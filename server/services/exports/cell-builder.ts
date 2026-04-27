/**
 * Per-row, per-column cell value extraction. Centralized here so CSV and Excel
 * serializers operate on identical raw data — they only differ in how they
 * format that data into bytes.
 *
 * Activity Status uses `determineTruckStatus` from `@shared/truck-status` so the
 * dashboard table and the export agree byte-for-byte.
 */

import {
  determineTruckStatus,
  type TruckStatusLabel,
} from "@shared/truck-status";
import type { ColumnKey } from "@shared/export-columns";
import type { TruckExportRow } from "./types";

/** Raw cell payload — typed as the union the serializers expect. */
export type RawCellValue = string | number | Date | null;

/** Per-column extractor returning the raw value (not yet formatted). */
type Extractor = (row: TruckExportRow, ctx: ExtractionContext) => RawCellValue;

export interface ExtractionContext {
  /** Per-truck savings, computed once and reused for both Today/Month columns. */
  savings: Map<number, { todaySavings: number; mtdSavings: number }>;
  /** Resolution time used for any "now"-relative computations. */
  now: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function celsiusToFahrenheit(c: number | null | undefined): number | null {
  if (c === null || c === undefined) return null;
  return (c * 9) / 5 + 32;
}

function formatLocation(
  lat: number | null | undefined,
  lng: number | null | undefined,
  description: string | null | undefined,
): string | null {
  if (description && description.trim().length > 0) return description;
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

function operationalStatusLabel(status: string | null | undefined): string {
  if (status === "in-service") return "In Service";
  if (status === "not-in-service") return "Not In Service";
  return status ?? "Unknown";
}

function connectionStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  // values: online / offline / unstable
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function activityStatus(row: TruckExportRow, now: Date): TruckStatusLabel | null {
  if (!row.snapshot && !row.shellySnapshot) return null;
  const chassisVoltage = row.snapshot?.voltage2 ?? 0;
  const hasShellyData = !!row.shellySnapshot;
  const isMoving = row.shellySnapshot?.isMoving ?? false;
  const lastMovementAt = row.shellySnapshot?.lastMovementAt
    ? new Date(row.shellySnapshot.lastMovementAt)
    : null;
  const result = determineTruckStatus({
    chassisVoltage,
    hasShellyData,
    isMoving,
    lastMovementAt,
    now,
  });
  return result.statusLabel;
}

function energyRemainingKwh(row: TruckExportRow): number | null {
  if (!row.device || !row.snapshot) return null;
  const v = row.device.batteryVoltage ?? 25.6;
  const ah = row.device.batteryAh ?? 200;
  const n = row.device.numberOfBatteries ?? 2;
  const soc = row.snapshot.soc ?? 0;
  return ((v * ah) * n) * (soc / 100) / 1000;
}

// ---------------------------------------------------------------------------
// Extractor table
// ---------------------------------------------------------------------------

const EXTRACTORS: Record<ColumnKey, Extractor> = {
  // Identity
  truck_number:        (r) => r.truck.truckNumber,
  fleet_name:          (r) => r.fleetName,
  driver_name:         (r) => r.truck.driverName ?? null,
  powermon_serial:     (r) => r.device?.serialNumber ?? null,
  powermon_device_name:(r) => r.device?.deviceName ?? null,

  // Status
  operational_status:  (r) => operationalStatusLabel(r.truck.status),
  connection_status:   (r) => connectionStatusLabel(r.device?.connectionStatus),
  activity_status:     (r, ctx) => activityStatus(r, ctx.now),

  // Location
  address:             (r) => formatLocation(r.truck.latitude, r.truck.longitude, r.truck.locationDescription),
  latitude:            (r) => r.truck.latitude ?? null,
  longitude:           (r) => r.truck.longitude ?? null,
  last_location_update:(r) => r.truck.lastLocationUpdate ? new Date(r.truck.lastLocationUpdate) : null,

  // Live readings
  voltage1:            (r) => r.snapshot?.voltage1 ?? null,
  voltage2:            (r) => r.snapshot?.voltage2 ?? null,
  soc:                 (r) => r.snapshot?.soc ?? null,
  power:               (r) => r.snapshot?.power ?? null,
  temperature_f:       (r) => celsiusToFahrenheit(r.snapshot?.temperature ?? null),
  energy_remaining_kwh:(r) => energyRemainingKwh(r),
  charge:              (r) => r.snapshot?.charge ?? null,

  // Battery configuration
  battery_voltage:     (r) => r.device?.batteryVoltage ?? null,
  battery_ah:          (r) => r.device?.batteryAh ?? null,
  number_of_batteries: (r) => r.device?.numberOfBatteries ?? null,

  // Idle / savings
  today_idle_hours:    (r) => {
    const m = r.snapshot?.todayParkedMinutes ?? null;
    return m === null ? null : m / 60;
  },
  month_idle_hours:    (r) => {
    const today = r.snapshot?.todayParkedMinutes ?? 0;
    const completed = r.snapshot?.monthParkedMinutes ?? null;
    if (completed === null && (r.snapshot?.todayParkedMinutes ?? null) === null) return null;
    return ((completed ?? 0) + today) / 60;
  },
  today_savings:       (r, ctx) => ctx.savings.get(r.truck.id)?.todaySavings ?? 0,
  month_savings:       (r, ctx) => ctx.savings.get(r.truck.id)?.mtdSavings ?? 0,

  // Health & timestamps
  active_alerts:       (r) => r.activeAlertCount,
  last_updated:        (r) => {
    const ts = r.snapshot?.updatedAt ?? r.snapshot?.recordedAt ?? null;
    return ts ? new Date(ts) : null;
  },
  last_reported:       (r) => r.device?.lastReportedAt ? new Date(r.device.lastReportedAt) : null,
  last_seen:           (r) => r.device?.lastSeenAt ? new Date(r.device.lastSeenAt) : null,

  // Lifetime stats
  total_discharge_energy: (r) => r.deviceStatistics?.totalDischargeEnergy ?? null,
  total_charge_energy:    (r) => r.deviceStatistics?.totalChargeEnergy ?? null,
  min_voltage_ever:       (r) => r.deviceStatistics?.minVoltage ?? null,
  max_voltage_ever:       (r) => r.deviceStatistics?.maxVoltage ?? null,
  min_temperature_ever:   (r) => celsiusToFahrenheit(r.deviceStatistics?.temperatureMin ?? null),
  max_temperature_ever:   (r) => celsiusToFahrenheit(r.deviceStatistics?.temperatureMax ?? null),
  deepest_discharge:      (r) => r.deviceStatistics?.deepestDischarge ?? null,
  time_since_last_full_charge: (r) => {
    // stored as integer (seconds, per existing convention)
    const seconds = r.deviceStatistics?.timeSinceLastFullCharge ?? null;
    return seconds === null ? null : seconds / 3600;
  },

  // SIM
  sim_carrier:         (r) => r.sim?.carrier ?? r.sim?.networkName ?? null,
  sim_msisdn:          (r) => r.sim?.msisdn ?? null,
  sim_data_used_mb:    (r) => r.sim?.dataUsedMb ?? null,
  sim_data_limit_mb:   (r) => r.sim?.dataLimitMb ?? null,
  signal_rssi:         (r) => r.snapshot?.rssi ?? null,

  // Hardware
  hardware_revision:   (r) => r.device?.hardwareRevision ?? null,
  firmware_version:    (r) => r.device?.firmwareVersion ?? null,
};

/** Extract one cell. Centralised so CSV and Excel serializers stay in lockstep. */
export function extractCell(
  row: TruckExportRow,
  columnKey: ColumnKey,
  ctx: ExtractionContext,
): RawCellValue {
  return EXTRACTORS[columnKey](row, ctx);
}
