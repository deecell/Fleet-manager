# Solar APU - Agent Instructions

> **Complete step-by-step guide for deploying the application to AWS**

---

## Overview

This document provides detailed instructions for setting up a production-ready AWS deployment with:
- Automated CI/CD via GitHub Actions
- Terraform-managed infrastructure
- Multi-tenant architecture
- SOC2/ISO27001 compliance controls

**Estimated Time**: 2-4 hours for initial setup

---

## Phase 1: Project Preparation

### Step 1.1: Verify Project Structure

Ensure your Replit project has this structure:

```
solar-apu/
├── client/                    # Frontend (React/Vite recommended)
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── lib/
│   │   └── App.tsx
│   └── index.html
├── server/                    # Backend (Express/Node.js recommended)
│   ├── routes.ts
│   ├── storage.ts
│   ├── index.ts
│   └── vite.ts
├── shared/                    # Shared types/schemas
│   └── schema.ts
├── terraform/                 # Infrastructure (create this)
├── .github/                   # GitHub Actions (create this)
│   └── workflows/
├── Dockerfile                 # Container definition (create this)
├── package.json
└── replit.md
```

### Step 1.2: Create Required Directories

```bash
mkdir -p terraform
mkdir -p .github/workflows
```

### Step 1.3: Verify Database Schema

Ensure your `shared/schema.ts` includes multi-tenant support:

```typescript
import { pgTable, serial, text, timestamp, varchar, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Organizations table (for multi-tenancy)
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").default("free"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  organizationId: integer("organization_id").references(() => organizations.id),
  role: text("role").default("user"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

// Sessions table
export const sessions = pgTable("sessions", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: text("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

// Audit log table (required for SOC2)
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  action: text("action").notNull(),
  resource: text("resource"),
  resourceId: text("resource_id"),
  details: text("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Export schemas and types
export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, lastLoginAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
```

---

## Phase 2: Create Dockerfile

### Step 2.1: Create Multi-Stage Dockerfile

Create `Dockerfile` in project root:

```dockerfile
# =============================================================================
# Solar APU - Production Dockerfile
# Multi-stage build for optimized image size
# =============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy built assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Set environment
ENV NODE_ENV=production
ENV PORT=5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Run as non-root user
USER nodejs

EXPOSE 5000

CMD ["node", "dist/index.js"]
```

### Step 2.2: Create .dockerignore

Create `.dockerignore`:

```
node_modules
.git
.gitignore
*.md
.env*
terraform/
.github/
.replit
replit.nix
*.log
coverage/
.nyc_output/
```

### Step 2.3: Create Health Check Endpoint

Add to `server/routes.ts`:

```typescript
import { Router } from "express";

const router = Router();

// Health check endpoint (required for ALB)
router.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  });
});

export default router;
```

---

## Phase 3: AWS Account Setup

### Step 3.1: Create IAM User for Terraform

1. Go to AWS Console > IAM > Users
2. Create user: `solar-apu-terraform`
3. Attach these managed policies:
   - `AmazonVPCFullAccess`
   - `AmazonRDSFullAccess`
   - `AmazonECS_FullAccess`
   - `AmazonEC2ContainerRegistryFullAccess`
   - `ElasticLoadBalancingFullAccess`
   - `IAMFullAccess`
   - `AmazonS3FullAccess`
   - `SecretsManagerReadWrite`
   - `CloudWatchFullAccess`
   - `AWSCloudTrail_FullAccess`

4. Create Access Key (for programmatic access)
5. Save the Access Key ID and Secret Access Key securely

### Step 3.2: Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name solar-apu \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256 \
  --region us-east-1
```

Save the repository URI: `<account-id>.dkr.ecr.us-east-1.amazonaws.com/solar-apu`

---

## Phase 4: Create Terraform Infrastructure

### Step 4.1: Copy Terraform Files

Copy ALL Terraform files from [3-TERRAFORM-SETUP.md](./3-TERRAFORM-SETUP.md) into your `terraform/` directory:

```
terraform/
├── main.tf
├── variables.tf
├── vpc.tf
├── rds.tf
├── ecs.tf
├── alb.tf
├── security-groups.tf
├── iam.tf
├── secrets.tf
├── cloudwatch.tf
├── monitoring.tf
├── outputs.tf
└── terraform.tfvars.example
```

### Step 4.2: Create terraform.tfvars

Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in values:

```hcl
# Project Configuration
project_name = "solar-apu"
environment  = "production"
aws_region   = "us-east-1"

# Network Configuration
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# Application Configuration
domain_name   = "app.solarapu.com"  # Your domain
ecs_cpu       = 512
ecs_memory    = 1024
desired_count = 2

# Database Configuration
db_instance_class    = "db.t3.small"
db_allocated_storage = 20

# Container Configuration
ecr_repository_url = "<account-id>.dkr.ecr.us-east-1.amazonaws.com/solar-apu"
container_port     = 5000

# Secrets (use environment variables instead for CI/CD)
# TF_VAR_db_password
# TF_VAR_session_secret
```

### Step 4.3: Initialize and Plan (Local Test)

```bash
cd terraform
terraform init
terraform plan -out=tfplan
```

Review the plan to ensure it creates expected resources.

---

## Phase 5: GitHub Repository Setup

### Step 5.1: Create GitHub Repository

1. Go to github.com and create new repository: `solar-apu`
2. Keep it private for now
3. Don't initialize with README (we'll push from Replit)

### Step 5.2: Connect Replit to GitHub

In Replit:
1. Go to Version Control (Git tab)
2. Click "Connect to GitHub"
3. Authorize Replit to access your GitHub
4. Select the `solar-apu` repository
5. Push your code

### Step 5.3: Configure GitHub Secrets

Go to Repository > Settings > Secrets and variables > Actions

Add these secrets:

| Secret Name | Description |
|-------------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account ID |
| `ECR_REPOSITORY` | `solar-apu` |
| `TF_VAR_db_password` | Strong password for PostgreSQL |
| `TF_VAR_session_secret` | Random 64-character string |
| `TF_VAR_domain_name` | Your domain (e.g., `app.solarapu.com`) |

Generate secure secrets:
```bash
# Generate session secret
openssl rand -base64 48

# Generate database password
openssl rand -base64 32 | tr -dc 'a-zA-Z0-9!#$%&*' | head -c 32
```

---

## Phase 6: Create GitHub Actions Workflow

### Step 6.1: Create CI/CD Workflow

Copy the complete workflow from [4-GITHUB-ACTIONS-SETUP.md](./4-GITHUB-ACTIONS-SETUP.md) to `.github/workflows/deploy.yml`

### Step 6.2: Create Terraform Workflow (Optional)

For infrastructure-only changes, create `.github/workflows/terraform.yml`:

```yaml
name: Terraform

on:
  push:
    branches: [main]
    paths:
      - 'terraform/**'
  pull_request:
    branches: [main]
    paths:
      - 'terraform/**'

jobs:
  terraform:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: terraform

    steps:
      - uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Terraform Init
        run: terraform init

      - name: Terraform Plan
        run: |
          terraform plan -no-color
        env:
          TF_VAR_db_password: ${{ secrets.TF_VAR_db_password }}
          TF_VAR_session_secret: ${{ secrets.TF_VAR_session_secret }}

      - name: Terraform Apply
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        run: terraform apply -auto-approve
        env:
          TF_VAR_db_password: ${{ secrets.TF_VAR_db_password }}
          TF_VAR_session_secret: ${{ secrets.TF_VAR_session_secret }}
```

---

## Phase 7: Initial Deployment

### Step 7.1: Deploy Infrastructure First

```bash
cd terraform
terraform init
terraform apply
```

This creates:
- VPC with public/private subnets
- RDS PostgreSQL database
- ECS cluster (empty)
- ALB
- Security groups
- IAM roles
- CloudWatch log groups
- Secrets Manager secrets

### Step 7.2: Run Database Migrations

After infrastructure is up, run migrations:

```bash
# Get database endpoint from Terraform output
terraform output database_endpoint

# Run migrations (adjust for your setup)
DATABASE_URL="postgresql://..." npm run db:push
```

### Step 7.3: Push Code to Trigger Deployment

From Replit, push to main branch:
```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

This triggers the GitHub Action which:
1. Builds Docker image
2. Pushes to ECR
3. Updates ECS service
4. Waits for healthy deployment

### Step 7.4: Verify Deployment

```bash
# Get ALB URL
terraform output alb_dns_name

# Test health endpoint
curl http://<alb-dns>/api/health
```

---

## Phase 8: Domain and SSL Setup

### Step 8.1: Request ACM Certificate

The Terraform creates an ACM certificate request. To validate:

1. Get validation records:
   ```bash
   terraform output dns_validation_records
   ```

2. Add CNAME records to your DNS provider

3. Wait for certificate validation (can take 30 minutes)

### Step 8.2: Configure Domain

Add CNAME record pointing your domain to the ALB:
```
app.solarapu.com -> <alb-dns-name>
```

### Step 8.3: Enable HTTPS Listener

After certificate is validated, the Terraform applies HTTPS listener automatically.

---

## Phase 9: Post-Deployment Verification

### Step 9.1: Security Checklist

- [ ] HTTPS working with valid certificate
- [ ] Health check endpoint responding
- [ ] Database connections working
- [ ] CloudWatch logs streaming
- [ ] GuardDuty enabled
- [ ] CloudTrail logging

### Step 9.2: Test Multi-Tenancy

```bash
# Create test organization
curl -X POST https://app.solarapu.com/api/organizations \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Org", "slug": "test-org"}'
```

### Step 9.3: Verify Audit Logging

Check CloudWatch Logs for audit entries after user actions.

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| ECS tasks failing to start | Check CloudWatch logs, verify environment variables |
| Database connection refused | Check security group allows ECS to RDS on port 5432 |
| Health check failing | Ensure `/api/health` returns 200 status |
| GitHub Action failing | Check secrets are configured correctly |
| Certificate not validating | Verify DNS CNAME records are correct |

### Useful Commands

```bash
# View ECS service status
aws ecs describe-services --cluster solar-apu-production-cluster --services solar-apu

# View recent logs
aws logs tail /ecs/solar-apu-production --follow

# Force new deployment
aws ecs update-service --cluster solar-apu-production-cluster --service solar-apu --force-new-deployment

# Check RDS status
aws rds describe-db-instances --db-instance-identifier solar-apu-production-postgres
```

---

## Next Steps

1. Review [5-SECURITY-COMPLIANCE.md](./5-SECURITY-COMPLIANCE.md) for compliance requirements
2. Review [6-MULTI-TENANCY-GUIDE.md](./6-MULTI-TENANCY-GUIDE.md) for tenant isolation
3. Set up monitoring alerts in CloudWatch
4. Configure backup retention policies
5. Set up staging environment

---

*Document Version: 1.0*
*Last Updated: November 2024*
