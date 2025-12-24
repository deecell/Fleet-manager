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

import {
  to = aws_db_subnet_group.main
  id = "deecell-fleet-production-db-subnet-group"
}

import {
  to = aws_cloudwatch_log_group.cloudtrail[0]
  id = "/aws/cloudtrail/deecell-fleet-production"
}

import {
  to = aws_iam_role.cloudtrail[0]
  id = "deecell-fleet-production-cloudtrail-role"
}
