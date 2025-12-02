# GitHub Repository Cleanup Guide

> **IMPORTANT**: Your AWS credentials are exposed in git history. You MUST rotate them after cleanup.

## The Problem

GitHub is blocking your push because:
1. **Large files** (674 MB Terraform providers) exist in git history
2. **AWS credentials** are exposed in old commits

Even though current files are clean, git history contains the old versions with secrets.

---

## Solution: Clean Git History

### Option A: Use git-filter-repo (Recommended)

**Step 1: Install git-filter-repo**

```bash
# On macOS
brew install git-filter-repo

# On Ubuntu/Debian
pip install git-filter-repo

# On Windows
pip install git-filter-repo
```

**Step 2: Clone a fresh copy (BACKUP FIRST!)**

```bash
# Clone the repo fresh
git clone --mirror https://github.com/deecell/Fleet-manager.git fleet-cleanup
cd fleet-cleanup
```

**Step 3: Remove large files and sensitive data**

```bash
# Remove the large Terraform providers folder
git filter-repo --path terraform/.terraform --invert-paths

# Remove state files
git filter-repo --path-glob 'terraform/*.tfstate*' --invert-paths
git filter-repo --path-glob 'terraform/*.backup' --invert-paths

# Remove old .replit versions with credentials
git filter-repo --path .replit --invert-paths
```

**Step 4: Force push cleaned history**

```bash
git push --force --all
git push --force --tags
```

---

### Option B: Start Fresh (Easier)

If the above is too complex, you can create a new repository:

**Step 1: Create a new GitHub repo**
- Go to GitHub and create a new repository (e.g., `Fleet-manager-v2`)

**Step 2: Push current clean code**

```bash
# In your Replit project directory
git remote remove origin
git remote add origin https://github.com/deecell/Fleet-manager-v2.git

# Create a fresh commit with only current files
git checkout --orphan clean-main
git add -A
git commit -m "Initial commit - clean production code"
git branch -D main
git branch -m main
git push -u origin main --force
```

---

## CRITICAL: Rotate AWS Credentials

Your AWS Access Keys are compromised. You MUST:

1. **Go to AWS IAM Console**: https://console.aws.amazon.com/iam/
2. Click **Users** → Select the user with exposed credentials
3. Click **Security credentials** tab
4. Under **Access keys**, click **Create access key**
5. Save the new Access Key ID and Secret Access Key
6. **Deactivate** the old access key (then delete it after confirming new one works)
7. Update your GitHub repository secrets with the new credentials

---

## Files to Keep Out of Git

Your `.gitignore` already includes these, but double-check:

```
# Already in your .gitignore - DO NOT COMMIT THESE:
.terraform/
*.tfstate
*.tfstate.*
*.backup
terraform.tfvars  # If it contains real values
.replit           # If it contains env vars
.env
.env.*
```

---

## Quick Reference: GitHub Unblock Links

If you prefer to allow the secrets (NOT RECOMMENDED - only if rotating credentials):

- https://github.com/deecell/Fleet-manager/security/secret-scanning/unblock-secret/36GU0O7m3vJyyd0qXj9GFn6jrNX
- https://github.com/deecell/Fleet-manager/security/secret-scanning/unblock-secret/36GU0MI7qdDrNaO4v8qyGXqjLBl
- https://github.com/deecell/Fleet-manager/security/secret-scanning/unblock-secret/36GU0OlGm63I60yhOdcvWkG5mjZ
- https://github.com/deecell/Fleet-manager/security/secret-scanning/unblock-secret/36GU0NBYH5HLkLbwKIUGT3ptiKz

**WARNING**: Only use these after rotating your AWS credentials!

---

## After Cleanup Checklist

- [ ] AWS credentials rotated in IAM console
- [ ] Old access keys deactivated/deleted
- [ ] New credentials added to GitHub Secrets
- [ ] Repository pushed successfully
- [ ] All team members recloned the repo
- [ ] `.gitignore` verified (should already be correct)

---

## Need Help?

If you get stuck:
1. The easiest path is **Option B** (start fresh)
2. Rotate AWS credentials BEFORE doing anything else
3. After rotating, you can use the "unblock" links to push quickly
