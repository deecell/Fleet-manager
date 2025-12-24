# Terraform Remote State Bootstrap

This document describes how to set up remote state for the Deecell Fleet Tracking infrastructure.

## Prerequisites

- AWS CLI configured with AdministratorAccess
- Terraform 1.6+ installed

## Step 1: Create S3 Bucket for State

```bash
aws s3api create-bucket \
  --bucket deecell-terraform-state \
  --region us-east-2 \
  --create-bucket-configuration LocationConstraint=us-east-2

aws s3api put-bucket-versioning \
  --bucket deecell-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket deecell-terraform-state \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }
    ]
  }'

aws s3api put-public-access-block \
  --bucket deecell-terraform-state \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }'
```

## Step 2: Create DynamoDB Table for Locking

```bash
aws dynamodb create-table \
  --table-name deecell-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-2
```

## Step 3: Enable Remote Backend

Uncomment the backend configuration in `terraform/main.tf`:

```hcl
backend "s3" {
  bucket         = "deecell-terraform-state"
  key            = "production/terraform.tfstate"
  region         = "us-east-2"
  encrypt        = true
  dynamodb_table = "deecell-terraform-locks"
}
```

## Step 4: Migrate State

```bash
cd terraform
terraform init -migrate-state
```

When prompted, type `yes` to copy existing state to the remote backend.

## Naming Convention

All resources follow a deterministic naming pattern:

| Resource Type | Pattern | Example |
|---------------|---------|---------|
| Standard resources | `{project}-{env}-{name}` | `deecell-fleet-production-vpc` |
| Globally unique (S3) | `{project}-{env}-{name}-{account_suffix}` | `deecell-fleet-production-cloudtrail-13647605` |

The `unique_suffix` is derived from the last 8 characters of the AWS account ID, ensuring:
- Deterministic naming (same result every run)
- Global uniqueness for S3 buckets
- No random drift between applies

## Cleanup Before Fresh Deploy

Before running Terraform on a new environment, ensure no conflicting resources exist:

```bash
# List all resources with the project prefix
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=deecell-fleet \
  --region us-east-2

# Delete specific resource types if they exist:
# - EC2: Auto Scaling Groups, Launch Templates, Instances
# - ECS: Services, Clusters
# - RDS: Database instances
# - ALB: Load Balancers, Target Groups
# - IAM: Roles, Policies (except GitHub Actions user)
# - S3: Buckets with project prefix
# - Secrets Manager: Secrets with project prefix
```

## Troubleshooting

### "Resource already exists" Error

If Terraform fails because a resource already exists:

1. Delete the resource in AWS Console
2. Wait 5 minutes (for ALB/Target Groups)
3. Re-run `terraform apply`

### State Drift

If state becomes out of sync:

```bash
# Refresh state from AWS
terraform refresh

# Or for specific resource
terraform import aws_instance.example i-1234567890abcdef0
```

### Lock Issues

If a lock is stuck:

```bash
terraform force-unlock LOCK_ID
```
