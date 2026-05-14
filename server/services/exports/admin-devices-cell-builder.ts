/**
 * Admin Devices Export — cell builder.
 *
 * Mirrors `cell-builder.ts` / `historical-cell-builder.ts` but for the
 * cross-org admin device registry (Task #5). Returns a `RawCellValue` —
 * the serializer formats it according to `AdminDeviceColumn.format`.
 */

import {
  ADMIN_DEVICE_COLUMNS,
  type AdminDeviceColumnKey,
} from "@shared/export-admin-devices";
import type { RawCellValue } from "./cell-builder";
import type { AdminDeviceExportRow } from "./admin-types";

function connectionStatusLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  // Values from the device manager: online / offline / unstable / flapping / connecting / disconnected
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Derive the admin-facing "Circuit Breaker State" by mapping the device
 * manager's `connection_status` into the operator-facing taxonomy agreed
 * for the soft launch. Source state comes from `device-manager/app/database.js`
 * (`markDeviceUnstable` writes `unstable` or `flapping`; supervisor sets
 * `offline` + `markedOfflineAt`).
 *
 *   connection_status     →  exported circuit_breaker_state
 *   ─────────────────────    ────────────────────────────────
 *   flapping              →  flapping_quarantine
 *   unstable              →  unstable_pending
 *   offline (or markedOfflineAt set) → offline
 *   online (or anything else) → healthy
 */
function deriveCircuitBreakerState(row: AdminDeviceExportRow): string {
  const status = (row.connectionStatus ?? "").toLowerCase();
  if (status === "flapping") return "flapping_quarantine";
  if (status === "unstable") return "unstable_pending";
  if (status === "offline" || row.markedOfflineAt) return "offline";
  return "healthy";
}

export function extractAdminDeviceCell(
  row: AdminDeviceExportRow,
  columnKey: AdminDeviceColumnKey,
): RawCellValue {
  switch (columnKey) {
    // Identity
    case "organization_name":    return row.organizationName ?? null;
    case "fleet_name":           return row.fleetName ?? null;
    case "truck_number":         return row.truckNumber ?? null;
    case "powermon_serial":      return row.serialNumber ?? null;
    case "powermon_device_name": return row.deviceName ?? null;

    // Hardware
    case "hardware_revision":    return row.hardwareRevision ?? null;
    case "firmware_version":     return row.firmwareVersion ?? null;
    case "build_date":           return row.buildDate ?? null;

    // Connectivity
    case "host_id":              return row.hostId ?? null;
    case "is_active":
      return row.credentialIsActive === null || row.credentialIsActive === undefined
        ? null
        : row.credentialIsActive ? "Yes" : "No";
    case "iccid":                return row.iccid ?? null;
    case "imsi":                 return row.imsi ?? null;
    case "msisdn":               return row.msisdn ?? null;
    case "connection_status":    return connectionStatusLabel(row.connectionStatus);

    // Operations
    case "last_reported":        return row.lastReportedAt ?? null;
    case "last_seen":            return row.lastSeenAt ?? null;
    case "circuit_breaker_state":return deriveCircuitBreakerState(row);

    // Worker / live
    case "worker_cohort":
      return row.workerCohort === null || row.workerCohort === undefined
        ? null
        : `Cohort ${row.workerCohort}`;
    case "soc":                  return row.soc ?? null;
    case "voltage1":             return row.voltage1 ?? null;
    case "rssi":                 return row.rssi ?? null;

    default: {
      // Exhaustiveness sentinel — keeps the registry and switch in sync.
      const _exhaustive: never = columnKey;
      void ADMIN_DEVICE_COLUMNS;
      return _exhaustive;
    }
  }
}
