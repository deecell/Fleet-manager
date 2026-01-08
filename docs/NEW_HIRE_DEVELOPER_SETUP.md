# New Hire Developer Setup Guide

Welcome to Deecell! This guide will get your MacBook set up to work on the Fleet Tracking Dashboard, including access to our production database for migrations.

---

## Prerequisites

- MacBook (Intel or Apple Silicon)
- Admin access to install software
- AWS IAM credentials (get from your manager)
- GitHub account added to the `deecell` organization

---

## Step 1: Install Homebrew (if not already installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen instructions to add Homebrew to your PATH.

---

## Step 2: Install Required Tools

```bash
brew install awscli git
```

---

## Step 3: Configure AWS CLI

You'll need your **AWS Access Key ID** and **AWS Secret Access Key** from your manager.

```bash
aws configure
```

Enter the following when prompted:
- **AWS Access Key ID**: (paste your access key)
- **AWS Secret Access Key**: (paste your secret key)
- **Default region name**: `us-east-2`
- **Default output format**: `json`

### Verify AWS Setup

```bash
aws sts get-caller-identity
```

You should see your AWS account details. If you get a credentials error, double-check your keys.

---

## Step 4: Install AWS Session Manager Plugin

This is required to connect to our production EC2 instance.

### For Apple Silicon Macs (M1/M2/M3)

```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac_arm64/sessionmanager-bundle.zip" -o "sessionmanager-bundle.zip"
unzip sessionmanager-bundle.zip
sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin
rm -rf sessionmanager-bundle sessionmanager-bundle.zip
```

### For Intel Macs

```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac/sessionmanager-bundle.zip" -o "sessionmanager-bundle.zip"
unzip sessionmanager-bundle.zip
sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin
rm -rf sessionmanager-bundle sessionmanager-bundle.zip
```

**Not sure which Mac you have?** Run `uname -m`:
- `arm64` = Apple Silicon
- `x86_64` = Intel

### Verify Session Manager

```bash
session-manager-plugin --version
```

---

## Step 5: Create a GitHub Personal Access Token

GitHub no longer accepts passwords for git operations. You need a Personal Access Token (PAT).

1. Go to: https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Give it a name like `MacBook CLI`
4. Set expiration (recommend 90 days or custom)
5. Select scope: **repo** (full control of private repositories)
6. Click **Generate token**
7. **Copy the token immediately** (it starts with `ghp_` and won't be shown again)

Save this token somewhere secure (1Password, Keychain, etc.).

---

## Step 6: Clone the Repository

Navigate to your development folder:

```bash
cd ~/Development
```

Clone the repo using your Personal Access Token:

```bash
git clone https://YOUR_TOKEN@github.com/deecell/Fleet-manager.git
```

Replace `YOUR_TOKEN` with your actual GitHub token.

Example:
```bash
git clone https://ghp_abc123xyz@github.com/deecell/Fleet-manager.git
```

---

## Step 7: Verify Production Access

Test that you can see our EC2 instances:

```bash
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].[InstanceId,Tags[?Key==`Name`].Value|[0]]' \
  --output table \
  --region us-east-2
```

You should see:
```
+----------------------+-------------------------------------------+
|  i-05443904f977d7301 |  deecell-fleet-production-device-manager  |
+----------------------+-------------------------------------------+
```

---

## You're Done!

Your MacBook is now set up for Deecell development.

---

## Quick Reference: Running Production Database Migrations

When you need to run SQL migrations on the production database, use this workflow:

### Step 1: Connect to EC2 via SSM

```bash
aws ssm start-session --target i-05443904f977d7301 --region us-east-2
```

### Step 2: Get the Database URL (run this inside the EC2 session)

```bash
export DATABASE_URL=$(aws secretsmanager get-secret-value \
  --secret-id deecell-fleet-production/database-url \
  --query SecretString \
  --output text \
  --region us-east-2)
```

### Step 3: Connect to PostgreSQL

```bash
psql "$DATABASE_URL"
```

### Step 4: Run Your SQL

```sql
-- Example: create a new table
CREATE TABLE IF NOT EXISTS my_table (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128)
);

-- Verify
\dt my_table
```

### Step 5: Exit

```sql
\q
```

Then type `exit` to close the SSM session.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Unable to locate credentials` | Run `aws configure` and enter your keys |
| `Repository not found` when cloning | Make sure you're using the correct repo URL and a valid GitHub token |
| `command not found: session-manager-plugin` | Reinstall the Session Manager plugin |
| SSM session hangs | Check if the EC2 instance is running in AWS Console |
| `DATABASE_URL is empty` | Make sure you run the export command **inside** the EC2 session, not before |

---

## Key Resources

| Resource | Location |
|----------|----------|
| Repository | https://github.com/deecell/Fleet-manager |
| AWS Region | us-east-2 (Ohio) |
| Production App | https://app.deecell.com |
| Device Manager EC2 | i-05443904f977d7301 |
| Database Secret | `deecell-fleet-production/database-url` |

---

## Need Help?

- Check `docs/PRODUCTION_DB_MIGRATION_GUIDE.md` for detailed migration instructions
- Check `DEVELOPMENT_LOG.md` for recent development history
- Ask your manager for AWS/GitHub access issues
