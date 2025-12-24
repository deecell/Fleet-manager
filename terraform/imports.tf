# Import blocks for existing resources from previous deployment attempts
# These will be automatically imported on the next terraform apply

# IAM Roles
import {
  to = aws_iam_role.device_manager
  id = "deecell-fleet-production-device-manager-role"
}

import {
  to = aws_iam_role.cloudtrail[0]
  id = "deecell-fleet-production-cloudtrail-role"
}

import {
  to = aws_iam_role.vpc_flow_logs
  id = "deecell-fleet-production-vpc-flow-logs-role"
}

import {
  to = aws_iam_role.ecs_task
  id = "deecell-fleet-production-ecs-task-role"
}

# IAM User
import {
  to = aws_iam_user.github_actions
  id = "deecell-fleet-production-github-actions"
}

# CloudWatch Log Groups
import {
  to = aws_cloudwatch_log_group.cloudtrail[0]
  id = "/aws/cloudtrail/deecell-fleet-production"
}

import {
  to = aws_cloudwatch_log_group.vpc_flow
  id = "/aws/vpc/deecell-fleet-production/flow-logs"
}

# Additional CloudWatch Log Groups
import {
  to = aws_cloudwatch_log_group.device_manager
  id = "/ec2/deecell-fleet-production/device-manager"
}

import {
  to = aws_cloudwatch_log_group.ecs
  id = "/ecs/deecell-fleet-production"
}

# ECS Execution Role
import {
  to = aws_iam_role.ecs_execution
  id = "deecell-fleet-production-ecs-execution-role"
}

# Instance Profile
import {
  to = aws_iam_instance_profile.device_manager
  id = "deecell-fleet-production-device-manager-profile"
}

# CloudTrail
import {
  to = aws_cloudtrail.main[0]
  id = "deecell-fleet-production-trail"
}

# DB Subnet Group - DELETE FROM AWS CONSOLE (bound to old VPC, can't be imported)
# aws rds delete-db-subnet-group --db-subnet-group-name deecell-fleet-production-db-subnet-group

# IAM Policy for GitHub Actions
import {
  to = aws_iam_policy.github_actions
  id = "arn:aws:iam::892213647605:policy/deecell-fleet-production-github-actions-policy"
}

# Target Group - Need to get ARN from AWS Console
# Run: aws elbv2 describe-target-groups --names deecell-fleet-production-tg --query 'TargetGroups[0].TargetGroupArn' --output text
# Then uncomment and update the ID below
# import {
#   to = aws_lb_target_group.main
#   id = "ARN_FROM_ABOVE_COMMAND"
# }
