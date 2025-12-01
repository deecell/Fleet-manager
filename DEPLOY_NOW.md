# 🚀 Deploy Your App NOW - Quick Start

> Last updated: December 1, 2025 - v1.0.1

Your AWS infrastructure is **LIVE**! Just 3 steps to see your app running:

---

## Step 1: Add GitHub Secrets (2 minutes)

Go to your GitHub repo: **https://github.com/deecell/Fleet-manager**

1. Click **Settings** (top menu)
2. Click **Secrets and variables** → **Actions** (left sidebar)
3. Click **New repository secret** and add each:

| Secret Name | Secret Value |
|-------------|--------------|
| `AWS_ACCESS_KEY_ID` | (get from Terraform output or AWS console) |
| `AWS_SECRET_ACCESS_KEY` | (get from Terraform output or AWS console) |
| `AWS_REGION` | `us-east-2` |
| `ECR_REPOSITORY` | `deecell-fleet` |

---

## Step 2: Push Code to GitHub (1 minute)

**Option A: Use Replit's Git Panel**
1. Click the **Git** icon in Replit's left sidebar
2. Write a commit message: "Deploy to AWS"
3. Click **Commit & Push**

**Option B: Trigger Manually**
1. Go to GitHub repo → **Actions** tab
2. Click **Deploy to AWS** workflow
3. Click **Run workflow** button

---

## Step 3: Watch It Deploy (5-10 minutes)

1. Go to GitHub repo → **Actions** tab
2. Watch the workflow run (green checkmarks = success)
3. Once complete, visit your app:

**🌐 Your Live URL:**
```
http://deecell-fleet-production-alb-5549888.us-east-2.elb.amazonaws.com
```

---

## That's It! 🎉

After the GitHub Actions workflow completes:
- Docker image will be in ECR
- ECS will deploy the new container
- Your app will be live at the URL above

---

## AWS Console Links

| Service | URL |
|---------|-----|
| ECS Cluster | https://us-east-2.console.aws.amazon.com/ecs/v2/clusters/deecell-fleet-production-cluster |
| RDS Database | https://us-east-2.console.aws.amazon.com/rds/home?region=us-east-2#databases: |
| CloudWatch Dashboard | https://us-east-2.console.aws.amazon.com/cloudwatch/home?region=us-east-2#dashboards/dashboard/deecell-fleet-production-dashboard |
| Load Balancer | https://us-east-2.console.aws.amazon.com/ec2/v2/home?region=us-east-2#LoadBalancers: |

---

## Troubleshooting

**Still seeing 503?**
- Wait 5 minutes for ECS to start the new container
- Check GitHub Actions for errors
- Check ECS console for task status

**GitHub Actions failed?**
- Make sure all 4 secrets are added correctly
- Check the error message in the Actions log
