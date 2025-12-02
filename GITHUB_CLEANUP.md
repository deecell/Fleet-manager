# GitHub Repository Cleanup Guide

> **IMPORTANT**: Your AWS credentials are exposed in git history. You MUST rotate them after cleanup.

## The Problem

GitHub is blocking your push because:
1. **Large files** (674 MB Terraform providers) exist in git history
2. **AWS credentials** are exposed in old commits in these files:
   - `DEPLOY_NOW.md` (lines 19-20)
   - `terraform/terraform.tfstate` and backup files
   - `.replit` file

Even though current files are clean, git history contains the old versions with secrets.

---

## Solution: Clean Git History

### Option A: Use git-filter-repo (Thorough Clean)

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
# Clone the repo fresh (--mirror preserves all branches)
git clone --mirror https://github.com/deecell/Fleet-manager.git fleet-cleanup
cd fleet-cleanup
```

**Step 3: Remove ALL sensitive files from history**

```bash
# Remove large Terraform providers (674 MB)
git filter-repo --path terraform/.terraform --invert-paths --force

# Remove ALL files that contained credentials
git filter-repo --path DEPLOY_NOW.md --invert-paths --force
git filter-repo --path .replit --invert-paths --force
git filter-repo --path-glob 'terraform/*.tfstate*' --invert-paths --force
git filter-repo --path-glob 'terraform/*.backup' --invert-paths --force

# Also catch any other large files over 100MB
git filter-repo --strip-blobs-bigger-than 100M --force
```

**Step 4: Force push cleaned history**

```bash
git push --force --all
git push --force --tags
```

**Step 5: Re-add clean versions of removed files**

After pushing, you'll need to add back clean versions of DEPLOY_NOW.md 
(copy from Replit where credentials are already removed).

---

### Option B: Start Fresh (Easiest - Recommended)

This is the simplest approach - create a brand new repository with only clean code:

**Step 1: Rotate AWS Credentials FIRST**
- Go to AWS IAM Console: https://console.aws.amazon.com/iam/
- Create new access keys
- Delete/deactivate old keys
- (This is required regardless of which option you choose)

**Step 2: Create a new GitHub repo**
- Go to GitHub: https://github.com/new
- Create a new repository called `Fleet-manager-clean` (or any name)
- Keep it empty (no README, no .gitignore)

**Step 3: On your local machine (not in Replit)**

```bash
# Clone from Replit or download the current code
# Make sure you have the clean current version

# Initialize fresh git in a folder with the clean code
cd your-project-folder
rm -rf .git
git init
git add -A
git commit -m "Initial commit - production code"

# Push to new repo
git remote add origin https://github.com/deecell/Fleet-manager-clean.git
git branch -M main
git push -u origin main
```

**Step 4: Update GitHub Secrets in new repo**
- Go to new repo Settings → Secrets → Actions
- Add your NEW (rotated) AWS credentials

---

### Option C: Quickest Fix (After Rotating Credentials)

If you've already rotated your AWS credentials, you can allow the old secrets in history:

**Step 1: Rotate credentials in AWS IAM (MUST DO FIRST)**

**Step 2: Click each unblock link:**
- https://github.com/deecell/Fleet-manager/security/secret-scanning/unblock-secret/36GU0O7m3vJyyd0qXj9GFn6jrNX
- https://github.com/deecell/Fleet-manager/security/secret-scanning/unblock-secret/36GU0MI7qdDrNaO4v8qyGXqjLBl
- https://github.com/deecell/Fleet-manager/security/secret-scanning/unblock-secret/36GU0OlGm63I60yhOdcvWkG5mjZ
- https://github.com/deecell/Fleet-manager/security/secret-scanning/unblock-secret/36GU0NBYH5HLkLbwKIUGT3ptiKz

**Step 3: Push again**

```bash
git push origin main --force
```

**Note**: This leaves secrets in history, but since they're rotated, they're harmless.

---

## CRITICAL: Rotate AWS Credentials

Your AWS Access Keys are compromised. Do this BEFORE any other step:

1. **Go to AWS IAM Console**: https://console.aws.amazon.com/iam/
2. Click **Users** in the left sidebar
3. Find and click the user (likely `deecell-fleet-production-github-actions`)
4. Click **Security credentials** tab
5. Scroll to **Access keys** section
6. Click **Create access key**
   - Choose "Application running outside AWS"
   - Click Next, then Create
7. **SAVE** the new Access Key ID and Secret Access Key (you won't see them again)
8. Back on the access keys list, find the OLD key
9. Click **Actions** → **Deactivate**, then **Delete** after testing

**Update GitHub Secrets:**
- Go to your repo → Settings → Secrets and variables → Actions
- Update `AWS_ACCESS_KEY_ID` with new value
- Update `AWS_SECRET_ACCESS_KEY` with new value

---

## Which Option Should You Choose?

| Option | Difficulty | Time | History Clean? |
|--------|------------|------|----------------|
| **A: git-filter-repo** | Hard | 30+ min | Yes - fully cleaned |
| **B: Start Fresh** | Medium | 15 min | Yes - brand new history |
| **C: Unblock Links** | Easy | 5 min | No - secrets remain (but rotated) |

**Recommendation**: 
- If you need the repo TODAY: **Option C** (unblock after rotating)
- If you want clean history: **Option B** (start fresh)
- If you must keep same repo URL: **Option A** (filter-repo)

---

## After Cleanup Checklist

- [ ] AWS credentials rotated in IAM console
- [ ] Old access keys deactivated/deleted  
- [ ] New credentials added to GitHub Secrets
- [ ] Repository pushed successfully
- [ ] All team members recloned the repo (if using Option A or B)
- [ ] Test deployment workflow runs with new credentials

---

## Files That Should Never Be Committed

Your `.gitignore` is already configured correctly. These files stay local:

```
.terraform/           # Large provider binaries
*.tfstate            # Contains resource IDs and secrets
*.tfstate.*          # State backups
*.backup             # Terraform backups
terraform.tfvars     # If it contains real secrets
.replit              # Replit config with env vars
.env / .env.*        # Environment files
```
