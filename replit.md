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
Both admin and customer authentication are session-based. Admin access uses an `ADMIN_PASSWORD` secret, while customer login uses email/password verification with bcrypt. `tenantMiddleware` ensures active user/organization verification.

### Device Manager
A standalone Node.js application manages device polling and data collection (PowerMon devices, SIM cards, GPS). It's designed for AWS EC2 and uses a supervisor/worker architecture with cohort-based sharding for fault isolation. It integrates with `libpowermon_bin` (Thornwave's C++ library), polls various devices at different intervals, and includes a circuit breaker mechanism for isolating problematic devices and recovering them via solo probe workers.

### Savings Calculation System
This system calculates fuel cost savings from solar energy using a formula that integrates solar energy data and regional diesel prices fetched from the U.S. Energy Information Administration (EIA) API.

### Fleet Export Pipeline
An asynchronous pipeline handles CSV/Excel exports of fleet snapshots and historical time-series data for individual trucks (per-minute, hourly, or daily granularity, up to 1 year, 600k row cap). It uses dedicated services for cell building and serialization, stores export jobs in a database, processes them with an in-process worker, uploads results to S3, and notifies users via SendGrid. Historical aggregation reuses existing data sources — chassis voltage (`voltage2 < 13.0 V`) for parked/driving state and minutes, `sim_location_history` for per-bucket lat/long, and `savings_config` + `fuel_prices` for daily savings — so no new telemetry tables are required. Concurrency limits are enforced per user and organization.

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