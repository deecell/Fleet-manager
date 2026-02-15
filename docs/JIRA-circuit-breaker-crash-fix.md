# Device Manager: Circuit Breaker Crash Fix & Connection Status Overhaul

## Summary

Fixed a critical crash loop in the device manager caused by no-power devices (e.g., Kalitta-Hospitality) triggering the native C++ library's `terminate()` during rapid connect/disconnect cycles. Also overhauled the connection status semantics to properly distinguish admin-initiated offline from temporary disconnects, and added live online/offline control from the admin dashboard.

---

## Problem

1. **Native library crash loop**: When a PowerMon device has no power (trailer batteries off), the device is network-reachable but can't sustain a BLE connection. Each connect succeeds in ~3ms then immediately disconnects. After 5 rapid cycles, the C++ library's internal state corrupts, calling `terminate()` and crashing the entire Node.js process. On restart, the recovery sweep reset the device status, causing it to reconnect and crash again — an infinite loop (observed at 1684 restarts).

2. **Status ambiguity**: `connection_status = 'offline'` was used for both admin-initiated offline AND any unexpected disconnect. A device with 1 disconnect showed as "OFFLINE" on the dashboard, which was misleading.

3. **No live control**: Admins had no way to stop/start polling a specific device without restarting the device manager.

---

## Fix

### A. Fail-Fast No-Power Detection

Instead of allowing 5 reconnect attempts before opening the circuit breaker, detect the first rapid disconnect immediately:

1. After `connect()` resolves, wait 50ms for the async `onDisconnect` callback to fire
2. If `conn.status === 'disconnected'` AND `rapidDisconnectCount > 0`, immediately:
   - Null out the native device reference (`conn.device = null`)
   - Clear any reconnect timer
   - Remove from connection pool
   - Mark as `no_power` in database
3. No reconnect cycle ever starts — crash is prevented

Applied to all 3 connection paths:
- `connectAll()` — startup
- `checkForNewDevices()` — newly activated devices
- `checkForNewDevices()` — admin-reset reconnections

### B. Startup Recovery Sweep

- **Before**: Reset both `unstable` AND `no_power` devices to NULL on restart
- **After**: Only resets `unstable` devices. `no_power` devices stay marked and are excluded from polling until admin explicitly clicks "Set Online"
- This breaks the crash loop — the device that crashed the process doesn't get auto-retried on restart

### C. Circuit Breaker Guards

When circuit breaker opens (for devices already in the pool that reach 5 rapid disconnects):
- Immediately null out `this.device` to prevent pending native callbacks from touching corrupted state
- Clear reconnect timers and return early
- `fetchAndUpdateDeviceInfo()` checks `this.status === 'connected'` AND `!this.isCircuitOpen` before making native calls

---

## Connection Status State Matrix

| Status | Meaning | Set By | Polled? | Auto-Recovers? | How to Restore |
|--------|---------|--------|---------|-----------------|----------------|
| `NULL` | Initial/ready | System | Yes | N/A | N/A |
| `online` | Connected, waiting for first data | Device manager | Yes | N/A | N/A |
| `reporting` | Connected and returning data | Device manager | Yes | N/A | N/A |
| `disconnected` | Temporary unexpected disconnect | Device manager | Yes (stays in active query) | Yes — auto-reconnect on next poll | Automatic |
| `unstable` | Circuit breaker opened (5 rapid disconnects, connection durations vary) | Device manager | No (excluded from query) | Yes — auto-reset on startup recovery sweep | Automatic on restart, or admin "Set Online" |
| `no_power` | Circuit breaker opened (5 rapid disconnects, ALL connections < 100ms) | Device manager | No (excluded from query) | No — NOT reset on startup | Admin "Set Online" only |
| `offline` | Admin manually stopped polling | Admin dashboard | No (excluded from query) | No | Admin "Set Online" only |

---

## Circuit Breaker Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| `RAPID_DISCONNECT_THRESHOLD_MS` | 5000ms | Disconnect within 5s of connect = "rapid" |
| `MAX_RAPID_DISCONNECTS` | 5 | Opens circuit breaker after 5 rapid disconnects |
| `UNSTABLE_BACKOFF_MS` | 300000ms (5 min) | In-process cooldown before retry |
| `NO_POWER_THRESHOLD_MS` | 100ms | If ALL disconnect durations < 100ms → `no_power` |

---

## Device Manager Polling Query Filter

```sql
WHERE (d.connection_status IS NULL 
   OR d.connection_status NOT IN ('unstable', 'offline', 'no_power'))
AND c.is_active = true
```

- `NULL`, `online`, `reporting`, `disconnected` → **included** (polled)
- `unstable`, `offline`, `no_power` → **excluded** (skipped)
- `c.is_active = false` → **excluded** (monitoring disabled by admin)

---

## Startup Recovery Sweep

```sql
UPDATE power_mon_devices d
SET connection_status = NULL, consecutive_disconnects = 0,
    marked_unstable_at = NULL
WHERE d.connection_status IN ('unstable')
  AND EXISTS (SELECT 1 FROM device_credentials c 
              WHERE c.device_id = d.id AND c.is_active = true)
```

Only `unstable` is reset. `no_power` and `offline` persist across restarts.

---

## Truck Status vs Device Monitoring (Separated Concerns)

| Level | Field | Values | Controlled By | Affects Polling? |
|-------|-------|--------|---------------|------------------|
| Truck | `trucks.is_active` | In Service / Not In Service | Fleet manager | No |
| Device | `device_credentials.is_active` | true / false | Admin only | Yes |
| Device | `power_mon_devices.connection_status` | See matrix above | System / Admin | Yes |

All trucks are always monitored. Truck service status is purely operational. Device polling is controlled by `device_credentials.is_active` and `connection_status`.

---

## Admin Dashboard Controls

| Action | Button | Effect | Device Manager Response |
|--------|--------|--------|------------------------|
| Set Offline | Orange wifi-off icon | Sets `connection_status = 'offline'` | `checkForNewDevices()` detects on next cycle, removes from pool |
| Set Online | Green refresh icon | Resets `connection_status = NULL`, clears counters | `checkForNewDevices()` detects on next cycle, reconnects (with fail-fast protection) |
| Toggle Monitoring | In device credentials dialog | Sets `device_credentials.is_active` | Device included/excluded from polling query |

No device manager restart required for any admin action.

---

## Frontend Status Badges

| Status | Badge Color | Label |
|--------|-------------|-------|
| `online` | Green | Online |
| `reporting` | Green | Reporting |
| `disconnected` | Orange | Disconnected |
| `unstable` | Orange | Unstable |
| `no_power` | Red | No Power |
| `offline` | Gray | Offline |

---

## Files Changed

- `device-manager/app/connection-pool.js` — fail-fast detection, circuit breaker guards, `checkForNewDevices()` offline removal
- `device-manager/app/database.js` — startup recovery sweep (exclude `no_power`), `markDeviceDisconnected()`, active devices query filter
- `server/api/admin-routes.ts` — Set Offline endpoint
- `server/db-storage.ts` — `setDeviceOffline()`, `resetDeviceConnectionStatus()`
- `client/src/pages/admin/DevicesPage.tsx` — Set Offline button, status badges
- `client/src/lib/admin-api.ts` — mutation hooks

---

## Testing / Verification

- Deployed to production EC2. Kalitta-Hospitality correctly shows as `[no_power]` and is skipped on every polling cycle
- Device manager running stable with 0 crashes after fix (previously at 1684 restart counter)
- All other devices polling normally
- Admin "Set Online" / "Set Offline" buttons work without restart
