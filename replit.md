# Deecell Fleet Tracking Dashboard

## Overview

The Deecell Fleet Tracking Dashboard is a real-time monitoring system for managing a fleet of clean energy trucks. The application provides comprehensive visibility into truck locations, battery states, performance metrics, and system health. Users can track individual vehicles, view historical performance data, and receive notifications about fleet status changes.

The system is designed as a data-heavy enterprise application with emphasis on clarity, scanability, and operational efficiency. It follows a clean, minimalistic design approach optimized for monitoring and managing fleet operations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React 18 with TypeScript using Vite as the build tool and development server.

**Routing**: Wouter for lightweight client-side routing with a simple dashboard-focused structure.

**State Management**: TanStack React Query (v5) for server state management, caching, and data synchronization. Component-level state managed with React hooks.

**UI Component Library**: Radix UI primitives with shadcn/ui component patterns. The design follows the "new-york" style variant with a system-based approach inspired by Material Design and Carbon Design System.

**Styling**: Tailwind CSS with custom design tokens for colors, spacing, and typography. Uses CSS variables for theming with support for both light and dark modes (currently light mode active). Typography uses Inter font family via Google Fonts for optimal readability.

**Data Visualization**: Recharts for rendering historical performance charts (SOC, voltage, current, watts).

**Map Integration**: Static map image with SVG overlays for truck location visualization, using coordinate transformation for latitude/longitude positioning.

**Form Validation**: React Hook Form with Zod resolvers for type-safe form handling and validation.

### Backend Architecture

**Runtime**: Node.js with Express.js framework for HTTP server and API routing.

**Type Safety**: Full TypeScript implementation shared between client and server via the `/shared` directory for schemas and type definitions.

**API Pattern**: RESTful API structure with routes prefixed with `/api`. Currently uses skeleton route structure ready for implementation.

**Data Validation**: Zod schemas defined in `shared/schema.ts` for runtime type validation and inference, including truck data, historical metrics, and notifications.

**Development Mode**: Vite middleware integration for HMR (Hot Module Replacement) during development with custom error handling and logging.

**Storage Layer**: Abstracted storage interface (`IStorage`) implemented with PostgreSQL database storage (`DbStorage`). Multi-tenant queries with organization scoping.

**API Hooks** (client/src/lib/api.ts): React Query hooks for data fetching with organization ID header injection. Includes mapping layer to transform database types to legacy frontend types:
- `useLegacyTrucks()`: Fetches trucks, devices, and snapshots, maps to `LegacyTruckWithDevice`
- `useLegacyNotifications()`: Fetches alerts and maps to `LegacyNotification`
- `useTruckHistory()`: Fetches device measurements for historical charts

### Data Storage

**Current Implementation**: PostgreSQL database with Drizzle ORM. Multi-tenant schema with organization-scoped data.

**Database**: PostgreSQL via Neon serverless driver (`@neondatabase/serverless`). Drizzle ORM for type-safe queries and schema management.

**Schema Management**: Drizzle Kit configured to push schema changes directly to database via `npm run db:push`. Schema location: `./shared/schema.ts`.

**Session Storage**: Infrastructure in place for PostgreSQL-backed sessions using `connect-pg-simple` package.

**Data Models** (13 tables implemented):
- **Organizations**: Customer accounts (tenants) with multi-tenant isolation
- **Users**: Login accounts scoped to organizations with RBAC roles
- **Fleets**: Named truck groups (1-N per organization, e.g., "Flatbed Fleet", "Van-Trailer Fleet")
- **Trucks**: Vehicles with metadata (truck number, driver name, location, status)
- **PowerMonDevices**: PowerMon hardware info (serial, firmware, 1:1 with trucks)
- **DeviceCredentials**: Encrypted WifiAccessKey for remote connection
- **DeviceSnapshots**: Latest readings for fast dashboard queries
- **DeviceMeasurements**: Time-series data with monthly partitioning
- **DeviceSyncStatus**: Tracks log file offset for backfill when devices reconnect
- **Alerts**: OFFLINE and Low Voltage notifications (V1)
- **PollingSettings**: Configurable polling frequency per organization
- **AuditLogs**: SOC2 compliance tracking
- **Sessions**: User session storage

**Multi-tenancy**: All business tables include `organization_id` for row-level security. Middleware enforces tenant scoping on all queries.

### Design System

**Color Palette**: Neutral-based theme with green primary color (142° hue, 76% saturation) representing clean energy. Custom elevation system using subtle shadows and background overlays.

**Component Patterns**:
- Cards with rounded corners (9px border radius) and subtle shadows
- Hover states with elevation changes (`hover-elevate` class)
- Badge system with status indicators (in-service, not-in-service, notifications)
- Data tables with sortable columns and row selection
- Side panel for detailed truck information with charts

**Spacing System**: Consistent spacing using Tailwind's scale (2, 4, 6, 8 units) for padding, margins, and gaps.

**Responsive Design**: Mobile-first approach with breakpoint-based layouts. Tables and charts adapt to smaller screens, notifications use popovers on mobile.

## External Dependencies

### Core Infrastructure

- **Database**: Neon Serverless PostgreSQL (configured but not yet connected)
- **Drizzle ORM**: Type-safe database queries and schema migrations
- **Express.js**: HTTP server and API framework

### UI and Styling

- **Radix UI**: Headless component primitives for accessibility and customization
- **Tailwind CSS**: Utility-first CSS framework with custom configuration
- **shadcn/ui**: Component patterns and conventions
- **Recharts**: Charting library for data visualization
- **Lucide React**: Icon library

### Development Tools

- **Vite**: Build tool and dev server with HMR support
- **TypeScript**: Type safety across client and server
- **React Query**: Server state management and caching
- **Wouter**: Lightweight routing library

### Form and Validation

- **React Hook Form**: Form state management
- **Zod**: Schema validation and type inference
- **@hookform/resolvers**: Integration between React Hook Form and Zod

### Utilities

- **date-fns**: Date formatting and manipulation
- **clsx + tailwind-merge**: Conditional class name utilities
- **nanoid**: Unique ID generation
- **class-variance-authority**: Type-safe component variants

### Build and Deployment

- **esbuild**: Fast JavaScript bundler for production builds
- **tsx**: TypeScript execution for development server
- **PostCSS + Autoprefixer**: CSS processing pipeline

### Replit-Specific

- **@replit/vite-plugin-runtime-error-modal**: Development error overlay
- **@replit/vite-plugin-cartographer**: Development tooling
- **@replit/vite-plugin-dev-banner**: Development environment indicator

## AWS Deployment Documentation

Complete deployment documentation is stored in `Deployment/Solar/`. This documentation provides everything needed to deploy the application to AWS with enterprise-grade security and compliance.

### Documentation Files

| File | Purpose |
|------|---------|
| `1-AGENT-INSTRUCTIONS.md` | Step-by-step setup guide for AWS deployment |
| `2-ARCHITECTURE-OVERVIEW.md` | System architecture diagrams and component details |
| `3-TERRAFORM-SETUP.md` | Complete Terraform infrastructure-as-code templates |
| `4-GITHUB-ACTIONS-SETUP.md` | CI/CD pipeline configuration for automated deployments |
| `5-SECURITY-COMPLIANCE.md` | SOC2, ISO27001, CIS AWS security controls |
| `6-MULTI-TENANCY-GUIDE.md` | Multi-tenant database patterns and middleware |
| `7-OPERATIONS-RUNBOOK.md` | Day-to-day operations, monitoring, troubleshooting |
| `README.md` | Documentation index and quick start guide |

### Infrastructure Components (Terraform)

The Terraform templates provision:
- **VPC**: Multi-AZ with public, private, and isolated database subnets
- **ECS Fargate**: Serverless container hosting with auto-scaling
- **RDS PostgreSQL**: Managed database with encryption and backups
- **ALB**: Application Load Balancer with SSL termination
- **Security Groups**: Layered network security (ALB → ECS → RDS)
- **Secrets Manager**: Secure credential storage
- **CloudWatch**: Logging, monitoring, and alerting
- **CloudTrail**: API audit logging (SOC2 compliance)
- **GuardDuty**: Threat detection and security monitoring

### CI/CD Pipeline (GitHub Actions)

Two main workflows:
1. **deploy.yml**: Application deployment on push to main
   - Test → Security Scan → Build Docker → Push to ECR → Deploy to ECS → Run Migrations
2. **terraform.yml**: Infrastructure changes on terraform/ directory changes
   - Format Check → Validate → Plan → Apply (with PR review)

### Multi-Tenancy Pattern

Uses shared database with row-level security:
- All business tables include `organizationId` foreign key
- Tenant middleware extracts organization context from user sessions
- Storage interface enforces organization scoping on all queries
- RBAC roles: super_admin, org_admin, manager, user, viewer

### Required GitHub Secrets for Deployment

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `AWS_REGION` | AWS region (e.g., us-east-1) |
| `AWS_ACCOUNT_ID` | 12-digit AWS account ID |
| `ECR_REPOSITORY` | ECR repository name |
| `TF_VAR_db_password` | Database password |
| `TF_VAR_session_secret` | Session encryption key |

### Estimated Monthly Costs (Dev/Staging)

| Component | Cost |
|-----------|------|
| ECS Fargate (0.5 vCPU, 1GB) | ~$15 |
| RDS PostgreSQL (db.t3.micro) | ~$15 |
| ALB | ~$20 |
| NAT Gateway | ~$35 |
| Secrets Manager | ~$2 |
| CloudWatch Logs | ~$5 |
| **Total** | **~$92/month** |

### Cloud-Agnostic Design Considerations

While the current templates are AWS-specific, the architecture follows cloud-agnostic patterns:
- **Terraform**: Can be adapted for Azure (AzureRM provider) or GCP (Google provider)
- **Container-based**: ECS Fargate patterns translate to Azure Container Apps or GCP Cloud Run
- **PostgreSQL**: Standard PostgreSQL works on any cloud managed database service
- **CI/CD**: GitHub Actions can deploy to any cloud with appropriate credentials
- **Secrets**: Vault or cloud-native secret managers follow similar patterns

To adapt for other clouds, the main changes would be:
1. Replace AWS provider with target cloud provider
2. Update resource types (e.g., `aws_ecs_service` → `azurerm_container_app`)
3. Adjust networking constructs to cloud-specific equivalents
4. Update GitHub Actions to use target cloud's CLI/SDK

## Recent Development Progress

### Admin Dashboard (November 2025)

**Completed Features:**

1. **Admin Dashboard UI** - 6 fully functional admin pages:
   - `/admin` - Dashboard with system-wide statistics (organizations, fleets, trucks, devices, users counts)
   - `/admin/organizations` - CRUD management for customer organizations
   - `/admin/fleets` - Fleet management across all organizations
   - `/admin/trucks` - Truck provisioning and management
   - `/admin/devices` - PowerMon device management and assignment
   - `/admin/users` - User account management with role assignment

2. **Admin Backend API** (`server/api/admin-routes.ts`):
   - Complete CRUD endpoints at `/api/v1/admin/*`
   - Cross-organizational access (bypasses tenant middleware)
   - Storage methods: `deleteOrganization`, `listAllDevices`, `listAllUsers`, `deleteUser`, `getAdminStats`

3. **Session-Based Authentication**:
   - Secure login page at `/admin/login`
   - Express session middleware with MemoryStore
   - Session validation middleware for all admin routes
   - Logout functionality with session cleanup
   - Environment variable: `ADMIN_PASSWORD` (stored as secret)

4. **Admin UI Components**:
   - `AdminLayout.tsx` - Sidebar navigation with auth check and logout
   - `AdminLogin.tsx` - Login form with logo branding
   - Custom hooks: `useAdminSession`, `useAdminLogin`, `useAdminLogout`
   - API utilities in `client/src/lib/admin-api.ts`

5. **Admin Branding**:
   - Orange accent color: `#FA4B1E` for buttons, active states, and hover effects
   - Custom CSS class `.admin-nav-item` for sidebar navigation styling
   - Deecell logo integration on login page
   - Clean, minimal input styling (no focus rings)

**Key Files:**
- `server/api/admin-routes.ts` - Admin API routes with session auth
- `server/routes.ts` - Session middleware setup
- `client/src/pages/admin/` - All admin page components
- `client/src/components/AdminLayout.tsx` - Admin layout with sidebar
- `client/src/lib/admin-api.ts` - Admin API hooks and utilities
- `client/src/index.css` - Custom admin navigation styles

**Authentication Flow:**
1. User navigates to `/admin/*`
2. `AdminLayout` checks session via `/api/v1/admin/session`
3. If not authenticated, redirects to `/admin/login`
4. User enters credentials (username: "admin", password: from ADMIN_PASSWORD secret)
5. On success, session cookie is set and user is redirected to `/admin`
6. All subsequent admin API calls include session cookie for authentication