/**
 * Internal types for the export pipeline.
 * The storage layer hydrates `TruckExportRow` per truck; the serializer pulls
 * rendered values out of `ExportCellValues` keyed by `ColumnKey`.
 */
import type {
  Truck, PowerMonDevice, DeviceSnapshot, DeviceStatistics, Sim, ShellySnapshot,
} from "@shared/schema";
import type { BundleKey, ColumnKey } from "@shared/export-columns";
import type { HistoricalColumnKey, HistoricalGranularity } from "@shared/export-historical";
import type { AdminDeviceColumnKey } from "@shared/export-admin-devices";

/**
 * One row of joined data, batched by the storage layer to avoid N+1.
 * `fleetName` is denormalized in for convenience.
 */
export interface TruckExportRow {
  truck: Truck;
  fleetName: string;
  device?: PowerMonDevice;
  snapshot?: DeviceSnapshot;
  shellySnapshot?: ShellySnapshot;
  deviceStatistics?: DeviceStatistics;
  sim?: Sim;
  activeAlertCount: number;
}

/** Filters that can be applied at the storage layer when collecting rows. */
export interface ExportFilters {
  /** Optional fleet scope (matches the dashboard fleet selector). */
  fleetId?: number;
  /** Operational status filter — must match `trucks.status` literal values. */
  operationalStatus?: "in-service" | "not-in-service";
  /** Free-text search over truck number / driver / serial. Case-insensitive. */
  searchQuery?: string;
}

/** Subset of IStorage that `generateExport` actually needs. */
export interface ExportStorage {
  getTrucksForExport(
    organizationId: number,
    options: {
      fleetId?: number;
      operationalStatus?: "in-service" | "not-in-service";
      searchQuery?: string;
      includeStatistics?: boolean;
      includeSims?: boolean;
    },
  ): Promise<TruckExportRow[]>;
}

/** Inputs for the public `generateExport` entry point. */
export interface GenerateExportInput {
  organizationId: number;
  bundleKey: BundleKey;
  format: "csv" | "xlsx";
  filters?: ExportFilters;
  /** Add columns on top of the bundle. Unknown keys silently dropped. */
  includeColumns?: string[];
  /** Remove columns from the bundle. Unknown keys silently dropped. */
  excludeColumns?: string[];
  /**
   * Pre-computed savings keyed by truckId. If omitted, the entry point computes
   * savings itself via `SavingsCalculator`. Provided primarily for tests.
   */
  savingsByTruckId?: Map<number, { todaySavings: number; mtdSavings: number }>;
  /**
   * Storage implementation override. Defaults to the singleton `storage` from
   * `server/storage`. Provided so tests (and the eventual async worker, if it
   * wants its own connection pool) can swap in a different implementation
   * without monkey-patching the module.
   */
  storage?: ExportStorage;
}

export interface GeneratedExport {
  buffer: Buffer;
  filename: string;
  contentType: string;
  /** File extension without leading dot — `"csv"` or `"xlsx"`. */
  mimeExtension: "csv" | "xlsx";
  rowCount: number;
  /**
   * The actual ordered list of column keys used. Snapshot exports return
   * `ColumnKey[]`; historical exports return `HistoricalColumnKey[]`. Both
   * are stable strings — downstream uses `.length` for the column-count
   * stat on the job record.
   */
  columnKeys: ColumnKey[] | HistoricalColumnKey[] | AdminDeviceColumnKey[];
  /**
   * Identity metadata for the row's subject — set only by the historical
   * generator. The worker passes this into the completion email so the
   * recipient can identify the truck without opening the file.
   */
  historicalMeta?: {
    truckNumber: string;
    fleetName: string | null;
  };
}

// ---------------------------------------------------------------------------
// Historical (single-truck time-series) export types
// ---------------------------------------------------------------------------

/**
 * A single bucket of aggregated `device_measurements` for the historical
 * export. The storage layer fills the identity columns (truck/fleet/device)
 * once and repeats them on every row — small price for a flat shape that the
 * cell-builder can read by key.
 */
export interface HistoricalExportRow {
  /** Bucket start timestamp (truncated to minute / hour / day boundary). */
  bucket: Date;
  truckNumber: string;
  fleetName: string | null;
  powerMonSerial: string | null;

  // Time-series & daily-average readings (averages of underlying samples)
  voltage1: number | null;
  voltage2: number | null;
  current: number | null;
  power: number | null;
  soc: number | null;
  /** Average ambient temperature in Celsius (converted to °F at render). */
  temperatureC: number | null;
  /** Average remaining energy in Wh (converted to kWh at render). */
  energyWh: number | null;
  charge: number | null;
  rssi: number | null;
  /** Last non-null power_status_string in the bucket; falls back to integer. */
  powerStatus: string | null;

  /** Snapshot/derived parked flag for the bucket. Null when not derivable. */
  isParked: boolean | null;
  /** Truck position for the bucket. Null on per-min/hour rows (no history). */
  latitude: number | null;
  longitude: number | null;

  // Daily-only fields (null on per-minute / hourly rows)
  minSoc: number | null;
  maxSoc: number | null;
  minVoltage1: number | null;
  maxVoltage1: number | null;
  minVoltage2: number | null;
  maxVoltage2: number | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  /** Energy throughput across the day in Wh (converted to kWh at render). */
  energyThroughputWh: number | null;
  /** Sum of positive (charging) power × sample interval, in Wh. */
  totalEnergyInWh: number | null;
  /** Sum of negative (discharging) power magnitude × sample interval, in Wh. */
  totalEnergyOutWh: number | null;
  /** Activity minutes for the day (null when not derivable). */
  driveMinutes: number | null;
  idleMinutes: number | null;
  parkedMinutes: number | null;
  /** Day savings in USD (null when not derivable per-day). */
  daySavings: number | null;
  /** End-of-day position (null when not derivable). */
  endLatitude: number | null;
  endLongitude: number | null;
  /** Count of alerts whose `created_at` fell inside the bucket. */
  alertsRaised: number | null;
}

export interface HistoricalQueryOptions {
  organizationId: number;
  truckId: number;
  startTime: Date;
  endTime: Date;
  granularity: HistoricalGranularity;
}

export interface HistoricalQueryResult {
  rows: HistoricalExportRow[];
  truck: { id: number; truckNumber: string };
  fleetName: string | null;
  powerMonSerial: string | null;
}

export interface GenerateHistoricalExportInput {
  organizationId: number;
  truckId: number;
  startTime: Date;
  endTime: Date;
  granularity: HistoricalGranularity;
  format: "csv" | "xlsx";
  /** Storage override for tests. Defaults to the singleton. */
  storage?: HistoricalExportStorage;
}

export interface HistoricalExportStorage {
  getHistoricalMeasurements(opts: HistoricalQueryOptions): Promise<HistoricalQueryResult>;
}
