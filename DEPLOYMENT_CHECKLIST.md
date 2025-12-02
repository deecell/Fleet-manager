# Deecell Fleet Tracking - AWS Deployment Checklist

> **Step-by-step guide for deploying to production AWS environment**  
> **Team: Me, Mary, Elliot**  
> **Date: December 1, 2025**

---

## Pre-Deployment Checklist

### 1. AWS Account Setup (Do this first!)

- [ ] **Create IAM User for Terraform**
  ```bash
  # Go to AWS Console > IAM > Users > Create user
  # User name: deecell-terraform
  # Access type: Programmatic access
  
  # Attach these managed policies:
  # - AmazonVPCFullAccess
  # - AmazonRDSFullAccess
  # - AmazonECS_FullAccess
  # - AmazonEC2ContainerRegistryFullAccess
  # - ElasticLoadBalancingFullAccess
  # - IAMFullAccess
  # - AmazonS3FullAccess
  # - SecretsManagerReadWrite
  # - CloudWatchFullAccess
  # - AWSCloudTrail_FullAccess
  # - AmazonEC2FullAccess
  
  # Save the Access Key ID and Secret Access Key!
  ```

- [ ] **Create ECR Repository**
  ```bash
  aws ecr create-repository \
    --repository-name deecell-fleet \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 \
    --region us-east-1
  ```
  
  Save the repository URI: `<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/deecell-fleet`

---

## Phase 1: Generate Secrets

Run these commands to generate secure passwords:

```bash
# Generate session secret (64 chars)
openssl rand -base64 48

# Generate database password (32 chars)
openssl rand -base64 32 | tr -dc 'a-zA-Z0-9!#$%&*' | head -c 32

# Generate admin password
openssl rand -base64 24 | tr -dc 'a-zA-Z0-9!#$%&*' | head -c 24
```

**Save these secrets securely - you'll need them for GitHub Secrets!**

---

## Phase 2: GitHub Repository Setup

### 2.1 Create GitHub Repository

- [ ] Go to [github.com/new](https://github.com/new)
- [ ] Repository name: `deecell-fleet-tracker`
- [ ] Visibility: **Private**
- [ ] Don't initialize with README (we'll push from Replit)

### 2.2 Connect Replit to GitHub

- [ ] In Replit, go to **Version Control** (Git tab)
- [ ] Click **"Connect to GitHub"**
- [ ] Authorize Replit to access your GitHub
- [ ] Select the repository
- [ ] Push your code

### 2.3 Configure GitHub Secrets

Go to **Repository > Settings > Secrets and variables > Actions**

Add these secrets:

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key | Created in step 1 |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key | Created in step 1 |
| `AWS_REGION` | AWS region | `us-east-2` |
| `AWS_ACCOUNT_ID` | 12-digit AWS account ID | AWS Console top-right |
| `ECR_REPOSITORY` | ECR repo name | `deecell-fleet` |
| `TF_VAR_DB_PASSWORD` | Database password | Generated above |
| `TF_VAR_SESSION_SECRET` | Session secret | Generated above |
| `TF_VAR_ADMIN_PASSWORD` | Admin password | Generated above |
| `DEVICE_MANAGER_BUCKET` | S3 bucket for Device Manager | `terraform output device_manager_deploy_bucket_name` |

---

## Phase 3: Configure Terraform Variables

### 3.1 Create terraform.tfvars

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

### 3.2 Edit terraform.tfvars

```hcl
# Required - Update these!
project_name       = "deecell-fleet"
environment        = "production"
aws_region         = "us-east-1"
ecr_repository_url = "<YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/deecell-fleet"

# Optional - For custom domain
domain_name = ""  # e.g., "fleet.deecell.com"

# Database
db_instance_class = "db.t3.small"  # $30/month
db_multi_az       = false          # Set true for HA ($60/month)

# Alerting
alert_email = "ops@deecell.com"  # Optional
```

---

## Phase 4: Initial Infrastructure Deployment

### 4.1 Initialize Terraform

```bash
cd terraform

# Set environment variables for secrets
export TF_VAR_db_password="YOUR_GENERATED_DB_PASSWORD"
export TF_VAR_session_secret="YOUR_GENERATED_SESSION_SECRET"
export TF_VAR_admin_password="YOUR_GENERATED_ADMIN_PASSWORD"

# Initialize Terraform
terraform init

# Review the plan
terraform plan -out=tfplan

# Apply (creates all AWS resources)
terraform apply tfplan
```

### 4.2 Save Terraform Outputs

After terraform apply completes:

```bash
# Get important outputs
terraform output alb_dns_name          # Your app URL
terraform output database_endpoint     # RDS endpoint
terraform output ecs_cluster_name      # ECS cluster
terraform output github_actions_access_key_id  # For GitHub (if needed)
```

---

## Phase 5: Deploy Application

### 5.1 Push to Main Branch

From Replit or your local machine:

```bash
git add .
git commit -m "Deploy to production"
git push origin main
```

This triggers the GitHub Action which:
1. Builds Docker image
2. Pushes to ECR
3. Updates ECS service
4. Runs database migrations
5. Verifies health check

### 5.2 Monitor Deployment

- Go to **GitHub > Actions** to watch the pipeline
- Check **AWS CloudWatch > Logs** for application logs
- Check **AWS ECS > Services** for task status

---

## Phase 6: Device Manager Deployment (EC2)

The Device Manager runs on EC2, separate from the web app. It maintains persistent connections to PowerMon devices and polls them every 10 seconds.

### 6.1 Automated Deployment (Recommended)

**CI/CD via GitHub Actions** - Automatically deploys when changes are pushed to `device-manager/` folder:

1. **Get S3 Bucket Name** (after Terraform apply):
   ```bash
   cd terraform
   terraform output device_manager_deploy_bucket_name
   # Example: deecell-fleet-production-device-manager-deploy-abc123
   ```

2. **Add GitHub Secret**:
   - Go to **Repository > Settings > Secrets > Actions**
   - Add `DEVICE_MANAGER_BUCKET` with the bucket name from step 1

3. **Push Changes**:
   ```bash
   # Any change to device-manager/ triggers deployment
   git add device-manager/
   git commit -m "Update Device Manager"
   git push origin main
   ```

4. **Monitor Deployment**:
   - Go to **GitHub > Actions > Deploy Device Manager**
   - Watch the workflow execute

### 6.2 Manual Deployment

**Option A: Using the deployment script** (from local machine):

```bash
cd device-manager

# Get the S3 bucket name
export S3_BUCKET=$(cd ../terraform && terraform output -raw device_manager_deploy_bucket_name)

# Run deployment
./scripts/deploy-to-aws.sh

# Or dry-run first
./scripts/deploy-to-aws.sh --dry-run
```

**Option B: Direct SSH deployment**:

```bash
# Connect via AWS SSM Session Manager (recommended - no SSH key needed)
aws ssm start-session --target i-xxxxx --region us-east-2

# Or get instance ID from ASG
INSTANCE_ID=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names deecell-fleet-production-device-manager-asg \
  --query 'AutoScalingGroups[0].Instances[0].InstanceId' \
  --output text --region us-east-2)
aws ssm start-session --target $INSTANCE_ID --region us-east-2

# On the EC2 instance:
cd /opt/device-manager

# Run the deploy script (fetches from S3)
sudo /opt/device-manager/deploy.sh

# Check service status
sudo systemctl status device-manager
```

### 6.3 Verify Device Manager

```bash
# Check service status
sudo systemctl status device-manager

# Check logs (real-time)
sudo journalctl -u device-manager -f

# Check last 100 log lines
sudo journalctl -u device-manager -n 100

# Check health endpoint
curl http://localhost:3001/health

# Check Prometheus metrics
curl http://localhost:3001/metrics

# Expected metrics:
# device_manager_devices_total - Number of registered devices
# device_manager_devices_connected - Currently connected devices
# device_manager_polls_total{status="success"} - Successful polls
# device_manager_polls_total{status="failed"} - Failed polls
```

### 6.4 Scaling the Device Manager

For fleets with more than 1,000 devices:

```bash
# Scale the ASG
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name deecell-fleet-production-device-manager-asg \
  --desired-capacity 2 \
  --region us-east-2

# Verify instances
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names deecell-fleet-production-device-manager-asg \
  --query 'AutoScalingGroups[0].Instances' \
  --region us-east-2
```

---

## Post-Deployment Verification

### Health Checks

```bash
# Get ALB URL
ALB_URL=$(terraform output -raw alb_dns_name)

# Test health endpoint
curl http://$ALB_URL/api/health

# Test the dashboard
open http://$ALB_URL
```

### Security Checklist

- [ ] HTTPS enabled (if domain configured)
- [ ] Health check passing
- [ ] Database connections working
- [ ] CloudWatch logs streaming
- [ ] GuardDuty enabled
- [ ] CloudTrail logging

---

## Troubleshooting

### ECS Tasks Not Starting

```bash
# Check ECS events
aws ecs describe-services \
  --cluster deecell-fleet-production-cluster \
  --services deecell-fleet \
  --query 'services[0].events[:5]'

# Check task logs
aws logs tail /ecs/deecell-fleet-production --follow
```

### Database Connection Failed

```bash
# Verify security group allows ECS to RDS on port 5432
aws ec2 describe-security-groups \
  --group-ids sg-xxxxx \
  --query 'SecurityGroups[0].IpPermissions'
```

### Health Check Failing

```bash
# Ensure /api/health returns 200
# Check the route is defined in server/routes.ts
curl -v http://$ALB_URL/api/health
```

---

## Cost Estimates

| Resource | Monthly Cost |
|----------|-------------|
| ECS Fargate (2 tasks) | ~$35 |
| RDS t3.small | ~$30 |
| NAT Gateway | ~$33 |
| ALB | ~$20 |
| EC2 t3.medium (Device Manager) | ~$30 |
| S3 + CloudWatch | ~$5 |
| **Total** | **~$153/month** |

For cost savings:
- Use single NAT gateway (saves $33)
- Use Fargate Spot for non-critical workloads
- Use Reserved Instances for long-term (30% savings)

---

## Emergency Contacts

- **AWS Support**: (if you have a support plan)
- **Replit Support**: support@replit.com
- **Team Lead**: [Add contact]

---

*Document created: December 1, 2025*
