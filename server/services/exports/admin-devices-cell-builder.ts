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
  // Values: online / offline / unstable / connecting / disconnected
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Derive the admin-facing "Circuit Breaker State". The supervisor (Device
 * Manager) marks devices as offline + tracks consecutiveDisconnects; we
 * surface the operator-friendly state without bringing the supervisor's
 * runtime into the export server.
 *
 *   • Tripped — currently offline AND markedOfflineAt is set
 *   • Recovering — connection_status = 'unstable' OR a recent reconnect
 *   • Closed — anything else
 */
function deriveCircuitBreakerState(row: AdminDeviceExportRow): string {
  const status = (row.connectionStatus ?? "").toLowerCase();
  if (status === "offline" && row.markedOfflineAt) return "Tripped";
  if (status === "unstable") return "Recovering";
  if ((row.consecutiveDisconnects ?? 0) > 0 && status !== "online") return "Recovering";
  return "Closed";
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

    default: {
      // Exhaustiveness sentinel — keeps the registry and switch in sync.
      const _exhaustive: never = columnKey;
      void ADMIN_DEVICE_COLUMNS;
      return _exhaustive;
    }
  }
}
