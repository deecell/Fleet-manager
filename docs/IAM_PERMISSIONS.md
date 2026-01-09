# AWS IAM Permissions Documentation

This document describes all IAM roles, policies, and permissions used in the Deecell Fleet Tracking infrastructure.

---

## Overview

The Deecell infrastructure uses four main IAM principals:

| Principal | Type | Purpose |
|-----------|------|---------|
| ECS Execution Role | IAM Role | Pulls container images, writes logs, fetches secrets at task startup |
| ECS Task Role | IAM Role | Runtime permissions for the web application |
| Device Manager Role | IAM Role | EC2 instance permissions for the Device Manager service |
| GitHub Actions User | IAM User | CI/CD deployment automation |

---

## 1. ECS Execution Role

**Role Name**: `deecell-fleet-production-ecs-execution-role`

**Assumed By**: `ecs-tasks.amazonaws.com`

**Purpose**: Used by ECS to launch containers. This role is used *before* the application starts.

### Permissions

| Action | Resource | Purpose |
|--------|----------|---------|
| `ecr:GetAuthorizationToken` | * | Authenticate to ECR |
| `ecr:BatchCheckLayerAvailability` | * | Check image layers |
| `ecr:GetDownloadUrlForLayer` | * | Download image layers |
| `ecr:BatchGetImage` | * | Pull container images |
| `logs:CreateLogStream` | `/ecs/deecell-fleet-production:*` | Create log streams |
| `logs:PutLogEvents` | `/ecs/deecell-fleet-production:*` | Write application logs |
| `secretsmanager:GetSecretValue` | `deecell-fleet-production/database-url` | Inject DATABASE_URL |
| `secretsmanager:GetSecretValue` | `deecell-fleet-production/session-secret` | Inject SESSION_SECRET |
| `secretsmanager:GetSecretValue` | `deecell-fleet-production/admin-password` | Inject ADMIN_PASSWORD |

---

## 2. ECS Task Role

**Role Name**: `deecell-fleet-production-ecs-task-role`

**Assumed By**: `ecs-tasks.amazonaws.com`

**Purpose**: Runtime permissions for the web application while it's running.

### Permissions

| Action | Resource | Purpose |
|--------|----------|---------|
| `secretsmanager:GetSecretValue` | `deecell-fleet-production/database-url` | Access database |
| `secretsmanager:GetSecretValue` | `deecell-fleet-production/session-secret` | Session management |
| `secretsmanager:GetSecretValue` | `deecell-fleet-production/admin-password` | Admin authentication |
| `s3:GetObject` | `deecell-fleet-production-assets-*/*` | Read uploaded assets |
| `s3:PutObject` | `deecell-fleet-production-assets-*/*` | Upload assets |
| `s3:DeleteObject` | `deecell-fleet-production-assets-*/*` | Delete assets |
| `s3:ListBucket` | `deecell-fleet-production-assets-*` | List bucket contents |

---

## 3. Device Manager EC2 Role

**Role Name**: `deecell-fleet-production-device-manager-role`

**Assumed By**: `ec2.amazonaws.com`

**Purpose**: Permissions for the Device Manager EC2 instance that polls PowerMon devices and SIM cards.

### Permissions

| Action | Resource | Purpose |
|--------|----------|---------|
| `secretsmanager:GetSecretValue` | `deecell-fleet-production/database-url` | Database connection |
| `secretsmanager:GetSecretValue` | `deecell-fleet-production/simpro-api-client` | SIMPro API authentication |
| `secretsmanager:GetSecretValue` | `deecell-fleet-production/simpro-api-key` | SIMPro API authentication |
| `s3:GetObject` | `deecell-fleet-production-device-manager-deploy-*/*` | Download deployment artifacts |
| `s3:ListBucket` | `deecell-fleet-production-device-manager-deploy-*` | List deployment artifacts |
| `logs:CreateLogGroup` | `/ec2/deecell-fleet-production/device-manager*` | Create log groups |
| `logs:CreateLogStream` | `/ec2/deecell-fleet-production/device-manager*` | Create log streams |
| `logs:PutLogEvents` | `/ec2/deecell-fleet-production/device-manager*` | Write logs |
| `logs:DescribeLogStreams` | `/ec2/deecell-fleet-production/device-manager*` | List log streams |
| `cloudwatch:PutMetricData` | * (namespace: `Deecell/DeviceManager`) | Publish custom metrics |
| `ssm:GetParameter` | `deecell-fleet-production/*` | Read SSM parameters |
| `ssm:GetParameters` | `deecell-fleet-production/*` | Read SSM parameters |
| `ssm:GetParameterHistory` | `deecell-fleet-production/*` | Read parameter history |

### Attached Managed Policies

| Policy ARN | Purpose |
|------------|---------|
| `arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore` | Session Manager access for remote administration |

---

## 4. GitHub Actions User

**User Name**: `deecell-fleet-production-github-actions`

**Path**: `/automation/`

**Purpose**: CI/CD automation for deploying web app to ECS and Device Manager to EC2.

### Permissions

| Sid | Actions | Resource | Purpose |
|-----|---------|----------|---------|
| ECR | `ecr:*` | * | Push/pull container images |
| ECS | `ecs:Describe*`, `ecs:List*`, `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, `ecs:DeregisterTaskDefinition` | * | Deploy ECS services |
| PassRole | `iam:PassRole` | ECS Execution Role, ECS Task Role | Assign roles to ECS tasks |
| ELB | `elasticloadbalancing:Describe*` | * | Check load balancer health |
| SecretsGet | `secretsmanager:GetSecretValue` | `deecell-fleet-production/database-url` | Run database migrations |
| SecretsList | `secretsmanager:ListSecrets` | * | List available secrets |
| Logs | `logs:Get*`, `logs:Describe*` | * | View deployment logs |
| DeviceManagerS3 | `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` | Device Manager deploy bucket | Upload deployment artifacts |
| DeviceManagerASG | `autoscaling:DescribeAutoScalingGroups` | * | Find EC2 instances |
| DeviceManagerSSM | `ssm:SendCommand`, `ssm:ListCommandInvocations`, `ssm:GetCommandInvocation` | * | Trigger deployments via SSM |
| EC2Describe | `ec2:DescribeImages`, `ec2:DescribeInstances`, `ec2:DescribeSecurityGroups`, `ec2:DescribeSubnets`, `ec2:DescribeVpcs` | * | Describe infrastructure |

---

## Secrets Manager Resources

These are the secrets referenced by the IAM policies:

| Secret ID | Used By | Purpose |
|-----------|---------|---------|
| `deecell-fleet-production/database-url` | ECS, Device Manager, GitHub Actions | PostgreSQL connection string |
| `deecell-fleet-production/session-secret` | ECS | Express session encryption key |
| `deecell-fleet-production/admin-password` | ECS | Admin login password |
| `deecell-fleet-production/simpro-api-client` | Device Manager | SIMPro API client ID |
| `deecell-fleet-production/simpro-api-key` | Device Manager | SIMPro API key |
| `deecell-fleet-production/openai-api-key` | ECS (optional) | OpenAI API for Fleet Assistant |
| `deecell-fleet-production/eia-api-key` | ECS (optional) | EIA API for diesel prices |
| `deecell-fleet-production/sendgrid-api-key` | ECS (optional) | SendGrid for email |

---

## S3 Buckets

| Bucket | Used By | Purpose |
|--------|---------|---------|
| `deecell-fleet-production-assets-*` | ECS Task Role | User-uploaded assets |
| `deecell-fleet-production-device-manager-deploy-*` | Device Manager, GitHub Actions | Deployment artifacts |

---

## Security Best Practices Applied

1. **Least Privilege**: Each role only has permissions required for its function
2. **Resource Scoping**: Actions are scoped to specific ARNs where possible
3. **Conditional Permissions**: CloudWatch metrics restricted to specific namespace
4. **IMDSv2 Required**: Device Manager EC2 requires IMDSv2 tokens
5. **No Wildcard Secrets**: Secrets Manager access is scoped to specific secrets
6. **Managed Policies**: SSM Core policy used instead of custom SSM permissions

---

## Terraform Files

All IAM resources are defined in:
- `terraform/iam.tf` - Roles, policies, and S3 buckets
- `terraform/device-manager.tf` - Device Manager instance profile reference
- `terraform/ecs.tf` - ECS task/execution role references

---

## Adding New Permissions

When adding new AWS service integrations:

1. **Identify the principal**: Which role needs the permission?
2. **Find the minimum actions**: Use AWS documentation to find least-privilege actions
3. **Scope the resource**: Use specific ARNs, not wildcards
4. **Update Terraform**: Add to the appropriate policy in `terraform/iam.tf`
5. **Apply changes**: Run `terraform apply` to update AWS

Example: Adding SES email permissions to ECS Task Role:
```hcl
{
  Effect = "Allow"
  Action = [
    "ses:SendEmail",
    "ses:SendRawEmail"
  ]
  Resource = [
    "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/*"
  ]
}
```

---

## Troubleshooting

### "AccessDenied" errors

1. Check CloudTrail for the exact API call that failed
2. Verify the correct role is being used
3. Ensure the resource ARN matches the policy
4. Check for conditional restrictions (e.g., namespace conditions)

### "Unable to assume role" errors

1. Verify the trust policy allows the correct service principal
2. Check the role ARN is correctly specified
3. Ensure the role exists in the correct account

### Session Manager connection issues

1. Verify `AmazonSSMManagedInstanceCore` policy is attached
2. Check the SSM agent is running on the instance
3. Ensure the instance has network access to SSM endpoints
