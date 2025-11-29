# Deecell Fleet Management - Development Log

> This log tracks all development progress, architectural decisions, and implementation details for team reference.

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
| Step 7 | Alerts System | ⏳ Pending |
| Step 8 | Device Manager Docs | ⏳ Pending |
| Step 9 | Admin Dashboard | ✅ Complete |
| Step 10 | Customer Authentication | ✅ Complete |

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

## Team Notes

*Add notes here during development for future reference*

