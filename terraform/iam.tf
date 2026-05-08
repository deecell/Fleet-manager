# =============================================================================
# Deecell Fleet Tracking - IAM Roles and Policies
# =============================================================================

# -----------------------------------------------------------------------------
# ECS Execution Role (for pulling images and logging)
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution-policy"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.ecs.arn}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = concat(
          [
            aws_secretsmanager_secret.database_url.arn,
            aws_secretsmanager_secret.session_secret.arn,
            aws_secretsmanager_secret.admin_password.arn
          ],
          aws_secretsmanager_secret.openai_api_key[*].arn,
          aws_secretsmanager_secret.eia_api_key[*].arn,
          aws_secretsmanager_secret.sendgrid_api_key[*].arn,
          aws_secretsmanager_secret.simpro_api_client[*].arn,
          aws_secretsmanager_secret.simpro_api_key[*].arn
        )
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# ECS Task Role (for application runtime permissions)
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "${local.name_prefix}-ecs-task-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.database_url.arn,
          aws_secretsmanager_secret.session_secret.arn,
          aws_secretsmanager_secret.admin_password.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "${aws_s3_bucket.assets.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.assets.arn
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Device Manager EC2 Instance Role
# -----------------------------------------------------------------------------

resource "aws_iam_role" "device_manager" {
  name = "${local.name_prefix}-device-manager-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_instance_profile" "device_manager" {
  name = "${local.name_prefix}-device-manager-profile"
  role = aws_iam_role.device_manager.name
}

resource "aws_iam_role_policy" "device_manager" {
  name = "${local.name_prefix}-device-manager-policy"
  role = aws_iam_role.device_manager.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = concat(
          [aws_secretsmanager_secret.database_url.arn],
          aws_secretsmanager_secret.simpro_api_client[*].arn,
          aws_secretsmanager_secret.simpro_api_key[*].arn,
          [
            data.aws_secretsmanager_secret.inhand_api_username.arn,
            data.aws_secretsmanager_secret.inhand_api_password.arn,
          ]
        )
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.device_manager_deploy.arn,
          "${aws_s3_bucket.device_manager_deploy.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = [
          "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ec2/${local.name_prefix}/device-manager*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "Deecell/DeviceManager"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParameterHistory"
        ]
        Resource = [
          "arn:aws:ssm:${local.region}:${local.account_id}:parameter/${local.name_prefix}/*"
        ]
      }
    ]
  })
}

# SSM Managed Policy for Session Manager access
resource "aws_iam_role_policy_attachment" "device_manager_ssm" {
  role       = aws_iam_role.device_manager.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# -----------------------------------------------------------------------------
# GitHub Actions Deployment User
# -----------------------------------------------------------------------------

resource "aws_iam_user" "github_actions" {
  name = "${local.name_prefix}-github-actions"
  path = "/automation/"

  tags = local.common_tags
}

# Use managed policy instead of inline (6,144 char limit vs 2,048 for inline)
resource "aws_iam_policy" "github_actions" {
  name        = "${local.name_prefix}-github-actions-policy"
  description = "Policy for GitHub Actions CI/CD deployments"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECR"
        Effect   = "Allow"
        Action   = ["ecr:*"]
        Resource = "*"
      },
      {
        Sid    = "ECS"
        Effect = "Allow"
        Action = [
          "ecs:Describe*",
          "ecs:List*",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService",
          "ecs:DeregisterTaskDefinition"
        ]
        Resource = "*"
      },
      {
        Sid      = "PassRole"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.ecs_execution.arn, aws_iam_role.ecs_task.arn]
      },
      {
        Sid      = "ELB"
        Effect   = "Allow"
        Action   = ["elasticloadbalancing:Describe*"]
        Resource = "*"
      },
      {
        Sid      = "SecretsGet"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.database_url.arn]
      },
      {
        Sid      = "SecretsList"
        Effect   = "Allow"
        Action   = ["secretsmanager:ListSecrets"]
        Resource = "*"
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:Get*", "logs:Describe*"]
        Resource = "*"
      },
      {
        Sid    = "DeviceManagerS3"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.device_manager_deploy.arn,
          "${aws_s3_bucket.device_manager_deploy.arn}/*"
        ]
      },
      {
        Sid    = "DeviceManagerASG"
        Effect = "Allow"
        Action = [
          "autoscaling:DescribeAutoScalingGroups"
        ]
        Resource = "*"
      },
      {
        Sid    = "DeviceManagerSSM"
        Effect = "Allow"
        Action = [
          "ssm:SendCommand",
          "ssm:ListCommandInvocations",
          "ssm:GetCommandInvocation"
        ]
        Resource = "*"
      },
      {
        Sid    = "EC2Describe"
        Effect = "Allow"
        Action = [
          "ec2:DescribeImages",
          "ec2:DescribeInstances",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSubnets",
          "ec2:DescribeVpcs"
        ]
        Resource = "*"
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_user_policy_attachment" "github_actions" {
  user       = aws_iam_user.github_actions.name
  policy_arn = aws_iam_policy.github_actions.arn
}

# Access key for GitHub Actions - SKIPPED: User already has 2 access keys (AWS limit)
# The existing access keys are already configured in GitHub secrets
# resource "aws_iam_access_key" "github_actions" {
#   user = aws_iam_user.github_actions.name
# }

# -----------------------------------------------------------------------------
# Assets S3 Bucket
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "assets" {
  bucket = "${local.name_prefix}-assets-${local.unique_suffix}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-assets"
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

# -----------------------------------------------------------------------------
# Lifecycle: async fleet exports housekeeping
# -----------------------------------------------------------------------------
# The export worker uploads files at `exports/<orgId>/<jobId>/<filename>` and
# hands the user a 7-day signed URL. We keep the object for 14 days as a buffer
# (re-download / debugging), then S3 deletes it automatically. Versioned
# (non-current) copies are also expired after 14 days so the bucket cannot
# accumulate stale exports.
resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    id     = "exports-cleanup"
    status = "Enabled"

    filter {
      prefix = "exports/"
    }

    expiration {
      days = 14
    }

    noncurrent_version_expiration {
      noncurrent_days = 14
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
