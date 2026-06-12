import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const STACK_NAME = process.env.STACK_NAME || "Adspace360FoundationStack";
const REGION = process.env.AWS_REGION || "us-east-1";

const cloudFormation = new CloudFormationClient({ region: REGION });
const dynamodb = new DynamoDBClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = required(args.email, "email");
  const role = required(args.role, "role");
  if (!["platform_admin", "customer_admin"].includes(role)) {
    throw new Error('role must be "platform_admin" or "customer_admin"');
  }

  const stack = await describeStack(STACK_NAME);
  const userPoolId = output(stack, "UserPoolId");
  const coreTableName = output(stack, "CoreTableName");
  const now = new Date().toISOString();

  const user = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: email,
    })
  );

  const sub = attribute(user, "sub");
  if (!sub) throw new Error(`Could not resolve Cognito sub for ${email}`);

  const displayName = args.name || attribute(user, "name") || email.split("@")[0];
  const customerIds = (args.customers || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  await dynamodb.send(
    new PutItemCommand({
      TableName: coreTableName,
      Item: marshall(
        {
          pk: `USER#${sub}`,
          sk: "PROFILE",
          gsi1pk: `USER_EMAIL#${email.toLowerCase()}`,
          gsi1sk: "PROFILE",
          gsi2pk: `ROLE#${role}`,
          gsi2sk: `USER#${displayName.toLowerCase()}#${sub}`,
          entityType: "UserProfile",
          id: sub,
          cognitoSub: sub,
          email: email.toLowerCase(),
          displayName,
          role,
          customerIds,
          isActive: args.active !== "false",
          createdAt: now,
          updatedAt: now,
        },
        { removeUndefinedValues: true }
      ),
    })
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        stack: STACK_NAME,
        userPoolId,
        coreTableName,
        email,
        cognitoSub: sub,
        role,
        customerIds,
      },
      null,
      2
    )
  );
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

async function describeStack(stackName) {
  const response = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
  const stack = response.Stacks?.[0];
  if (!stack) throw new Error(`CloudFormation stack ${stackName} not found`);
  return stack;
}

function output(stack, key) {
  const value = stack.Outputs?.find((item) => item.OutputKey === key)?.OutputValue;
  if (!value) throw new Error(`Missing stack output ${key}`);
  return value;
}

function attribute(user, name) {
  return user.UserAttributes?.find((item) => item.Name === name)?.Value || "";
}

function required(value, key) {
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
