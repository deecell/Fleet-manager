/**
 * Admin Devices Export — Column Registry
 *
 * Cross-org device registry exported from `/admin/devices` (Task #5 soft
 * launch). The shape mirrors `shared/export-columns.ts` so the CSV/Excel
 * cell renderer can stay registry-agnostic.
 *
 * Unlike the customer-facing snapshot export, the admin export has a single
 * fixed column set — there are no bundles or per-column toggles. The 18
 * columns map 1:1 to what the admin sees in the `/admin/devices` table plus
 * the operational fields needed to triage devices.
 */

import type { ColumnFormat, ColumnSource, ExportColumn } from "./export-columns";

export type AdminDeviceColumnSource =
  | ColumnSource
  // Admin-only sources surfaced by the registry but not shown to customers:
  | "organization"
  | "credential"
  | "syncStatus";

export interface AdminDeviceColumn extends Omit<ExportColumn, "source"> {
  source: AdminDeviceColumnSource;
}

/**
 * Stable registry. Iteration order is the column order in the output file.
 * Build Date and Circuit Breaker State are intentionally derived/synthetic:
 *   • build_date — not stored anywhere; emitted as null today, scaffolded so
 *     a later schema migration can populate it without UI changes.
 *   • circuit_breaker_state — derived from the device manager's
 *     `connection_status` (online | flapping | unstable | offline). The
 *     enum we emit is the operator-facing taxonomy agreed for the soft
 *     launch: `healthy | flapping_quarantine | unstable_pending | offline`.
 *
 * `is_active` is sourced from `device_credentials.is_active` (whether the
 * stored WiFi access key is currently in use), not `power_mon_devices.is_active`,
 * so admins can spot devices that are physically present but credential-disabled.
 */
export const ADMIN_DEVICE_COLUMNS = {
  // Identity (5)
  organization_name:    { key: "organization_name",    label: "Organization",        source: "organization", format: "text",     width: 24, group: "Identity" },
  fleet_name:           { key: "fleet_name",           label: "Fleet",               source: "fleet",        format: "text",     width: 18, group: "Identity" },
  truck_number:         { key: "truck_number",         label: "Truck Number",        source: "truck",        format: "text",     width: 14, group: "Identity" },
  powermon_serial:      { key: "powermon_serial",      label: "Serial Number",       source: "device",       format: "text",     width: 16, group: "Identity" },
  powermon_device_name: { key: "powermon_device_name", label: "Device Name",         source: "device",       format: "text",     width: 22, group: "Identity" },

  // Hardware (3)
  hardware_revision:    { key: "hardware_revision",    label: "HW Revision",         source: "device",       format: "text",     width: 12, group: "Hardware" },
  firmware_version:     { key: "firmware_version",     label: "FW Version",          source: "device",       format: "text",     width: 12, group: "Hardware" },
  build_date:           { key: "build_date",           label: "Build Date",          source: "device",       format: "date",     width: 14, group: "Hardware",
    description: "Not currently stored; reserved column for a future field." },

  // Connectivity (6)
  host_id:              { key: "host_id",              label: "Host ID / IP",        source: "credential",   format: "text",     width: 18, group: "Connectivity" },
  is_active:            { key: "is_active",            label: "Credential Active",   source: "credential",   format: "text",     width: 14, group: "Connectivity",
    description: "Whether the device's stored WiFi access credential is currently active." },
  iccid:                { key: "iccid",                label: "ICCID",               source: "sim",          format: "text",     width: 22, group: "Connectivity" },
  imsi:                 { key: "imsi",                 label: "IMSI",                source: "sim",          format: "text",     width: 18, group: "Connectivity" },
  msisdn:               { key: "msisdn",               label: "MSISDN",              source: "sim",          format: "text",     width: 16, group: "Connectivity" },
  connection_status:    { key: "connection_status",    label: "Connection Status",   source: "device",       format: "text",     width: 16, group: "Connectivity" },

  // Operations (3)
  last_reported:        { key: "last_reported",        label: "Last Reported",       source: "device",       format: "datetime", width: 22, group: "Operations" },
  last_seen:            { key: "last_seen",            label: "Last Seen",           source: "device",       format: "datetime", width: 22, group: "Operations" },
  circuit_breaker_state:{ key: "circuit_breaker_state",label: "Circuit Breaker",     source: "derived",      format: "text",     width: 22, group: "Operations",
    description: "Derived from connection_status: healthy | flapping_quarantine | unstable_pending | offline." },

  // Worker / live (4)
  worker_cohort:        { key: "worker_cohort",        label: "Worker Cohort",       source: "syncStatus",   format: "text",     width: 14, group: "Worker / live" },
  soc:                  { key: "soc",                  label: "SOC (%)",             source: "snapshot",     format: "percent",  width: 10, group: "Worker / live" },
  voltage1:             { key: "voltage1",             label: "Voltage 1 (Chassis)", source: "snapshot",     format: "voltage",  width: 16, group: "Worker / live" },
  rssi:                 { key: "rssi",                 label: "RSSI (dBm)",          source: "snapshot",     format: "number",   width: 12, group: "Worker / live" },
} as const satisfies Record<string, AdminDeviceColumn>;

export type AdminDeviceColumnKey = keyof typeof ADMIN_DEVICE_COLUMNS;

/** Iteration-friendly array form, preserves declaration order. */
export const ADMIN_DEVICE_COLUMN_LIST: AdminDeviceColumn[] =
  Object.values(ADMIN_DEVICE_COLUMNS) as AdminDeviceColumn[];

export const ADMIN_DEVICE_COLUMN_KEYS: AdminDeviceColumnKey[] =
  Object.keys(ADMIN_DEVICE_COLUMNS) as AdminDeviceColumnKey[];

export function isAdminDeviceColumnKey(value: unknown): value is AdminDeviceColumnKey {
  return typeof value === "string" && value in ADMIN_DEVICE_COLUMNS;
}

// Re-exported so the cell renderer can reference the same `ColumnFormat`
// without pulling export-columns.ts directly (keeps imports tidy).
export type { ColumnFormat } from "./export-columns";
