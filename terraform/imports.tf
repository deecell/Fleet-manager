# Import blocks for resources that already exist from previous deployment attempts
# These will be automatically imported on the next terraform apply

import {
  to = aws_cloudwatch_log_group.vpc_flow
  id = "/aws/vpc/deecell-fleet-production/flow-logs"
}

import {
  to = aws_iam_role.vpc_flow_logs
  id = "deecell-fleet-production-vpc-flow-logs-role"
}

# NOTE: Removed aws_db_subnet_group.main - needs to be deleted manually
# because it references subnets from a previous VPC that no longer exists

import {
  to = aws_cloudwatch_log_group.cloudtrail[0]
  id = "/aws/cloudtrail/deecell-fleet-production"
}

import {
  to = aws_iam_role.cloudtrail[0]
  id = "deecell-fleet-production-cloudtrail-role"
}

# Additional imports discovered from second run
import {
  to = aws_iam_role.ecs_task
  id = "deecell-fleet-production-ecs-task-role"
}

import {
  to = aws_iam_role.device_manager
  id = "deecell-fleet-production-device-manager-role"
}

import {
  to = aws_iam_user.github_actions
  id = "deecell-fleet-production-github-actions"
}

import {
  to = aws_cloudtrail.main[0]
  id = "deecell-fleet-production-trail"
}
