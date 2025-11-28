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
| Step 4 | Test Data Hydration | ⏳ Pending |
| Step 5 | Connect Dashboard | ⏳ Pending |
| Step 6 | Device Manager Simulation | ⏳ Pending |
| Step 7 | Alerts System | ⏳ Pending |
| Step 8 | Device Manager Docs | ⏳ Pending |

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

## Team Notes

*Add notes here during development for future reference*

