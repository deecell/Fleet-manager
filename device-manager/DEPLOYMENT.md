# Device Manager - AWS EC2 Deployment Guide

This guide covers deploying the Device Manager to AWS EC2 for production use.

## Overview

The Device Manager is a standalone Node.js application that:
- Maintains persistent connections to PowerMon devices via WiFi
- Polls devices every 10 seconds for real-time data
- Writes measurements to PostgreSQL in batches
- Backfills gaps using device log files
- Exposes Prometheus metrics for monitoring

**Scale**: ~1,000 devices per instance, horizontally scalable to tens of thousands.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AWS Infrastructure                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────────┐     ┌──────────────────────────┐     │
│   │   EC2 Instance   │     │   Neon PostgreSQL        │     │
│   │   Device Manager │ ──▶ │   (Shared with Web App)  │     │
│   └────────┬─────────┘     └──────────────────────────┘     │
│            │                                                 │
│            │ WebSocket                                       │
│            ▼                                                 │
│   ┌──────────────────┐                                      │
│   │ Thornwave Relay  │                                      │
│   │ (External)       │                                      │
│   └────────┬─────────┘                                      │
│            │                                                 │
│            ▼                                                 │
│   ┌──────────────────┐                                      │
│   │ PowerMon Devices │                                      │
│   │ (Customer Sites) │                                      │
│   └──────────────────┘                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

### EC2 Instance Requirements

| Spec | Minimum | Recommended |
|------|---------|-------------|
| Instance Type | t3.small | t3.medium |
| vCPUs | 2 | 2 |
| Memory | 2 GB | 4 GB |
| Storage | 20 GB EBS | 50 GB EBS |
| OS | Amazon Linux 2023 | Amazon Linux 2023 |

### Required Software

- Node.js 18+ (LTS)
- Python 3.x (for node-gyp)
- GCC/G++ (for native addon compilation)
- Git

## Deployment Steps

### 1. Launch EC2 Instance

```bash
# Using AWS CLI
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \  # Amazon Linux 2023
  --instance-type t3.medium \
  --key-name your-key-pair \
  --security-group-ids sg-xxxxxxxx \
  --subnet-id subnet-xxxxxxxx \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=deecell-device-manager}]'
```

### 2. Security Group Configuration

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Your IP | SSH access |
| 3001 | TCP | VPC/Monitoring | Metrics & health |
| 443 | TCP | 0.0.0.0/0 | Outbound HTTPS (Thornwave relay) |

### 3. Install Dependencies

SSH into the instance:

```bash
ssh -i your-key.pem ec2-user@<instance-ip>
```

Install Node.js and build tools:

```bash
# Install Node.js 18
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Install build tools
sudo yum groupinstall -y "Development Tools"
sudo yum install -y python3

# Verify installations
node --version  # Should be 18.x
npm --version
g++ --version
python3 --version
```

### 4. Deploy Application

```bash
# Create application directory
sudo mkdir -p /opt/deecell
sudo chown ec2-user:ec2-user /opt/deecell

# Clone or copy device-manager folder
cd /opt/deecell
# Option A: Git clone (if in repo)
git clone https://github.com/your-org/deecell-fleet.git
cd deecell-fleet/device-manager

# Option B: SCP from local machine
# scp -r device-manager/ ec2-user@<ip>:/opt/deecell/

# Install dependencies
npm install

# Build native addon
npx node-gyp rebuild

# Verify build
ls -la build/Release/powermon_addon.node
```

### 5. Configure Environment

Create environment file:

```bash
sudo vim /opt/deecell/device-manager/.env
```

Add configuration:

```bash
# Required
DATABASE_URL=postgres://user:password@host:5432/database?sslmode=require

# Optional (with defaults)
POLL_INTERVAL_MS=10000
COHORT_COUNT=10
MAX_CONCURRENT_POLLS=100
BATCH_FLUSH_INTERVAL_MS=2000
MAX_BATCH_SIZE=500
GAP_THRESHOLD_MS=30000
MAX_CONCURRENT_BACKFILLS=5
DM_PORT=3001
LOG_LEVEL=info
LOG_FORMAT=json
```

### 6. Set Up systemd Service

Create service file:

```bash
sudo vim /etc/systemd/system/device-manager.service
```

Contents:

```ini
[Unit]
Description=Deecell Device Manager
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/deecell/device-manager
EnvironmentFile=/opt/deecell/device-manager/.env
ExecStart=/usr/bin/node app/index.js
Restart=always
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=device-manager

# Process limits
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable device-manager
sudo systemctl start device-manager

# Check status
sudo systemctl status device-manager

# View logs
sudo journalctl -u device-manager -f
```

### 7. Verify Deployment

Check health endpoint:

```bash
curl http://localhost:3001/health
# {"status":"healthy","uptime":123,"devices":{"total":5,"connected":5}}
```

Check metrics:

```bash
curl http://localhost:3001/metrics
# device_manager_devices_total 5
# device_manager_devices_connected 5
# device_manager_polls_total{status="success"} 1234
# ...
```

## Monitoring

### CloudWatch Integration

Install CloudWatch agent:

```bash
sudo yum install -y amazon-cloudwatch-agent
```

Configure to collect:
- Application logs from journald
- Prometheus metrics from :3001/metrics
- System metrics (CPU, memory, network)

### Recommended Alarms

| Metric | Threshold | Action |
|--------|-----------|--------|
| `device_manager_devices_connected` | < 90% of total | Alert |
| `device_manager_polls_failed_total` | > 100/min | Alert |
| `device_manager_batch_queue_size` | > 5000 | Scale up |
| EC2 CPU | > 80% | Scale up |
| EC2 Memory | > 80% | Scale up |

### Grafana Dashboard

Import the provided dashboard JSON or create panels for:
- Device connection status
- Poll success/failure rates
- Batch write throughput
- Queue depths
- Backfill progress

## Scaling

### Horizontal Scaling

For more than 1,000 devices:

1. **Shard by Organization**:
   - Deploy multiple EC2 instances
   - Each instance handles specific organization IDs
   - Add `ORGANIZATION_IDS` env var to filter devices

2. **Auto Scaling Group**:
   - Create Launch Template with this configuration
   - Set up ASG with desired/min/max instances
   - Use SQS or database for device assignment

### Database Scaling

For high measurement volume:
- Enable Neon autoscaling
- Consider time-series partitioning
- Archive old measurements to S3

## Troubleshooting

### Common Issues

**1. Native addon build fails**

```bash
# Check for missing build tools
sudo yum groupinstall -y "Development Tools"
npm rebuild
```

**2. Cannot connect to devices**

```bash
# Check outbound HTTPS
curl -v https://api.thornwave.com
# Verify security group allows outbound 443
```

**3. Database connection errors**

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"
# Check SSL mode in connection string
```

**4. High memory usage**

```bash
# Check batch queue depth
curl localhost:3001/metrics | grep queue
# Reduce MAX_BATCH_SIZE or increase flush interval
```

### Logs

```bash
# Real-time logs
sudo journalctl -u device-manager -f

# Last 100 lines
sudo journalctl -u device-manager -n 100

# Filter by level
sudo journalctl -u device-manager | grep '"level":"error"'

# Export for analysis
sudo journalctl -u device-manager --since "1 hour ago" > logs.json
```

## Maintenance

### Updates

```bash
# Stop service
sudo systemctl stop device-manager

# Pull updates
cd /opt/deecell/device-manager
git pull

# Rebuild if native code changed
npx node-gyp rebuild

# Restart
sudo systemctl start device-manager
```

### Backup

The Device Manager is stateless - all data is in PostgreSQL. No local backup needed.

### Security

- Rotate DATABASE_URL password regularly
- Use IAM roles instead of access keys where possible
- Keep Node.js and system packages updated
- Enable VPC flow logs for network auditing

## Cost Estimate

| Resource | Specification | Monthly Cost |
|----------|---------------|--------------|
| EC2 t3.medium | On-demand | ~$30 |
| EBS 50GB | gp3 | ~$4 |
| Data transfer | ~100 GB out | ~$9 |
| **Total** | | **~$43/month** |

Reserved instances or Savings Plans can reduce costs by 30-50%.

## Support

For issues:
1. Check logs: `sudo journalctl -u device-manager -n 500`
2. Check metrics: `curl localhost:3001/metrics`
3. Verify database connectivity
4. Contact: support@deecell.com

---

## Manual EC2 Bootstrap Guide (CloudShell)

This section documents the manual process to bootstrap a fresh EC2 instance for the Device Manager using AWS CloudShell. Use this when:
- The EC2 instance was terminated and a new one launched
- Terraform wasn't used to provision the instance
- GitHub Actions deployment fails with "deploy.sh not found"

### Prerequisites

- AWS CloudShell access
- EC2 instance running Ubuntu 24.04 in the Device Manager ASG
- SSM Session Manager access to the instance
- S3 bucket with deployment artifacts (`device-manager-latest.zip`)

### Step 1: Connect to the Instance

From AWS CloudShell:

```bash
# Get the instance ID from the ASG
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names deecell-fleet-production-device-manager-asg \
  --query 'AutoScalingGroups[0].Instances[*].InstanceId' \
  --output text \
  --region us-east-2

# Connect via SSM Session Manager
aws ssm start-session --target i-XXXXXXXXXXXXXXXXX --region us-east-2
```

### Step 2: Update System Packages

```bash
sudo apt-get update -y
sudo apt-get upgrade -y
```

### Step 3: Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs git build-essential jq unzip
```

Verify installation:
```bash
node --version   # Should show v20.x.x
npm --version
```

### Step 4: Install AWS CLI v2

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
unzip -q /tmp/awscliv2.zip -d /tmp
sudo /tmp/aws/install
rm -rf /tmp/aws /tmp/awscliv2.zip
```

Verify:
```bash
aws --version
```

### Step 5: Install Bluetooth Libraries

Required for the PowerMon native addon:

```bash
sudo apt-get install -y libbluetooth-dev libdbus-1-dev
```

### Step 6: Create Application Directory

```bash
sudo mkdir -p /opt/device-manager
sudo chown ubuntu:ubuntu /opt/device-manager
```

### Step 7: Get S3 Bucket Name

From CloudShell (not the instance):

```bash
aws s3 ls | grep device-manager-deploy
```

Note the bucket name (e.g., `deecell-fleet-production-device-manager-deploy-XXXXXXXX`).

### Step 8: Create deploy.sh Script

Replace `BUCKET_NAME` with the actual bucket name from Step 7:

```bash
sudo bash -c 'cat > /opt/device-manager/deploy.sh << "DEPLOYSCRIPT"
#!/bin/bash
set -e
BUCKET="deecell-fleet-production-device-manager-deploy-XXXXXXXX"
TMPFILE="/home/ubuntu/device-manager.zip"
echo "Fetching deployment artifact from S3..."
aws s3 cp "s3://$BUCKET/device-manager-latest.zip" "$TMPFILE" --region us-east-2
echo "Extracting artifact..."
cd /opt/device-manager
unzip -o "$TMPFILE"
rm -f "$TMPFILE"
echo "Installing dependencies (using pre-built native addon)..."
npm ci --only=production --ignore-scripts
echo "Verifying native addon..."
ls -la build/Release/powermon_addon.node
echo "Restarting service..."
sudo systemctl restart device-manager
echo "Deployment complete!"
DEPLOYSCRIPT'

sudo chmod +x /opt/device-manager/deploy.sh
sudo chown ubuntu:ubuntu /opt/device-manager/deploy.sh
```

**Important**: We use `--ignore-scripts` because the pre-built `powermon_addon.node` is included in the deployment package. Rebuilding would fail without the `libpowermon_bin` headers.

### Step 9: Get Secrets Manager ARNs

From CloudShell:

```bash
aws secretsmanager list-secrets --region us-east-2 \
  --query "SecretList[?contains(Name, 'deecell')].{Name:Name,ARN:ARN}" \
  --output table
```

Note the DATABASE_URL ARN (e.g., `arn:aws:secretsmanager:us-east-2:XXXXXXXXXXXX:secret:deecell-fleet-production/database-url-XXXXXX`).

### Step 10: Create start.sh Script

Replace the secret ARN with the actual value from Step 9:

```bash
sudo bash -c 'cat > /opt/device-manager/start.sh << "STARTSCRIPT"
#!/bin/bash
set -e

# Fetch DATABASE_URL from Secrets Manager
export DATABASE_URL=$(aws secretsmanager get-secret-value \
  --secret-id "arn:aws:secretsmanager:us-east-2:XXXXXXXXXXXX:secret:deecell-fleet-production/database-url-XXXXXX" \
  --query "SecretString" \
  --output text \
  --region us-east-2)

# Set other environment variables
export NODE_ENV=production
export LOG_LEVEL=info
export DM_PORT=3001
export POLL_INTERVAL_MS=10000
export COHORT_COUNT=10
export MAX_BATCH_SIZE=500
export RDS_CA_BUNDLE=/opt/device-manager/certs/rds-ca-bundle.pem

# Start the application
exec node app/index.js
STARTSCRIPT'

sudo chmod +x /opt/device-manager/start.sh
sudo chown ubuntu:ubuntu /opt/device-manager/start.sh
```

### Step 11: Download RDS CA Certificate

```bash
sudo mkdir -p /opt/device-manager/certs
curl -sS "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" | sudo tee /opt/device-manager/certs/rds-ca-bundle.pem > /dev/null
sudo chmod 644 /opt/device-manager/certs/rds-ca-bundle.pem
sudo chown ubuntu:ubuntu /opt/device-manager/certs/rds-ca-bundle.pem
```

### Step 12: Create systemd Service

```bash
sudo bash -c 'cat > /etc/systemd/system/device-manager.service << "SYSTEMD"
[Unit]
Description=Deecell Device Manager
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/device-manager
ExecStart=/opt/device-manager/start.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SYSTEMD'

sudo systemctl daemon-reload
sudo systemctl enable device-manager
```

### Step 13: Run Initial Deployment

```bash
sudo -u ubuntu /opt/device-manager/deploy.sh
```

### Step 14: Verify Service is Running

```bash
sudo systemctl status device-manager
```

You should see "Active: active (running)" and log messages showing device connections.

### Step 15: Test Health Endpoint

```bash
curl http://localhost:3001/health
```

Expected output:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-07T20:36:39.734Z",
  "components": {
    "connectionPool": { "status": "ok", "devices": 1, "connected": 1 },
    "pollingScheduler": { "status": "ok", "totalPolls": 8, "successRate": "100.0%" },
    "batchWriter": { "status": "ok", "queueSize": 0, "totalWritten": 8 }
  }
}
```

---

## Quick Reference Commands

### View Service Logs
```bash
sudo journalctl -u device-manager -f
```

### Restart Service
```bash
sudo systemctl restart device-manager
```

### Re-deploy from S3
```bash
sudo -u ubuntu /opt/device-manager/deploy.sh
```

### Check Service Status
```bash
sudo systemctl status device-manager
curl http://localhost:3001/health
```

### Trigger GitHub Actions Deployment
After bootstrap, GitHub Actions deployments will work because `/opt/device-manager/deploy.sh` now exists. The workflow runs:
```bash
aws ssm send-command --parameters 'commands=["/opt/device-manager/deploy.sh"]'
```

---

## Troubleshooting

### "deploy.sh not found" Error
This means the EC2 instance hasn't been bootstrapped. Follow the Manual EC2 Bootstrap Guide above.

### Permission Denied During Deploy
Run deploy as the ubuntu user:
```bash
sudo -u ubuntu /opt/device-manager/deploy.sh
```

### Native Addon Build Fails
Use `--ignore-scripts` in npm ci. The pre-built `.node` file is included in the S3 package:
```bash
npm ci --only=production --ignore-scripts
```

### "powermon.h not found" Error
This occurs if npm tries to rebuild. The `libpowermon_bin` headers aren't in the deployment package. Use `--ignore-scripts` to skip the build.

### Service Fails to Start
Check logs for database connection issues:
```bash
sudo journalctl -u device-manager -n 50
```

Common causes:
- DATABASE_URL secret ARN is wrong in start.sh
- RDS security group doesn't allow access from EC2
- EC2 instance doesn't have IAM permissions for Secrets Manager

### SIMPro Warning
The warning "SIMPro API credentials not configured" is expected if you haven't added SIMPRO_API_CLIENT and SIMPRO_API_KEY to the start.sh script. SIM location tracking will be disabled.

---

## Production Database Schema Migrations

When schema changes are made in Replit (via `npm run db:push`), the AWS RDS production database must be updated separately. There is no automatic migration in the deployment pipeline.

### Step 1: Connect to EC2 via SSM

From AWS CloudShell:

```bash
# Get the Device Manager instance ID
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names deecell-fleet-production-device-manager-asg \
  --query 'AutoScalingGroups[0].Instances[*].InstanceId' \
  --output text \
  --region us-east-2

# Connect via SSM Session Manager
aws ssm start-session --target i-XXXXXXXXXXXXXXXXX --region us-east-2
```

### Step 2: Install PostgreSQL Client (if not installed)

```bash
# Ubuntu (Device Manager EC2 is Ubuntu 24.04)
sudo apt-get update && sudo apt-get install -y postgresql-client
```

### Step 3: Export DATABASE_URL from Secrets Manager

```bash
export DATABASE_URL=$(aws secretsmanager get-secret-value \
  --secret-id "deecell-fleet-production/database-url" \
  --region us-east-2 \
  --query SecretString \
  --output text)
```

Verify:
```bash
echo $DATABASE_URL | head -c 30
# Should show: postgresql://deecell_admin:...
```

### Step 4: Run the Migration

For simple column additions, use `ALTER TABLE`:

```bash
# Example: Add a nullable column
psql "$DATABASE_URL" -c "ALTER TABLE power_mon_devices ADD COLUMN IF NOT EXISTS marked_unstable_at TIMESTAMP WITH TIME ZONE;"

# Example: Add multiple columns
psql "$DATABASE_URL" << 'SQL'
ALTER TABLE power_mon_devices 
ADD COLUMN IF NOT EXISTS new_column_1 VARCHAR(255),
ADD COLUMN IF NOT EXISTS new_column_2 INTEGER DEFAULT 0;
SQL
```

For complex migrations, create a SQL file and run it:

```bash
# Create migration file
cat > /tmp/migration.sql << 'SQL'
-- Add new table
CREATE TABLE IF NOT EXISTS new_table (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index
CREATE INDEX IF NOT EXISTS idx_new_table_name ON new_table(name);
SQL

# Run migration
psql "$DATABASE_URL" -f /tmp/migration.sql
```

### Step 5: Verify Migration

```bash
# Check table structure
psql "$DATABASE_URL" -c "\d power_mon_devices"

# Check if column exists
psql "$DATABASE_URL" -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'power_mon_devices' AND column_name = 'marked_unstable_at';"
```

### Step 6: Deploy Updated Code

Push changes to GitHub `main` branch to trigger ECS deployment (web app) or Device Manager deployment.

### Step 7: Restart Device Manager (if needed)

```bash
sudo systemctl restart device-manager
sudo journalctl -u device-manager -f
```

---

### Migration Best Practices

| Do | Don't |
|----|-------|
| Use `ADD COLUMN IF NOT EXISTS` | Use `ADD COLUMN` without IF NOT EXISTS |
| Add nullable columns first, then add NOT NULL later | Add NOT NULL columns without defaults |
| Create indexes with `IF NOT EXISTS` | Drop and recreate indexes |
| Test migrations on Replit first | Run untested SQL on production |
| Back up critical data before destructive changes | DROP tables without backup |

### Common Migration Commands

```bash
# Add nullable column
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS col_name TYPE;

# Add column with default
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS col_name TYPE DEFAULT value;

# Make column NOT NULL (after backfilling)
ALTER TABLE table_name ALTER COLUMN col_name SET NOT NULL;

# Add index
CREATE INDEX IF NOT EXISTS idx_name ON table_name(column);

# Add foreign key
ALTER TABLE table_name ADD CONSTRAINT fk_name FOREIGN KEY (col) REFERENCES other_table(id);

# Rename column
ALTER TABLE table_name RENAME COLUMN old_name TO new_name;
```

### Quick Reference: Schema Migration Checklist

1. ✅ Make schema changes in `shared/schema.ts`
2. ✅ Run `npm run db:push` in Replit (updates dev DB)
3. ✅ Connect to EC2 via SSM
4. ✅ Install psql if needed: `sudo apt-get install -y postgresql-client`
5. ✅ Export DATABASE_URL from Secrets Manager
6. ✅ Run migration SQL
7. ✅ Verify changes with `\d table_name`
8. ✅ Deploy updated code (push to GitHub main)
9. ✅ Restart Device Manager if needed
