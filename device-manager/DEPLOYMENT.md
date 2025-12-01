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
