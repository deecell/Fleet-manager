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
- **Styling**: Tailwind CSS with custom design tokens, CSS variables for theming (light/dark modes), and Inter font family.
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
- **Data Models**: 13 tables including Organizations, Users, Fleets, Trucks, Devices, Snapshots, Measurements, Alerts, etc.
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

### Device Manager (In Progress)
- **Purpose**: Communicates with PowerMon devices on trucks via Thornwave's libpowermon C++ library.
- **Architecture**: C++ bridge executable (`powermon-bridge`) with Node.js client (`BridgeClient`).
- **Protocol**: NDJSON over stdin/stdout with command ID tagging for robust async handling.
- **Library**: `libpowermon_bin` - Thornwave's pre-compiled library (awaiting PIC-compiled version for native addon).
- **Location**: `device-manager/` directory.
- **Status**: Bridge implementation complete; awaiting Thornwave's PIC-compiled library update (ETA: Tomorrow morning PT).

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