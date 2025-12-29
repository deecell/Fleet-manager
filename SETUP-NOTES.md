# Deecell Fleet - Infrastructure Setup Notes

## Overview

Infrastructure changes are managed manually via AWS CloudShell (not GitHub Actions).
This provides better security by keeping admin-level AWS permissions out of CI/CD.

App deployments (ECS, Device Manager) still run automatically via GitHub Actions.

---

## One-Time CloudShell Setup

Run these commands the first time you use CloudShell for Terraform:

```bash
# Install Terraform 1.6.0
curl -fsSL https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip -o tf.zip
unzip tf.zip && sudo mv terraform /usr/local/bin/
rm tf.zip

# Verify installation
terraform version

# Clone the repository
git clone https://github.com/deecellglobal/fleet-tracking.git
cd fleet-tracking/terraform

# Initialize Terraform (connects to S3 backend)
terraform init
```

---

## Making Infrastructure Changes

When you need to modify AWS infrastructure:

### 1. Open CloudShell

1. Log into AWS Console: https://console.aws.amazon.com
2. Make sure you're in **us-east-2** region
3. Click the CloudShell icon (terminal icon in top navigation bar)

### 2. Pull Latest Changes

```bash
cd ~/fleet-tracking
git pull origin main
cd terraform
```

### 3. Run Terraform Plan

Review what will change before applying:

```bash
# Set your variables (replace with actual values)
export TF_VAR_db_password="your-db-password"
export TF_VAR_session_secret="your-session-secret"
export TF_VAR_admin_password="your-admin-password"

# Run plan
terraform plan \
  -var="ecr_repository_url=892213647605.dkr.ecr.us-east-2.amazonaws.com/deecell-fleet" \
  -var="domain_name=app.deecell.com"
```

### 4. Apply Changes

If the plan looks correct:

```bash
terraform apply \
  -var="ecr_repository_url=892213647605.dkr.ecr.us-east-2.amazonaws.com/deecell-fleet" \
  -var="domain_name=app.deecell.com"
```

Type `yes` when prompted to confirm.

---

## Important Notes

- **CloudShell sessions persist for 120 days** - your clone and Terraform will be there
- **If session expires**, re-run the one-time setup commands
- **Secrets**: The variables above are also stored in AWS Secrets Manager:
  - `deecell-fleet-production/database-url`
  - `deecell-fleet-production/session-secret`
  - `deecell-fleet-production/admin-password`

---

## Getting Secret Values

If you need to retrieve the current secret values:

```bash
# Database URL
aws secretsmanager get-secret-value \
  --secret-id deecell-fleet-production/database-url \
  --query SecretString --output text

# Session Secret
aws secretsmanager get-secret-value \
  --secret-id deecell-fleet-production/session-secret-13647605 \
  --query SecretString --output text

# Admin Password
aws secretsmanager get-secret-value \
  --secret-id deecell-fleet-production/admin-password-13647605 \
  --query SecretString --output text
```

---

## GitHub Actions Workflows

| Workflow | Purpose | Trigger |
|----------|---------|---------|
| Deploy to AWS | Build & deploy web app to ECS | Push to main |
| Deploy Device Manager | Deploy device polling service to EC2 | Manual or device-manager/ changes |
| Terraform | **DISABLED** - Run manually via CloudShell | N/A |

---

## IAM Permissions Summary

**GitHub Actions IAM User** (`deecell-terraform`):
- ECR: Push/pull container images
- ECS: Update services, register task definitions
- S3: Device Manager deployment artifacts
- SSM: Send commands to EC2 instances
- Secrets Manager: Read database URL
- CloudWatch Logs: Read logs

**Your AWS Console User**:
- Full administrator access for infrastructure changes

---

## Troubleshooting

### CloudShell Terraform Not Found
Re-run the installation:
```bash
curl -fsSL https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip -o tf.zip
unzip tf.zip && sudo mv terraform /usr/local/bin/
```

### State Lock Error
If Terraform shows a lock error, another process may be running. Wait or force unlock:
```bash
terraform force-unlock LOCK_ID
```

### Plan Shows Unexpected Deletions
Always review the plan carefully. If resources show as deleted unexpectedly, check:
1. You're on the correct AWS account (892213647605)
2. You're in the correct region (us-east-2)
3. State file hasn't been corrupted

---

## IAM Cleanup (One-Time)

After switching to CloudShell for Terraform, clean up unused IAM resources:

### Step 1: Delete Unused Policy

1. Go to **IAM → Policies** in AWS Console
2. Search for `DeecellGitHubActionsPolicy` (the manually created one, not the Terraform-managed one)
3. If it exists and has **0 attached entities**, delete it

### Step 2: Remove Terraform State Permissions (Optional)

The GitHub Actions policy (`deecell-fleet-production-github-actions-policy`) may still have Terraform-related permissions. These can be removed since Terraform no longer runs via GitHub Actions:

**Permissions to keep** (needed for app deployments):
- `ecr:*` - Container image push/pull
- `ecs:*` - ECS service updates
- `ssm:*` - EC2 command execution
- `secretsmanager:GetSecretValue` - Read database URL
- `logs:*` - CloudWatch logs
- `s3:*` on deployment bucket - Device Manager artifacts
- `iam:PassRole` - ECS task execution

**Permissions that could be removed** (only needed for Terraform):
- S3 access to `terraform-state-*` bucket (if separate from deployment bucket)
- DynamoDB access to `terraform-locks` table
- Any `iam:*` beyond PassRole

**Note**: The current policy is minimal and may already be optimized. Only modify if you see excess permissions.

### Step 3: Verify Deployments Still Work

After any IAM changes, trigger a test deployment:
1. Make a small change to any file (not in terraform/ or device-manager/)
2. Push to main
3. Check GitHub Actions → "Deploy to AWS" workflow succeeds

---

## AWS Resources Reference

| Resource | ARN/ID |
|----------|--------|
| AWS Account | `892213647605` |
| Region | `us-east-2` |
| ECR Repository | `deecell-fleet` |
| ECS Cluster | `deecell-fleet-production-cluster` |
| ECS Service | `deecell-fleet` |
| ALB | `deecell-fleet-production-alb` |
| RDS Instance | `deecell-fleet-production-postgres` |
| S3 Terraform State | `deecell-fleet-terraform-state-892213647605` |
| IAM User (CI/CD) | `deecell-terraform` |
| Domain | `app.deecell.com` |
