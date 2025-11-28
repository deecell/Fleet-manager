# Solar APU - Operations Runbook

> **Day-to-day operations, monitoring, and troubleshooting guide**

---

## Overview

This runbook provides operational procedures for maintaining the Solar APU production environment.

---

## Daily Operations

### Morning Health Check

```bash
#!/bin/bash
# Run this script daily to verify system health

echo "=== Solar APU Health Check ==="
echo ""

# 1. Check ECS Service Status
echo "1. ECS Service Status:"
aws ecs describe-services \
  --cluster solar-apu-production-cluster \
  --services solar-apu \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,Pending:pendingCount}' \
  --output table

# 2. Check RDS Status
echo ""
echo "2. RDS Database Status:"
aws rds describe-db-instances \
  --db-instance-identifier solar-apu-production-postgres \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Storage:AllocatedStorage,MultiAZ:MultiAZ}' \
  --output table

# 3. Check ALB Health
echo ""
echo "3. ALB Target Health:"
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --names solar-apu-production-alb \
  --query 'LoadBalancers[0].LoadBalancerArn' \
  --output text)

TG_ARN=$(aws elbv2 describe-target-groups \
  --load-balancer-arn $ALB_ARN \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text)

aws elbv2 describe-target-health \
  --target-group-arn $TG_ARN \
  --query 'TargetHealthDescriptions[*].{Target:Target.Id,Health:TargetHealth.State}' \
  --output table

# 4. Check Recent Errors
echo ""
echo "4. Recent Errors (last 1 hour):"
aws logs filter-log-events \
  --log-group-name /ecs/solar-apu-production \
  --start-time $(date -d '1 hour ago' +%s000) \
  --filter-pattern "ERROR" \
  --query 'events[*].message' \
  --output text | head -10

# 5. Check GuardDuty Findings
echo ""
echo "5. GuardDuty Findings (High Severity):"
aws guardduty list-findings \
  --detector-id $(aws guardduty list-detectors --query 'DetectorIds[0]' --output text) \
  --finding-criteria '{"Criterion":{"severity":{"Gte":7}}}' \
  --query 'FindingIds' \
  --output text

echo ""
echo "=== Health Check Complete ==="
```

---

## Monitoring

### Key Metrics to Watch

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| ECS CPU | > 70% | > 85% | Scale up or optimize |
| ECS Memory | > 75% | > 90% | Scale up or fix memory leak |
| RDS CPU | > 70% | > 85% | Upgrade instance or optimize queries |
| RDS Connections | > 80% max | > 95% max | Connection pooling or upgrade |
| ALB 5xx Errors | > 1% | > 5% | Check application logs |
| ALB Response Time | > 500ms | > 2000ms | Optimize or scale |

### CloudWatch Dashboard Access

1. Go to AWS Console > CloudWatch > Dashboards
2. Select `solar-apu-production-dashboard`

### Creating Custom Alerts

```bash
# Create high CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name solar-apu-high-cpu \
  --alarm-description "ECS CPU > 80% for 5 minutes" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=ClusterName,Value=solar-apu-production-cluster Name=ServiceName,Value=solar-apu \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:solar-apu-production-alerts
```

---

## Common Operations

### Deploying a New Version

```bash
# Automatic (via GitHub)
git push origin main

# Manual (if needed)
aws ecs update-service \
  --cluster solar-apu-production-cluster \
  --service solar-apu \
  --force-new-deployment

# Watch deployment progress
aws ecs wait services-stable \
  --cluster solar-apu-production-cluster \
  --services solar-apu
```

### Scaling the Service

```bash
# Scale to 4 tasks
aws ecs update-service \
  --cluster solar-apu-production-cluster \
  --service solar-apu \
  --desired-count 4

# Scale down to 2 tasks
aws ecs update-service \
  --cluster solar-apu-production-cluster \
  --service solar-apu \
  --desired-count 2
```

### Viewing Logs

```bash
# Tail live logs
aws logs tail /ecs/solar-apu-production --follow

# Search for errors in last hour
aws logs filter-log-events \
  --log-group-name /ecs/solar-apu-production \
  --start-time $(date -d '1 hour ago' +%s000) \
  --filter-pattern "ERROR"

# Search for specific request ID
aws logs filter-log-events \
  --log-group-name /ecs/solar-apu-production \
  --filter-pattern "REQUEST_ID_HERE"

# Export logs to S3
aws logs create-export-task \
  --task-name "export-$(date +%Y%m%d)" \
  --log-group-name /ecs/solar-apu-production \
  --from $(date -d '7 days ago' +%s000) \
  --to $(date +%s000) \
  --destination solar-apu-production-logs-export
```

### Database Operations

```bash
# Connect to RDS (from EC2 bastion or Cloud9)
psql "postgresql://solar_apu_user:PASSWORD@endpoint.rds.amazonaws.com:5432/solar_apu?sslmode=require"

# Check database size
SELECT pg_database_size('solar_apu') / 1024 / 1024 AS size_mb;

# Check table sizes
SELECT 
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC
LIMIT 10;

# Check slow queries (requires pg_stat_statements)
SELECT 
  query,
  calls,
  mean_time,
  total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

# Create manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier solar-apu-production-postgres \
  --db-snapshot-identifier solar-apu-manual-$(date +%Y%m%d-%H%M)
```

### Rotating Secrets

```bash
# Rotate session secret
NEW_SECRET=$(openssl rand -base64 48)

aws secretsmanager update-secret \
  --secret-id solar-apu-production/session-secret-XXXX \
  --secret-string "$NEW_SECRET"

# Force ECS to pick up new secret
aws ecs update-service \
  --cluster solar-apu-production-cluster \
  --service solar-apu \
  --force-new-deployment
```

---

## Troubleshooting

### Issue: ECS Tasks Failing to Start

**Symptoms:**
- Tasks go from PENDING to STOPPED
- Running count stays at 0

**Steps:**
1. Check stopped task reason:
   ```bash
   aws ecs describe-tasks \
     --cluster solar-apu-production-cluster \
     --tasks $(aws ecs list-tasks --cluster solar-apu-production-cluster --desired-status STOPPED --query 'taskArns[0]' --output text) \
     --query 'tasks[0].{StoppedReason:stoppedReason,StopCode:stopCode}'
   ```

2. Check CloudWatch logs for errors:
   ```bash
   aws logs tail /ecs/solar-apu-production --since 10m
   ```

3. Common causes:
   - **Container exit code 1**: Application crash - check logs
   - **Essential container exited**: Check all container statuses
   - **Secrets access denied**: Verify IAM permissions
   - **Image pull failed**: Check ECR permissions and image exists

### Issue: Database Connection Errors

**Symptoms:**
- "Connection refused" or "Connection timed out"
- Application errors mentioning PostgreSQL

**Steps:**
1. Check RDS status:
   ```bash
   aws rds describe-db-instances \
     --db-instance-identifier solar-apu-production-postgres \
     --query 'DBInstances[0].DBInstanceStatus'
   ```

2. Check security group allows ECS:
   ```bash
   aws ec2 describe-security-groups \
     --group-ids sg-RDSSGID \
     --query 'SecurityGroups[0].IpPermissions'
   ```

3. Check connection count:
   ```sql
   SELECT count(*) FROM pg_stat_activity;
   ```

4. Common causes:
   - RDS in maintenance window
   - Connection pool exhausted
   - Security group misconfiguration
   - Incorrect DATABASE_URL secret

### Issue: High Response Times

**Symptoms:**
- ALB target response time > 1s
- User complaints about slow loading

**Steps:**
1. Check application metrics:
   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace AWS/ApplicationELB \
     --metric-name TargetResponseTime \
     --dimensions Name=LoadBalancer,Value=ALBARNPREFIX \
     --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
     --period 300 \
     --statistics Average
   ```

2. Check CPU/Memory:
   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace AWS/ECS \
     --metric-name CPUUtilization \
     --dimensions Name=ClusterName,Value=solar-apu-production-cluster Name=ServiceName,Value=solar-apu \
     --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
     --period 300 \
     --statistics Average
   ```

3. Check database slow queries

4. Common causes:
   - Insufficient ECS resources
   - Database query performance
   - External API slowness
   - Memory pressure causing GC

### Issue: Health Check Failures

**Symptoms:**
- ALB showing unhealthy targets
- Tasks being replaced frequently

**Steps:**
1. Check target health:
   ```bash
   aws elbv2 describe-target-health \
     --target-group-arn TGARN
   ```

2. Test health endpoint manually:
   ```bash
   # From within VPC (bastion/Cloud9)
   curl -v http://TASK_PRIVATE_IP:5000/api/health
   ```

3. Check container logs around health check times

4. Common causes:
   - Application not starting in time (increase startPeriod)
   - Health endpoint returning non-200
   - Port mismatch
   - Application crash during startup

---

## Disaster Recovery

### RDS Point-in-Time Recovery

```bash
# Restore to specific point in time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier solar-apu-production-postgres \
  --target-db-instance-identifier solar-apu-restored-$(date +%Y%m%d) \
  --restore-time "2024-01-15T10:00:00Z" \
  --db-subnet-group-name solar-apu-production-db-subnet-group \
  --vpc-security-group-ids sg-XXXXX

# Wait for restoration
aws rds wait db-instance-available \
  --db-instance-identifier solar-apu-restored-$(date +%Y%m%d)
```

### Rolling Back Deployment

```bash
# Get previous task definition
PREV_TD=$(aws ecs describe-services \
  --cluster solar-apu-production-cluster \
  --services solar-apu \
  --query 'services[0].taskDefinition' \
  --output text | sed 's/:[0-9]*$/:/')

CURRENT_REV=$(aws ecs describe-services \
  --cluster solar-apu-production-cluster \
  --services solar-apu \
  --query 'services[0].taskDefinition' \
  --output text | grep -oE '[0-9]+$')

PREV_REV=$((CURRENT_REV - 1))

# Roll back
aws ecs update-service \
  --cluster solar-apu-production-cluster \
  --service solar-apu \
  --task-definition ${PREV_TD}${PREV_REV}

# Wait for stability
aws ecs wait services-stable \
  --cluster solar-apu-production-cluster \
  --services solar-apu
```

### Full Environment Recovery

In case of complete environment loss:

1. **Restore Terraform State** (if using S3 backend)
2. **Run Terraform Apply**:
   ```bash
   cd terraform
   terraform init
   terraform apply
   ```
3. **Restore Database** from latest snapshot
4. **Deploy Application** via GitHub Actions
5. **Verify** all health checks pass
6. **Update DNS** if needed

---

## Maintenance Windows

### RDS Maintenance

- **Window**: Monday 04:00-05:00 UTC
- **Impact**: Brief interruption possible
- **Mitigation**: Enable Multi-AZ for zero-downtime

### ECS Maintenance

- **Window**: Managed by AWS
- **Impact**: None (rolling updates)

---

## Security Incident Response

### Suspected Breach

1. **Contain**: Revoke access immediately
   ```bash
   # Disable user in application
   # Rotate affected secrets
   aws secretsmanager update-secret --secret-id XXX --secret-string "NEW_VALUE"
   ```

2. **Collect Evidence**:
   ```bash
   # Export CloudTrail logs
   aws s3 sync s3://solar-apu-cloudtrail/ ./incident-$(date +%Y%m%d)/
   
   # Export application logs
   aws logs create-export-task --log-group-name /ecs/solar-apu-production ...
   ```

3. **Analyze**: Review logs for unauthorized access

4. **Remediate**: Fix vulnerability, patch, update

5. **Report**: Document incident and notify stakeholders

### GuardDuty Finding Response

```bash
# Get finding details
aws guardduty get-findings \
  --detector-id DETECTOR_ID \
  --finding-ids FINDING_ID

# Mark as archived after resolution
aws guardduty archive-findings \
  --detector-id DETECTOR_ID \
  --finding-ids FINDING_ID
```

---

## Contacts

| Role | Contact | Escalation Time |
|------|---------|-----------------|
| On-Call Engineer | [Your contact] | Immediate |
| Tech Lead | [Your contact] | 15 minutes |
| Security Team | [Your contact] | 30 minutes |
| AWS Support | AWS Console | Varies by support plan |

---

## Runbook Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2024-11 | 1.0 | Initial version |

---

*Document Version: 1.0*
*Last Updated: November 2024*
