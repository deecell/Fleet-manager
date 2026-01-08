# Production Database Migration Guide

## Overview
This guide documents the **only** approved method for running database migrations on the production RDS instance.

**Important**: CloudShell cannot directly connect to RDS (it's in a private subnet). You must go through the Device Manager EC2 instance.

---

## Step-by-Step Process

### Step 1: Get the EC2 Instance ID
From AWS CloudShell:
```bash
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].[InstanceId,Tags[?Key==`Name`].Value|[0]]' \
  --output table --region us-east-2
```

Look for: `deecell-fleet-production-device-manager`

### Step 2: Connect to EC2 via SSM
```bash
aws ssm start-session --target i-XXXXXXXXX --region us-east-2
```
Replace `i-XXXXXXXXX` with the instance ID from Step 1.

### Step 3: Get the DATABASE_URL from Secrets Manager
Once inside the EC2 instance:
```bash
export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id deecell-fleet-production/database-url --query SecretString --output text --region us-east-2)
```

### Step 4: Connect to PostgreSQL
```bash
psql "$DATABASE_URL"
```

You should see:
```
psql (16.11 (Ubuntu 16.11-0ubuntu0.24.04.1), server 15.14)
SSL connection (protocol: TLSv1.2, cipher: ECDHE-RSA-AES256-GCM-SHA384, compression: off)
Type "help" for help.

deecell_fleet=>
```

### Step 5: Run Your SQL
Paste your SQL commands. Example:
```sql
CREATE TABLE IF NOT EXISTS my_table (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128)
);
```

### Step 6: Verify
```sql
\dt my_table
```

### Step 7: Exit
```sql
\q
```
Then type `exit` to leave the SSM session.

---

## Common Mistakes to Avoid

| Mistake | Why It Fails |
|---------|--------------|
| Running `psql $DATABASE_URL` directly from CloudShell | CloudShell is outside the VPC; cannot reach RDS |
| Forgetting to export DATABASE_URL on EC2 | EC2 doesn't have it set by default |
| Using the API migration endpoint | Deprecated; use SSM → EC2 → psql |
| Trying ECS execute-command | Not enabled on our tasks |

---

## Quick Reference (Copy-Paste Commands)

```bash
# 1. Get instance ID (from CloudShell)
aws ec2 describe-instances --filters "Name=instance-state-name,Values=running" --query 'Reservations[*].Instances[*].[InstanceId,Tags[?Key==`Name`].Value|[0]]' --output table --region us-east-2

# 2. Connect to EC2 (from CloudShell)
aws ssm start-session --target i-XXXXXXXXX --region us-east-2

# 3. Get DATABASE_URL (from EC2)
export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id deecell-fleet-production/database-url --query SecretString --output text --region us-east-2)

# 4. Connect to PostgreSQL (from EC2)
psql "$DATABASE_URL"
```

---

## Troubleshooting

### "No such file or directory" when running psql from CloudShell
You're trying to connect directly from CloudShell. Use the SSM → EC2 approach instead.

### SSM session hangs or times out
The EC2 instance might be stopped. Check EC2 console or run:
```bash
aws ec2 describe-instances --instance-ids i-XXXXXXXXX --query 'Reservations[*].Instances[*].State.Name' --region us-east-2
```

### DATABASE_URL is empty
Make sure you're running the export command **inside** the EC2 instance (after SSM session starts), not in CloudShell.

### "permission denied" on Secrets Manager
The EC2 instance IAM role may not have Secrets Manager access. Check IAM policies.

---

## Migration History

| Date | Migration | Tables/Columns |
|------|-----------|----------------|
| 2026-01-08 | Shelly vibration sensors | `shelly_devices`, `shelly_snapshots` |
| 2026-01-07 | Circuit breaker recovery | `power_mon_devices.marked_unstable_at` |
| 2025-12-30 | Schema sync | Multiple tables added |
| 2025-12-11 | Password reset tokens | `password_reset_tokens` |
| 2025-12-05 | Driving since column | `device_snapshots.driving_since` |
