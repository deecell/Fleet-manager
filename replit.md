# Deecell Fleet Tracking Dashboard

## Overview
The Deecell Fleet Tracking Dashboard is a real-time monitoring system for a fleet of clean energy trucks. It provides visibility into truck locations, battery states, performance metrics, and system health, plus historical data, notifications, and fuel-cost-savings calculations from solar energy. It is a data-heavy enterprise application with a clean, minimalistic design.

> Detailed, dated implementation history lives in `DEVELOPMENT_LOG.md`. This file is the high-level, durable architecture reference — keep it concise and scannable.

## User Preferences
- Preferred communication style: Simple, everyday language.
- Always update `DEVELOPMENT_LOG.md` with progress on every task (user reads this regularly).
- Update `replit.md` and other documentation alongside `DEVELOPMENT_LOG.md`.
- **Production Database Migrations**:
  - **ALWAYS create a runnable script** in `scripts/migrations/` the user can run from their MacBook Pro.
  - Scripts must be self-contained and include all SQL commands.
  - Name format: `YYYY-MM-DD_description.sh` (e.g. `2026-01-08_add_shelly_tables.sh`).
  - User's local dev folder: `/Users/amoeck/Development/Fleet-manager`.
  - Use the SSM → EC2 → psql approach (NOT direct CloudShell or an API endpoint).

## System Architecture

### Frontend
React 18 + TypeScript + Vite, Wouter for routing, TanStack React Query for server state. UI is built on Radix UI primitives and shadcn/ui, styled with Tailwind CSS (light/dark modes). Charts use Recharts; maps use static images with SVG overlays. Forms use React Hook Form with Zod.

### Backend
Node.js + Express.js in TypeScript, with Zod validation. Exposes a RESTful API over an abstracted `IStorage` interface (implemented against PostgreSQL), supporting multi-tenant queries.

### Data Storage
PostgreSQL with Drizzle ORM. **Dev** uses the Neon serverless driver (Replit's built-in DB); **production** is AWS RDS PostgreSQL. Drizzle Kit manages the schema (`npm run db:push`); `connect-pg-simple` handles sessions. Tables cover Organizations, Users, Fleets, Trucks, Devices, SIMs, and performance/alert data. Multi-tenancy is enforced via `organization_id`.

### Design System
Neutral-based palette with a green primary accent, rounded cards, hover elevation, and a badge system. Consistent spacing and a mobile-first responsive approach.

### Authentication
Session-based email/password (bcrypt) for both admin and customer surfaces.
- **Platform admins** are real `users` rows in the `Deecell Internal` org (slug `deecell-internal`) with `is_platform_admin = true`. The legacy shared `ADMIN_PASSWORD` is **not** accepted for login.
- `SESSION_SECRET` is the only source of the session secret — production fails fast at startup if unset; dev falls back to a labelled insecure string. `ADMIN_PASSWORD` now only gates the one-shot `/api/migrate-database` endpoint.
- `platformAdminMiddleware` re-validates the user (`isPlatformAdmin`, `isActive`, org active) on every admin request, so revoking access takes effect immediately. `tenantMiddleware` does the equivalent for the customer surface.
- Admins are invited from `/admin/users` via emailed **invitation tokens** (7-day expiry, SendGrid). Tokens are resendable and rejected once a user has a password. Andy (`andy@deecell.com`) is seeded with a NULL password plus an invitation link; app boot re-mints/re-sends as an idempotent fallback.

### Device ↔ Truck ↔ SIM linkage
Two separate truck links exist and **must stay in sync**:
- `power_mon_devices.truck_id` — the device's assignment (what the admin UI sets/shows).
- `sims.truck_id` — what the **InHand GPS poller** uses to decide which truck a GPS fix belongs to.

`assignDeviceToTruck`/`unassignDevice` (`server/db-storage.ts`) update **both** links in one transaction. **Diagnostic**: a device showing signal but blank location almost always means `sims.truck_id` is NULL — not a router GPS failure. Signal lives on `sims.router_rssi` and only proves the router is online, not that it has a GPS lock. Confirm by comparing `sims.truck_id` vs `power_mon_devices.truck_id`. The backfill script `scripts/migrations/2026-06-24_sync_sim_truck_from_device.sh` repairs existing rows.

### Device Registration
SIM linkage is established **synchronously and fail-loud at "Register Device" time** (not via the periodic SIMPro sync + poller race). Registration calls Wireless Logic (`simProClient.getSimByDeviceName()`, a strict-single helper) and uses structured errors: `SIM_NOT_FOUND` / `SIM_MULTIPLE_MATCH` (400) and `SIM_ALREADY_LINKED` (409, no silent reassignment). Device + SIM are committed atomically.
- **Refresh SIM from Wireless Logic** (`POST …/devices/:id/refresh-sim`, in the `/admin/devices` row `⋯` menu) handles router/SIM swaps — re-runs the strict lookup and updates the SIM in place, including ICCID drift, reusing the same error codes.
- **Backfill SIM Links** (button on `/admin/devices`) runs the strict lookup for every device with no linked SIM and returns a per-bucket summary.
- The periodic SIMPro sync only refreshes `data_used_mb`/location for the whole catalog; it never re-links existing rows. The authoritative link paths are registration, Refresh, and Backfill.

### Device Manager
A standalone Node.js app on AWS EC2 polls PowerMon devices, SIMs, and GPS, using a supervisor/worker architecture with cohort-based sharding for fault isolation. It integrates `libpowermon_bin` (Thornwave C++ library).
- **Circuit breaker + recovery**: a flapping device is isolated locally (worker stays alive); recovery is handled by the supervisor's solo-probe loop (one process per device, 5-min quarantine, exponential backoff). Connection states use honest names: `flapping` (instant disconnects), `unstable` (rapid, non-instant), `probing` (solo probe in progress), `offline` (admin-set). Orphaned `probing` rows are reclaimed by the startup sweep and the probe loop.
- **Per-poll watchdog**: each `conn.poll()` is wrapped in an 8 s timeout so a hung native callback can't freeze the whole cohort's scheduler.
- **Midnight firmware mass-close**: at ~00:00 UTC the PowerMon-W firmware closes all sessions at once; the reconnect storm is absorbed by a 2-minute firmware-recovery window so it no longer false-trips the breaker fleet-wide.
- **InHand poller** (`inhand-poller.js`, talks to `iot.inhandnetworks.com`): extracts GPS coordinates and cellular signal each poll. GPS updates land on `trucks` (keyed on `sims.truck_id`) and are also appended to `sim_location_history` (`source='router_gps'`) so full driving paths are retained. The `/admin/devices` **"Moved (24h)"** column reads this history (`getTruckMovementMiles`) to show per-truck distance driven in the last 24h — total path distance summed from consecutive fixes (so round-trips count), with parked GPS jitter filtered out (~0.03 mi per-segment floor; <0.2 mi total reads as "Parked"). Backed by the `sim_location_truck_time_idx (truck_id, recorded_at)` index. Signal always lands on `sims.router_rssi`; for devices whose firmware omits signal in the bulk response it falls back to the per-device signal endpoint.

### Savings Calculation System
Calculates fuel-cost savings from solar energy using solar data and regional diesel prices from the U.S. EIA API.

### Fleet Export Pipeline
Asynchronous CSV/Excel exports of fleet snapshots and per-truck historical time-series (per-minute/hourly/daily, up to 1 year, 600k-row cap). Export jobs are stored in the DB, processed by an in-process worker, uploaded to S3, and surfaced in the recent-exports table + `ExportsBanner`. Email notifications are **opt-in** per job (`export_jobs.notify_by_email`). Historical aggregation reuses existing data (chassis voltage for parked/driving state, `sim_location_history` for lat/long, `savings_config` + `fuel_prices` for savings). Concurrency limits apply per user and per org.

### Admin Export
The same pipeline backs admin exports, gated by `adminMiddleware`, via the dedicated `/admin/export` page (device-registry export + per-truck historical export + recent-exports table). A synthetic "Deecell Admin" user in the "Deecell Internal" org is reused for `export_jobs` accounting. The `export_jobs.kind` column (`snapshot | historical | admin_devices | admin_historical`) drives worker dispatch; admin files land under `s3://…/exports/admin/<jobId>/`.

### AI Fleet Assistant
A natural-language chat interface (OpenAI GPT-4o-mini via Replit AI Integrations) answers fleet queries using function calling for real-time data access.

### AWS Deployment Infrastructure
Deployed on AWS via Terraform (IaC) and GitHub Actions (CI/CD): ECS Fargate (web app), RDS PostgreSQL, ALB, EC2 (Device Manager), VPC, Secrets Manager, CloudWatch, CloudTrail.

## External Dependencies

### Core
- **Database**: Neon serverless PostgreSQL (dev) / AWS RDS PostgreSQL (production)
- **ORM**: Drizzle ORM
- **Web Framework**: Express.js

### UI and Styling
- **UI Primitives**: Radix UI · **CSS**: Tailwind CSS · **Components**: shadcn/ui · **Charts**: Recharts · **Icons**: Lucide React

### External APIs
- **SIMPro / Wireless Logic API**: SIM card location and data usage.
- **InHand Networks API**: GPS location and cellular signal from routers (OAuth2).
- **U.S. EIA API**: Diesel fuel prices.
- **OpenAI API**: GPT-4o-mini for the AI Fleet Assistant.

### Tooling
- **Build**: Vite · **Language**: TypeScript · **State**: React Query · **Routing**: Wouter · **Forms**: React Hook Form + Zod · **Dates**: date-fns · **IDs**: nanoid

### AWS Services
ECS, RDS, ALB, EC2, Secrets Manager, CloudWatch, CloudTrail.
