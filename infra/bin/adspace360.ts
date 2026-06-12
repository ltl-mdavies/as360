#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { Adspace360FoundationStack } from "../lib/adspace360-foundation-stack.js";

const app = new cdk.App();

const stageName = app.node.tryGetContext("stageName") || "dev";
const appDomainName = app.node.tryGetContext("appDomainName") || "app.adspace360.com";
const shortDomainName = app.node.tryGetContext("shortDomainName") || "go.adspace360.com";
const appCertificateArn = app.node.tryGetContext("appCertificateArn") || process.env.ADSP_APP_CERTIFICATE_ARN;
const apiCertificateArn = app.node.tryGetContext("apiCertificateArn") || process.env.ADSP_API_CERTIFICATE_ARN;

new Adspace360FoundationStack(app, "Adspace360FoundationStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  stageName,
  appDomainName,
  shortDomainName,
  appCertificateArn,
  apiCertificateArn,
});
