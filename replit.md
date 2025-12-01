# Deecell Fleet Tracking Dashboard

## Overview
The Deecell Fleet Tracking Dashboard is a real-time monitoring system for managing a fleet of clean energy trucks. It offers comprehensive visibility into truck locations, battery states, performance metrics, and system health. The system supports tracking individual vehicles, viewing historical data, and receiving notifications. Designed as a data-heavy enterprise application, it prioritizes clarity, scanability, and operational efficiency with a clean, minimalistic design for fleet management.

## User Preferences
- Preferred communication style: Simple, everyday language.
- **Always update DEVELOPMENT_LOG.md** with progress on every task (user reads this regularly).
- Update replit.md and other documentation alongside DEVELOPMENT_LOG.md.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **Routing**: Wouter for client-side routing.
- **State Management**: TanStack React Query for server state; React hooks for component state.
- **UI Component Library**: Radix UI primitives with shadcn/ui patterns, following a "new-york" style inspired by Material Design and Carbon Design System.
- **Styling**: Tailwind CSS with custom design tokens, CSS variables for theming (light/dark modes), and DM Sans font family.
- **Data Visualization**: Recharts for historical performance charts.
- **Map Integration**: Static map image with SVG overlays for truck location.
- **Form Validation**: React Hook Form with Zod resolvers.

### Backend
- **Runtime**: Node.js with Express.js.
- **Type Safety**: Full TypeScript, shared types via `/shared` directory.
- **API Pattern**: RESTful API, `/api` prefix.
- **Data Validation**: Zod schemas (`shared/schema.ts`).
- **Development**: Vite middleware for HMR, custom error handling.
- **Storage Layer**: Abstracted `IStorage` interface, implemented with PostgreSQL (`DbStorage`), supporting multi-tenant queries.
- **API Hooks**: React Query hooks (`client/src/lib/api.ts`) for data fetching and type mapping.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM, using Neon serverless driver.
- **Schema Management**: Drizzle Kit (`npm run db:push`), schema in `./shared/schema.ts`.
- **Session Storage**: PostgreSQL-backed sessions using `connect-pg-simple`.
- **Data Models**: 14 tables including Organizations, Users, Fleets, Trucks, Devices, Snapshots, Measurements, Statistics, Alerts, etc.
- **New Table (Nov 30)**: `device_statistics` - stores lifetime fuelgauge stats (totalCharge, totalDischarge, voltage range, current peaks, etc.)
- **Multi-tenancy**: `organization_id` on all business tables, row-level security enforced by middleware.

### Design System
- **Color Palette**: Neutral-based with green primary accent (142° hue, 76% saturation) for clean energy theme. Custom elevation system.
- **Component Patterns**: Rounded cards (9px radius), hover elevation, badge system, sortable data tables, side panels for details.
- **Spacing System**: Consistent spacing using Tailwind's scale.
- **Responsive Design**: Mobile-first approach with breakpoint-based layouts.

### Admin Dashboard
- **Admin UI**: 6 functional admin pages for managing organizations, fleets, trucks, devices, and users.
- **Admin API**: CRUD endpoints at `/api/v1/admin/*` with cross-organizational access.
- **Authentication**: Session-based authentication via `/admin/login` using `ADMIN_PASSWORD` secret.

### Customer Authentication
- **Customer Login**: Email/password login at `/login` with bcrypt verification and session management.
- **Security**: Session-based auth, `tenantMiddleware` for active user/org verification, secure logout.
- **API**: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/session`.
- **Protected Routes**: All fleet API routes require authenticated sessions; dashboard redirects to `/login` if unauthenticated.

### Device Manager (Production Application - December 1, 2025)
- **Purpose**: Standalone application for managing PowerMon device connections and data collection.
- **Deployment**: Designed for AWS EC2, scales independently from web app.
- **Architecture**: Cohort-based sharding, staggered polling, batch database writes.
- **Scale Target**: ~1,000 devices per instance, horizontally scalable to tens of thousands.

**Application Structure** (`device-manager/app/`):
| Module | File | Purpose |
|--------|------|---------|
| Config | `config.js` | Environment variables, validation |
| Logger | `logger.js` | Structured JSON logging |
| Database | `database.js` | PostgreSQL pool, bulk inserts |
| Connection Pool | `connection-pool.js` | Persistent device connections |
| Polling Scheduler | `polling-scheduler.js` | 10-second staggered polling |
| Batch Writer | `batch-writer.js` | Buffered bulk inserts |
| Backfill Service | `backfill-service.js` | Gap detection, log sync |
| Metrics | `metrics.js` | Prometheus metrics, health check |
| Entry Point | `index.js` | Lifecycle, graceful shutdown |

**Key Parameters**:
- Poll interval: 10 seconds (matches PowerMon log sample rate)
- Cohorts: 10 (devices sharded via hash(serial) % 10)
- Batch flush: 2 seconds OR 500 records
- Gap threshold: 30 seconds (3 missed polls)
- Metrics endpoint: `:3001/metrics`

**Native Addon** (`device-manager/build/`):
- **Library**: `libpowermon_bin` v1.17 - Thornwave's C++ library
- **Build**: `cd device-manager && npx node-gyp rebuild`
- **Status**: ✅ Live connection to "DCL-Moeck" verified
- **WiFi Support**: Works on servers without Bluetooth

**Log Sync Service** (`device-manager/lib/log-sync.js`):
- Lists log files on device (tested: 41 files, 14MB)
- Reads/decodes binary log data (10-second samples)
- Incremental sync with state tracking
- Functions: `syncDeviceLogs()`, `syncSince()`, `getLogFileList()`

### SIMPro Integration (Truck Location Tracking)
- **Purpose**: Track truck locations via SIM card cell tower triangulation; monitor data usage.
- **Provider**: Wireless Logic SIMPro platform.
- **API**: REST API v3 at `https://simpro4.wirelesslogic.com/api/v3`.
- **Authentication**: `x-api-client` and `x-api-key` headers.
- **Linking**: SIMs matched to PowerMon devices via device_name (SIMPro custom_field1).
- **Data Flow**: SIM location → truck.latitude/longitude → map display.
- **Secrets Required**: `SIMPRO_API_CLIENT`, `SIMPRO_API_KEY`.
- **Status**: Integration built, awaiting API credentials.

### SIMPro Database Tables
- `sims` - SIM cards with ICCID, MSISDN, location, linked device/truck.
- `sim_location_history` - Historical location data.
- `sim_usage_history` - Data consumption for alerting.
- `sim_sync_settings` - Sync intervals and thresholds per organization.

### Savings Calculation System
- **Purpose**: Calculate fuel cost savings from solar energy generated by PowerMon devices.
- **Formula**: `(solar_Wh / 1000 / diesel_kWh_per_gallon) × fuel_price_per_gallon`
- **Default Values**: diesel_kWh_per_gallon = 9.0, default fuel price = $3.50/gallon
- **EIA Integration**: Fetches weekly diesel prices from U.S. Energy Information Administration API.
- **Regional Pricing**: Uses truck location to determine PADD region for accurate local diesel prices.
- **PADD Regions**: 1A (New England), 1B (Central Atlantic), 1C (Lower Atlantic), 2 (Midwest), 3 (Gulf Coast), 4 (Rocky Mountain), 5 (West Coast).
- **Secrets Required**: `EIA_API_KEY` (optional - falls back to default price if not set)
- **Database Tables**: `fuel_prices` (cached EIA prices by region), `savings_config` (per-org settings)
- **API Endpoint**: `GET /api/v1/savings` returns today's savings, 7-day average, trend percentage
- **Files**: `server/services/eia-client.ts`, `server/services/savings-calculator.ts`, `server/services/padd-regions.ts`

### AI Fleet Assistant
- **Purpose**: Natural language chat interface for fleet management queries and insights.
- **Model**: OpenAI GPT-4o-mini via Replit AI Integrations.
- **Architecture**: Function calling for real-time data access (prevents hallucination).
- **Backend**: `server/services/fleet-assistant.ts` - processes chat with function calling tools.
- **API Endpoint**: `POST /api/v1/assistant/chat` - accepts message history, returns AI response.
- **Frontend**: `client/src/components/FleetAssistant.tsx` - slide-out Sheet drawer in header.
- **Function Tools**:
  - `get_all_trucks` - List trucks with optional status filter
  - `get_truck_details` - Get detailed truck metrics by truck number
  - `get_fleet_statistics` - Aggregate fleet metrics (savings, SOC, maintenance)
  - `get_active_alerts` - Unresolved alerts across fleet
  - `get_low_battery_trucks` - Trucks below SOC threshold
  - `get_fleet_summary` - Quick fleet health overview

### AWS Deployment Infrastructure (December 1, 2025) - ✅ LIVE!
- **Status**: DEPLOYED and running in AWS!
- **Terraform**: Complete IaC in `terraform/` directory (12 files) - 92+ resources deployed.
- **GitHub Actions**: CI/CD workflows in `.github/workflows/` (deploy.yml, terraform.yml).
- **Compliance**: SOC2/ISO27001 readiness with CloudTrail, encrypted storage.

**Live Production URLs**:
| Resource | URL/Endpoint |
|----------|--------------|
| **Application URL** | http://deecell-fleet-production-alb-5549888.us-east-2.elb.amazonaws.com |
| **Database Endpoint** | deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432 |
| **Database Name** | deecell_fleet |
| **AWS Account** | 892213647605 |
| **Region** | us-east-2 (Ohio) |

**AWS Architecture (Deployed)**:
| Component | Service | Configuration |
|-----------|---------|---------------|
| Web App | ECS Fargate | 1-4 tasks, 512 CPU, 1GB RAM, Auto-scaling |
| Database | RDS PostgreSQL 15 | db.t3.micro (free tier), encrypted |
| Load Balancer | ALB | HTTP (HTTPS ready with ACM) |
| Device Manager | EC2 t3.micro | Auto Scaling Group (0-1 instances, free tier) |
| Networking | VPC | Multi-AZ, public/private/database subnets |
| Secrets | Secrets Manager | DB URL, session secret, admin password |
| Monitoring | CloudWatch | Logs, dashboards, alarms |
| Compliance | CloudTrail | Audit logging enabled |

**GitHub Secrets for CI/CD**:
| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | (get from Terraform output) |
| `AWS_SECRET_ACCESS_KEY` | (get from Terraform output) |
| `AWS_REGION` | us-east-2 |
| `ECR_REPOSITORY` | deecell-fleet |

**Terraform Files** (`terraform/`):
- `main.tf`, `variables.tf`, `vpc.tf`, `rds.tf`, `ecs.tf`, `alb.tf`
- `security-groups.tf`, `iam.tf`, `secrets.tf`, `device-manager.tf`
- `monitoring.tf`, `outputs.tf`, `terraform.tfvars.example`

**GitHub Secrets Required**:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_ACCOUNT_ID`
- `ECR_REPOSITORY`, `TF_VAR_DB_PASSWORD`, `TF_VAR_SESSION_SECRET`, `TF_VAR_ADMIN_PASSWORD`

**Deployment Guide**: See `DEPLOYMENT_CHECKLIST.md` for step-by-step instructions.

**Cost Estimate**: ~$153/month (ECS $35, RDS $30, NAT $33, ALB $20, EC2 $30, misc $5)

## External Dependencies

### Core Infrastructure
- **Database**: Neon Serverless PostgreSQL
- **ORM**: Drizzle ORM
- **Web Framework**: Express.js

### UI and Styling
- **UI Primitives**: Radix UI
- **CSS Framework**: Tailwind CSS
- **Component Library**: shadcn/ui
- **Charting**: Recharts
- **Icons**: Lucide React

### Development Tools
- **Build Tool**: Vite
- **Language**: TypeScript
- **State Management**: React Query
- **Routing**: Wouter

### Form and Validation
- **Form Management**: React Hook Form
- **Schema Validation**: Zod
- **Resolver Integration**: @hookform/resolvers

### Utilities
- **Date Handling**: date-fns
- **Class Utilities**: clsx, tailwind-merge
- **ID Generation**: nanoid
- **Component Variants**: class-variance-authority

### Build and Deployment
- **Bundler**: esbuild
- **TS Execution**: tsx
- **CSS Processing**: PostCSS, Autoprefixer

### Replit-Specific
- **Vite Plugins**: @replit/vite-plugin-runtime-error-modal, @replit/vite-plugin-cartographer, @replit/vite-plugin-dev-banner