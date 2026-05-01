/**
 * Admin Devices Export — row shape returned by storage layer.
 *
 * The row is intentionally flat: every field maps to (or directly populates)
 * exactly one column in `shared/export-admin-devices.ts`. The cell builder
 * is the only thing that knows the column → field mapping.
 *
 * Anything that joins from a source that may be missing in dev (e.g. a
 * device without a SIM, a snapshot, or a device_sync_status row) is typed
 * `T | null` so the cell renderer can emit a blank cell.
 */

export interface AdminDeviceExportRow {
  // Keys (not exported, used for stable sort + debugging)
  deviceId: number;
  organizationId: number;

  // Identity
  organizationName: string;
  fleetName: string | null;
  truckNumber: string | null;
  serialNumber: string | null;
  deviceName: string | null;

  // Hardware
  hardwareRevision: string | null;
  firmwareVersion: string | null;
  buildDate: Date | null; // not stored; always null today

  // Connectivity
  hostId: string | null;       // PowerMon WiFi access key host id (acts as IP)
  credentialIsActive: boolean | null; // device_credentials.is_active
  iccid: string | null;
  imsi: string | null;
  msisdn: string | null;
  connectionStatus: string | null; // online / offline / unstable / no_power / connecting

  // Operations
  lastReportedAt: Date | null;
  lastSeenAt: Date | null;
  markedOfflineAt: Date | null;        // surfaces alongside circuit_breaker_state for triage

  // Worker / live
  workerCohort: number | null;         // device_sync_status.cohort_id
  soc: number | null;                  // device_snapshots.soc (%)
  voltage1: number | null;             // device_snapshots.voltage1 (V)
  rssi: number | null;                 // device_snapshots.rssi (dBm)
}

export interface GetAdminDevicesForExportFilters {
  /** Restrict to a single organization. */
  organizationId?: number | null;
  /** Case-insensitive substring match across device, sim, truck, org. */
  searchQuery?: string | null;
}
