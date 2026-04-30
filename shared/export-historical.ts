/**
 * Fleet Export — Historical (Time-Series) Column Registries & Helpers
 *
 * Companion to `shared/export-columns.ts`. Snapshot exports describe trucks at
 * a single point in time; historical exports describe ONE truck across a date
 * range, bucketed by `HistoricalGranularity`.
 *
 * Two registries live here:
 *
 *   - HISTORICAL_TIMESERIES_COLUMNS — used for "minute" and "hour" granularity.
 *     Each row is one bucket of averaged readings.
 *
 *   - HISTORICAL_DAILY_COLUMNS — used for "day" granularity. Each row is one
 *     calendar day with avg/min/max for the most-watched readings plus an
 *     alerts-raised count.
 *
 * Data-availability notes (intentional omissions from spec; documented so the
 * next iteration knows what's blocked vs. unimplemented):
 *
 *   - Historical lat/long is NOT included. `device_measurements` does not
 *     store position; only the truck's current location lives on `trucks`.
 *     Adding a per-bucket location column would be misleading (it would just
 *     be the truck's current location stamped on every row).
 *
 *   - Activity status (Driving / Idling / Parked) and the activity-minutes
 *     buckets are NOT included. Activity is derived from voltage AND vibration,
 *     and vibration history is not retained per measurement.
 *
 *   - Day savings is NOT included. The savings calculator runs against current
 *     state and per-org regional pricing — it does not produce per-day historical
 *     values yet.
 */

import { type ColumnFormat, type ColumnSource, type ExportColumn } from "./export-columns";

// ---------------------------------------------------------------------------
// Granularity
// ---------------------------------------------------------------------------

export type HistoricalGranularity = "minute" | "hour" | "day";

export const HISTORICAL_GRANULARITIES: HistoricalGranularity[] = ["minute", "hour", "day"];

export interface HistoricalGranularityMeta {
  key: HistoricalGranularity;
  label: string;
  /** Approximate seconds between rows (used for row-count estimates). */
  bucketSeconds: number;
  description: string;
}

export const HISTORICAL_GRANULARITY_META: Record<HistoricalGranularity, HistoricalGranularityMeta> = {
  minute: {
    key: "minute",
    label: "Per minute",
    bucketSeconds: 60,
    description: "One row per minute. Best for short windows (≤7 days).",
  },
  hour: {
    key: "hour",
    label: "Hourly",
    bucketSeconds: 60 * 60,
    description: "One row per hour. Good for week-to-month windows.",
  },
  day: {
    key: "day",
    label: "Daily",
    bucketSeconds: 24 * 60 * 60,
    description: "One row per calendar day with avg / min / max. Best for ranges over a month.",
  },
};

/**
 * Suggested default granularity given a window size in days.
 *  - ≤7 days  → per minute
 *  - ≤45 days → hourly
 *  - >45 days → daily
 */
export function defaultGranularityForRangeDays(rangeDays: number): HistoricalGranularity {
  if (rangeDays <= 7) return "minute";
  if (rangeDays <= 45) return "hour";
  return "day";
}

// ---------------------------------------------------------------------------
// Column registries
// ---------------------------------------------------------------------------

/**
 * Time-series row keys. The serializer reads `HistoricalRow` by these keys
 * (see `server/services/exports/historical-cell-builder.ts`).
 */
export const HISTORICAL_TIMESERIES_COLUMNS = {
  truck_number:         { key: "truck_number",         label: "Truck Number",          source: "truck",    format: "text",        width: 14, group: "Identity" },
  fleet_name:           { key: "fleet_name",           label: "Fleet",                 source: "fleet",    format: "text",        width: 18, group: "Identity" },
  powermon_serial:      { key: "powermon_serial",      label: "PowerMon Serial",       source: "device",   format: "text",        width: 16, group: "Identity" },
  bucket_timestamp:     { key: "bucket_timestamp",     label: "Timestamp",             source: "derived",  format: "datetime",    width: 22, group: "Time" },
  voltage1:             { key: "voltage1",             label: "Voltage 1 (Chassis)",   source: "snapshot", format: "voltage",     width: 16, group: "Readings" },
  voltage2:             { key: "voltage2",             label: "Voltage 2 (Sleeper)",   source: "snapshot", format: "voltage",     width: 16, group: "Readings" },
  current:              { key: "current",              label: "Current (A)",           source: "snapshot", format: "number",      width: 12, group: "Readings" },
  power:                { key: "power",                label: "Power (W)",             source: "snapshot", format: "wattage",     width: 12, group: "Readings" },
  soc:                  { key: "soc",                  label: "SOC (%)",               source: "snapshot", format: "percent",     width: 10, group: "Readings" },
  temperature_f:        { key: "temperature_f",        label: "Temperature (°F)",      source: "derived",  format: "temperature_f", width: 14, group: "Readings" },
  energy_remaining_kwh: { key: "energy_remaining_kwh", label: "Energy Remaining (kWh)", source: "derived", format: "kwh",         width: 18, group: "Readings" },
  charge:               { key: "charge",               label: "Charge (Ah)",           source: "snapshot", format: "amp_hours",   width: 12, group: "Readings" },
  signal_rssi:          { key: "signal_rssi",          label: "Signal RSSI",           source: "snapshot", format: "integer",     width: 10, group: "Connectivity" },
  power_status:         { key: "power_status",         label: "Power Status",          source: "snapshot", format: "text",        width: 14, group: "Connectivity" },
} as const satisfies Record<string, ExportColumn>;

export type HistoricalTimeseriesColumnKey = keyof typeof HISTORICAL_TIMESERIES_COLUMNS;

export const HISTORICAL_TIMESERIES_COLUMN_LIST: ExportColumn[] = Object.values(
  HISTORICAL_TIMESERIES_COLUMNS,
) as ExportColumn[];

/**
 * Daily row keys — wider set with avg/min/max for the most-watched readings
 * and an alerts-raised count joined from `alerts`.
 */
export const HISTORICAL_DAILY_COLUMNS = {
  truck_number:         { key: "truck_number",         label: "Truck Number",          source: "truck",    format: "text",        width: 14, group: "Identity" },
  fleet_name:           { key: "fleet_name",           label: "Fleet",                 source: "fleet",    format: "text",        width: 18, group: "Identity" },
  powermon_serial:      { key: "powermon_serial",      label: "PowerMon Serial",       source: "device",   format: "text",        width: 16, group: "Identity" },
  bucket_date:          { key: "bucket_date",          label: "Date",                  source: "derived",  format: "date",        width: 14, group: "Time" },

  avg_soc:              { key: "avg_soc",              label: "Avg SOC (%)",           source: "snapshot", format: "percent",     width: 12, group: "SOC" },
  min_soc:              { key: "min_soc",              label: "Min SOC (%)",           source: "snapshot", format: "percent",     width: 12, group: "SOC" },
  max_soc:              { key: "max_soc",              label: "Max SOC (%)",           source: "snapshot", format: "percent",     width: 12, group: "SOC" },

  avg_voltage1:         { key: "avg_voltage1",         label: "Avg Voltage 1",         source: "snapshot", format: "voltage",     width: 14, group: "Voltage 1" },
  min_voltage1:         { key: "min_voltage1",         label: "Min Voltage 1",         source: "snapshot", format: "voltage",     width: 14, group: "Voltage 1" },
  max_voltage1:         { key: "max_voltage1",         label: "Max Voltage 1",         source: "snapshot", format: "voltage",     width: 14, group: "Voltage 1" },

  avg_voltage2:         { key: "avg_voltage2",         label: "Avg Voltage 2",         source: "snapshot", format: "voltage",     width: 14, group: "Voltage 2" },
  min_voltage2:         { key: "min_voltage2",         label: "Min Voltage 2",         source: "snapshot", format: "voltage",     width: 14, group: "Voltage 2" },
  max_voltage2:         { key: "max_voltage2",         label: "Max Voltage 2",         source: "snapshot", format: "voltage",     width: 14, group: "Voltage 2" },

  avg_temperature_f:    { key: "avg_temperature_f",    label: "Avg Temperature (°F)",  source: "derived",  format: "temperature_f", width: 18, group: "Temperature" },
  min_temperature_f:    { key: "min_temperature_f",    label: "Min Temperature (°F)",  source: "derived",  format: "temperature_f", width: 18, group: "Temperature" },
  max_temperature_f:    { key: "max_temperature_f",    label: "Max Temperature (°F)",  source: "derived",  format: "temperature_f", width: 18, group: "Temperature" },

  energy_throughput_kwh:{ key: "energy_throughput_kwh",label: "Energy Throughput (kWh)", source: "derived", format: "kwh",        width: 20, group: "Energy" },
  alerts_raised:        { key: "alerts_raised",        label: "Alerts Raised",         source: "alertCount", format: "integer",   width: 12, group: "Health" },
} as const satisfies Record<string, ExportColumn>;

export type HistoricalDailyColumnKey = keyof typeof HISTORICAL_DAILY_COLUMNS;

export const HISTORICAL_DAILY_COLUMN_LIST: ExportColumn[] = Object.values(
  HISTORICAL_DAILY_COLUMNS,
) as ExportColumn[];

/** Union of every historical column key. */
export type HistoricalColumnKey = HistoricalTimeseriesColumnKey | HistoricalDailyColumnKey;

/**
 * Resolve the ordered column list for a given granularity. There is no
 * include/exclude override for historical exports yet — all columns are
 * always emitted. (Customization can be added later by the same dialog.)
 */
export function resolveHistoricalColumns(granularity: HistoricalGranularity): {
  columnList: ExportColumn[];
  columnKeys: HistoricalColumnKey[];
} {
  if (granularity === "day") {
    return {
      columnList: HISTORICAL_DAILY_COLUMN_LIST,
      columnKeys: HISTORICAL_DAILY_COLUMN_LIST.map((c) => c.key as HistoricalColumnKey),
    };
  }
  return {
    columnList: HISTORICAL_TIMESERIES_COLUMN_LIST,
    columnKeys: HISTORICAL_TIMESERIES_COLUMN_LIST.map((c) => c.key as HistoricalColumnKey),
  };
}

/** Look up a column's display metadata across both registries. */
export function getHistoricalColumn(key: HistoricalColumnKey): ExportColumn | undefined {
  return (
    (HISTORICAL_TIMESERIES_COLUMNS as Record<string, ExportColumn>)[key] ??
    (HISTORICAL_DAILY_COLUMNS as Record<string, ExportColumn>)[key]
  );
}

// ---------------------------------------------------------------------------
// Estimator + caps
// ---------------------------------------------------------------------------

export const HISTORICAL_MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
export const HISTORICAL_MAX_ROWS = 200_000; // hard cap; the dialog also warns earlier

export interface HistoricalEstimateInput {
  startMs: number;
  endMs: number;
  granularity: HistoricalGranularity;
}

export interface HistoricalEstimate {
  /** Upper-bound row count (assumes one row per bucket; actual ≤ this). */
  rowCount: number;
  /** Rough byte estimate based on a typical CSV row width. */
  approxBytes: number;
  /** True when row count exceeds `HISTORICAL_MAX_ROWS`. */
  exceedsMaxRows: boolean;
}

const APPROX_BYTES_PER_ROW: Record<HistoricalGranularity, number> = {
  // Per-minute / hourly: ~14 columns × ~12 chars + separators
  minute: 200,
  hour: 200,
  // Daily: ~18 columns × ~12 chars + separators
  day: 280,
};

/**
 * Upper-bound estimate. Used by the dialog for "≈ N rows / ≈ M MB" copy and
 * by the API as a sanity guard before enqueueing a job.
 */
export function estimateHistoricalRows(input: HistoricalEstimateInput): HistoricalEstimate {
  const durationMs = Math.max(0, input.endMs - input.startMs);
  const meta = HISTORICAL_GRANULARITY_META[input.granularity];
  const rowCount = Math.max(0, Math.ceil(durationMs / 1000 / meta.bucketSeconds));
  const approxBytes = rowCount * APPROX_BYTES_PER_ROW[input.granularity];
  return {
    rowCount,
    approxBytes,
    exceedsMaxRows: rowCount > HISTORICAL_MAX_ROWS,
  };
}

/** Type guard for granularity strings coming from the wire. */
export function isHistoricalGranularity(v: unknown): v is HistoricalGranularity {
  return v === "minute" || v === "hour" || v === "day";
}

// Re-export the shared format types so historical-only callers don't have to
// reach into export-columns just for ColumnFormat.
export type { ColumnFormat, ColumnSource, ExportColumn };
