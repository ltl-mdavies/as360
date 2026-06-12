import { fileURLToPath } from "node:url";
import path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Adspace360FoundationStackProps = StackProps & {
  stageName: string;
  appDomainName: string;
  shortDomainName: string;
  appCertificateArn?: string;
  apiCertificateArn?: string;
};

function lambdaEntry(fileName: string) {
  return path.join(__dirname, "..", "lambda", fileName);
}

function privateBucket(scope: Construct, id: string, lifecycleRules: s3.LifecycleRule[] = []) {
  return new s3.Bucket(scope, id, {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    lifecycleRules,
    removalPolicy: RemovalPolicy.RETAIN,
  });
}

export class Adspace360FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props: Adspace360FoundationStackProps) {
    super(scope, id, props);

    const { stageName, appDomainName, shortDomainName, appCertificateArn, apiCertificateArn } = props;
    const appOrigin = `https://${appDomainName}`;
    const notificationsFromEmail = "noreply@adspace360.com";
    const appCertificate = appCertificateArn ? acm.Certificate.fromCertificateArn(this, "AppCertificate", appCertificateArn) : undefined;
    const apiCertificate = apiCertificateArn
      ? acm.Certificate.fromCertificateArn(this, "ApiCertificate", apiCertificateArn)
      : appCertificate;

    cdk.Tags.of(this).add("App", "Adspace360");
    cdk.Tags.of(this).add("Stage", stageName);

    const appBucket = privateBucket(this, "FrontendAppBucket");

    const venueAssetsBucket = privateBucket(this, "VenueAssetsBucket", [
      {
        id: "ExpireRawVenueImports",
        prefix: "raw-imports/",
        expiration: Duration.days(90),
      },
      {
        id: "ArchiveVenueWorkingFiles",
        prefix: "maps/",
        transitions: [{ storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(365) }],
      },
    ]);

    const projectAssetsBucket = privateBucket(this, "ProjectAssetsBucket", [
      {
        id: "MoveProjectWorkingFilesToIntelligentTiering",
        transitions: [{ storageClass: s3.StorageClass.INTELLIGENT_TIERING, transitionAfter: Duration.days(30) }],
      },
    ]);

    const generatedDocsBucket = privateBucket(this, "GeneratedDocsBucket", [
      {
        id: "ArchiveGeneratedDocs",
        transitions: [{ storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(365) }],
      },
    ]);

    const logsBucket = privateBucket(this, "LogsBucket", [
      {
        id: "ExpireOperationalLogs",
        expiration: Duration.days(90),
      },
    ]);

    for (const bucket of [venueAssetsBucket, projectAssetsBucket, generatedDocsBucket]) {
      bucket.addCorsRule({
        allowedOrigins: [appOrigin, "http://localhost:5173"],
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD, s3.HttpMethods.PUT],
        allowedHeaders: ["*"],
        exposedHeaders: ["ETag"],
        maxAge: 3000,
      });
    }

    const appDistribution = new cloudfront.Distribution(this, "AppDistribution", {
      defaultRootObject: "index.html",
      ...(appCertificate
        ? {
            domainNames: [appDomainName],
            certificate: appCertificate,
          }
        : {}),
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(appBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(5),
        },
      ],
    });

    const coreTable = new dynamodb.Table(this, "CoreTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    coreTable.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
    });

    coreTable.addGlobalSecondaryIndex({
      indexName: "gsi2",
      partitionKey: { name: "gsi2pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi2sk", type: dynamodb.AttributeType.STRING },
    });

    const auditTable = new dynamodb.Table(this, "AuditTable", {
      partitionKey: { name: "projectId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const shortLinksTable = new dynamodb.Table(this, "ShortLinksTable", {
      partitionKey: { name: "code", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const userPool = new cognito.UserPool(this, "AdminUserPool", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const userPoolClient = new cognito.UserPoolClient(this, "AdminUserPoolClient", {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
    });

    const api = new apigwv2.HttpApi(this, "ProductApi", {
      apiName: `adspace360-product-api-${stageName}`,
      corsPreflight: {
        allowOrigins: [appOrigin, "http://localhost:5173"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["authorization", "content-type", "x-share-token", "x-share-participant-id"],
        exposeHeaders: ["x-adspace-route-key", "x-adspace-route-ms"],
        maxAge: Duration.days(1),
      },
    });

    const cognitoAuthorizer = new authorizers.HttpUserPoolAuthorizer("AdminJwtAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
    });

    const healthFn = new lambdaNode.NodejsFunction(this, "HealthFunction", {
      entry: lambdaEntry("health.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: { minify: true, target: "node20", sourceMap: true },
      environment: {
        SERVICE_NAME: "adspace360-api",
      },
    });

    api.addRoutes({
      path: "/api/health",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("HealthIntegration", healthFn),
    });

    const uploadUrlFn = new lambdaNode.NodejsFunction(this, "CreateUploadUrlFunction", {
      entry: lambdaEntry("create-upload-url.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: { minify: true, target: "node20", sourceMap: true },
      environment: {
        CORE_TABLE_NAME: coreTable.tableName,
        VENUE_ASSETS_BUCKET_NAME: venueAssetsBucket.bucketName,
        PROJECT_ASSETS_BUCKET_NAME: projectAssetsBucket.bucketName,
        GENERATED_DOCS_BUCKET_NAME: generatedDocsBucket.bucketName,
        APP_ORIGIN: appOrigin,
      },
    });

    venueAssetsBucket.grantPut(uploadUrlFn);
    projectAssetsBucket.grantPut(uploadUrlFn);
    generatedDocsBucket.grantPut(uploadUrlFn);
    coreTable.grantReadData(uploadUrlFn);

    api.addRoutes({
      path: "/api/uploads/sign",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("UploadUrlIntegration", uploadUrlFn),
      authorizer: cognitoAuthorizer,
    });

    api.addRoutes({
      path: "/api/share/uploads/sign",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("ShareUploadUrlIntegration", uploadUrlFn),
    });

    const venueApiFn = new lambdaNode.NodejsFunction(this, "VenueApiFunction", {
      entry: lambdaEntry("venue-api.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: { minify: true, target: "node20", sourceMap: true },
      timeout: Duration.seconds(29),
      memorySize: 512,
      environment: {
        CORE_TABLE_NAME: coreTable.tableName,
        AUDIT_TABLE_NAME: auditTable.tableName,
        VENUE_ASSETS_BUCKET_NAME: venueAssetsBucket.bucketName,
      },
    });

    coreTable.grantReadWriteData(venueApiFn);
    auditTable.grantWriteData(venueApiFn);
    venueAssetsBucket.grantRead(venueApiFn);

    const venueRoutes: Array<{ path: string; method: apigwv2.HttpMethod }> = [
      { path: "/api/customers", method: apigwv2.HttpMethod.GET },
      { path: "/api/customers", method: apigwv2.HttpMethod.POST },
      { path: "/api/customers/{customerId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/customers/{customerId}/markets", method: apigwv2.HttpMethod.GET },
      { path: "/api/venues", method: apigwv2.HttpMethod.GET },
      { path: "/api/venues/{venueId}", method: apigwv2.HttpMethod.GET },
      { path: "/api/markets", method: apigwv2.HttpMethod.POST },
      { path: "/api/markets/{marketId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/venues", method: apigwv2.HttpMethod.POST },
      { path: "/api/venues/{venueId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/venues/{venueId}/maps", method: apigwv2.HttpMethod.POST },
      { path: "/api/venues/{venueId}/maps/{mapId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/venues/{venueId}/maps/{mapId}", method: apigwv2.HttpMethod.DELETE },
      { path: "/api/venues/{venueId}/variants/{variantId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/venues/{venueId}/inventory/import", method: apigwv2.HttpMethod.POST },
      { path: "/api/inventory/{inventoryItemId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/inventory/{inventoryItemId}", method: apigwv2.HttpMethod.DELETE },
      { path: "/api/inventory/{inventoryItemId}/placement", method: apigwv2.HttpMethod.PATCH },
    ];

    for (const route of venueRoutes) {
      api.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: new integrations.HttpLambdaIntegration(`Venue${route.method}${route.path}`.replace(/[^A-Za-z0-9]/g, ""), venueApiFn),
        authorizer: cognitoAuthorizer,
      });
    }

    const projectApiFn = new lambdaNode.NodejsFunction(this, "ProjectApiFunction", {
      entry: lambdaEntry("project-api.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: { minify: true, target: "node20", sourceMap: true },
      timeout: Duration.seconds(29),
      memorySize: 512,
      environment: {
        CORE_TABLE_NAME: coreTable.tableName,
        AUDIT_TABLE_NAME: auditTable.tableName,
        PROJECT_ASSETS_BUCKET_NAME: projectAssetsBucket.bucketName,
        VENUE_ASSETS_BUCKET_NAME: venueAssetsBucket.bucketName,
        GENERATED_DOCS_BUCKET_NAME: generatedDocsBucket.bucketName,
        SHORT_LINKS_TABLE_NAME: shortLinksTable.tableName,
        APP_BASE_URL: appOrigin,
        SHORT_BASE_URL: `https://${shortDomainName}`,
        NOTIFICATIONS_FROM_EMAIL: notificationsFromEmail,
      },
    });

    coreTable.grantReadWriteData(projectApiFn);
    auditTable.grantReadWriteData(projectApiFn);
    projectAssetsBucket.grantRead(projectApiFn);
    venueAssetsBucket.grantRead(projectApiFn);
    generatedDocsBucket.grantReadWrite(projectApiFn);
    shortLinksTable.grantReadWriteData(projectApiFn);
    projectApiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      })
    );

    const notificationDigestFn = new lambdaNode.NodejsFunction(this, "NotificationDigestFunction", {
      entry: lambdaEntry("notification-digest.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: { minify: true, target: "node20", sourceMap: true },
      environment: {
        CORE_TABLE_NAME: coreTable.tableName,
        APP_BASE_URL: appOrigin,
        NOTIFICATIONS_FROM_EMAIL: notificationsFromEmail,
      },
    });

    coreTable.grantReadWriteData(notificationDigestFn);
    notificationDigestFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      })
    );
    new events.Rule(this, "NotificationDigestHourlyRule", {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(notificationDigestFn)],
    });

    const projectRoutes: Array<{ path: string; method: apigwv2.HttpMethod }> = [
      { path: "/api/projects", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects", method: apigwv2.HttpMethod.POST },
      { path: "/api/projects/{projectId}", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects/{projectId}/workspace", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects/{projectId}/lift-order-url", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects/{projectId}/activity", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects/{projectId}/documents", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects/{projectId}/documents", method: apigwv2.HttpMethod.POST },
      { path: "/api/projects/{projectId}/errors", method: apigwv2.HttpMethod.POST },
      { path: "/api/projects/{projectId}/share-links", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects/{projectId}/share-links", method: apigwv2.HttpMethod.POST },
      { path: "/api/share-links/{shareLinkId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/projects/{projectId}/creatives", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects/{projectId}/creatives", method: apigwv2.HttpMethod.POST },
      { path: "/api/projects/{projectId}/creatives/{creativeId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/projects/{projectId}/creatives/{creativeId}", method: apigwv2.HttpMethod.DELETE },
      { path: "/api/projects/{projectId}/submit", method: apigwv2.HttpMethod.POST },
      { path: "/api/projects/{projectId}/release-production", method: apigwv2.HttpMethod.POST },
      { path: "/api/projects/{projectId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/projects/{projectId}/assignments/{inventoryId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/projects/{projectId}/proofs", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects/{projectId}/proofs/{lineItemId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/projects/{projectId}/transit", method: apigwv2.HttpMethod.GET },
      { path: "/api/projects/{projectId}/transit", method: apigwv2.HttpMethod.PUT },
      { path: "/api/admin/settings", method: apigwv2.HttpMethod.GET },
      { path: "/api/admin/settings", method: apigwv2.HttpMethod.PATCH },
    ];

    for (const route of projectRoutes) {
      api.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: new integrations.HttpLambdaIntegration(`Project${route.method}${route.path}`.replace(/[^A-Za-z0-9]/g, ""), projectApiFn),
        authorizer: cognitoAuthorizer,
      });
    }

    const publicProjectRoutes: Array<{ path: string; method: apigwv2.HttpMethod }> = [
      { path: "/api/share-links/resolve", method: apigwv2.HttpMethod.GET },
      { path: "/api/share-links/identify", method: apigwv2.HttpMethod.POST },
      { path: "/api/share/projects/{projectId}", method: apigwv2.HttpMethod.GET },
      { path: "/api/share/projects/{projectId}/workspace", method: apigwv2.HttpMethod.GET },
      { path: "/api/share/projects/{projectId}/documents", method: apigwv2.HttpMethod.GET },
      { path: "/api/share/projects/{projectId}/errors", method: apigwv2.HttpMethod.POST },
      { path: "/api/share/projects/{projectId}/creatives", method: apigwv2.HttpMethod.GET },
      { path: "/api/share/projects/{projectId}/creatives", method: apigwv2.HttpMethod.POST },
      { path: "/api/share/projects/{projectId}/creatives/{creativeId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/share/projects/{projectId}/creatives/{creativeId}", method: apigwv2.HttpMethod.DELETE },
      { path: "/api/share/projects/{projectId}/submit", method: apigwv2.HttpMethod.POST },
      { path: "/api/share/projects/{projectId}/assignments/{inventoryId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/share/projects/{projectId}/proofs", method: apigwv2.HttpMethod.GET },
      { path: "/api/share/projects/{projectId}/proofs/{lineItemId}", method: apigwv2.HttpMethod.PATCH },
      { path: "/api/share/projects/{projectId}/transit", method: apigwv2.HttpMethod.GET },
      { path: "/api/share/projects/{projectId}/transit", method: apigwv2.HttpMethod.PUT },
    ];

    for (const route of publicProjectRoutes) {
      api.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: new integrations.HttpLambdaIntegration(`PublicProject${route.method}${route.path}`.replace(/[^A-Za-z0-9]/g, ""), projectApiFn),
      });
    }

    const redirectApi = new apigwv2.HttpApi(this, "ShortLinkRedirectApi", {
      apiName: `adspace360-short-links-${stageName}`,
    });

    const redirectFn = new lambdaNode.NodejsFunction(this, "ShortLinkRedirectFunction", {
      entry: lambdaEntry("short-redirect.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: { minify: true, target: "node20", sourceMap: true },
      environment: {
        SHORT_LINKS_TABLE_NAME: shortLinksTable.tableName,
        APP_BASE_URL: appOrigin,
      },
    });

    shortLinksTable.grantReadData(redirectFn);

    redirectApi.addRoutes({
      path: "/{code}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("ShortLinkRedirectIntegration", redirectFn),
    });

    const shortDomain = apiCertificate
      ? new apigwv2.DomainName(this, "ShortLinkDomainName", {
          domainName: shortDomainName,
          certificate: apiCertificate,
        })
      : undefined;

    if (shortDomain) {
      new apigwv2.ApiMapping(this, "ShortLinkApiMapping", {
        api: redirectApi,
        domainName: shortDomain,
      });
    }

    new cdk.CfnOutput(this, "AppDomain", { value: appOrigin });
    new cdk.CfnOutput(this, "ShortLinkDomain", { value: `https://${shortDomainName}` });
    new cdk.CfnOutput(this, "ApiEndpoint", { value: api.apiEndpoint });
    new cdk.CfnOutput(this, "ShortLinkRedirectEndpoint", { value: redirectApi.apiEndpoint });
    new cdk.CfnOutput(this, "FrontendBucketName", { value: appBucket.bucketName });
    new cdk.CfnOutput(this, "VenueAssetsBucketName", { value: venueAssetsBucket.bucketName });
    new cdk.CfnOutput(this, "ProjectAssetsBucketName", { value: projectAssetsBucket.bucketName });
    new cdk.CfnOutput(this, "GeneratedDocsBucketName", { value: generatedDocsBucket.bucketName });
    new cdk.CfnOutput(this, "LogsBucketName", { value: logsBucket.bucketName });
    new cdk.CfnOutput(this, "CoreTableName", { value: coreTable.tableName });
    new cdk.CfnOutput(this, "AuditTableName", { value: auditTable.tableName });
    new cdk.CfnOutput(this, "ShortLinksTableName", { value: shortLinksTable.tableName });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "GoDaddyAppCnameName", { value: appDomainName });
    new cdk.CfnOutput(this, "GoDaddyAppCnameValue", { value: appDistribution.distributionDomainName });
    new cdk.CfnOutput(this, "CustomDomainStatus", {
      value: appCertificate ? "Custom domains enabled" : "Provide appCertificateArn to enable app.adspace360.com",
    });

    if (shortDomain) {
      new cdk.CfnOutput(this, "GoDaddyShortCnameName", { value: shortDomainName });
      new cdk.CfnOutput(this, "GoDaddyShortCnameValue", { value: shortDomain.regionalDomainName });
    } else {
      new cdk.CfnOutput(this, "GoDaddyShortCnameValue", {
        value: "Provide appCertificateArn or apiCertificateArn context to enable go.adspace360.com",
      });
    }
  }
}
