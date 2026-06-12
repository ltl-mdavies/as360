import { BatchWriteItemCommand, DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const STACK_NAME = process.env.STACK_NAME || "Adspace360FoundationStack";
const REGION = process.env.AWS_REGION || "us-east-1";
const TARGET = {
  customerId: "outfront_media",
  marketId: "market_outfront_nyc",
  venueId: "venue_outfront_penn_station",
};

const cloudformation = new CloudFormationClient({ region: REGION });
const dynamodb = new DynamoDBClient({ region: REGION });

async function main() {
  const { coreTableName, auditTableName } = await resolveStackTables();
  console.log(`Using core table ${coreTableName}`);

  const projectRefs = await scanProjects(coreTableName);
  const userRefs = await scanUserProfiles(coreTableName);
  if (projectRefs.length || userRefs.length) {
    console.error("Purge aborted because live references still exist.");
    if (projectRefs.length) {
      console.error("Project references:");
      console.error(JSON.stringify(projectRefs, null, 2));
    }
    if (userRefs.length) {
      console.error("User profile references:");
      console.error(JSON.stringify(userRefs, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  const customerPartition = await queryByPk(coreTableName, `CUSTOMER#${TARGET.customerId}`);
  const venueProfiles = await queryByGsi1(coreTableName, `CUSTOMER#${TARGET.customerId}`, "VENUE#");
  const venuePartitions = (
    await Promise.all(
      venueProfiles
        .filter((item) => item.entityType === "Venue")
        .map((venue) => queryByPk(coreTableName, `VENUE#${venue.id}`))
    )
  ).flat();

  const keys = dedupeKeys(
    [...customerPartition, ...venuePartitions].map((item) => ({
      pk: item.pk,
      sk: item.sk,
    }))
  );

  if (!keys.length) {
    console.log("No OutFront records were found. Nothing to purge.");
    return;
  }

  console.log(`Deleting ${keys.length} records for ${TARGET.customerId}...`);
  await deleteKeys(coreTableName, keys);

  if (auditTableName) {
    await writeAudit(auditTableName, keys.length);
  }

  console.log("OutFront Media purge completed successfully.");
}

async function resolveStackTables() {
  const response = await cloudformation.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  const outputs = response.Stacks?.[0]?.Outputs || [];
  const outputValue = (key) => outputs.find((output) => output.OutputKey === key)?.OutputValue || "";
  const coreTableName = outputValue("CoreTableName");
  if (!coreTableName) {
    throw new Error(`Could not resolve CoreTableName from stack ${STACK_NAME}`);
  }
  return {
    coreTableName,
    auditTableName: outputValue("AuditTableName"),
  };
}

async function queryByPk(tableName, pk) {
  const response = await dynamodb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: marshall({ ":pk": pk }),
    })
  );
  return (response.Items || []).map((item) => unmarshall(item));
}

async function queryByGsi1(tableName, gsi1pk, gsi1skPrefix) {
  const response = await dynamodb.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :gsi1pk AND begins_with(gsi1sk, :gsi1skPrefix)",
      ExpressionAttributeValues: marshall({
        ":gsi1pk": gsi1pk,
        ":gsi1skPrefix": gsi1skPrefix,
      }),
    })
  );
  return (response.Items || []).map((item) => unmarshall(item));
}

async function scanProjects(tableName) {
  const response = await dynamodb.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression:
        "#entityType = :project AND (customerId = :customerId OR marketId = :marketId OR venueId = :venueId OR sourceCustomerId = :customerId)",
      ExpressionAttributeNames: { "#entityType": "entityType" },
      ExpressionAttributeValues: marshall({
        ":project": "Project",
        ":customerId": TARGET.customerId,
        ":marketId": TARGET.marketId,
        ":venueId": TARGET.venueId,
      }),
    })
  );
  return (response.Items || []).map((item) => unmarshall(item));
}

async function scanUserProfiles(tableName) {
  const response = await dynamodb.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: "#entityType = :profile AND contains(customerIds, :customerId)",
      ExpressionAttributeNames: { "#entityType": "entityType" },
      ExpressionAttributeValues: marshall({
        ":profile": "UserProfile",
        ":customerId": TARGET.customerId,
      }),
    })
  );
  return (response.Items || []).map((item) => unmarshall(item));
}

function dedupeKeys(keys) {
  const seen = new Set();
  return keys.filter((key) => {
    const composite = `${key.pk}::${key.sk}`;
    if (seen.has(composite)) return false;
    seen.add(composite);
    return true;
  });
}

async function deleteKeys(tableName, keys) {
  for (let index = 0; index < keys.length; index += 25) {
    const chunk = keys.slice(index, index + 25);
    await dynamodb.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: chunk.map((key) => ({
            DeleteRequest: {
              Key: marshall(key),
            },
          })),
        },
      })
    );
  }
}

async function writeAudit(auditTableName, deletedCount) {
  const createdAt = new Date().toISOString();
  await dynamodb.send(
    new PutItemCommand({
      TableName: auditTableName,
      Item: marshall(
        {
          projectId: `ADMIN_SETTINGS#CUSTOMER#${TARGET.customerId}`,
          scopeId: `ADMIN_SETTINGS#CUSTOMER#${TARGET.customerId}`,
          eventType: "customer.purged",
          actorType: "user",
          actorId: "system_cleanup",
          actorName: "System Cleanup",
          createdAt,
          detail: {
            customerId: TARGET.customerId,
            marketId: TARGET.marketId,
            venueId: TARGET.venueId,
            deletedCount,
          },
        },
        { removeUndefinedValues: true }
      ),
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
