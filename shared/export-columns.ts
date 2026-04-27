/**
 * Fleet Export — Column Registry & Bundles
 *
 * Single source of truth shared between frontend (the Export dialog) and backend
 * (the serializers). Adding a new column here makes it available everywhere with
 * no UI changes required.
 *
 * A "bundle" is a named preset that selects a subset of columns. Users can also
 * pass `includeColumns` / `excludeColumns` to override the bundle on a per-key
 * basis — the bundle is just a starting point.
 */

export type ColumnFormat =
  | "text"
  | "integer"
  | "number"          // generic float, 2dp
  | "voltage"         // 2dp + " V" suffix in display, raw number in cell
  | "wattage"         // 1dp + " W"
  | "percent"         // 1dp + " %"
  | "temperature_f"   // 1dp + " °F"
  | "kwh"             // 2dp + " kWh"
  | "amp_hours"       // 2dp + " Ah"
  | "hours"           // 2dp + " h"
  | "currency"        // USD
  | "date"            // YYYY-MM-DD
  | "datetime";       // ISO timestamp

/** Logical source of the column — informational; serializer reads `ExportRow` directly. */
export type ColumnSource =
  | "truck"
  | "fleet"
  | "device"
  | "snapshot"
  | "deviceStatistics"
  | "sim"
  | "alertCount"
  | "savings"
  | "derived";

export interface ExportColumn {
  /** Stable identifier. Used in API requests and `ExportRow` keys. */
  key: string;
  /** Header label shown in CSV/Excel output and the dialog UI. */
  label: string;
  source: ColumnSource;
  format: ColumnFormat;
  /** Excel column width hint (characters). */
  width?: number;
  /** Optional grouping label for the dialog. */
  group?: string;
  /** Short description shown next to the dialog checkbox. */
  description?: string;
}

export type BundleKey =
  | "default"
  | "operations"
  | "battery_health"
  | "connectivity"
  | "full";

export interface ExportBundle {
  key: BundleKey;
  label: string;
  description: string;
  columnKeys: string[];
}

// ---------------------------------------------------------------------------
// Column registry — order matches the spec's "default" order so iteration of
// EXPORT_COLUMNS naturally produces a sensible Full Export layout.
// ---------------------------------------------------------------------------

export const EXPORT_COLUMNS = {
  // Identity (5)
  truck_number:        { key: "truck_number",        label: "Truck Number",        source: "truck",   format: "text",     width: 14, group: "Identity" },
  fleet_name:          { key: "fleet_name",          label: "Fleet",               source: "fleet",   format: "text",     width: 18, group: "Identity" },
  driver_name:         { key: "driver_name",         label: "Driver",              source: "truck",   format: "text",     width: 22, group: "Identity" },
  powermon_serial:     { key: "powermon_serial",     label: "PowerMon Serial",     source: "device",  format: "text",     width: 16, group: "Identity" },
  powermon_device_name:{ key: "powermon_device_name",label: "PowerMon Device Name",source: "device",  format: "text",     width: 22, group: "Identity" },

  // Status (3) — three independent columns by design
  operational_status:  { key: "operational_status",  label: "Operational Status",  source: "truck",   format: "text",     width: 16, group: "Status",
    description: "Fleet manager controlled — In Service / Not In Service" },
  connection_status:   { key: "connection_status",   label: "Connection Status",   source: "device",  format: "text",     width: 16, group: "Status",
    description: "PowerMon device reachability — Online / Offline / Unstable" },
  activity_status:     { key: "activity_status",     label: "Activity Status",     source: "derived", format: "text",     width: 14, group: "Status",
    description: "Driving / Idling / Parked, derived from voltage and vibration" },

  // Location (4)
  address:             { key: "address",             label: "Address",             source: "derived", format: "text",     width: 32, group: "Location" },
  latitude:            { key: "latitude",            label: "Latitude",            source: "truck",   format: "number",   width: 12, group: "Location" },
  longitude:           { key: "longitude",           label: "Longitude",           source: "truck",   format: "number",   width: 12, group: "Location" },
  last_location_update:{ key: "last_location_update",label: "Last Location Update",source: "truck",   format: "datetime", width: 22, group: "Location" },

  // Live readings (7)
  voltage1:            { key: "voltage1",            label: "Voltage 1 (Chassis)", source: "snapshot",format: "voltage",  width: 16, group: "Live readings" },
  voltage2:            { key: "voltage2",            label: "Voltage 2 (Sleeper)", source: "snapshot",format: "voltage",  width: 16, group: "Live readings" },
  soc:                 { key: "soc",                 label: "SOC (%)",             source: "snapshot",format: "percent",  width: 10, group: "Live readings" },
  power:               { key: "power",               label: "Power (W)",           source: "snapshot",format: "wattage",  width: 12, group: "Live readings" },
  temperature_f:       { key: "temperature_f",       label: "Temperature (°F)",    source: "derived", format: "temperature_f", width: 14, group: "Live readings" },
  energy_remaining_kwh:{ key: "energy_remaining_kwh",label: "Energy Remaining (kWh)", source: "derived", format: "kwh",   width: 18, group: "Live readings" },
  charge:              { key: "charge",              label: "Charge (Ah)",         source: "snapshot",format: "amp_hours",width: 12, group: "Live readings" },

  // Battery configuration (3)
  battery_voltage:     { key: "battery_voltage",     label: "Battery Voltage",     source: "device",  format: "voltage",  width: 14, group: "Battery configuration" },
  battery_ah:          { key: "battery_ah",          label: "Battery Ah",          source: "device",  format: "amp_hours",width: 12, group: "Battery configuration" },
  number_of_batteries: { key: "number_of_batteries", label: "Number of Batteries", source: "device",  format: "integer",  width: 8,  group: "Battery configuration" },

  // Idle / savings (4)
  today_idle_hours:    { key: "today_idle_hours",    label: "Today Idle Hours",    source: "derived", format: "hours",    width: 14, group: "Idle / savings" },
  month_idle_hours:    { key: "month_idle_hours",    label: "Month Idle Hours",    source: "derived", format: "hours",    width: 14, group: "Idle / savings" },
  today_savings:       { key: "today_savings",       label: "Today's Savings ($)", source: "savings", format: "currency", width: 14, group: "Idle / savings" },
  month_savings:       { key: "month_savings",       label: "Month's Savings ($)", source: "savings", format: "currency", width: 14, group: "Idle / savings" },

  // Health & timestamps (4)
  active_alerts:       { key: "active_alerts",       label: "Active Alerts",       source: "alertCount", format: "integer", width: 10, group: "Health & timestamps" },
  last_updated:        { key: "last_updated",        label: "Last Updated",        source: "snapshot",format: "datetime", width: 22, group: "Health & timestamps" },
  last_reported:       { key: "last_reported",       label: "Last Reported",       source: "device",  format: "datetime", width: 22, group: "Health & timestamps" },
  last_seen:           { key: "last_seen",           label: "Last Seen",           source: "device",  format: "datetime", width: 22, group: "Health & timestamps" },

  // ----- Extended (Full Export adds) -----

  // Lifetime stats (8)
  total_discharge_energy: { key: "total_discharge_energy", label: "Total Discharge Energy (Wh)", source: "deviceStatistics", format: "number",  width: 22, group: "Lifetime stats" },
  total_charge_energy:    { key: "total_charge_energy",    label: "Total Charge Energy (Wh)",    source: "deviceStatistics", format: "number",  width: 22, group: "Lifetime stats" },
  min_voltage_ever:       { key: "min_voltage_ever",       label: "Min Voltage Ever",            source: "deviceStatistics", format: "voltage", width: 14, group: "Lifetime stats" },
  max_voltage_ever:       { key: "max_voltage_ever",       label: "Max Voltage Ever",            source: "deviceStatistics", format: "voltage", width: 14, group: "Lifetime stats" },
  min_temperature_ever:   { key: "min_temperature_ever",   label: "Min Temperature Ever (°F)",   source: "deviceStatistics", format: "temperature_f", width: 18, group: "Lifetime stats" },
  max_temperature_ever:   { key: "max_temperature_ever",   label: "Max Temperature Ever (°F)",   source: "deviceStatistics", format: "temperature_f", width: 18, group: "Lifetime stats" },
  deepest_discharge:      { key: "deepest_discharge",      label: "Deepest Discharge",           source: "deviceStatistics", format: "number",  width: 14, group: "Lifetime stats" },
  time_since_last_full_charge: { key: "time_since_last_full_charge", label: "Time Since Last Full Charge (h)", source: "deviceStatistics", format: "hours", width: 22, group: "Lifetime stats" },

  // SIM (5)
  sim_carrier:         { key: "sim_carrier",         label: "Carrier",             source: "sim",     format: "text",     width: 16, group: "SIM" },
  sim_msisdn:          { key: "sim_msisdn",          label: "MSISDN",              source: "sim",     format: "text",     width: 16, group: "SIM" },
  sim_data_used_mb:    { key: "sim_data_used_mb",    label: "Data Used (MB)",      source: "sim",     format: "number",   width: 14, group: "SIM" },
  sim_data_limit_mb:   { key: "sim_data_limit_mb",   label: "Data Limit (MB)",     source: "sim",     format: "number",   width: 14, group: "SIM" },
  signal_rssi:         { key: "signal_rssi",         label: "Signal RSSI",         source: "snapshot",format: "integer",  width: 10, group: "SIM" },

  // Hardware (2)
  hardware_revision:   { key: "hardware_revision",   label: "Hardware Revision",   source: "device",  format: "text",     width: 14, group: "Hardware" },
  firmware_version:    { key: "firmware_version",    label: "Firmware Version",    source: "device",  format: "text",     width: 14, group: "Hardware" },
} as const satisfies Record<string, ExportColumn>;

export type ColumnKey = keyof typeof EXPORT_COLUMNS;

/** Iteration-friendly array form, preserving declaration order. */
export const EXPORT_COLUMN_LIST: ExportColumn[] = Object.values(EXPORT_COLUMNS) as ExportColumn[];

/** Type guard. */
export function isColumnKey(value: unknown): value is ColumnKey {
  return typeof value === "string" && value in EXPORT_COLUMNS;
}

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

const DEFAULT_KEYS: ColumnKey[] = [
  // Identity
  "truck_number", "fleet_name", "driver_name", "powermon_serial", "powermon_device_name",
  // Status
  "operational_status", "connection_status", "activity_status",
  // Location
  "address", "latitude", "longitude", "last_location_update",
  // Live readings
  "voltage1", "voltage2", "soc", "power", "temperature_f", "energy_remaining_kwh", "charge",
  // Battery configuration
  "battery_voltage", "battery_ah", "number_of_batteries",
  // Idle / savings
  "today_idle_hours", "month_idle_hours", "today_savings", "month_savings",
  // Health & timestamps
  "active_alerts", "last_updated", "last_reported", "last_seen",
];

const OPERATIONS_KEYS: ColumnKey[] = [
  "truck_number", "fleet_name", "driver_name",
  // All three status columns appear together in any bundle that includes status.
  "operational_status", "connection_status", "activity_status",
  "address", "latitude", "longitude",
  "today_idle_hours", "month_idle_hours", "today_savings", "month_savings",
  "active_alerts", "last_updated",
];

const BATTERY_HEALTH_KEYS: ColumnKey[] = [
  "truck_number", "powermon_serial",
  "voltage1", "voltage2", "soc", "power", "temperature_f", "energy_remaining_kwh", "charge",
  "battery_voltage", "battery_ah", "number_of_batteries",
  "total_discharge_energy", "total_charge_energy",
  "min_voltage_ever", "max_voltage_ever",
  "min_temperature_ever", "max_temperature_ever",
  "deepest_discharge", "time_since_last_full_charge",
  "last_updated",
];

const CONNECTIVITY_KEYS: ColumnKey[] = [
  "truck_number", "powermon_serial", "powermon_device_name",
  // All three status columns appear together in any bundle that includes status.
  "operational_status", "connection_status", "activity_status",
  "signal_rssi",
  "sim_carrier", "sim_msisdn", "sim_data_used_mb", "sim_data_limit_mb",
  "hardware_revision", "firmware_version",
  "last_seen", "last_reported",
];

const FULL_KEYS: ColumnKey[] = Object.keys(EXPORT_COLUMNS) as ColumnKey[];

export const EXPORT_BUNDLES: Record<BundleKey, ExportBundle> = {
  default: {
    key: "default",
    label: "Default",
    description: "Operational snapshot with the 30 columns shown by default on the dashboard.",
    columnKeys: DEFAULT_KEYS,
  },
  operations: {
    key: "operations",
    label: "Operations",
    description: "Driver, activity, location, idle hours, savings, and active alerts.",
    columnKeys: OPERATIONS_KEYS,
  },
  battery_health: {
    key: "battery_health",
    label: "Battery Health",
    description: "Voltages, SOC, temperature, energy, charge, plus lifetime min/max statistics.",
    columnKeys: BATTERY_HEALTH_KEYS,
  },
  connectivity: {
    key: "connectivity",
    label: "Connectivity & SIM",
    description: "PowerMon connectivity and SIM details — carrier, MSISDN, data usage, and signal.",
    columnKeys: CONNECTIVITY_KEYS,
  },
  full: {
    key: "full",
    label: "Full Export",
    description: "Every available column — fleet, identity, live, lifetime, SIM, and hardware.",
    columnKeys: FULL_KEYS,
  },
};

export const BUNDLE_KEYS: BundleKey[] = ["default", "operations", "battery_health", "connectivity", "full"];

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a final ordered column list from a bundle plus optional include/exclude
 * overrides. Order: bundle order, then any extra `includeColumns` appended in the
 * order they appear in the registry. Duplicates removed; unknown keys silently
 * dropped (the storage layer is the validation boundary).
 */
export function resolveColumns(
  bundleKey: BundleKey,
  includeColumns?: string[],
  excludeColumns?: string[],
): ColumnKey[] {
  const bundle = EXPORT_BUNDLES[bundleKey];
  const includeSet = new Set<ColumnKey>(
    (includeColumns ?? []).filter(isColumnKey),
  );
  const excludeSet = new Set<ColumnKey>(
    (excludeColumns ?? []).filter(isColumnKey),
  );

  // Start with bundle, then add explicit includes that aren't already there
  // (in registry order so the shape is predictable). Bundle keys are typed
  // loosely as `string[]` for ergonomic authoring; we re-validate here.
  const seen = new Set<ColumnKey>();
  const out: ColumnKey[] = [];
  for (const rawKey of bundle.columnKeys) {
    if (!isColumnKey(rawKey)) continue;
    if (excludeSet.has(rawKey)) continue;
    if (seen.has(rawKey)) continue;
    seen.add(rawKey);
    out.push(rawKey);
  }
  for (const key of FULL_KEYS) {
    if (!includeSet.has(key)) continue;
    if (excludeSet.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * True when any resolved column requires data joined from `device_statistics`.
 * Used by the storage layer to skip an extra round-trip when not needed.
 */
export function bundleNeedsStatistics(columnKeys: ColumnKey[]): boolean {
  return columnKeys.some((k) => EXPORT_COLUMNS[k].source === "deviceStatistics");
}

/**
 * True when any resolved column requires data joined from `sims`.
 */
export function bundleNeedsSims(columnKeys: ColumnKey[]): boolean {
  return columnKeys.some((k) => EXPORT_COLUMNS[k].source === "sim");
}
