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
| Step 7 | Alerts System | ✅ Complete |
| Step 8 | Device Manager Docs | ⏳ Pending |
| Step 9 | Admin Dashboard | ✅ Complete |
| Step 10 | Customer Authentication | ✅ Complete |
| Step 11 | Device Manager (libpowermon) | 🔄 In Progress |
| Step 12 | In-App Notifications | ✅ Complete |

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

### Bluetooth Requirement

**Known Limitation:** The `PowermonDevice` constructor initializes Bluetooth hardware. On servers without Bluetooth, instance creation fails but static methods still work.

**Workaround:** The TypeScript wrapper handles this gracefully:
```typescript
constructor() {
  try {
    this.device = new addon.PowermonDevice();
    this.initialized = true;
  } catch (error) {
    console.warn('BLE init failed (expected on servers):', error.message);
    this.initialized = false;
  }
}
```

### Next Steps

1. **Deploy to Bluetooth-capable environment** for full integration testing
2. **Connect to test device** using provided access URL
3. **Implement Device Manager service** that:
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

## Team Notes

*Add notes here during development for future reference*

