---
name: Device-manager EC2 is ASG-managed
description: Instance IDs churn when AutoScaling replaces the box; never trust hardcoded IDs in docs.
---

The production device-manager EC2 (`deecell-fleet-production-device-manager`, us-east-2, account 892213647605) runs in an Auto Scaling Group. AutoScaling terminated and replaced the instance on 2026-07-27 (CloudTrail Username: `AutoScaling`), so any instance ID written in docs goes stale on each replacement.

**Why:** user hit `TargetNotConnected` on `aws ssm start-session` using a doc-hardcoded instance ID that no longer existed.

**How to apply:** resolve the current ID by Name tag before connecting or documenting:
`aws ec2 describe-instances --region us-east-2 --filters "Name=tag:Name,Values=deecell-fleet-production-device-manager" "Name=instance-state-name,Values=running" --query 'Reservations[].Instances[].InstanceId' --output text`
Replacement cause lives in EC2 → Auto Scaling Groups → Activity history. The Replit `deecell-terraform` IAM user cannot read CloudTrail or `ssm:DescribeInstanceInformation`.
