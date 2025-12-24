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
