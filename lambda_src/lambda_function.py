import boto3
import json
import os
import sys

print('Loading function')

# AWS clients
sso = boto3.client('sso-admin')
scheduler = boto3.client('scheduler')
identitystore = boto3.client('identitystore')

# Environment variables
iamIdentitycenterArn = os.getenv('IAM_IDENTITYCENTER_ARN', '')
adminPermissionsetArn = os.getenv('ADMIN_PERMISSIONSET_ARN', '')
idStoreID = os.getenv('IAM_IDENTITYCENTER_IDSTORE_ID', '')


def get_user_id(event):
    """Fetch user id based on username from the event"""
    users = identitystore.list_users(
        IdentityStoreId=idStoreID,
        Filters=[{'AttributePath': 'UserName',
                  'AttributeValue': event['username']}]
    )
    return users["Users"][0]["UserId"]


def lambda_handler(event, context):
    try:
        # print(f"Received event: {json.dumps(event)}")
        user_id = get_user_id(event)

        assignment_args = {
            'InstanceArn': iamIdentitycenterArn,
            'TargetId': event['accountid'],
            'TargetType': 'AWS_ACCOUNT',
            'PermissionSetArn': adminPermissionsetArn,
            'PrincipalType': 'USER',
            'PrincipalId': user_id
        }

        # Perform action based on the event
        if event['action'] == "create":
            response = sso.create_account_assignment(**assignment_args)
        elif event['action'] == "delete":
            response = sso.delete_account_assignment(**assignment_args)
        else:
            print(f"Unknown action: {event['action']}")
            sys.exit(1)

        # if response:
        #    print(response)

        # Delete schedule
        response = scheduler.delete_schedule(
            Name=event['schedulerarn'].rsplit('/', 1)[1])
        # if response:
        #    print(response)
    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)
