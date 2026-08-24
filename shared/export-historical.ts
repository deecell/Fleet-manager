/**
 * Fleet Export — Historical (Time-Series) Column Registries & Helpers
 *
 * Companion to `shared/export-columns.ts`. Snapshot exports describe trucks
 * at a single point in time; historical exports describe ONE truck across a
 * date range, bucketed by `HistoricalGranularity`.
 *
 *   - HISTORICAL_TIMESERIES_COLUMNS — "minute" / "hour" granularity, one row
 *     per bucket of averaged readings.
 *   - HISTORICAL_DAILY_COLUMNS — "day" granularity, one row per calendar day
 *     with avg/min/max + derived energy in/out, activity minutes, day
 *     savings, alerts-raised.
 *
 * Data-source notes (see `server/db-storage.ts:getHistoricalMeasurements`):
 *   - lat/long + end_lat/lng: from `sim_location_history` (DISTINCT ON →
 *     last point per bucket); null when no SIM update in the window.
 *   - is_parked / parked_minutes / drive_minutes: chassis voltage
 *     (voltage2 < 13.0 V or NULL → parked), matching device-manager's
 *     PARKED_VOLTAGE_THRESHOLD. idle_minutes is always null (no idle state).
 *   - day_savings: canonical savings-calculator.ts formula
 *     (parked_minutes / 60) × 1.2 gal/hr × fuel_price. 0 when no parked time.
 *   - Total energy in/out (Wh): SUM(±power) × 10 s / 3600 (PowerMon poll rate).
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
    description: "One row per hour. Good for week-to-quarter windows.",
  },
  day: {
    key: "day",
    label: "Daily",
    bucketSeconds: 24 * 60 * 60,
    description: "One row per calendar day with avg / min / max. Best for ranges over a quarter.",
  },
};

/**
 * Suggested default granularity given a window size in days.
 *  - ≤7 days  → per minute
 *  - ≤90 days → hourly
 *  - >90 days → daily
 */
export function defaultGranularityForRangeDays(rangeDays: number): HistoricalGranularity {
  if (rangeDays <= 7) return "minute";
  if (rangeDays <= 90) return "hour";
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
  is_parked:            { key: "is_parked",            label: "Parked",                source: "snapshot", format: "text",        width: 10, group: "Activity" },
  latitude:             { key: "latitude",             label: "Latitude",              source: "truck",    format: "number",      width: 12, group: "Location" },
  longitude:            { key: "longitude",            label: "Longitude",             source: "truck",    format: "number",      width: 12, group: "Location" },
} as const satisfies Record<string, ExportColumn>;

export type HistoricalTimeseriesColumnKey = keyof typeof HISTORICAL_TIMESERIES_COLUMNS;

export const HISTORICAL_TIMESERIES_COLUMN_LIST: ExportColumn[] = Object.values(
  HISTORICAL_TIMESERIES_COLUMNS,
) as ExportColumn[];

/**
 * Daily row keys — wider set with avg/min/max for the most-watched readings,
 * derived energy in/out, activity minutes, day savings, end-of-day position,
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
  total_energy_in_wh:   { key: "total_energy_in_wh",   label: "Total Energy In (Wh)",  source: "derived",  format: "wh",          width: 18, group: "Energy" },
  total_energy_out_wh:  { key: "total_energy_out_wh",  label: "Total Energy Out (Wh)", source: "derived",  format: "wh",          width: 18, group: "Energy" },

  drive_minutes:        { key: "drive_minutes",        label: "Drive Minutes",         source: "derived",  format: "integer",     width: 14, group: "Activity" },
  idle_minutes:         { key: "idle_minutes",         label: "Idle Minutes",          source: "derived",  format: "integer",     width: 14, group: "Activity" },
  parked_minutes:       { key: "parked_minutes",       label: "Parked Minutes",        source: "derived",  format: "integer",     width: 14, group: "Activity" },

  day_savings:          { key: "day_savings",          label: "Day Savings",           source: "savings",  format: "currency",    width: 14, group: "Savings" },

  end_latitude:         { key: "end_latitude",         label: "End Latitude",          source: "truck",    format: "number",      width: 12, group: "Location" },
  end_longitude:        { key: "end_longitude",        label: "End Longitude",         source: "truck",    format: "number",      width: 12, group: "Location" },

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
/**
 * Hard row cap. Sized so a one-year per-minute export (525,600 rows) is
 * always permitted, with a small headroom for clock skew / DST overlap.
 */
export const HISTORICAL_MAX_ROWS = 600_000;

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
  // Per-minute / hourly: ~17 columns × ~12 chars + separators
  minute: 240,
  hour: 240,
  // Daily: ~28 columns × ~12 chars + separators
  day: 380,
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

// ---------------------------------------------------------------------------
// On-screen summary (View on Screen dialog option)
// ---------------------------------------------------------------------------

/**
 * Tighter per-granularity range caps for the synchronous "View on Screen"
 * summary endpoint ONLY. `HISTORICAL_MAX_ROWS` / `HISTORICAL_MAX_RANGE_MS`
 * above stay as-is for the async CSV/XLSX export (queued, runs in the job
 * worker, no ALB deadline). The summary endpoint has none of that headroom —
 * it must finish inside the load balancer's idle timeout — so it gets its
 * own, much shorter ranges, chosen to keep the underlying bucket count in
 * the tens of thousands rather than the hundreds of thousands.
 */
export const HISTORICAL_SYNC_MAX_RANGE_MS: Record<HistoricalGranularity, number> = {
  minute: 14 * 24 * 60 * 60 * 1000, // 14 days  → ≤ 20,160 buckets
  hour: 60 * 24 * 60 * 60 * 1000, // ~2 months → ≤ 1,440 buckets
  day: HISTORICAL_MAX_RANGE_MS, // 1 year, unchanged — already ≤ 365 buckets
};

/** True when a range exceeds the sync-only cap for the given granularity. */
export function exceedsHistoricalSyncRange(
  rangeMs: number,
  granularity: HistoricalGranularity,
): boolean {
  return rangeMs > HISTORICAL_SYNC_MAX_RANGE_MS[granularity];
}

/**
 * Avg/min/max for one reading over a date range. Min/max are exact when the
 * underlying rows carry true daily min/max columns (day granularity); at
 * minute/hour granularity they're the min/max of the per-bucket averages —
 * an approximation, same one the CSV/Excel export itself is limited to for
 * fields with no dedicated min/max column (current, power).
 */
export interface HistoricalMetricSummary {
  avg: number | null;
  min: number | null;
  max: number | null;
}

/**
 * On-screen aggregate summary for a truck's history over a date range —
 * the "View on Screen" alternative to downloading a CSV/Excel file. Computed
 * from the exact same `getHistoricalMeasurements` query the file export
 * uses, so these numbers always match what the file would contain.
 */
export interface HistoricalSummary {
  startTime: string;
  endTime: string;
  granularity: HistoricalGranularity;
  /** Number of buckets (rows) the query returned for this granularity. */
  dataPoints: number;
  soc: HistoricalMetricSummary & {
    /** SoC of the first bucket with a reading — net-change reference point. */
    start: number | null;
    /** SoC of the last bucket with a reading. */
    end: number | null;
  };
  voltage1: HistoricalMetricSummary;
  /** Null when the truck has no voltage2 (sleeper) readings in range. */
  voltage2: HistoricalMetricSummary | null;
  current: HistoricalMetricSummary;
  power: HistoricalMetricSummary;
  /** Null when no temperature readings exist in range. */
  temperatureF: HistoricalMetricSummary | null;
  /**
   * Total energy throughput in kWh across the full range, always computed
   * from day-level buckets internally regardless of the granularity chosen
   * for the other stats above — the day-only energy calculation is the only
   * one accurate enough to sum. Null when no day-level data exists in range.
   */
  totalKwh: number | null;
}

// Re-export the shared format types so historical-only callers don't have to
// reach into export-columns just for ColumnFormat.
export type { ColumnFormat, ColumnSource, ExportColumn };
