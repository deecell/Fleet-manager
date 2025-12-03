# Deecell Fleet Management - Development Log

> This log tracks all development progress, architectural decisions, and implementation details for team reference.

---

## Latest Updates (December 3, 2025)

### Parked Status & Fuel Savings Tracking (December 3, 2025)

**Goal**: Track when trucks are parked (idle reduction) and calculate fuel savings based on parked time.

**Implementation Complete**:

1. **Schema Changes** (`shared/schema.ts`):
   - Added `is_parked` (boolean) - current parked status based on chassis voltage
   - Added `parked_since` (timestamp) - when truck became parked
   - Added `today_parked_minutes` (integer) - accumulated parked time today
   - Added `today_parked_date` (varchar) - date for daily reset tracking

2. **Device Manager Logic** (`device-manager/app/database.js`):
   - Parked detection: chassis voltage (voltage2) < 13.8V = parked
   - Daily reset: clears `todayParkedMinutes` at midnight (based on stored date)
   - Accumulates parked time by tracking `parkedSince` transitions

3. **Frontend API** (`client/src/lib/api.ts`):
   - Added `isParked`, `todayParkedMinutes`, `fuelSavings` to LegacyTruckWithDevice
   - Fuel savings formula: `(parkedMinutes / 60) * 1.2 gal/hr * $3.50/gal`
   - Default diesel price: $3.50 (hardcoded for now)

4. **Dashboard UI** (`client/src/components/FleetTable.tsx`):
   - Added "Parked" column with green/orange badge (Parked/Moving)
   - Added "Fuel Savings" column showing dollar amount with 2 decimals
   - Positioned between Truck and Driver columns

**Future Enhancements**:
- Connect fuel price to regional diesel pricing API (EIA integration)
- Add timezone-aware daily resets per fleet
- Display parked duration (hours:minutes) alongside status

---

### 📋 TODO: Implement Password Reset Feature (December 4, 2025)

**Goal**: Allow fleet dashboard users to reset their password via email

---

## Password Reset - Development Plan

### Prerequisites (Before Starting)
- [ ] Set up AWS SES in us-east-2 (same region as your infrastructure)
- [ ] Verify a sender email address in SES (e.g., noreply@deecell.com or your domain)
- [ ] Get SES credentials (or use IAM role if running on EC2/ECS)
- [ ] Add secrets: `SES_FROM_EMAIL`, optionally `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`

---

### Step 1: Database Schema (5 min)
**File**: `shared/schema.ts`

Add `passwordResetTokens` table:
```typescript
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Run: `npm run db:push`

---

### Step 2: Install AWS SES Package (2 min)
```bash
npm install @aws-sdk/client-ses
```

---

### Step 3: Create Email Service (15 min)
**File**: `server/services/email-service.ts`

```typescript
// Functions needed:
// - sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>
// - Uses AWS SES client
// - HTML email template with reset link
// - Plain text fallback
```

---

### Step 4: Create Password Reset Service (20 min)
**File**: `server/services/password-reset.ts`

```typescript
// Functions needed:
// - generateResetToken(): string (crypto.randomBytes, 32 bytes hex)
// - createPasswordResetRequest(email: string): Promise<boolean>
//   - Look up user by email
//   - Generate token, store with 1-hour expiry
//   - Send email with reset link
//   - Return true (always, to prevent email enumeration)
// - validateResetToken(token: string): Promise<User | null>
//   - Check token exists, not expired, not used
//   - Return user if valid
// - resetPassword(token: string, newPassword: string): Promise<boolean>
//   - Validate token
//   - Hash new password with bcrypt
//   - Update user's password
//   - Mark token as used
//   - Invalidate all other tokens for this user
```

---

### Step 5: API Routes (15 min)
**File**: `server/api/customer-auth.ts`

Add two new endpoints:

```typescript
// POST /api/v1/auth/forgot-password
// Body: { email: string }
// Response: { success: true, message: "If an account exists..." }
// Always returns success to prevent email enumeration

// POST /api/v1/auth/reset-password
// Body: { token: string, password: string }
// Response: { success: true } or { error: "Invalid or expired token" }
```

---

### Step 6: Frontend - Forgot Password Page (20 min)
**File**: `client/src/pages/ForgotPassword.tsx`

- Simple form with email input
- Submit calls POST /api/v1/auth/forgot-password
- Show success message: "If an account exists, we've sent a reset link"
- Link back to login page

---

### Step 7: Frontend - Reset Password Page (20 min)
**File**: `client/src/pages/ResetPassword.tsx`

- Extract token from URL query param
- Form with new password + confirm password fields
- Password validation (min 8 chars, match confirmation)
- Submit calls POST /api/v1/auth/reset-password
- On success: redirect to login with success toast
- On error: show "Invalid or expired link" message

---

### Step 8: Update Login Page (5 min)
**File**: `client/src/pages/Login.tsx`

- Add "Forgot Password?" link below password field
- Link to /forgot-password

---

### Step 9: Add Routes to App.tsx (2 min)
**File**: `client/src/App.tsx`

```typescript
<Route path="/forgot-password" component={ForgotPassword} />
<Route path="/reset-password" component={ResetPassword} />
```

---

### Step 10: Test End-to-End (15 min)
1. Go to login page, click "Forgot Password?"
2. Enter valid email, submit
3. Check email arrives (check SES sandbox if in sandbox mode)
4. Click reset link
5. Enter new password
6. Verify can log in with new password
7. Verify old password no longer works
8. Verify reset link can't be reused

---

### Production Deployment
- Ensure SES is out of sandbox mode (or recipient is verified)
- Add SES credentials to AWS Secrets Manager
- Update ECS task definition with SES environment variables

---

### Security Considerations (Built Into Plan)
- ✅ Tokens expire after 1 hour
- ✅ Tokens are single-use
- ✅ No email enumeration (same response for valid/invalid emails)
- ✅ Secure random token generation (crypto.randomBytes)
- ✅ Password hashed with bcrypt
- ✅ All other reset tokens invalidated on password change

---

### 📋 TODO: Review Today's Savings Calculation (December 4, 2025)

**Reminder**: User wants to review/work on the Today's Savings calculation logic.

Current formula: `(Solar Wh ÷ 1000 ÷ 9.0 kWh/gallon) × Diesel Price`

Files involved:
- `server/services/savings-calculator.ts` - Main calculation logic
- `server/services/eia-client.ts` - EIA diesel price fetching
- `server/services/padd-regions.ts` - Regional pricing by truck location

---

### ✅ Fixed Today's Savings Decimal Display (December 3, 2025)

**Fixed trailing zero display in Today's Savings card**

- Before: `$10.1` (missing trailing zero)
- After: `$10.10` (correct 2 decimal places)

**Change**: Added `alwaysShowDecimals={true}` to the Today's Savings StatCard in `client/src/components/FleetStats.tsx`

---

### ✅ Fixed Device Info API Method Name (December 3, 2025)

**Fixed PowerMon method name in Device Manager**

- Changed `device.getDeviceInfo()` to `device.getInfo()` in connection-pool.js
- The wrapper exports `getInfo` not `getDeviceInfo`

---

### ✅ GitHub Issues Integration (December 3, 2025)

**Added ability to create and view GitHub Issues from the Admin panel**

- **Repository**: `deecell/Fleet-manager`
- **Admin Page**: `/admin/issues`
- **Features**:
  - List open issues from the repo
  - Create new issues with title, description, and labels
  - Quick templates for Bug Reports, Feature Requests, and Technical Debt
  - Labels fetched from repo and selectable
  - Issues open in GitHub when created

**Files Created/Modified**:
- `server/services/github-issues.ts` - GitHub API service (create, list, labels)
- `server/api/admin-routes.ts` - Added `/github/issues` and `/github/labels` endpoints
- `client/src/pages/admin/IssuesPage.tsx` - Admin UI for managing issues
- `client/src/components/AdminLayout.tsx` - Added Issues nav link
- `client/src/App.tsx` - Added Issues route

**Secret Required**: `GITHUB_TOKEN` with `repo` scope

---

### ✅ Auto-Populate Device Info from PowerMon (December 3, 2025)

**Added automatic device info population on first connection**

When the Device Manager connects to a PowerMon device for the first time, it now automatically fetches and stores:
- Serial Number
- Firmware Version
- Hardware Revision
- Host ID

**Changes**:
1. **`device-manager/app/database.js`**:
   - Added `updateDeviceInfo()` function to update device details in `power_mon_devices` table

2. **`device-manager/app/connection-pool.js`**:
   - Added `fetchAndUpdateDeviceInfo()` method to DeviceConnection class
   - Called automatically after successful connection via `getDeviceInfo()` API
   - Logs device info when fetched and updates database

3. **`client/src/pages/admin/DevicesPage.tsx`**:
   - Removed Hardware Revision and Firmware Version fields from Register Device dialog
   - These fields are now auto-populated, so users don't need to enter them
   - Updated dialog description to explain auto-population

**User Experience**: Users only need to enter Serial Number (placeholder) and Device Name when registering. All technical details are filled in automatically when the PowerMon connects.

---

### ✅ Thornwave Applink URL Support (December 3, 2025)

**Added support for Thornwave applink URL format in device credentials**

The system now accepts both URL formats:
1. Legacy: `powermon://accessKey@connectionKey`
2. Thornwave: `https://applinks.thornwave.com/?n=DeviceName&s=serial&h=41&c=connectionKey&k=accessKey`

**Changes to `server/api/admin-routes.ts`**:
- Updated POST `/devices/:id/credentials` to parse Thornwave URLs
- Updated PATCH `/devices/:id/credentials` to parse Thornwave URLs
- Extracts `c` parameter as connectionKey and `k` parameter as accessKey
- Stores full applink URL for Device Manager compatibility

**Example Thornwave URL**:
```
https://applinks.thornwave.com/?n=DCL-Moeck&s=a3a5b30ea9b3ff98&h=41&c=c1HOvvGTYe4HcxZ1AWUUVg%3D%3D&k=qN19gp1NyTIjTcKXIFUagek74WSxnF9446mW1lX0Ca4%3D
```

---

### ✅ Fixed Device-to-Truck Assignment Bug (December 3, 2025)

**Problem**: "Assign" button did nothing when clicked - devices couldn't be assigned to trucks.

**Root Cause**: The `handleAssign` function used `selectedOrgId` (the organization filter dropdown) instead of the device's own `organizationId`. When viewing "All organizations", `selectedOrgId` was undefined, causing the function to silently return.

**Changes to `client/src/pages/admin/DevicesPage.tsx`**:
1. `handleAssign` now uses `assigningDevice.organizationId` instead of `selectedOrgId`
2. `handleUnassign` now uses `device.organizationId` instead of `selectedOrgId`
3. Truck dropdown in assign dialog filters trucks by the device's organization
4. Assign button disable logic checks for available trucks in the device's organization

**Result**: Device assignment now works correctly regardless of which organization filter is selected in the admin panel.

---

### ✅ Fixed "Last Seen" Timestamp Not Updating (December 3, 2025)

**Problem**: The "Last Seen" timestamp on the admin Devices page wasn't updating - it only showed when the device first connected, not ongoing poll activity.

**Root Cause**: The `updateDevicePollStatus()` function in Device Manager only updated `last_successful_poll_at` in `device_sync_status` table, but didn't update `last_seen_at` in `power_mon_devices` table (which is what the admin UI displays).

**Fix in `device-manager/app/database.js`**:
- Added query to update `power_mon_devices.last_seen_at` on every successful poll
- Now the admin dashboard shows real-time "Last Seen" timestamps

**Deployment Required**: Push to GitHub and redeploy Device Manager on EC2.

---

## Previous Updates (December 2, 2025)

### ✅ AWS Deployment FULLY OPERATIONAL (December 2, 2025 - 11:40 PM)

**Complete production deployment with Device Manager polling 2 PowerMon devices!**

**Infrastructure Summary**:
| Component | Status | Details |
|-----------|--------|---------|
| **Web App URL** | ✅ LIVE | http://deecell-fleet-production-alb-1191388080.us-east-2.elb.amazonaws.com |
| **ECS Fargate** | ✅ 2 tasks running | 512 CPU, 1024 MB RAM per task |
| **RDS PostgreSQL** | ✅ Available | deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com |
| **Device Manager EC2** | ✅ Active | Ubuntu 24.04, i-086e55075cb2820b7 |
| **Device Manager Service** | ✅ Polling | **2 active devices registered** |

**Production Data (GTO Fast Racing)**:
| Resource | Details |
|----------|---------|
| Organization | GTO Fast Racing (ID: 2) |
| Fleet | GFR Racing Fleet |
| Trucks | GFR-69, GFR-70 |
| Devices | DCL-Moeck (10.9.1.190), GFR-70 PowerMon (10.9.1.191) |

**What was done**:
1. Deployed complete AWS infrastructure (VPC, ECS, RDS, EC2, ALB)
2. Ubuntu 24.04 for Device Manager (glibc 2.38 compatibility)
3. Database schema migrated with all tables
4. Seeded GTO Fast Racing organization, fleet, trucks
5. Configured power_mon_devices and device_credentials tables
6. Device Manager service running and finding both devices

**Login Credentials**:
- Admin: `admin@deecell.com` / Password from AWS Secrets Manager
- Customer: Configure user credentials for GTO Fast Racing org

**Database Tables (20 tables)**:
```
alerts, audit_logs, device_credentials, device_measurements,
device_snapshots, device_statistics, device_sync_status, devices,
fleets, fuel_prices, organizations, power_mon_devices, savings_config,
schema_version, sessions, sim_location_history, sims, snapshots,
trucks, users
```

**Note**: Devices are on GFR's local network (10.9.1.x). Device Manager will show connection errors until VPN or network routing is configured between AWS and GFR's facility.

---

### 📋 Pending Tasks / Technical Debt

| Task | Priority | Notes |
|------|----------|-------|
| **Add AWS RDS SSL Certificate Verification** | Medium | Currently using `sslmode=disable` for AWS RDS connection. Should add proper certificate verification using AWS `rds-combined-ca-bundle.pem` CA bundle. See [AWS RDS SSL documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html). Steps: 1) Download RDS CA bundle, 2) Add to `server/aws/` directory, 3) Configure `ssl: { ca: rdsCa, rejectUnauthorized: true }` in `server/db.ts`, 4) Update DATABASE_URL to use `sslmode=verify-full`. |

---

### 🐧 Ubuntu 24.04 for Device Manager (December 2, 2025)

**Changed Device Manager EC2 from Amazon Linux 2023 to Ubuntu 24.04 LTS**

**Problem**: PowerMon native addon (`powermon_addon.node`) was compiled on Replit which has glibc 2.38. Amazon Linux 2023 has an older glibc version, causing `GLIBC_2.38' not found` errors.

**Solution**: Switch to Ubuntu 24.04 LTS which includes glibc 2.38+ out of the box.

**Changes to `terraform/device-manager.tf`**:
1. New AMI data source: `aws_ami.ubuntu_2404` (Canonical owner: 099720109477)
2. Updated user data script:
   - Uses `apt-get` instead of `dnf`
   - Installs Node.js 20 via NodeSource
   - Installs AWS CLI v2 manually
   - Installs `libbluetooth-dev` for PowerMon Bluetooth support
   - Installs CloudWatch Agent from .deb package
3. Changed default user from `ec2-user` to `ubuntu`
4. Updated deploy.sh to use `npm ci --ignore-scripts` to preserve pre-built native addons

**Deployment Steps**:
1. Run `terraform apply` to create new launch template with Ubuntu AMI
2. Terminate existing Amazon Linux instance (Auto Scaling will launch Ubuntu instance)
3. SSH using `ubuntu@<ip>` instead of `ec2-user@<ip>`
4. Run `/opt/device-manager/deploy.sh` to deploy code

---

### 🚀 Device Manager AWS CI/CD Setup (December 2, 2025)

**Added automated deployment for Device Manager to AWS EC2**:

1. **GitHub Actions Workflow**: `.github/workflows/deploy-device-manager.yml`
   - Triggers on changes to `device-manager/` folder
   - Packages code, uploads to S3, deploys to EC2 via SSM
   - Can also be triggered manually via workflow_dispatch

2. **Manual Deployment Script**: `device-manager/scripts/deploy-to-aws.sh`
   - Packages device-manager code
   - Uploads to S3 bucket
   - Triggers deployment on EC2 instances via SSM
   - Supports `--dry-run` mode for testing

3. **New GitHub Secret Required**:
   - `DEVICE_MANAGER_BUCKET` - Get from `terraform output device_manager_deploy_bucket_name`

4. **Documentation Updated**:
   - `DEPLOYMENT_CHECKLIST.md` - Added Device Manager CI/CD instructions
   - Added verification commands and scaling instructions

**Device Poll Results** (live data from GTO Fast Racing):
- GFR-69 (A3A5B30EA9B3FF98): 29.03V, -2.05A, 98% SOC, charging at 59W
- GFR-70 (1982A3044D3599E2): 29.03V, -2.15A, 98% SOC, charging at 62W
- Both trucks at near full charge with healthy voltage

---

### 🔧 AWS Deployment Fixes (December 2, 2025)

**Issue 1: IAM Permissions for Secrets Manager**
- Error: GitHub Actions could not list secrets to find DATABASE_URL ARN
- Fix: Added `secretsmanager:ListSecrets` permission to GitHub Actions IAM policy
- File: `terraform/iam.tf` - Added new `SecretsList` statement

**Issue 2: Database Connection Configuration Mismatch**
- Root cause: `server/aws/rds.ts` used different env vars (RDS_HOST, RDS_PORT, etc.) than what ECS provides (DATABASE_URL)
- Fix: Updated `server/aws/rds.ts` to parse DATABASE_URL when available, with fallback to individual env vars
- This allows the health check endpoint `/api/health` to properly connect to the RDS database

**Issue 3: Vite Package Not Found in Production**
- Error: `Cannot find package 'vite' imported from /app/dist/index.js`
- Root cause: `server/index.ts` imported from `./vite` at top level, which loads vite (a dev dependency)
- Fix: 
  - Created new `server/static.ts` for production static file serving (no vite dependency)
  - Modified `server/index.ts` to use dynamic imports for vite (dev) vs static (prod)
  - Moved `log()` function directly into index.ts to avoid vite.ts import

**Issue 4: Vite Still Being Bundled Despite Dynamic Import**
- Symptom: ECS logs showed "Cannot find package 'vite'" even after dynamic import fix
- Root cause: esbuild statically analyzes `import("./vite")` and bundles vite.ts anyway
- Fix: Used `Function()` constructor to create truly dynamic import that esbuild can't trace:
  ```javascript
  const viteModule = "./vite" + "";
  const { setupVite } = await (Function('return import("' + viteModule + '")')());
  ```
- Result: Bundle size reduced from 188kb to 180kb, vite code no longer included
- Added debug logging to `server/static.ts` for future diagnostics

**Issue 5: OpenAI API Key Missing at Startup**
- Symptom: Container crashes with "Missing credentials. Please pass an `apiKey`"
- Root cause: OpenAI client initialized at module load time in `fleet-assistant.ts`
- Fix: Changed to lazy initialization - OpenAI client only created when actually used
- This allows server to start even without OpenAI key (AI assistant just won't work)

**Current Status**: ✅ DEPLOYED SUCCESSFULLY TO AWS!

**Production URL**: http://deecell-fleet-production-alb-5549888.us-east-2.elb.amazonaws.com

---

## Previous Updates (December 1, 2025)

### ✅ AWS Infrastructure LIVE! (December 1, 2025 - 11:30 PM)
- **Status**: Infrastructure successfully deployed to AWS!
- **Terraform Apply**: 92+ resources created successfully
- **Region**: us-east-2 (Ohio)
- **AWS Account**: 892213647605

**Live Resources**:
| Resource | Value |
|----------|-------|
| **Application URL** | http://deecell-fleet-production-alb-5549888.us-east-2.elb.amazonaws.com |
| **Database Endpoint** | deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432 |
| **Database Name** | deecell_fleet |
| **ECS Cluster** | deecell-fleet-production-cluster |
| **ECS Service** | deecell-fleet |
| **VPC ID** | vpc-05650bbf3842df593 |

**Current Status**: 503 (awaiting Docker image deployment)

**GitHub Secrets for CI/CD** (add to repo Settings → Secrets → Actions):
| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | (get from Terraform output) |
| `AWS_SECRET_ACCESS_KEY` | (get from Terraform output) |
| `AWS_REGION` | us-east-2 |
| `ECR_REPOSITORY` | deecell-fleet |

**Free Tier Configuration Applied**:
- EC2: t3.micro (free tier)
- RDS: db.t3.micro with 1-day backup (free tier)
- GuardDuty: Disabled (requires subscription)

**Next Step**: Push code to GitHub → GitHub Actions will build Docker image → Deploy to ECS

---

### Baby Steps Deployment Guide Created (December 1, 2025 - 9:00 PM)
- **New File**: `DEPLOYMENT_GUIDE.md` - Complete step-by-step guide for team
- **Target Audience**: Non-technical, explains everything from AWS account creation
- **Estimated Time**: ~1 hour to complete full deployment

### AWS Deployment Infrastructure Complete (December 1, 2025 - 8:30 PM)
- **Status**: Full Terraform infrastructure and GitHub Actions CI/CD created
- **Ready for Team**: Deployment scheduled with Mary & Elliot

**Infrastructure Created** (`terraform/` directory - 12 files):
| File | Purpose |
|------|---------|
| `main.tf` | Provider config, locals, random suffix |
| `variables.tf` | All configurable variables with defaults |
| `vpc.tf` | VPC, subnets, NAT gateway, route tables, flow logs |
| `rds.tf` | PostgreSQL RDS with encryption, backups, monitoring |
| `ecs.tf` | Fargate cluster, task definition, service, auto-scaling |
| `alb.tf` | Load balancer, target groups, HTTPS/ACM setup |
| `security-groups.tf` | ALB, ECS, RDS, Device Manager security groups |
| `iam.tf` | ECS roles, Device Manager role, GitHub Actions user |
| `secrets.tf` | Secrets Manager for DB URL, session, admin password |
| `device-manager.tf` | EC2 launch template, ASG, CloudWatch agent |
| `monitoring.tf` | CloudWatch dashboard, alarms, CloudTrail, GuardDuty |
| `outputs.tf` | All important resource IDs and URLs |

**GitHub Actions CI/CD** (`.github/workflows/`):
| Workflow | Triggers | Purpose |
|----------|----------|---------|
| `deploy.yml` | Push to main | Build Docker → ECR → Deploy ECS → Migrate DB |
| `terraform.yml` | Changes to terraform/ | Plan → Apply infrastructure changes |

**Production Dockerfile**:
- Multi-stage build (build → production)
- Node.js 20 Alpine base
- Non-root user for security
- Health check built-in
- Optimized for ~150MB image size

**Deployment Checklist Created**: `DEPLOYMENT_CHECKLIST.md`
- Step-by-step guide for team deployment
- AWS account setup instructions
- GitHub secrets configuration
- Terraform initialization steps
- Post-deployment verification
- Troubleshooting guide
- Cost estimates (~$153/month)

**GitHub Secrets Required**:
```
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_ACCOUNT_ID,
ECR_REPOSITORY, TF_VAR_DB_PASSWORD, TF_VAR_SESSION_SECRET, TF_VAR_ADMIN_PASSWORD
```

**AWS Resources Created by Terraform**:
- VPC with public/private/database subnets (Multi-AZ)
- RDS PostgreSQL 15.4 with encryption, backups
- ECS Fargate cluster with auto-scaling (1-4 tasks)
- Application Load Balancer with HTTPS support
- Device Manager EC2 Auto Scaling Group
- CloudWatch logs, dashboards, alarms
- CloudTrail for SOC2 compliance
- GuardDuty for threat detection
- Secrets Manager for secure credential storage

---

### Device Manager Running (December 1, 2025 - 7:12 PM)
- **Status**: Device Manager polling DCL-Moeck every 10 seconds
- **Data Flow**: voltage1=28.98V, SOC=99%, current=-1.7A, power=-49.5W, temp=22°C
- **Connection**: WiFi persistent connection to A3A5B30EA9B3FF98 (172.30.2.26:49262)
- **Note**: Device Manager runs as background process; restarts needed after Replit shutdown
- **Next Step**: AWS EC2 deployment planned later today with Mary & Elliot

### Bug Fix: Dashboard Voltage Display (December 1, 2025)
- **Issue**: Sleeper V column showing 0.00 instead of actual voltage (26.54V)
- **Root Cause**: FleetTable had voltage columns swapped. The PowerMon device reports:
  - `voltage1` = Sleeper battery (26.54V) - the main PowerMon battery
  - `voltage2` = Chassis battery (NaN → 0.00) - not connected/available
- **Fix**: Corrected voltage mapping in `client/src/components/FleetTable.tsx`:
  - Chassis V (line 154): Shows `truck.v2` → 0.00 (chassis battery, NaN when not connected)
  - Sleeper V (line 212): Shows `truck.v1` → 26.54V (PowerMon battery)
- **Note**: NaN values from the device are properly converted to 0.00 via JSON serialization (NaN → null → 0)

---

### Device Manager Deployment Prep (December 1, 2025)
- **Customer Credentials Updated**: am@gtofast.com / hello123!
- **Test Script Created**: `device-manager/test-local.js` - verifies all components before deployment
  - Checks native addon loaded
  - Validates database connection
  - Lists active devices and credentials
  - Tests live device connection
  - Validates all app modules
- **Package.json Updated**: Added start/test scripts
  - `npm start` - runs the Device Manager
  - `npm test` - runs local verification tests
  - `npm run build` - rebuilds native addon
- **EC2 Deployment Guide Created**: `device-manager/DEPLOYMENT.md`
  - EC2 instance requirements (t3.medium recommended)
  - Step-by-step deployment instructions
  - systemd service configuration
  - CloudWatch monitoring setup
  - Horizontal scaling guidance
  - Troubleshooting section
  - Cost estimates (~$43/month)

**Quick Start Commands**:
```bash
# Test locally
cd device-manager && npm test

# Run Device Manager
cd device-manager && npm start

# Or with custom settings
POLL_INTERVAL_MS=5000 LOG_LEVEL=debug npm start
```

---

### Production Database Setup - Live Device Ready (December 1, 2025)
- **Organization Created**: Deecell Power Systems (ID: 7)
- **User Created**: admin@deecell.com / Deecell2024! (bcrypt hashed, role: admin)
- **Fleet Created**: Test Fleet (ID: 5)
- **Truck Created**: DCL-001 (ID: 20) - San Francisco coordinates
- **Device Created**: DCL-Moeck (ID: 20) - Serial A3A5B30EA9B3FF98, PowerMon-W v1.32
- **Credentials Stored**: Connection key + access key from applink URL
- **Initial Snapshot**: 98% SOC, 28.75V, 22.9°C

**Login Credentials for Customer Dashboard**:
```
Email: am@gtofast.com
Password: hello123!
```

**Database Record Chain**:
```
Organization (7: Deecell Power Systems)
    └── User (2: admin@deecell.com)
    └── Fleet (5: Test Fleet)
        └── Truck (20: DCL-001)
            └── Device (20: DCL-Moeck)
                └── Credentials (applink URL + keys)
                └── Snapshot (initial readings)
                └── Sync Status (disconnected)
```

---

### Device Manager Application - Production Architecture (December 1, 2025)
- **Created**: Complete Device Manager application structure in `device-manager/app/`
- **Purpose**: Standalone application for AWS EC2 deployment, manages PowerMon device connections and data collection
- **Architecture**: Scales independently from web app, designed for tens of thousands of devices

**Core Modules Implemented**:

| Module | File | Purpose |
|--------|------|---------|
| Configuration | `config.js` | Environment variables, validation, all tunable parameters |
| Logger | `logger.js` | Structured JSON logging with log levels and child loggers |
| Database | `database.js` | PostgreSQL connection pool, all CRUD operations for sync |
| Connection Pool | `connection-pool.js` | Persistent device connections, cohort-based sharding |
| Polling Scheduler | `polling-scheduler.js` | Staggered 10-second polling with timing wheel |
| Batch Writer | `batch-writer.js` | Buffered bulk inserts (2s flush or 500 records) |
| Backfill Service | `backfill-service.js` | Gap detection and log-based recovery |
| Metrics | `metrics.js` | Prometheus metrics and health check HTTP server |
| Main Entry | `index.js` | Application lifecycle, graceful shutdown |

**Key Design Decisions**:

1. **Cohort-Based Sharding**:
   - Devices assigned to cohorts via `hash(serialNumber) % cohortCount`
   - Default 10 cohorts, each polled 1 second apart within 10-second interval
   - Prevents thundering herd, distributes load evenly

2. **Staggered Polling**:
   - 10-second poll interval (matches PowerMon log sample rate)
   - ±250ms jitter to avoid synchronization
   - Supports ~1,000 devices per instance at ~100 polls/second

3. **Batch Database Writes**:
   - Measurements buffered in memory
   - Flush triggers: 2-second timeout OR 500 records (whichever first)
   - Bulk INSERT with `ON CONFLICT DO NOTHING`
   - Snapshots updated with latest reading per device

4. **Automatic Gap Detection**:
   - 3 consecutive poll failures = device marked disconnected
   - `gap_start_at` recorded for backfill reference
   - Background service processes pending backfills using log sync
   - Max 5 concurrent backfill operations

5. **Observability**:
   - Prometheus-compatible metrics at `:3001/metrics`
   - Health check at `:3001/health`
   - Structured JSON logs with deviceId/orgId correlation
   - Stats for polls, writes, backfills, queue depths

**Configuration Environment Variables**:
```bash
DATABASE_URL=postgres://...
POLL_INTERVAL_MS=10000      # 10 seconds
COHORT_COUNT=10             # Number of polling cohorts
MAX_CONCURRENT_POLLS=100    # Polls per tick
POLL_JITTER_MS=250          # ±250ms jitter
BATCH_FLUSH_INTERVAL_MS=2000 # 2 second flush
MAX_BATCH_SIZE=500          # Records before forced flush
GAP_THRESHOLD_MS=30000      # 30 seconds = 3 missed polls
MAX_CONCURRENT_BACKFILLS=5  # Parallel backfill limit
DM_PORT=3001                # Metrics server port
LOG_LEVEL=info              # error/warn/info/debug
```

**Startup Sequence**:
1. Validate configuration
2. Initialize database pool
3. Load active devices from database
4. Assign devices to cohorts
5. Start metrics server
6. Start batch writer
7. Connect to all devices
8. Start polling scheduler
9. Start backfill service
10. Periodic device list refresh (every 5 minutes)

**Graceful Shutdown**:
- SIGTERM/SIGINT handlers
- Stop new polling
- Flush remaining measurements
- Wait for active backfills
- Disconnect all devices
- Close database pool

---

### Database Reset for Production Data (December 1, 2025)
- **Action**: Cleared all demo/simulated data from database
- **Reason**: Preparing for real PowerMon devices (DCL-Moeck + 10 more)
- **Tables Cleared**:
  - organizations, fleets, trucks, users
  - power_mon_devices, device_credentials
  - device_measurements, device_snapshots, device_statistics
  - alerts, sims, sim_location_history, sim_usage_history
  - fuel_prices, savings_config, polling_settings
- **Preserved**: Database schema (all tables exist but empty), admin authentication
- **Device Simulator**: Disabled in `server/index.ts` - no longer generating fake data
- **Next**: Add real organization, fleet, truck for DCL-Moeck device

---

## Previous Updates (November 30, 2025)

### Log Sync Service - Incremental Historical Data Sync (November 30, 2025)
- **New Feature**: `device-manager/lib/log-sync.js` - Service for syncing historical log data from PowerMon
- **Capabilities**:
  - List log files on device with metadata (ID, size, date)
  - Read raw log file data with offset/size control
  - Decode binary log data into structured samples
  - Incremental sync - tracks last sync state per device
  - Progress callbacks for UI feedback
- **Live Test Results** (DCL-Moeck device):
  - 41 log files on device (14 MB total, ~2M samples)
  - Date range: June 27 - November 30, 2025
  - Sample interval: 10 seconds
  - Successfully synced 18,467 samples from last 2 files
  - Incremental sync correctly detects "already up to date"
- **API Functions**:
  - `getLogFileList(device)` - Get list of log files
  - `estimateLogTimeRange(files)` - Get oldest/newest dates, total size
  - `syncDeviceLogs(device, serial, state, progressCb)` - Full incremental sync
  - `syncSince(device, serial, timestamp, progressCb)` - Sync from timestamp
  - `decodeLogData(buffer)` - Decode raw bytes to samples
- **Sync State Structure**:
  ```javascript
  {
    deviceSerial: "A3A5B30EA9B3FF98",
    lastSyncTime: 1764546714405,
    lastFileId: 1764378120,
    lastFileOffset: 123920,
    totalSamplesSynced: 18467
  }
  ```
- **Wrapper Fix**: `decodeLogData()` now returns `startTime` (file start timestamp) instead of error code
- **Documentation**: Updated `device-manager/README.md` with Log Sync Service section

### Step 8 Complete: Device Manager Documentation (November 30, 2025)
- **Created**: `device-manager/README.md` - comprehensive documentation
- **Contents**:
  - Architecture overview with diagram
  - Build instructions
  - Quick start example
  - Full API reference (all static and instance methods)
  - Data structure definitions (MonitorData, FuelgaugeStatistics)
  - Hardware support table
  - Error handling guide
  - Troubleshooting section
- **Also Updated**: Step 11 marked complete (live PowerMon connection verified!)

### Database Schema Update - Device Statistics Table (November 30, 2025)
- **New Table**: `device_statistics` - stores lifetime fuelgauge statistics from PowerMon
- **Fields Added**:
  - Lifetime energy: `totalCharge`, `totalChargeEnergy`, `totalDischarge`, `totalDischargeEnergy` (Ah/Wh)
  - Voltage range: `minVoltage`, `maxVoltage`
  - Current peaks: `maxChargeCurrent`, `maxDischargeCurrent`
  - Fuel gauge: `timeSinceLastFullCharge`, `fullChargeCapacity`, `deepestDischarge`, `lastDischarge`, `soc`
  - Session stats: `secondsSinceOn`, `voltage1Min/Max`, `voltage2Min/Max`, `peakChargeCurrent`, `peakDischargeCurrent`, `temperatureMin/Max`
- **Updated Tables**:
  - `device_snapshots` - added `powerStatus` (integer) and `powerStatusString` (text)
  - `device_measurements` - added `powerStatus` (integer) and `powerStatusString` (text)
- **Schema Types**: Added `DeviceStatistics`, `InsertDeviceStatistics`, `insertDeviceStatisticsSchema`
- **Impact**: Full PowerMon data storage capability now available

### 🎉 MILESTONE: First Live PowerMon Connection from Cloud! (November 30, 2025)
- **Achievement**: Successfully connected to live PowerMon device "DCL-Moeck" via WiFi from cloud server
- **Connection URL**: `https://applinks.thornwave.com/?n=DCL-Moeck&s=a3a5b30ea9b3ff98&h=41&c=...`
- **Device Details**:
  - Name: DCL-Moeck
  - Hardware: PowerMon-W (WiFi)
  - Firmware: v1.32
  - Serial: A3A5B30EA9B3FF98
- **Live Data Retrieved**:
  - Voltage: 28.75 V
  - Current: -0.36 A (discharging)
  - Power: -10.4 W
  - Temperature: 22.9 °C
  - SOC: 98%
  - Runtime: 63,238 minutes (~44 days)
- **Lifetime Statistics**:
  - Total Charge: 7,990 Ah (222.7 kWh)
  - Total Discharge: 8,468 Ah (234.6 kWh)
  - Voltage Range: 23.26V - 30.95V
  - Max Current: 1,092 A
- **Bug Fix**: Removed BLE check from `Connect()` method - WiFi connections don't require BLE
- **Validation**: End-to-end data pipeline confirmed working!

### Thornwave libpowermon v1.17 Update - BLE Dependency Removed! (November 30, 2025)
- **Breakthrough**: Thornwave updated the library to separate BLE initialization from object creation
- **Key Change**: New `initBle()` method - BLE is now optional, called separately after `createInstance()`
- **Before (v1.16)**: `createInstance()` required Bluetooth adapter, failed on servers without BLE
- **After (v1.17)**: `createInstance()` works on any system, WiFi connections work without BLE
- **Updated Files**:
  - `libpowermon_bin/` - Pulled latest from `git.thornwave.com`
  - `device-manager/src/powermon_wrapper.cpp` - Updated constructor to use new pattern
- **Test Results**:
  - Library version: 1.17 ✅
  - Device instance creation: Success ✅
  - BLE available: false (expected on server without Bluetooth)
  - WiFi connections: Ready to use!
- **Build Command**: `cd device-manager && npx node-gyp rebuild`
- **Impact**: Device Manager can now connect to PowerMon devices via WiFi on cloud servers

### Regional Diesel Pricing by Truck Location (November 30, 2025)
- **Feature**: Diesel prices now vary by truck location using EIA PADD regions
- **PADD Regions**: Petroleum Administration for Defense Districts
  - PADD 1A: New England
  - PADD 1B: Central Atlantic
  - PADD 1C: Lower Atlantic
  - PADD 2: Midwest
  - PADD 3: Gulf Coast (Texas, Louisiana)
  - PADD 4: Rocky Mountain
  - PADD 5: West Coast (California, Oregon, Washington)
- **Implementation Files**:
  - `server/services/padd-regions.ts` - State-to-PADD mapping + coordinate lookup
  - `server/services/eia-client.ts` - Updated to fetch regional prices by PADD code
  - `server/services/savings-calculator.ts` - Uses truck coordinates for local pricing
- **EIA API facets**: Uses `duoarea` parameter (R1X, R1Y, R1Z, R20, R30, R40, R50, R00)
- **Fallback behavior**: Uses US national average if truck has no coordinates
- **Benefit**: More accurate savings calculations - e.g., California diesel ($5.20) vs Gulf Coast ($3.40)

### AI Assistant Visual Updates (November 30, 2025)
- Changed all Bot/MessageCircle icons to sun.png with #EBEFFA background
- Updated: header icon, message avatars, loading state, floating button
- User bubble background: #92a6b3
- Send button: #303030

### AI Fleet Assistant (November 30, 2025)
- **Feature**: Natural language chat assistant for fleet management queries
- **Backend**: `server/services/fleet-assistant.ts` - OpenAI GPT-4o-mini with function calling
- **API endpoint**: `POST /api/v1/assistant/chat` - handles conversation with context
- **Function tools defined**:
  - `get_all_trucks` - list trucks with optional status filter
  - `get_truck_details` - detailed info for specific truck by number
  - `get_fleet_statistics` - savings, SOC, maintenance metrics
  - `get_active_alerts` - unresolved alerts across fleet
  - `get_low_battery_trucks` - trucks below SOC threshold
  - `get_fleet_summary` - quick fleet health overview
- **Frontend**: `client/src/components/FleetAssistant.tsx` - slide-out chat drawer
- **UI location**: Header bar next to notifications
- **Integration**: Uses Replit AI Integrations for OpenAI API key management

### Fleet Stats with 7-Day Trends (All 4 Cards)
- **Fleet stats calculator**: `server/services/fleet-stats-calculator.ts` calculates all metrics
- **API endpoint**: `GET /api/v1/fleet-stats` returns SOC, maintenance, runtime metrics with 7-day trends
- **Today's Savings**: Real calculation from solar energy (solar_Wh / 1000 / 9 kWh/gal × fuel price)
- **Avg SOC**: Current average from snapshots, compared to 7-day historical average
- **Tractor maintenance interval**: Derived from runtime reduction (less engine use = extended intervals)
- **Tractor hours offset**: Fleet-level total hours saved (baseline × device count - actual runtime)
- **Trend labels**: All cards now show "vs 7d" to indicate 7-day comparison
- **EIA_API_KEY**: Configured and active - fetches live weekly diesel prices

### Fleet Stats Calculation Fix (November 30, 2025)
- **Issue**: Hours offset was inflated when some devices were offline or not reporting
- **Root cause**: Used total registered device count instead of devices that actually reported data
- **Fix applied**: Baseline now calculated only from devices with measurements
  - `deviceCountToday = todayData.deviceCount` (from actual measurements)
  - `deviceCount7Day = sevenDayData.avgDeviceCount` (average across 7 days)
- **Result**: Accurate fleet-level metrics that reflect only active reporting devices

### Fleet Overview Filter Update (November 30, 2025)
- **Updated**: Filter buttons now show truck counts like Figma design
  - "All (09)" - total truck count
  - "In Service (07)" - with green dot indicator
  - "Not In Service (3)" - with red dot indicator
- **Removed**: "Active Trucks XX / XX" text next to Fleet Overview title
- **Matches**: Figma node 2580-9784 design specification

### UI Polish (November 30, 2025)
- **FleetStats cards**: Trend indicators now vertically centered with stat icons
- **Fleet Overview title**: Bottom-aligned with buttons, no bottom padding
- **Export CSV button**: Simplified to plain text + icon (no border/hover), 4px right margin
- **Historical Data cards**: Background changed to #FAFBFC
- **Table headers**: Chassis and Sleeper headers updated to orange theme
  - Background: #FFD7C0
  - Text: #FA4B1E

### Savings Calculation Feature
- **Database tables added**: `fuel_prices` (stores EIA diesel prices), `savings_config` (per-org calculation settings)
- **EIA API client**: `server/services/eia-client.ts` fetches weekly diesel prices from U.S. Energy Information Administration
- **Savings calculator**: `server/services/savings-calculator.ts` computes fuel savings from solar energy

### Font Consistency Update
- Changed application font from Inter to DM Sans for consistent typography
- Updated Google Fonts import in `client/index.html`
- Updated CSS variable `--font-sans` in `client/src/index.css`

### Export Button Positioning
- Finalized Export button position: 2px gap from status badge
- Button height: 27px (matches status badge)

---

## Project Overview

**Goal**: Build a multi-tenant Fleet Management Dashboard for Deecell Power Systems displaying truck fleet data with real-time PowerMon metrics, status tracking, and historical information.

**Architecture**:
- Organizations (customers) → Fleets (1-N per org) → Trucks → PowerMon Devices
- Device Manager polls PowerMon devices for real-time data and log file sync
- Fleet Viewer dashboard displays truck locations, metrics, status
- Deecell Operations dashboard for provisioning

---

## Development Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Step 1 | Database Schema | ✅ Complete |
| Step 2 | Storage Layer | ✅ Complete |
| Step 3 | API Routes | ✅ Complete |
| Step 4 | Test Data Hydration | ✅ Complete |
| Step 5 | Connect Dashboard | ✅ Complete |
| Step 6 | Device Manager Simulation | ✅ Complete |
| Step 7 | Alerts System | ✅ Complete |
| Step 8 | Device Manager Docs | ✅ Complete |
| Step 9 | Admin Dashboard | ✅ Complete |
| Step 10 | Customer Authentication | ✅ Complete |
| Step 11 | Device Manager (libpowermon) | ✅ Complete |
| Step 12 | In-App Notifications | ✅ Complete |
| Step 13 | SIMPro Integration | 🔄 In Progress |
| Step 14 | CSV Export Feature | ✅ Complete |
| Step 15 | Savings Calculation | ✅ Complete |

---

## Step 1: Database Schema

**Date Started**: November 28, 2025
**Date Completed**: November 28, 2025

### What We're Building

Multi-tenant PostgreSQL schema with the following tables:

| Table | Purpose |
|-------|---------|
| `organizations` | Customer accounts (tenants) |
| `users` | Login accounts scoped to organizations |
| `fleets` | Named truck groups (1-N per organization) |
| `trucks` | Vehicles with metadata (number, driver, location) |
| `power_mon_devices` | PowerMon hardware info (serial, firmware, etc.) |
| `device_credentials` | Encrypted WifiAccessKey for remote connection |
| `device_snapshots` | Latest readings for fast dashboard queries |
| `device_measurements` | Time-series data (partitioned by month) |
| `device_sync_status` | Tracks log file offset for backfill |
| `alerts` | OFFLINE and Low Voltage notifications |
| `audit_logs` | SOC2 compliance tracking |
| `sessions` | User session storage |

### Key Design Decisions

1. **Multi-tenancy Model**: Shared database with row-level security
   - All tables include `organization_id` foreign key
   - Middleware enforces tenant scoping on all queries
   - Cost-efficient while maintaining data isolation

2. **Fleet Structure**: 1-N fleets per customer
   - Each fleet has custom name (e.g., "Flatbed Fleet", "Van-Trailer Fleet")
   - Trucks belong to exactly one fleet

3. **Truck-to-PowerMon Relationship**: 1:1 for lifetime
   - One PowerMon device per truck
   - Device stays with truck unless replaced/repaired
   - Track historical assignments via `assigned_at` / `unassigned_at`

4. **Data Storage Strategy**: Store ALL raw PowerMon data
   - `device_measurements` table partitioned by month
   - `device_snapshots` table for latest readings (fast dashboard queries)
   - Full data retention for future analysis flexibility

5. **Scaling for 500,000 trucks per fleet**:
   - Composite indexes on `(organization_id, fleet_id, status)`
   - Pagination on all list endpoints
   - Monthly partitioning on measurements table
   - Snapshots table avoids scanning large measurements table

6. **Device Connection Tracking**:
   - `device_sync_status` tracks last log file offset
   - Enables efficient backfill when devices come back online
   - Supports both real-time polling and log file sync modes

7. **Initial Alerts** (V1):
   - Device OFFLINE (can't connect)
   - Low Voltage (V1 below threshold)
   - More alert types planned for future

### PowerMon Data Fields

From the Thornwave PowerMon library:
- `voltage1`, `voltage2` - Battery voltages (V)
- `current` - Current draw (A)
- `power` - Power consumption (W)
- `temperature` - Device temperature (°C)
- `soc` - State of Charge (%)
- `energy` - Energy consumed (Wh)
- `charge` - Charge consumed (Ah)
- `runtime` - Estimated runtime (minutes)
- `rssi` - WiFi signal strength

### How to Verify

After schema is implemented:
1. Run `npm run db:push` to apply schema to database
2. Check tables exist in PostgreSQL
3. Test sample queries with EXPLAIN ANALYZE to verify indexes

### Verification Results ✅

**Tables Created** (13 total):
- `organizations`, `users`, `fleets`, `trucks`
- `power_mon_devices`, `device_credentials`, `device_snapshots`
- `device_measurements`, `device_sync_status`
- `alerts`, `audit_logs`, `sessions`, `polling_settings`

**Indexes Created** (30+ total):
- Composite indexes for tenant-scoped queries (e.g., `truck_org_fleet_status_idx`)
- Time-series indexes for measurements (e.g., `measurement_org_device_time_idx`)
- Unique constraints for business rules (e.g., `fleet_org_name_idx`)

**Multi-tenancy Verification**:
- All business tables have `organization_id` column for tenant scoping
- Row-level security can operate without indirect joins
- Fixed: Added `organization_id` to `device_credentials` and `device_sync_status` (caught in review)

**Key File**: `shared/schema.ts`
- All Drizzle ORM table definitions
- Zod insert schemas for validation
- TypeScript types for both insert and select operations
- Legacy schemas preserved for backward compatibility with existing dashboard
- Constants for alert types, device status, truck status

---

## Step 2: Storage Layer (Completed)

### Implementation Date
November 28, 2025

### What Was Built

**Database Connection Module** (`server/db.ts`):
- Drizzle ORM client with connection pooling (max 20 connections)
- Environment-based configuration via DATABASE_URL

**DbStorage Class** (`server/db-storage.ts`):
- Complete tenant-scoped CRUD for all 13 tables
- Every query filters by `organizationId` for multi-tenancy isolation
- Optimized dashboard queries with batch loading

### Key Functions

| Entity | Functions |
|--------|-----------|
| Organizations | create, get, getBySlug, list, update |
| Users | create, get, getByEmail, list, update, updateLastLogin |
| Fleets | create, get, getByName, list, update, delete |
| Trucks | create, get, getByNumber, list, countByStatus, update, updateLocation, delete |
| Devices | create, get, getBySerial, getByTruck, list, countByStatus, update, assign, unassign, updateStatus |
| Credentials | create, get, update, delete |
| Snapshots | upsert, get, getByTruck, list, getFleetStats |
| Measurements | insert, insertBatch, getMeasurements, getMeasurementsByTruck, getLatest |
| Sync Status | upsert, get, updateProgress, updateError, updateLastPoll |
| Alerts | create, get, list, listByTruck, countActive, acknowledge, resolve, resolveByDevice |
| Audit Logs | create, list |
| Polling Settings | getOrCreate, update |
| Dashboard | getDashboardData (optimized aggregation) |

### Security Fixes

**Issue Found**: `getDeviceBySerial` initially didn't filter by organization
**Fix Applied**: Added `organizationId` parameter, created separate `checkSerialExists` for provisioning

### Test Results

```
Multi-tenancy Isolation Test:
  Org2 trucks (should be 0): 0
  Cross-org truck access (should be undefined): undefined
```

### Key Files
- `server/db.ts` - Database connection
- `server/db-storage.ts` - Full storage implementation
- `server/storage.ts` - Interface definition
- `server/test-storage.ts` - Integration tests

---

## Step 3: API Routes (Completed)

### Implementation Date
November 28, 2025

### What Was Built

**Tenant Middleware** (`server/middleware/tenant.ts`):
- Extracts `organizationId` from `X-Organization-Id` header
- Also supports `X-Organization-Slug` for organization lookup
- Adds `organizationId` to Express Request object
- Returns 400 if no tenant context provided

**Fleet Routes** (`server/api/fleet-routes.ts`):
- RESTful API structure at `/api/v1/*`
- All routes use tenant middleware for multi-tenancy isolation
- Zod validation on all POST/PATCH endpoints

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Organizations** | | |
| GET | /api/v1/organizations | List all organizations (admin) |
| GET | /api/v1/organizations/:id | Get organization details |
| POST | /api/v1/organizations | Create organization |
| PATCH | /api/v1/organizations/:id | Update organization |
| **Fleets** | | (tenant-scoped) |
| GET | /api/v1/fleets | List fleets |
| GET | /api/v1/fleets/:id | Get fleet details |
| POST | /api/v1/fleets | Create fleet |
| PATCH | /api/v1/fleets/:id | Update fleet |
| DELETE | /api/v1/fleets/:id | Delete fleet |
| **Trucks** | | (tenant-scoped) |
| GET | /api/v1/trucks | List trucks with filtering/pagination |
| GET | /api/v1/trucks/:id | Get truck details with snapshot |
| POST | /api/v1/trucks | Create truck |
| PATCH | /api/v1/trucks/:id | Update truck |
| PATCH | /api/v1/trucks/:id/location | Update truck GPS location |
| DELETE | /api/v1/trucks/:id | Delete truck |
| **Devices** | | (tenant-scoped) |
| GET | /api/v1/devices | List PowerMon devices |
| GET | /api/v1/devices/:id | Get device details |
| POST | /api/v1/devices | Create device |
| PATCH | /api/v1/devices/:id | Update device |
| POST | /api/v1/devices/:id/assign | Assign device to truck |
| POST | /api/v1/devices/:id/unassign | Unassign device from truck |
| PATCH | /api/v1/devices/:id/status | Update device online status |
| **Dashboard** | | (tenant-scoped) |
| GET | /api/v1/dashboard | Aggregated fleet stats |
| GET | /api/v1/fleets/:id/stats | Fleet-specific stats |
| GET | /api/v1/dashboard/active-trucks | Trucks with latest snapshots |
| **Alerts** | | (tenant-scoped) |
| GET | /api/v1/alerts | List alerts with pagination |
| POST | /api/v1/alerts | Create new alert |
| POST | /api/v1/alerts/:id/acknowledge | Acknowledge alert |
| POST | /api/v1/alerts/:id/resolve | Resolve alert |
| **Measurements** | | (tenant-scoped) |
| GET | /api/v1/measurements | Time-series data (date range, limit, offset) |
| GET | /api/v1/trucks/:id/measurements | Truck-specific measurements |
| GET | /api/v1/devices/:id/measurements | Device-specific measurements |
| **Polling Settings** | | (tenant-scoped) |
| GET | /api/v1/polling-settings | Get polling configuration |
| PATCH | /api/v1/polling-settings | Update polling frequency |

### Query Parameters

**Trucks List** (`GET /api/v1/trucks`):
- `fleetId` - Filter by fleet
- `status` - Filter by status (in-service, not-in-service, maintenance)
- `limit` - Pagination limit (default: 50)
- `offset` - Pagination offset

**Measurements** (`GET /api/v1/measurements`):
- `deviceId` - Filter by device
- `startDate` - Start of date range (ISO 8601)
- `endDate` - End of date range (ISO 8601)
- `limit` - Pagination limit (default: 1000)
- `offset` - Pagination offset

### Validation Schemas

All POST/PATCH endpoints validate request body with Zod:
- `updateLocationSchema` - lat/lng as numbers
- `assignDeviceSchema` - truckId as number
- `updateDeviceStatusSchema` - status enum (online/offline/unknown)
- `acknowledgeAlertSchema` - userId as number

### Test Results

All endpoints tested successfully:
```
Organizations API: ✓
Fleets API (tenant-scoped): ✓
Trucks API (with filtering): ✓
Devices API (assign/unassign): ✓
Dashboard API (aggregations): ✓
Alerts API (acknowledge/resolve): ✓
Measurements API (pagination): ✓
Polling Settings API: ✓
Zod Validation: ✓
```

### Key Files
- `server/middleware/tenant.ts` - Tenant extraction middleware
- `server/api/fleet-routes.ts` - All API route handlers
- `server/routes.ts` - Route registration

---

## Step 4: Test Data Hydration (Completed)

### Implementation Date
November 28, 2025

### What Was Built

**Seed Script** (`server/seed-data.ts`):
- Creates realistic demo data for dashboard testing
- Run with: `npx tsx server/seed-data.ts`

### Demo Data Created

**Organization**: Acme Transport (ID: 6)
- Contact: fleet@acmetransport.com
- Timezone: America/Los_Angeles

**Fleets**: 2
- Flatbed Fleet (8 trucks) - Heavy haul for construction/industrial
- Van-Trailer Fleet (7 trucks) - Enclosed for freight/deliveries

**Trucks**: 15 with realistic US locations
| Fleet | Truck | Driver | Location |
|-------|-------|--------|----------|
| Flatbed | FLT-001 | John Martinez | Los Angeles, CA |
| Flatbed | FLT-002 | Mike Johnson | Phoenix, AZ |
| Flatbed | FLT-003 | Carlos Rivera | Houston, TX |
| Flatbed | FLT-004 | James Wilson | San Diego, CA |
| Flatbed | FLT-005 | Robert Brown | Las Vegas, NV |
| Flatbed | FLT-006 | David Lee | San Francisco, CA |
| Flatbed | FLT-007 | William Chen | Dallas, TX |
| Flatbed | FLT-008 | Thomas Garcia | Atlanta, GA |
| Van-Trailer | VAN-001 | Sarah Thompson | Santa Monica, CA |
| Van-Trailer | VAN-002 | Jennifer Adams | San Jose, CA |
| Van-Trailer | VAN-003 | Emily Davis | Denver, CO |
| Van-Trailer | VAN-004 | Amanda White | Seattle, WA |
| Van-Trailer | VAN-005 | Michelle Taylor | Portland, OR |
| Van-Trailer | VAN-006 | Lisa Anderson | Salt Lake City, UT |
| Van-Trailer | VAN-007 | Karen Martin | Oklahoma City, OK |

**PowerMon Devices**: 15 (1:1 with trucks)
- Serial format: PWM-1000 to PWM-1007 (Flatbed), PWM-2000 to PWM-2006 (Van-Trailer)
- Firmware: 1.10.2, Model: PowerMon Pro

**Device Snapshots**: 15 with varied readings
- SOC: 65-98%
- Voltage: 12.0-14.4V
- Current: 5-30A
- Temperature: 20-45°C

**Measurements**: 960 records (48 hours for first 5 trucks)
- 15-minute intervals
- Simulates day/night SOC patterns (discharge during day, charge at night)

**Alerts**: 4
| Type | Truck | Status | Severity |
|------|-------|--------|----------|
| Low Voltage | FLT-005 | Active | Warning |
| Device Offline | FLT-003 | Active | Critical |
| Low Voltage | FLT-001 | Resolved | Warning |
| Low Voltage | FLT-008 | Acknowledged | Warning |

### API Verification

```
GET /api/v1/trucks → 15 trucks ✓
GET /api/v1/fleets → 2 fleets ✓
GET /api/v1/alerts → 4 alerts ✓
GET /api/v1/dashboard/stats → Aggregated stats ✓
GET /api/v1/devices/5/measurements → Historical data ✓
```

### Key Files
- `server/seed-data.ts` - Seed script

---

## Architecture Notes

### Remote Device Connection

PowerMon devices connect via 4G routers on trucks. Connection uses:
- WifiAccessKey structure containing encrypted credentials
- Applinks URL format: `https://applinks.thornwave.com/powermon?...`
- Base64-encoded device name, serial, host ID, connection key, access key

### Data Collection Modes

1. **Real-time Polling**: Get current sample data when device is online
2. **Log File Sync**: Download historical data from device storage
   - Track offset to avoid re-downloading
   - Backfill gaps when device reconnects after being offline

### Future: Node.js Native Addon

Device Manager will use Node.js native addon (node-addon-api) to wrap the C++ libpowermon library:
- Pre-built binaries for AWS Linux deployment
- N-API for ABI stability across Node.js versions
- Async workers for non-blocking device communication

---

## Step 9: Admin Dashboard (Completed)

### Implementation Date
November 28-29, 2025

### What Was Built

**Admin Dashboard UI** - 6 fully functional admin pages for Deecell Operations:

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/admin` | System-wide statistics (orgs, fleets, trucks, devices, users) |
| Organizations | `/admin/organizations` | CRUD for customer organizations |
| Fleets | `/admin/fleets` | Fleet management across all organizations |
| Trucks | `/admin/trucks` | Truck provisioning and management |
| Devices | `/admin/devices` | PowerMon device management and assignment |
| Users | `/admin/users` | User account management with role assignment |

### Backend Implementation

**Admin API Routes** (`server/api/admin-routes.ts`):
- Complete CRUD endpoints at `/api/v1/admin/*`
- Cross-organizational access (bypasses tenant middleware)
- Session-based authentication with middleware

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/admin/login` | POST | Admin login with password |
| `/api/v1/admin/logout` | POST | Session logout |
| `/api/v1/admin/session` | GET | Check authentication status |
| `/api/v1/admin/stats` | GET | System-wide statistics |
| `/api/v1/admin/organizations` | GET/POST | List/create organizations |
| `/api/v1/admin/organizations/:id` | GET/PATCH/DELETE | Manage organization |
| `/api/v1/admin/fleets` | GET/POST | List/create fleets |
| `/api/v1/admin/fleets/:id` | GET/PATCH/DELETE | Manage fleet |
| `/api/v1/admin/trucks` | GET/POST | List/create trucks |
| `/api/v1/admin/trucks/:id` | GET/PATCH/DELETE | Manage truck |
| `/api/v1/admin/devices` | GET/POST | List/create devices |
| `/api/v1/admin/devices/:id` | GET/PATCH/DELETE | Manage device |
| `/api/v1/admin/users` | GET/POST | List/create users |
| `/api/v1/admin/users/:id` | GET/PATCH/DELETE | Manage user |

**New Storage Methods** (`server/db-storage.ts`):
- `deleteOrganization(id)` - Remove organization
- `listAllDevices()` - Get all devices across orgs
- `listAllUsers()` - Get all users across orgs
- `deleteUser(id)` - Remove user
- `getAdminStats()` - Aggregate counts for dashboard

### Authentication Implementation

**Session Middleware** (`server/routes.ts`):
- Express session with MemoryStore
- 24-hour session expiry
- Secure cookies in production

**Authentication Flow**:
1. User navigates to `/admin/*`
2. `AdminLayout` checks session via `/api/v1/admin/session`
3. If not authenticated, redirects to `/admin/login`
4. User enters credentials (username: "admin", password: from ADMIN_PASSWORD secret)
5. On success, session cookie is set and user is redirected to `/admin`
6. All subsequent admin API calls include session cookie for authentication

**Security**:
- Password stored as environment secret (`ADMIN_PASSWORD`)
- Server-side session storage (never exposed to frontend)
- Automatic redirect on session expiry

### Frontend Components

**AdminLayout** (`client/src/components/AdminLayout.tsx`):
- Sidebar navigation with 6 menu items
- Session check on mount with loading state
- Logout functionality
- Orange branding color (#FA4B1E) for active/hover states

**AdminLogin** (`client/src/pages/admin/AdminLogin.tsx`):
- Login form with username/password fields
- Deecell logo branding
- Orange submit button (#FA4B1E)
- Clean input styling (no focus rings)

**Admin API Hooks** (`client/src/lib/admin-api.ts`):
- `useAdminSession()` - Check authentication status
- `useAdminLogin()` - Login mutation
- `useAdminLogout()` - Logout mutation
- `useAdminStats()` - Dashboard statistics
- CRUD hooks for all entities (organizations, fleets, trucks, devices, users)

### UI Styling

**Admin Branding**:
- Orange accent color: `#FA4B1E`
- Used for buttons, active nav items, hover states
- Custom CSS class `.admin-nav-item` in `index.css`

**Custom Styles** (`client/src/index.css`):
```css
.admin-nav-item:hover {
  background-color: rgba(250, 75, 30, 0.1) !important;
  color: #FA4B1E !important;
}

.admin-nav-item.active {
  background-color: rgba(250, 75, 30, 0.1);
  color: #FA4B1E;
  border-left: 4px solid #FA4B1E;
}
```

### Key Files

| File | Purpose |
|------|---------|
| `server/api/admin-routes.ts` | Admin API routes with session auth |
| `server/routes.ts` | Session middleware setup |
| `client/src/pages/admin/AdminLogin.tsx` | Login page with logo |
| `client/src/pages/admin/AdminDashboard.tsx` | Stats dashboard |
| `client/src/pages/admin/OrganizationsPage.tsx` | Organization management |
| `client/src/pages/admin/FleetsPage.tsx` | Fleet management |
| `client/src/pages/admin/TrucksPage.tsx` | Truck management |
| `client/src/pages/admin/DevicesPage.tsx` | Device management |
| `client/src/pages/admin/UsersPage.tsx` | User management |
| `client/src/components/AdminLayout.tsx` | Admin layout with sidebar |
| `client/src/lib/admin-api.ts` | Admin API hooks and utilities |
| `client/src/index.css` | Custom admin navigation styles |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `ADMIN_PASSWORD` | Admin login password (stored as secret) |

---

## Step 10: Customer Authentication (Completed)

### Implementation Date
November 29, 2025

### What Was Built

**Customer Login System** - Secure session-based authentication for fleet customers:

| Component | Description |
|-----------|-------------|
| Login Page | Email/password form at `/login` route |
| Session Management | Secure cookie-based sessions with regeneration |
| Protected Routes | All fleet API routes require authentication |
| Logout | Proper session destruction with cache clearing |

### Backend Implementation

**Customer Auth API Routes** (`server/api/auth-routes.ts`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/auth/login` | POST | Authenticate customer with email/password |
| `/api/v1/auth/logout` | POST | Destroy session and clear cookie |
| `/api/v1/auth/session` | GET | Check authentication status |

**Tenant Middleware Updates** (`server/middleware/tenant.ts`):
- Session-based authentication only (no header bypass)
- Validates user exists and is active
- Validates organization exists and is active
- Auto-destroys session if user/org becomes inactive

### Security Implementation

| Control | Implementation |
|---------|----------------|
| **Password Hashing** | bcrypt with 10 salt rounds |
| **Session Fixation Prevention** | `session.regenerate()` on login |
| **Secure Cookies** | HttpOnly, Secure (prod), SameSite=Lax |
| **Session Destruction** | `session.destroy()` + cookie clear on logout |
| **Account Status Checks** | Verify user and org are active on every request |
| **Cache Clearing** | React Query cache cleared on logout |
| **Password Validation** | 6 character minimum (server-side) |

### Authentication Flow

1. User navigates to `/login`
2. Enters email and password
3. Server validates credentials with bcrypt
4. Server checks user and organization are active
5. Session regenerated to prevent fixation attacks
6. User redirected to dashboard
7. All fleet API calls use session cookie for tenant context
8. Logout destroys session and clears browser cache

### Frontend Components

**Login Page** (`client/src/pages/Login.tsx`):
- Email/password form with validation
- Error message display
- Redirect to dashboard on success
- Deecell branding

**Auth Hooks** (`client/src/lib/auth-api.ts`):
- `useAuthSession()` - Check authentication status
- `useLogin()` - Login mutation
- `useLogout()` - Logout mutation with cache clear

**Dashboard Updates** (`client/src/pages/Dashboard.tsx`):
- Auth check on mount
- Redirect to `/login` if unauthenticated
- Logout button in header

### SOC2 Compliance Status

**Currently Implemented** (Ready for basic compliance):
- ✅ Password hashing (bcrypt)
- ✅ Session fixation prevention
- ✅ Secure cookie configuration
- ✅ Account status verification
- ✅ Multi-tenant isolation

**Future SOC2 Enhancements** (Not yet implemented):
- ❌ Rate limiting on login endpoints
- ❌ Audit logging for auth events
- ❌ Account lockout after failed attempts
- ❌ Password complexity requirements
- ❌ Multi-factor authentication (MFA)
- ❌ Session idle timeout
- ❌ Password expiration policy

### Key Files

| File | Purpose |
|------|---------|
| `server/api/auth-routes.ts` | Customer auth API with session management |
| `server/middleware/tenant.ts` | Session-based tenant isolation |
| `client/src/pages/Login.tsx` | Customer login page |
| `client/src/lib/auth-api.ts` | Auth hooks and utilities |
| `client/src/pages/Dashboard.tsx` | Protected dashboard with auth checks |

### Security Fixes Applied

1. **Removed header-based org bypass**: `tenantMiddleware` now only accepts session-based authentication
2. **Session regeneration**: Both admin and customer login regenerate sessions to prevent fixation
3. **Proper logout**: Both systems use `session.destroy()` with cookie clearing
4. **Active status checks**: Login and middleware verify user/org are active
5. **Cache clearing**: Frontend clears React Query cache on logout to prevent cross-tenant data leakage

---

## Step 11: Device Manager - libpowermon Integration (In Progress)

### Implementation Date
November 29, 2025

### What's Being Built

**Device Manager** - Node.js service that communicates with PowerMon devices:

| Component | Description |
|-----------|-------------|
| libpowermon | Thornwave's C++ library for PowerMon communication |
| powermon-bridge | C++ executable that wraps libpowermon |
| BridgeClient | Node.js module that spawns and manages the bridge |
| TypeScript Types | Full type definitions for all PowerMon data structures |

### Architecture Decision

**Problem**: libpowermon C++ static library (`powermon_lib.a`) wasn't compiled with `-fPIC`, which is required for Node.js native addons (shared libraries) on Linux x64.

**Solution**: Bridge executable architecture:
1. Build `powermon-bridge` as standalone executable (static linking works)
2. Node.js spawns bridge as subprocess
3. Communication via stdin/stdout with NDJSON protocol
4. This approach works with the unmodified library

### Repository Cloned

```bash
git clone https://git.thornwave.com/git/thornwave/libpowermon_bin.git
```

**Contents**:
- `powermon_lib.a` - Linux x64 static library
- `powermon_lib_rpi64.a` - Raspberry Pi 64-bit version
- `inc/` - Header files (powermon.h, powermon_log.h, etc.)
- `examples/` - Connect and scan examples

### libpowermon API Summary

| Function | Purpose |
|----------|---------|
| `DeviceIdentifier::fromURL(url)` | Parse access URL to extract encryption keys |
| `connectWifi(WifiAccessKey)` | Connect to remote device via cloud relay |
| `requestGetInfo()` | Device name, firmware, serial number |
| `requestGetMonitorData()` | Real-time V1, V2, current, power, temp, SOC |
| `requestGetStatistics()` | Power meter statistics |
| `requestGetFgStatistics()` | Fuelgauge/battery statistics |
| `requestGetLogFileList()` | List available log files |
| `requestReadLogFile()` | Download log file data |
| `PowermonLogFile::decode()` | Parse log data into samples |

### MonitorData Fields

From real-time polling:
- `voltage1`, `voltage2` - Battery voltages (V)
- `current` - Current draw (A)
- `power` - Power consumption (W)
- `temperature` - Device temperature (°C)
- `coulombMeter` - Charge consumed (Ah)
- `energyMeter` - Energy consumed (Wh)
- `powerStatus` - PS_OFF, PS_ON, PS_LVD, PS_OCD, etc.
- `soc` - State of Charge (%)
- `runtime` - Estimated runtime (minutes)
- `rssi` - WiFi signal strength (dBm)

### Bridge Commands

The `powermon-bridge` executable accepts these commands on stdin:

| Command | Parameters | Response |
|---------|------------|----------|
| `version` | - | Library version info |
| `parse <url>` | Access URL | Parsed device identifier |
| `connect <url>` | Access URL | Connection status |
| `disconnect` | - | Disconnection acknowledgment |
| `status` | - | Connected/connecting state |
| `info` | - | Device information |
| `monitor` | - | Current monitor data |
| `statistics` | - | Power meter statistics |
| `fgstatistics` | - | Battery statistics |
| `logfiles` | - | List of log files |
| `readlog <id> <offset> <size>` | File params | Log data (hex) |
| `stream <interval_ms> [count]` | Polling params | Continuous monitor events |
| `quit` | - | Exit the bridge |

### Known Limitation

**Bluetooth Hardware Requirement**: The libpowermon library initializes Bluetooth subsystem on startup, even for WiFi-only connections. This requires Bluetooth hardware (HCI socket) to be available.

**Impact**:
- Development/testing environments without Bluetooth will fail to start the bridge
- AWS deployment must include Bluetooth support (or use a Bluetooth-capable AMI)
- WiFi remote connections work once bridge starts successfully

### Test Device Provided

Access URL for testing:
```
https://applinks.thornwave.com/?n=DCL-Moeck&s=a3a5b30ea9b3ff98&h=41&c=c1HOvvGTYe4HcxZ1AWUUVg%3D%3D&k=qN19gp1NyTIjTcKXIFUagek74WSxnF9446mW1lX0Ca4%3D
```

### Files Created

| File | Purpose |
|------|---------|
| `device-manager/src/powermon_bridge.cpp` | C++ bridge executable source |
| `device-manager/Makefile` | Build configuration |
| `device-manager/lib/bridge-client.js` | Node.js bridge manager |
| `device-manager/lib/bridge-client.d.ts` | TypeScript type definitions |
| `device-manager/lib/index.js` | Package entry point |
| `device-manager/lib/index.d.ts` | Package type definitions |
| `device-manager/package.json` | Package configuration |

### Build Status

✅ Bridge executable compiles successfully:
```bash
cd device-manager && make
# Output: powermon-bridge (264KB executable)
```

### Protocol Robustness (Fixed)

**Issue Identified**: Original protocol used FIFO queue for command/response matching, which broke when async events arrived before results.

**Fix Applied**: Command ID tagging system:
- Commands sent as: `<cmd_id> <command> [args]`
- Results include ID: `{"type":"result","id":"cmd_xxx","success":true,...}`
- Errors include ID: `{"type":"error","id":"cmd_xxx","message":"..."}`
- Fatal startup errors: `{"type":"fatal","message":"..."}`
- Events remain untagged (not responses to commands)

**Node.js Client Changes**:
- Changed from FIFO `pendingCallbacks` array to Map-based tracking by command ID
- Added proper cleanup of `connecting` state on connect failures
- Added immediate failure detection for fatal bridge startup errors

### Native Addon Build Success (November 29, 2025)

**Thornwave PIC Library Update Completed!**

Thornwave fixed their library with the commit "Fixed PIC library" - all object files now compiled with `-fPIC` flag.

**Build Success:**
```bash
cd device-manager && npx node-gyp rebuild
# Result: gyp info ok
# Created: build/Release/powermon_addon.node (413KB)
```

**Library Version:** 1.16 (upgraded from v1.10)

**Native Addon Test Results:**
```javascript
const addon = require('./build/Release/powermon_addon.node');

// Static methods work without Bluetooth:
addon.PowermonDevice.getLibraryVersion()  // { major: 1, minor: 16, string: '1.16' }
addon.PowermonDevice.getPowerStatusString(0) // 'OFF'
addon.PowermonDevice.getPowerStatusString(1) // 'ON'
addon.PowermonDevice.getPowerStatusString(2) // 'LVD'
addon.PowermonDevice.getPowerStatusString(3) // 'OCD'
addon.PowermonDevice.getPowerStatusString(4) // 'HVD'
addon.PowermonDevice.getPowerStatusString(5) // 'FGD'
```

**Files Created:**

| File | Purpose |
|------|---------|
| `device-manager/binding.gyp` | Node-gyp build configuration |
| `device-manager/src/addon.cpp` | N-API addon entry point |
| `device-manager/src/powermon_wrapper.cpp` | PowerMon C++ wrapper |
| `device-manager/src/powermon_wrapper.h` | Wrapper header file |
| `device-manager/lib/index.ts` | TypeScript wrapper with types |
| `device-manager/lib/index.js` | Compiled JavaScript |
| `device-manager/build/Release/powermon_addon.node` | Compiled native addon |

**TypeScript Interface:**
```typescript
import { PowermonDevice, getLibraryVersion } from './device-manager/lib/index';

// Static methods (work without Bluetooth)
const version = getLibraryVersion();
const parsed = PowermonDevice.parseAccessURL(url);
const hwString = PowermonDevice.getHardwareString(0x0100);
const psString = PowermonDevice.getPowerStatusString(1);

// Instance methods (require Bluetooth for initialization)
const device = new PowermonDevice();
device.connect({ url: accessUrl, onConnect: () => {}, onDisconnect: () => {} });
device.getMonitorData((response) => { console.log(response.data); });
device.disconnect();
```

### Bluetooth Error Handling (Fixed)

**Problem Solved:** The library's `Powermon::createInstance()` threw an exception when no Bluetooth hardware was available, causing the Node.js process to crash.

**Solution Applied:** Modified the C++ wrapper to catch the BLE initialization exception gracefully:
```cpp
PowermonWrapper::PowermonWrapper(const Napi::CallbackInfo& info) {
    try {
        powermon_ = Powermon::createInstance();
        if (powermon_ != nullptr) {
            ble_available_ = true;
            SetupCallbacks();
        }
    } catch (const std::exception& e) {
        // BLE init failed - expected on servers without Bluetooth
        powermon_ = nullptr;
        ble_available_ = false;
    }
}
```

**Result:** The addon now works on ANY server:
- Instance creation succeeds (no crash)
- `device.isBleAvailable()` returns `false` when no BLE hardware
- Static methods work perfectly (`getLibraryVersion`, `parseAccessURL`, etc.)
- Attempting to connect gives a clear error message instead of crashing

**Test Output:**
```
Device initialized: true
BLE available: false
Library Version: { major: 1, minor: 16, string: '1.16' }
```

### Next Steps

**Awaiting Thornwave Update (ETA: Monday)**

Thornwave (Raz) is updating `createInstance()` to work without Bluetooth hardware for WiFi-only connections. Once pushed:
1. Pull updated library from `git.thornwave.com`
2. Rebuild native addon
3. Connect to live test device (DCL-Moeck in Southern California)
4. Test real-time data retrieval

**After Thornwave Update:**
1. **Connect to test device** using provided access URL
2. **Implement Device Manager service** that:
   - Polls devices based on polling settings
   - Stores snapshots and measurements in database
   - Syncs log files for historical data
   - Generates alerts for offline/low voltage conditions
4. **Create WebSocket integration** for real-time dashboard updates

**Current Implementation Status:**
- ✅ Native addon built and working (libpowermon v1.16)
- ✅ TypeScript wrapper with full type definitions
- ✅ Static methods operational (version, URL parsing, status strings)
- ✅ Subprocess bridge available as fallback
- ⏳ Instance methods require Bluetooth for testing

---

## Step 12: In-App Notification System (Completed)

### Implementation Date
November 29, 2025

### What Was Built

**In-App Notification System** - Real-time alerts displayed via bell icon in dashboard header:

| Component | Description |
|-----------|-------------|
| Notification UI | Bell icon with badge count, dropdown panel with alert list |
| Alert Types | Offline (critical), SoC (warning), Temperature (warning) |
| Alert Actions | Mark as read (acknowledge), Dismiss (resolve), Mark all as read |
| API Integration | Real-time polling every 10s with cache invalidation |

### Alert Priority Order

Alerts are displayed by priority (most important first):
1. **Offline** - Device unreachable (critical severity)
2. **SoC** - State of Charge below threshold (warning severity)
3. **Temperature** - Device temperature above threshold (warning severity)

### Backend Implementation

**Alert API Endpoints** (`server/api/fleet-routes.ts`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/alerts` | GET | List active alerts for organization |
| `/api/v1/alerts/:id/acknowledge` | POST | Mark alert as acknowledged (requires userId) |
| `/api/v1/alerts/:id/resolve` | POST | Resolve/dismiss alert |

**Storage Methods** (`server/db-storage.ts`):
- `listAlerts(organizationId)` - Get all active alerts
- `acknowledgeAlert(alertId, userId)` - Record who acknowledged and when
- `resolveAlert(alertId)` - Mark alert as resolved with timestamp

### Frontend Implementation

**Notification Component** (`client/src/components/Notifications.tsx`):
- Bell icon with unread count badge (gray when no notifications, green when unread)
- Dropdown panel with notification list
- Each notification shows: severity icon, message, truck name, timestamp
- Action buttons: Mark as read, Dismiss
- "Mark all as read" button in header

**API Hooks** (`client/src/lib/api.ts`):
- `useLegacyNotifications()` - Polls alerts every 10s
- `useAcknowledgeAlert()` - Mutation to acknowledge alert
- `useResolveAlert()` - Mutation to resolve/dismiss alert

**Dashboard Integration** (`client/src/pages/Dashboard.tsx`):
- Notifications passed session user ID for acknowledgement
- Optimistic UI update with local state
- Cache invalidation after mutations

### Notification Display Mapping

| Alert Type | Icon | Color | Example Message |
|------------|------|-------|-----------------|
| Offline | AlertTriangle | Red | "Device PWM-1003 offline for 2+ hours" |
| SoC | Battery | Orange | "Battery at 22% on FLT-003" |
| Temperature | ThermometerSun | Yellow | "High temperature: 58°C on FLT-005" |

### Key Files

| File | Purpose |
|------|---------|
| `client/src/components/Notifications.tsx` | Notification UI with bell icon and dropdown |
| `client/src/lib/api.ts` | Alert hooks (fetch, acknowledge, resolve) |
| `client/src/pages/Dashboard.tsx` | Dashboard integration with mutation calls |
| `server/api/fleet-routes.ts` | Alert API endpoints |
| `server/db-storage.ts` | Alert storage methods |

### Testing

Sample alerts created for testing:
- "Device PWM-1003 offline for 2+ hours" (Offline - Critical)
- "Battery at 22% on FLT-003" (Low SoC - Warning)
- "High temperature: 58°C on FLT-005" (Temperature - Warning)

### Simulator Alert Generation

The Device Manager simulator (`server/services/device-simulator.ts`) automatically generates alerts based on simulated conditions:

| Alert Type | Trigger Condition | Severity | Probability |
|------------|-------------------|----------|-------------|
| `offline` | Device goes offline | Critical | 8% per cycle |
| `low_voltage` | Voltage < 11.5V | Critical | Based on SoC |
| `low_soc` | SoC < 20% | Warning | 10% rapid discharge |
| `high_temp` | Temperature > 50°C | Warning | 8% spike chance |
| `low_temp` | Temperature < 5°C | Warning | 8% spike chance |

**Thresholds** (`ALERT_THRESHOLDS` constant):
- `LOW_VOLTAGE`: 11.5V
- `LOW_SOC`: 20%
- `HIGH_TEMP`: 50°C
- `LOW_TEMP`: 5°C
- `OFFLINE_CHANCE`: 8% per poll cycle
- `RECOVERY_CHANCE`: 40% per poll cycle

Alerts are automatically resolved when conditions return to normal (e.g., device comes back online, temperature drops below threshold).

### Bug Fixes Applied

1. **Login React Hooks Error**: Fixed by moving `setLocation` redirect into `useEffect` hook
2. **API Hook Imports**: Added `useMutation` import for alert acknowledge/resolve hooks

---

## Step 14: CSV Export Feature

### Implementation Date
November 30, 2025

### What Was Built

**CSV Export Functionality** - Allows users to export fleet and truck data to CSV files:

| Feature | Description |
|---------|-------------|
| Export All Trucks | Downloads a summary of all trucks with current status, battery, location |
| Export Truck History | Downloads detailed measurement history for a single truck with date range selection |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/export/trucks` | GET | Export all trucks summary to CSV |
| `/api/v1/export/trucks/:id` | GET | Export single truck history (params: startTime, endTime) |

### CSV Data Fields

**All Trucks Export:**
- Truck Number, Fleet, Status, Voltage 1/2, Current, SOC, Power, Temperature, Latitude, Longitude, Last Updated

**Single Truck History:**
- Timestamp, Truck Number, Fleet, Voltage 1/2, Current, SOC, Power, Temperature, Energy, Charge, Runtime

### Frontend Components

| Location | Feature |
|----------|---------|
| Dashboard.tsx | "Export CSV" button in Fleet Overview section |
| TruckDetail.tsx | "Export" button with date range picker popover |

### Key Files

| File | Changes |
|------|---------|
| `server/api/fleet-routes.ts` | Added export endpoints with CSV generation |
| `client/src/pages/Dashboard.tsx` | Added export all trucks button |
| `client/src/components/TruckDetail.tsx` | Added export history with date range picker |

### Features

- Proper CSV escaping for special characters (commas, quotes, newlines)
- Date range validation (start must be before end)
- File naming with dates for easy identification
- Loading states and toast notifications for user feedback
- Up to 10,000 measurement records per export

### Status

- ✅ Backend export endpoints
- ✅ Frontend export buttons with date picker
- ✅ Date range validation
- ✅ Proper CSV formatting

---

## Step 13: SIMPro Integration (In Progress)

### Implementation Date
November 29, 2025

### What Was Built

**SIMPro API Integration** - Connects to Wireless Logic's SIMPro platform for SIM management and truck location tracking:

| Component | Description |
|-----------|-------------|
| Database Schema | `sims`, `sim_location_history`, `sim_usage_history`, `sim_sync_settings` tables |
| SIMPro Client | TypeScript API client with authentication and key endpoints |
| Sync Service | Fetches SIMs, matches to devices by name, updates truck locations |
| Admin API | Endpoints for SIM sync, location sync, usage sync, and status check |

### Data Model

**SIM ↔ Device Linking:**
```
SIMPro Router (SIM)              PowerMon Device
      ↓                                ↓
custom_field1 = "DCL-Moeck"     device_name = "DCL-Moeck"
      ↓                                ↓
   Location                    Voltage/Current/SOC
      ↓                                ↓
         → Unified Truck View ←
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `sims` | SIM cards with ICCID, MSISDN, status, location, linked device/truck |
| `sim_location_history` | Historical location data for tracking movement |
| `sim_usage_history` | Data consumption records for alerting |
| `sim_sync_settings` | Per-organization sync intervals and thresholds |

### SIMPro API Client

**Key Endpoints Used:**
- `GET /api/v3/sims` - List all SIMs
- `GET /api/v3/sim/{msisdn}/details` - Detailed SIM info including custom fields
- `GET /api/v3/sim/{msisdn}/location` - SIM location via cell tower triangulation
- `GET /api/v3/sim/{msisdn}/usage` - Current data usage

**Authentication:**
```typescript
headers: {
  'x-api-client': process.env.SIMPRO_API_CLIENT,
  'x-api-key': process.env.SIMPRO_API_KEY
}
```

### Admin API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/admin/simpro/status` | GET | Check SIMPro connection status |
| `/api/v1/admin/organizations/:orgId/sims` | GET | List SIMs for organization |
| `/api/v1/admin/organizations/:orgId/sims/sync` | POST | Sync SIMs from SIMPro |
| `/api/v1/admin/organizations/:orgId/sims/sync-locations` | POST | Update truck locations from SIM |
| `/api/v1/admin/organizations/:orgId/sims/sync-usage` | POST | Sync data usage and generate alerts |
| `/api/v1/admin/sims/:simId/location-history` | GET | Get location history for a SIM |

### Key Files

| File | Purpose |
|------|---------|
| `shared/schema.ts` | SIM database tables and types |
| `server/services/simpro-client.ts` | SIMPro API client |
| `server/services/sim-sync-service.ts` | Sync service for SIMs, locations, usage |
| `server/api/admin-routes.ts` | Admin API endpoints for SIM management |

### Configuration Required

**Environment Variables:**
- `SIMPRO_API_CLIENT` - API client ID from SIMPro
- `SIMPRO_API_KEY` - API key from SIMPro

### Data Flow

1. **Initial Sync:** Fetch all SIMs from SIMPro, match to PowerMon devices by name (custom_field1)
2. **Location Polling:** Every 5 minutes, get location for each SIM and update truck position
3. **Usage Tracking:** Hourly usage sync, generate alerts if data threshold exceeded

### Status

- ✅ Database schema created and pushed
- ✅ SIMPro API client with full TypeScript types
- ✅ Sync service for SIMs, locations, and usage
- ✅ Admin API endpoints
- ⏳ Awaiting SIMPro API credentials to test

---

## Team Notes

*Add notes here during development for future reference*

