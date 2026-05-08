# Deecell Fleet Tracking Dashboard

## Overview
The Deecell Fleet Tracking Dashboard is a real-time monitoring system designed for managing a fleet of clean energy trucks. It provides comprehensive visibility into truck locations, battery states, performance metrics, and system health. Key capabilities include tracking individual vehicles, viewing historical data, receiving notifications, and calculating fuel cost savings from solar energy. The project aims to provide a data-heavy enterprise application with a clean, minimalistic design for efficient fleet management.

## User Preferences
- Preferred communication style: Simple, everyday language.
- Always update DEVELOPMENT_LOG.md with progress on every task (user reads this regularly).
- Update replit.md and other documentation alongside DEVELOPMENT_LOG.md.
- **Production Database Migrations**: 
  - **ALWAYS create a runnable script** in `scripts/migrations/` that the user can execute from their MacBook Pro
  - Scripts should be self-contained and include all SQL commands
  - Name format: `YYYY-MM-DD_description.sh` (e.g., `2026-01-08_add_shelly_tables.sh`)
  - User's local dev folder: `/Users/amoeck/Development/Fleet-manager`
  - Use SSM → EC2 → psql approach (NOT direct CloudShell or API endpoint)

## System Architecture

### Frontend
The frontend uses React 18 with TypeScript and Vite, Wouter for routing, and TanStack React Query for server state. UI components are built with Radix UI primitives and shadcn/ui patterns, styled with Tailwind CSS for a consistent, responsive design with light/dark modes. Data visualization is handled by Recharts, and map integration uses static images with SVG overlays. Form validation is managed by React Hook Form with Zod.

### Backend
The backend is built with Node.js and Express.js, leveraging TypeScript for type safety and Zod for data validation. It exposes a RESTful API and uses an abstracted `IStorage` interface implemented with PostgreSQL for data persistence, supporting multi-tenant queries.

### Data Storage
PostgreSQL with Drizzle ORM and Neon serverless driver is used for data storage. Drizzle Kit manages the schema, and `connect-pg-simple` handles PostgreSQL-backed sessions. The database includes tables for Organizations, Users, Fleets, Trucks, Devices, and various performance and alert data. Multi-tenancy is enforced with `organization_id` and row-level security.

### Design System
The design system features a neutral-based color palette with a green primary accent, rounded cards, hover elevation, and a badge system. It emphasizes a consistent spacing system and a mobile-first responsive design approach.

### Authentication
Both admin and customer authentication are session-based and use email/password with bcrypt. Platform admins are real `users` rows in the `Deecell Internal` org (slug `deecell-internal`) with `is_platform_admin = true`; the legacy shared `ADMIN_PASSWORD` is no longer accepted for login and is no longer a fallback for `SESSION_SECRET`. `SESSION_SECRET` is now the only source of the session secret — production fails fast at startup if it is unset, dev falls back to a labelled insecure string with a warning. `ADMIN_PASSWORD` lives only as the gate for the one-shot `/api/migrate-database` endpoint in `migration-routes.ts`. `platformAdminMiddleware` re-validates the user on every admin request — checking `isPlatformAdmin`, `isActive`, and the org's `isActive` flag — so revoking an admin takes effect immediately. Andy (`andy@deecell.com`) is seeded by the production migration script with a NULL `password_hash`; the same script also mints an invitation token and emails Andy a one-click password-setup link via SendGrid. The app boot is an idempotent fallback that re-mints + re-sends if the migration's email step fails. Additional admins are invited from `/admin/users` (Manage Platform Admins panel), which creates a user row with `is_platform_admin = true` and emails them an invitation token; promoting an existing deecell-internal user with NULL password also auto-issues an invitation email for parity. `tenantMiddleware` ensures active user/organization verification for the customer surface. Invitation tokens expire in 7 days; admins can resend a fresh token from the `/admin/users` row (icon next to "Never" in Last Login) or from the Manage Platform Admins panel via `POST /api/v1/admin/organizations/:orgId/users/:userId/resend-invitation` and `POST /api/v1/admin/platform-admins/:id/resend-invitation`. Both endpoints reuse the same `invitation_tokens` table + `sendInvitationEmail` pipeline as the create-user flow, reject the request when the user already has a `password_hash` (use password-reset instead), require `isEmailConfigured()` (503 otherwise), and apply a 60-second per-user in-memory cooldown to absorb double-clicks (429 on hit). Old superseded tokens are left in place — the `accept-invitation` route already filters by `expires_at > now() AND used_at IS NULL`.

### Device Manager
A standalone Node.js application manages device polling and data collection (PowerMon devices, SIM cards, GPS). It's designed for AWS EC2 and uses a supervisor/worker architecture with cohort-based sharding for fault isolation. It integrates with `libpowermon_bin` (Thornwave's C++ library), polls various devices at different intervals, and includes a circuit breaker mechanism for isolating problematic devices and recovering them via solo probe workers. The InHand poller (`device-manager/app/inhand-poller.js`) extracts both GPS coordinates and cellular signal strength on every poll: GPS updates land on `trucks` (when a truck is assigned and coords are present), and signal strength always lands on `sims.router_rssi` + `sims.router_signal_updated_at`. Signal extraction tries dBm fields first (`device.rssi`, `info.rssi`, `info.signalStrength`) then falls back to CSQ 0–31 via `dBm = -113 + 2*csq`; null when InHand omits the field. The `/admin/devices` page surfaces this as a sortable color-coded "Router Sig" column alongside the existing PowerMon "PM Sig" column (both rendered via the shared `<SignalCell>` component using the cellular bands -70 / -85 / -100 dBm). For diagnosing InHand connectivity from a laptop without touching prod, `scripts/probe/inhand_signal_probe.sh` mirrors the same OAuth2 + `_extractRssi` logic and prints per-device signal rows (raw field name + normalized dBm) — useful when the in-prod verification step comes back empty.

### Savings Calculation System
This system calculates fuel cost savings from solar energy using a formula that integrates solar energy data and regional diesel prices fetched from the U.S. Energy Information Administration (EIA) API.

### Fleet Export Pipeline
An asynchronous pipeline handles CSV/Excel exports of fleet snapshots and historical time-series data for individual trucks (per-minute, hourly, or daily granularity, up to 1 year, 600k row cap). It uses dedicated services for cell building and serialization, stores export jobs in a database, processes them with an in-process worker, uploads results to S3, and surfaces progress in the recent-exports table + `ExportsBanner`. **Email notifications are opt-in for every export type (customer + admin)** — each form has a default-OFF "Email me when ready" checkbox persisted on the job as `export_jobs.notify_by_email`; the worker only fires `sendExportReady`/`sendExportFailed` SendGrid emails when that flag is true, otherwise it silently skips. Historical aggregation reuses existing data sources — chassis voltage (`voltage2 < 13.0 V`) for parked/driving state and minutes, `sim_location_history` for per-bucket lat/long, and `savings_config` + `fuel_prices` for daily savings — so no new telemetry tables are required. Concurrency limits are enforced per user and organization.

### Admin Export Soft Launch
The same async export pipeline is also used by admin pages, gated by `adminMiddleware` instead of `tenantMiddleware`. The single admin surface is the dedicated `/admin/export` page, which combines the device-registry export with a per-truck historical export and a recent-exports table. (Earlier iterations also exposed an inline "Export" button and a per-row Download icon on `/admin/devices`; both were removed in favour of the consolidated `/admin/export` page, and the `AdminExportDialog` / `AdminTruckHistoryExportDialog` components were deleted.) Admin exports run through the same worker → S3 → email → sticky banner flow as customer exports. To plug into the existing pipeline without forking it, a synthetic "Deecell Admin" user inside a "Deecell Internal" org is bootstrapped on first admin login and reused as `export_jobs.user_id` / `organization_id`, so concurrency limits and email lookup keep working. The `export_jobs` table uses a `kind` column (`'snapshot' | 'historical' | 'admin_devices' | 'admin_historical'`) which the worker dispatches on; admin files land under `s3://…/exports/admin/<jobId>/<filename>`. For `admin_historical` jobs the worker reads the target customer org from `filters.organizationId` (the admin's Deecell Internal org stays on `job.organizationId` for concurrency accounting). `POST /api/admin/exports` accepts a discriminated `kind: 'devices' | 'historical'` payload; historical requests are validated against the same 1-year range and 600k-row caps as the customer-facing pipeline.

### AI Fleet Assistant
A natural language chat interface, powered by OpenAI GPT-4o-mini via Replit AI Integrations, provides fleet management queries and insights using function calling for real-time data access.

### AWS Deployment Infrastructure
The project is deployed on AWS using Terraform for Infrastructure as Code and GitHub Actions for CI/CD. It leverages ECS Fargate for the web app, RDS PostgreSQL, ALB, EC2 for the Device Manager, VPC, Secrets Manager, CloudWatch, and CloudTrail.

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

### External APIs
- **SIMPro API**: SIM card location and data usage.
- **InHand Networks API**: GPS location tracking from routers (OAuth2).
- **U.S. Energy Information Administration (EIA) API**: Diesel fuel prices.
- **OpenAI API**: GPT-4o-mini for AI Fleet Assistant.

### Development Tools
- **Build Tool**: Vite
- **Language**: TypeScript
- **State Management**: React Query
- **Routing**: Wouter

### Form and Validation
- **Form Management**: React Hook Form
- **Schema Validation**: Zod

### Utilities
- **Date Handling**: date-fns
- **ID Generation**: nanoid

### Integrations
- **AWS Services**: ECS, RDS, ALB, EC2, Secrets Manager, CloudWatch, CloudTrail.