# AWS Deployment Guide - Baby Steps Edition

> **For: Me, Mary, Elliot**  
> **Time needed: ~1 hour**  
> **Date: December 1, 2025**

---

## Before You Start

You'll need:
- [ ] An AWS account (with admin access)
- [ ] A GitHub account
- [ ] This Replit project open

---

## STEP 1: Create AWS Account (Skip if you have one)

1. Go to https://aws.amazon.com
2. Click "Create an AWS Account"
3. Follow the signup process
4. Add a credit card (you won't be charged much - about $150/month for this setup)

---

## STEP 2: Create an IAM User for Deployment

We need a special user account that our deployment tools can use.

### 2.1 Go to IAM Console
1. Log into AWS Console: https://console.aws.amazon.com
2. In the search bar at the top, type "IAM"
3. Click on "IAM" in the results

### 2.2 Create a New User
1. In the left sidebar, click "Users"
2. Click the orange "Create user" button
3. User name: `deecell-terraform`
4. Click "Next"

### 2.3 Set Permissions
1. Select "Attach policies directly"
2. Search for and check these policies (one at a time):
   - `AdministratorAccess` (for simplicity - you can restrict later)
3. Click "Next"
4. Click "Create user"

### 2.4 Create Access Keys
1. Click on the user you just created
2. Click the "Security credentials" tab
3. Scroll down to "Access keys"
4. Click "Create access key"
5. Select "Command Line Interface (CLI)"
6. Check "I understand the above recommendation..."
7. Click "Next"
8. Click "Create access key"
9. **IMPORTANT: Copy both keys and save them somewhere safe!**
   - Access key ID: `AKIA...` (looks like this)
   - Secret access key: `wJalr...` (looks like this)
10. Click "Done"

---

## STEP 3: Create ECR Repository (Where Docker images go)

### 3.1 Go to ECR Console
1. In AWS search bar, type "ECR"
2. Click "Elastic Container Registry"

### 3.2 Create Repository
1. Click "Get Started" or "Create repository"
2. Repository name: `deecell-fleet`
3. Leave other settings as default
4. Click "Create repository"
5. **Copy the URI** - it looks like: `123456789012.dkr.ecr.us-east-1.amazonaws.com/deecell-fleet`

---

## STEP 4: Generate Secure Passwords

Open a terminal (or use an online generator like https://passwordsgenerator.net)

You need 3 passwords. Write them down!

| Password | Requirements | Example |
|----------|--------------|---------|
| Database Password | 16+ characters, letters & numbers | `MyDb2024SecurePass!` |
| Session Secret | 32+ characters | `SuperLongSessionSecret2024ForDeecellFleet!` |
| Admin Password | 12+ characters | `AdminPass2024!` |

---

## STEP 5: Create GitHub Repository

### 5.1 Create New Repo
1. Go to https://github.com/new
2. Repository name: `deecell-fleet-tracker`
3. Select "Private"
4. DON'T check any boxes (no README, no .gitignore)
5. Click "Create repository"

### 5.2 Add Secrets to GitHub (REPOSITORY SECRETS, not environment secrets)
1. In your new repo, click "Settings" (top menu)
2. In left sidebar, click "Secrets and variables" → "Actions"
3. You'll see two tabs: "Secrets" and "Variables" - stay on **Secrets**
4. Click the green **"New repository secret"** button (NOT "New environment secret")
5. Add each of these secrets one by one:

| Secret Name | Value (what to paste) |
|-------------|----------------------|
| `AWS_ACCESS_KEY_ID` | The access key from Step 2.4 (starts with AKIA) |
| `AWS_SECRET_ACCESS_KEY` | The secret key from Step 2.4 |
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account number (find in top-right corner of AWS console) |
| `ECR_REPOSITORY` | `deecell-fleet` |
| `TF_VAR_DB_PASSWORD` | Your database password from Step 4 |
| `TF_VAR_SESSION_SECRET` | Your session secret from Step 4 |
| `TF_VAR_ADMIN_PASSWORD` | Your admin password from Step 4 |

---

## STEP 6: Connect Replit to GitHub

### 6.1 In Replit
1. Click the "Git" icon in the left sidebar (looks like a branch)
2. Click "Connect to GitHub"
3. Authorize Replit if prompted
4. Select your `deecell-fleet-tracker` repository
5. Click "Connect"

### 6.2 Push Your Code
1. In the Git panel, you should see all your files
2. Type a commit message: `Initial deployment`
3. Click "Commit & Push"

---

## STEP 7: Run Terraform (Create AWS Infrastructure)

### 7.1 Install Terraform Locally (or use AWS CloudShell)

**Option A: Use AWS CloudShell (Easiest)**
1. In AWS Console, click the terminal icon (top right, near your account name)
2. A terminal opens at the bottom of the screen
3. Terraform is already installed!

**Option B: Install on your computer**
- Mac: `brew install terraform`
- Windows: Download from https://terraform.io/downloads

### 7.2 Clone Your Repo (in CloudShell or your terminal)
```bash
git clone https://github.com/YOUR-USERNAME/deecell-fleet-tracker.git
cd deecell-fleet-tracker/terraform
```

### 7.3 Create terraform.tfvars file
```bash
cat > terraform.tfvars << 'EOF'
project_name       = "deecell-fleet"
environment        = "production"
aws_region         = "us-east-1"
ecr_repository_url = "YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/deecell-fleet"
EOF
```

Replace `YOUR_ACCOUNT_ID` with your 12-digit AWS account number.

### 7.4 Set Password Variables
```bash
export TF_VAR_db_password="YOUR_DATABASE_PASSWORD_FROM_STEP_4"
export TF_VAR_session_secret="YOUR_SESSION_SECRET_FROM_STEP_4"
export TF_VAR_admin_password="YOUR_ADMIN_PASSWORD_FROM_STEP_4"
```

### 7.5 Initialize and Apply Terraform
```bash
# Initialize (downloads required plugins)
terraform init

# Preview what will be created
terraform plan

# Create everything! (Type 'yes' when prompted)
terraform apply
```

**This takes about 10-15 minutes.** It creates:
- VPC (private network)
- RDS Database
- ECS Cluster (runs your app)
- Load Balancer
- EC2 for Device Manager
- All security settings

### 7.6 Save the Outputs
When Terraform finishes, it shows outputs. **Save these!**

```bash
terraform output
```

Look for:
- `alb_dns_name` = Your app's URL!
- `database_endpoint` = Database connection info

---

## STEP 8: Deploy the Application

### 8.1 Trigger Deployment
1. Go to your GitHub repo
2. Go to "Actions" tab
3. You should see a workflow running (or waiting to run)
4. If not, make any small change to a file and push:

```bash
echo "# Deployed $(date)" >> README.md
git add README.md
git commit -m "Trigger deployment"
git push
```

### 8.2 Watch the Deployment
1. In GitHub Actions, click on the running workflow
2. Watch each step complete
3. Green checkmarks = success!
4. Takes about 5-10 minutes

---

## STEP 9: Verify Everything Works

### 9.1 Check Your App
1. Get your URL from Terraform output (`alb_dns_name`)
2. Open it in a browser: `http://your-alb-url.us-east-1.elb.amazonaws.com`
3. You should see the Deecell login page!

### 9.2 Check AWS Console
1. Go to ECS in AWS Console
2. Click on your cluster
3. You should see 2 running tasks (green)

### 9.3 Check Logs (if something's wrong)
1. Go to CloudWatch in AWS Console
2. Click "Log groups" in left sidebar
3. Click on `/ecs/deecell-fleet-production`
4. Look at the most recent log stream

---

## STEP 10: Deploy Device Manager (Optional - for live truck data)

The Device Manager runs on EC2 and connects to PowerMon devices.

### 10.1 Get EC2 Instance IP
1. Go to EC2 in AWS Console
2. Click "Instances"
3. Find the instance named "deecell-fleet-production-device-manager"
4. Copy the Public IP

### 10.2 Upload Device Manager Code
```bash
# In your local terminal
cd device-manager
zip -r device-manager.zip .

# Get the S3 bucket name from Terraform output
aws s3 cp device-manager.zip s3://YOUR-BUCKET-NAME/device-manager-latest.zip
```

### 10.3 Deploy on EC2
```bash
# SSH to the instance (or use Session Manager in AWS Console)
aws ssm start-session --target i-INSTANCE_ID

# Run the deployment script
/opt/device-manager/deploy.sh
```

---

## Troubleshooting

### "Terraform apply failed"
- Check you have AdministratorAccess policy
- Check your AWS credentials are correct
- Try running `terraform init` again

### "ECS tasks not starting"
- Go to ECS → Your cluster → Tasks
- Click on a failed task
- Check "Stopped reason" for error message
- Usually means the Docker image isn't in ECR yet

### "Can't connect to app"
- Wait 5 minutes for health checks
- Check security group allows port 80
- Check ALB target group shows healthy targets

### "Database connection failed"
- Check ECS task has secrets access
- Verify DATABASE_URL secret exists in Secrets Manager

---

## Quick Reference - What We Created

| AWS Service | What It Does | Monthly Cost |
|-------------|--------------|--------------|
| VPC | Private network for everything | Free |
| RDS PostgreSQL | Your database | ~$30 |
| ECS Fargate | Runs the web app | ~$35 |
| ALB | Load balancer (handles traffic) | ~$20 |
| EC2 | Runs Device Manager | ~$30 |
| NAT Gateway | Lets private stuff reach internet | ~$33 |
| **TOTAL** | | **~$150/month** |

---

## Need Help?

- **AWS Documentation**: https://docs.aws.amazon.com
- **Terraform Docs**: https://terraform.io/docs
- **Check the logs first** - 90% of problems show up in CloudWatch logs

---

**Congratulations!** Your fleet tracking system is now running on AWS!
