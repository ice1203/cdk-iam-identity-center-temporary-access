# Requirement

-   AWS Organizations
    -   AWS アカウントが AWS Organizations 組織に参加していること
-   IAM Identity Center
    -   ユーザーは作成済み
    -   許可セットは作成済み

# Install

```
$ git clone git@github.com:ice1203/cdk-iam-identity-center-temporary-access.git
$ cd cdk-iam-identity-center-temporary-access/
# 環境変数を設定
$ vi .env

$ cat .env
APPROVER_ROLE_ARN=＜ワークフローを承認する管理者のIAMロールARN＞
SNS_SUB_EMAIL=＜ワークフローを承認する管理者のメールアドレス＞
IAM_IDENTITYCENTER_ARN=＜IAM Identity CenterのARN、マネージメントコンソールのIAM Identity Center画面の左ペインの「設定」から確認可能＞
IAM_IDENTITYCENTER_IDSTORE_ID=＜IAM Identity CenterのIDストアID、マネージメントコンソールのIAM Identity Center画面の左ペインの「設定」から確認可能＞
ADMIN_PERMISSIONSET_ARN=＜IAM Identity Centerの許可セットARN、申請者にこの許可セットが付与される＞

$ npm install
# CDKでリソースをデプロイ
$ cdk deploy
```
