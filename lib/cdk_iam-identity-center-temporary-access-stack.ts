import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as snssub from "aws-cdk-lib/aws-sns-subscriptions";
import {
    AutomationDocument,
    AwsApiStep,
    ApproveStep,
    DataTypeEnum,
    DocumentFormat,
    Input,
    HardCodedString,
    HardCodedStringList,
    AwsService,
    OnFailure,
} from "@cdklabs/cdk-ssm-documents";
require("dotenv").config();

export class CdkIamIdentityCenterTemporaryAccessStack extends cdk.Stack {
    readonly myDoc: AutomationDocument;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        const approverroleArn: string = process.env.APPROVER_ROLE_ARN ?? "";
        const snsSubEmail: string = process.env.SNS_SUB_EMAIL ?? "";
        const iamIdentitycenterArn: string =
            process.env.IAM_IDENTITYCENTER_ARN ?? "";
        const adminPermissionsetArn: string =
            process.env.ADMIN_PERMISSIONSET_ARN ?? "";
        const idStoreID: string =
            process.env.IAM_IDENTITYCENTER_IDSTORE_ID ?? "";
        // IAM Role
        // Lambdaが使用するIAMロール
        const lambdarole = new iam.Role(this, "mylambdarole", {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                ["accountassignment"]: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            actions: [
                                "sso:CreateAccountAssignment",
                                "sso:DeleteAccountAssignment",
                                "identitystore:ListUsers",
                                "scheduler:DeleteSchedule",
                            ],
                            effect: iam.Effect.ALLOW,
                            resources: ["*"],
                        }),
                    ],
                }),
            },
        });
        lambdarole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                "service-role/AWSLambdaBasicExecutionRole"
            )
        );
        // EventBridgeSchedulerが使用するIAMロール
        const schedulerrole = new iam.Role(this, "myschedulerrole", {
            assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
            inlinePolicies: {
                ["accountassignment"]: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            actions: ["lambda:InvokeFunction"],
                            effect: iam.Effect.ALLOW,
                            resources: ["*"],
                        }),
                    ],
                }),
            },
        });
        // 作成するAutomation Runbookが使用するサービスロール
        const automationrole = new iam.Role(this, "myautomationrole", {
            //roleName: "AutomationServiceRole",
            assumedBy: new iam.ServicePrincipal(
                "ssm.amazonaws.com"
            ).withConditions({
                ["StringEquals"]: {
                    "aws:SourceAccount": cdk.Stack.of(this).account,
                },
                ["ArnLike"]: {
                    "aws:SourceArn": `arn:aws:ssm:*:${
                        cdk.Stack.of(this).account
                    }:automation-execution/*`,
                },
            }),
        });
        automationrole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                "service-role/AmazonSSMAutomationRole"
            )
        );
        automationrole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                "AmazonEventBridgeSchedulerFullAccess"
            )
        );

        // 承認ステップに入ったときに通知で使用するSNS
        const mysns = new sns.Topic(this, "mysns", {
            topicName: "AutomationSnsTopic",
        });
        mysns.addSubscription(new snssub.EmailSubscription(snsSubEmail));

        // Lambda function
        const myLambda = new lambda.Function(this, "MyLambda", {
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: "lambda_function.lambda_handler",
            code: lambda.Code.fromAsset("lambda_src"),
            role: lambdarole,
            environment: {
                ["IAM_IDENTITYCENTER_ARN"]: iamIdentitycenterArn,
                ["ADMIN_PERMISSIONSET_ARN"]: adminPermissionsetArn,
                ["IAM_IDENTITYCENTER_IDSTORE_ID"]: idStoreID,
            },
        });

        // Systems Manager Automation Runbook
        this.myDoc = new AutomationDocument(this, "myAutomationRunbook", {
            documentFormat: DocumentFormat.YAML,
            tags: [{ key: "myTag", value: "myValue" }],
            documentName: "TemporaryPrivilegeWorkflow",
            description:
                "Temporary Privilege Workflow for IAM Identity Center.",
            assumeRole: HardCodedString.of(automationrole.roleArn),
            updateMethod: "NewVersion",
            docInputs: [
                Input.ofTypeString("StartTime", {
                    defaultValue: "2022-11-20T13:00:00",
                    allowedPattern:
                        "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$",
                    description: "(Required) Specify authority use start time.",
                }),
                Input.ofTypeString("EndTime", {
                    defaultValue: "2022-11-20T13:00:00",
                    allowedPattern:
                        "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$",
                    description: "(Required) Specify authority use end time.",
                }),
                Input.ofTypeString("AccountID", {
                    defaultValue: "123456789012",
                    allowedPattern: "[0-9]{12}",
                    description:
                        "(Required) AWS account ID you wish to login with.",
                }),
                Input.ofTypeString("UserName", {
                    defaultValue: "test",
                    description:
                        "(Required) User name used for identitycenter login.",
                }),
            ],
        });
        const approveStep = new ApproveStep(this, "approve", {
            approvers: HardCodedStringList.of([approverroleArn]),
            notificationArn: HardCodedString.of(mysns.topicArn),
            message: HardCodedString.of("Do you approve?"),
            onFailure: OnFailure.abort(),
        });

        const setStartSchdulerStep = new AwsApiStep(this, "startschduler", {
            service: AwsService.SCHEDULER,
            pascalCaseApi: "CreateSchedule", // 実行する API オペレーション名
            apiParams: {
                Name: "StartAccountLinking{{global:DATE_TIME}}",
                FlexibleTimeWindow: {
                    Mode: "OFF",
                },
                ScheduleExpression: "at({{StartTime}})",
                ScheduleExpressionTimezone: "Asia/Tokyo",
                Target: {
                    Arn: HardCodedString.of(myLambda.functionArn),
                    RoleArn: HardCodedString.of(schedulerrole.roleArn),
                    Input: JSON.stringify({
                        accountid: "{{AccountID}}",
                        username: "{{UserName}}",
                        action: "create",
                        schedulerarn: "<aws.scheduler.schedule-arn>",
                    }),
                },
            },
            outputs: [
                {
                    outputType: DataTypeEnum.STRING,
                    name: "ScheduleArn",
                    selector: "$.ScheduleArn",
                },
            ],
        });
        const setEndSchdulerStep = new AwsApiStep(this, "endschduler", {
            service: AwsService.SCHEDULER,
            pascalCaseApi: "CreateSchedule", // 実行する API オペレーション名
            apiParams: {
                Name: "EndAccountLinking{{global:DATE_TIME}}",
                FlexibleTimeWindow: {
                    Mode: "OFF",
                },
                ScheduleExpression: "at({{EndTime}})",
                ScheduleExpressionTimezone: "Asia/Tokyo",
                Target: {
                    Arn: HardCodedString.of(myLambda.functionArn),
                    RoleArn: HardCodedString.of(schedulerrole.roleArn),
                    Input: JSON.stringify({
                        accountid: "{{AccountID}}",
                        username: "{{UserName}}",
                        action: "delete",
                        schedulerarn: "<aws.scheduler.schedule-arn>",
                    }),
                },
            },
            isEnd: true,
            outputs: [
                {
                    outputType: DataTypeEnum.STRING,
                    name: "ScheduleArn",
                    selector: "$.ScheduleArn",
                },
            ],
        });
        this.myDoc.addStep(approveStep);
        this.myDoc.addStep(setStartSchdulerStep);
        this.myDoc.addStep(setEndSchdulerStep);
    }
}
