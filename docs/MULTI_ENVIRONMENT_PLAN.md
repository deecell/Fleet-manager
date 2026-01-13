# Multi-Environment Plan: DEV, STAGING, PRODUCTION

**Document Version**: 1.0  
**Date**: January 14, 2026  
**Project**: Deecell Fleet Tracking Dashboard  
**Status**: Planned  

---

## Executive Summary

This document outlines the plan to expand the Deecell Fleet Tracking Dashboard from a single production environment to a three-tier environment structure: DEV, STAGING, and PRODUCTION. The primary goal is **safer deployments** through testing changes before they reach production.

---

## Environment Overview

| Environment | Purpose | Web App | Device Manager | Database | Data Source |
|-------------|---------|---------|----------------|----------|-------------|
| **DEV** | Daily development, quick iteration | Replit | Mock/Optional | Replit Neon | Synced from Prod (GFR org) |
| **STAGING** | Pre-production testing, full integration | AWS ECS | AWS EC2 (shared) | AWS RDS (separate) | Synced from Prod or independent |
| **PROD** | Live customers | AWS ECS | AWS EC2 | AWS RDS | Real data |

---

## Phase 1: Production Data Sync for DEV (Replit)

### Goal
Enable on-demand sync of GFR organization data from production to the Replit dev database, allowing development with real data.

### Benefits
- Develop and test with realistic data structures
- Log in as real GFR users to verify the user experience
- No need to maintain separate test data
- One-way sync (prod → dev only) ensures production safety

### Implementation Steps

#### Step 1.1: Create Read-Only Production User

Run on production database via SSM → EC2 → psql:

```sql
-- Create read-only user for Replit sync
CREATE USER replit_sync WITH PASSWORD 'generated_secure_password';
GRANT CONNECT ON DATABASE deecell_fleet TO replit_sync;
GRANT USAGE ON SCHEMA public TO replit_sync;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO replit_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO replit_sync;
```

**Security**: This user can only SELECT data, never modify production.

#### Step 1.2: Store Read-Only Connection in Replit

Add Replit secret:
- **Key**: `PROD_DATABASE_URL_READONLY`
- **Value**: `postgresql://replit_sync:password@prod-host:5432/deecell_fleet?sslmode=require`

#### Step 1.3: Build Sync Script

Create `scripts/sync-from-prod.ts` that:

1. Connects to production (read-only)
2. Fetches all data for specified organization(s):
   - organizations
   - fleets
   - trucks
   - power_mon_devices
   - users
   - device_snapshots (latest per device)
   - measurements (last 7 days)
   - device_statistics
   - alerts
3. Clears existing data for those orgs in DEV database
4. Inserts fresh data respecting foreign key order
5. Reports sync summary (rows synced per table)

#### Step 1.4: Usage Workflow

| You Say | I Do |
|---------|------|
| "Sync GFR from prod" | Run sync script for GFR organization |
| "Sync GFR and Mike's org" | Run sync script for multiple organizations |

After sync:
- DEV database contains fresh production data
- Log in using your real GFR credentials (same email/password)
- Admin dashboard uses `ADMIN_PASSWORD` secret (separate per environment)

### Deliverables
- [ ] `scripts/migrations/create-readonly-user.sh` - Script to run on production
- [ ] `scripts/sync-from-prod.ts` - Sync script
- [ ] Documentation for sync process

---

## Phase 2: STAGING Environment in AWS

### Goal
A separate AWS environment for pre-production testing with real PowerMon devices.

### Benefits
- Test full integration (web app + Device Manager + devices) before production
- Validate database migrations on production-like infrastructure
- Safe place for QA and user acceptance testing

### Implementation Steps

#### Step 2.1: Terraform Workspace Setup

Create environment-specific configuration:

**File**: `terraform/environments/staging.tfvars`

```hcl
environment = "staging"
domain_name = "staging.deecell.com"

# Smaller instances to reduce cost
ecs_cpu    = 256
ecs_memory = 512
desired_count = 1
min_capacity  = 1
max_capacity  = 2

# Smaller database
db_instance_class = "db.t3.micro"
db_allocated_storage = 20
db_multi_az = false

# Device Manager
device_manager_instance_type = "t3.small"
```

**Terraform State**: Separate state file at `staging/terraform.tfstate`

#### Step 2.2: GitHub Actions Branch Strategy

| Branch | Auto-Deploys To | Manual Approval |
|--------|-----------------|-----------------|
| `main` | Production | No (current behavior) |
| `staging` | Staging | No |
| `develop` | None (use Replit) | N/A |

**Workflow Changes**:
- Modify `.github/workflows/deploy.yml` to detect branch and deploy to appropriate environment
- Use environment-specific ECS cluster/service names
- Use environment-specific secrets

#### Step 2.3: Device Manager Strategy

**Recommended**: Dedicated Test Devices

| Device | Environment | Notes |
|--------|-------------|-------|
| GFR-XX (shop test truck) | Staging only | For staging integration tests |
| All other devices | Production | Normal operation |

**Alternative Options**:
- **Shared Device Manager**: One DM serves both environments (staging web app reads same data as prod)
- **Time-based**: Staging DM only runs during testing windows

#### Step 2.4: DNS Configuration

Add Route 53 record:
- `staging.deecell.com` → Staging ALB

### Deliverables
- [ ] `terraform/environments/staging.tfvars`
- [ ] Updated GitHub Actions workflows
- [ ] Route 53 DNS configuration
- [ ] Staging-specific secrets in AWS Secrets Manager

---

## Phase 3: MacBook Local Development (Optional/Future)

### Goal
Enable full local development on MacBook Pro without cloud dependencies.

### Current Blocker
The Device Manager uses Thornwave's `libpowermon_bin` native library, which currently only provides Linux binaries.

### Investigation Required

```bash
# Check if Thornwave provides macOS library
git clone https://git.thornwave.com/thornwave/libpowermon_bin
ls -la libpowermon_bin/
```

Look for:
- `*.dylib` files (macOS dynamic library)
- `macos/` or `darwin/` subdirectory
- README mentioning macOS support

### If macOS Library Available

1. Update `device-manager/binding.gyp` with macOS conditions
2. Remove Linux-specific dependencies (`-lbluetooth`, `-ldbus-1`) for macOS
3. Document local setup process

### If No macOS Library

**Options**:
1. Contact Thornwave (Raz) about macOS support
2. Use Replit as primary DEV environment (current approach)
3. Build mock device mode for local UI development without real devices

### Deliverables (Conditional)
- [ ] Updated `binding.gyp` for cross-platform support
- [ ] Local development setup guide

---

## Infrastructure Cost Estimates

| Environment | Component | Monthly Cost |
|-------------|-----------|--------------|
| **DEV** | Replit | Included in plan |
| **STAGING** | ECS (1 task, small) | ~$15 |
| | RDS (db.t3.micro) | ~$15 |
| | EC2 Device Manager (t3.small) | ~$15 |
| | ALB | ~$20 |
| | Other (NAT, storage) | ~$15 |
| | **Subtotal** | **~$80/month** |
| **PROD** | Current infrastructure | ~$150-200/month |

### Cost Optimization for Staging
- Auto-shutdown during non-business hours (Lambda scheduled task)
- Use spot instances for Device Manager EC2
- Single-AZ RDS (no redundancy needed for staging)

---

## Implementation Priority

| Priority | Phase | Effort | Value |
|----------|-------|--------|-------|
| **1** | Phase 1: Prod → DEV Sync | 1-2 days | High - Immediate development value |
| **2** | Phase 2: Staging Environment | 2-3 days | High - Safer deployments |
| **3** | Phase 3: MacBook Local Dev | TBD | Medium - Depends on Thornwave |

---

## Security Considerations

### Data Sync (Phase 1)
- Read-only database user prevents accidental production modifications
- User passwords are bcrypt hashes (no plaintext exposure)
- Sync is one-way only (prod → dev)
- DEV environment access limited to developers

### Staging (Phase 2)
- Separate AWS resources with environment tagging
- Separate secrets in AWS Secrets Manager
- Separate database with no production data by default
- IAM policies restrict cross-environment access

---

## Acceptance Criteria

### Phase 1 Complete When:
- [ ] Read-only production user exists
- [ ] Sync script successfully copies GFR data to Replit
- [ ] Can log in to DEV Fleet dashboard with GFR credentials
- [ ] Sync can be triggered on-demand during development

### Phase 2 Complete When:
- [ ] Staging environment accessible at `staging.deecell.com`
- [ ] Push to `staging` branch auto-deploys to staging
- [ ] Push to `main` branch auto-deploys to production
- [ ] Device Manager in staging connects to test devices

### Phase 3 Complete When:
- [ ] Device Manager compiles and runs on macOS
- [ ] Local development guide documented
- [ ] Or: Decision made to use Replit-only approach

---

## Appendix: Current Architecture Reference

### Production Infrastructure (AWS)
- **Web App**: ECS Fargate at `app.deecell.com`
- **Device Manager**: EC2 in Auto Scaling Group
- **Database**: RDS PostgreSQL (Neon-backed in Replit for dev)
- **Secrets**: AWS Secrets Manager

### Key Secrets
- `deecell-fleet-production/database-url` - Production DATABASE_URL
- `ADMIN_PASSWORD` - Admin dashboard access
- `SENDGRID_API_KEY`, `OPENAI_API_KEY`, etc.

### GitHub Repository
- Main branch: Production deployments
- Terraform in `terraform/` directory
- CI/CD in `.github/workflows/`

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-14 | Agent | Initial plan |
