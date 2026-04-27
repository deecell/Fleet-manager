/**
 * Internal types for the export pipeline.
 * The storage layer hydrates `TruckExportRow` per truck; the serializer pulls
 * rendered values out of `ExportCellValues` keyed by `ColumnKey`.
 */
import type {
  Truck, PowerMonDevice, DeviceSnapshot, DeviceStatistics, Sim, ShellySnapshot,
} from "@shared/schema";
import type { BundleKey, ColumnKey } from "@shared/export-columns";

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
}

export interface GeneratedExport {
  buffer: Buffer;
  filename: string;
  contentType: string;
  /** File extension without leading dot — `"csv"` or `"xlsx"`. */
  mimeExtension: "csv" | "xlsx";
  rowCount: number;
  /** The actual ordered list of column keys used. */
  columnKeys: ColumnKey[];
}
