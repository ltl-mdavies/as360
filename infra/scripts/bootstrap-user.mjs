import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { randomBytes } from "node:crypto";

const STACK_NAME = process.env.STACK_NAME || "Adspace360FoundationStack";
const REGION = process.env.AWS_REGION || "us-east-1";

const cloudFormation = new CloudFormationClient({ region: REGION });
const dynamodb = new DynamoDBClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = required(args.email, "email");
  const role = required(args.role, "role");
  if (!["platform_admin", "customer_admin", "vendor_admin", "vendor_user"].includes(role)) {
    throw new Error('role must be "platform_admin", "customer_admin", "vendor_admin", or "vendor_user"');
  }

  const stack = await describeStack(STACK_NAME);
  const userPoolId = output(stack, "UserPoolId");
  const coreTableName = output(stack, "CoreTableName");
  const now = new Date().toISOString();
  const displayName = args.name || email.split("@")[0];
  const temporaryPassword = args["temporary-password"] || args.password || "";

  const { user, created, issuedTemporaryPassword } = await getOrCreateCognitoUser({
    userPoolId,
    email,
    displayName,
    temporaryPassword,
    resetPassword: args["reset-password"] === "true",
    suppressInvite: args["send-invite"] !== "true",
  });

  const sub = attribute(user, "sub");
  if (!sub) throw new Error(`Could not resolve Cognito sub for ${email}`);

  const resolvedDisplayName = args.name || attribute(user, "name") || displayName;
  const requestedCustomerIds = (args.customers || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestedVendorAccountIds = (args.vendors || args["vendor-accounts"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const isVendorRole = role === "vendor_admin" || role === "vendor_user";
  if (isVendorRole && !requestedVendorAccountIds.length) {
    throw new Error("vendor roles require --vendors or --vendor-accounts");
  }

  const customerIds = isVendorRole ? [] : requestedCustomerIds;
  const vendorAccountIds = isVendorRole ? requestedVendorAccountIds : [];

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
          gsi2sk: `USER#${resolvedDisplayName.toLowerCase()}#${sub}`,
          entityType: "UserProfile",
          id: sub,
          cognitoSub: sub,
          email: email.toLowerCase(),
          displayName: resolvedDisplayName,
          role,
          customerIds,
          vendorAccountIds,
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
        cognitoUserCreated: created,
        role,
        customerIds,
        vendorAccountIds,
        temporaryPassword: issuedTemporaryPassword || undefined,
      },
      null,
      2
    )
  );
}

async function getOrCreateCognitoUser({ userPoolId, email, displayName, temporaryPassword, resetPassword, suppressInvite }) {
  try {
    const existing = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: email,
      })
    );
    if (temporaryPassword && resetPassword) {
      await cognito.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: userPoolId,
          Username: email,
          Password: temporaryPassword,
          Permanent: false,
        })
      );
      return { user: existing, created: false, issuedTemporaryPassword: temporaryPassword };
    }
    return { user: existing, created: false, issuedTemporaryPassword: "" };
  } catch (error) {
    if (error?.name !== "UserNotFoundException") throw error;
  }

  const password = temporaryPassword || generateTemporaryPassword();
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      TemporaryPassword: password,
      MessageAction: suppressInvite ? "SUPPRESS" : undefined,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: displayName },
      ],
    })
  );

  const user = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: email,
    })
  );

  return { user, created: true, issuedTemporaryPassword: password };
}

function generateTemporaryPassword() {
  return `As360-${randomBytes(9).toString("base64url")}!7`;
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
