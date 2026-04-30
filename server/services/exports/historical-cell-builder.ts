/**
 * Historical (single-truck time-series) cell builder.
 *
 * Mirrors `cell-builder.ts` but for `HistoricalExportRow`. Returns a
 * `RawCellValue` (string | number | Date | null); the serializer formats
 * according to the column's `format` field.
 */

import {
  type HistoricalColumnKey,
  type HistoricalGranularity,
} from "@shared/export-historical";
import type { RawCellValue } from "./cell-builder";
import type { HistoricalExportRow } from "./types";

const C_TO_F = (c: number | null | undefined): number | null =>
  c === null || c === undefined || !Number.isFinite(c) ? null : c * 9 / 5 + 32;

const WH_TO_KWH = (wh: number | null | undefined): number | null =>
  wh === null || wh === undefined || !Number.isFinite(wh) ? null : wh / 1000;

export function extractHistoricalCell(
  row: HistoricalExportRow,
  columnKey: HistoricalColumnKey,
  _granularity: HistoricalGranularity,
): RawCellValue {
  switch (columnKey) {
    // Identity
    case "truck_number":     return row.truckNumber ?? null;
    case "fleet_name":       return row.fleetName ?? null;
    case "powermon_serial":  return row.powerMonSerial ?? null;

    // Time bucket
    case "bucket_timestamp": return row.bucket ?? null;
    case "bucket_date":      return row.bucket ?? null;

    // Time-series readings (per-minute / hourly use these directly)
    case "voltage1":             return row.voltage1;
    case "voltage2":             return row.voltage2;
    case "current":              return row.current;
    case "power":                return row.power;
    case "soc":                  return row.soc;
    case "temperature_f":        return C_TO_F(row.temperatureC);
    case "energy_remaining_kwh": return WH_TO_KWH(row.energyWh);
    case "charge":               return row.charge;
    case "signal_rssi":          return row.rssi;
    case "power_status":         return row.powerStatus;
    case "is_parked":            return row.isParked === null ? null : row.isParked ? "Yes" : "No";
    case "latitude":             return row.latitude;
    case "longitude":            return row.longitude;

    // Daily aggregates
    case "avg_soc":               return row.soc;
    case "min_soc":               return row.minSoc;
    case "max_soc":               return row.maxSoc;
    case "avg_voltage1":          return row.voltage1;
    case "min_voltage1":          return row.minVoltage1;
    case "max_voltage1":          return row.maxVoltage1;
    case "avg_voltage2":          return row.voltage2;
    case "min_voltage2":          return row.minVoltage2;
    case "max_voltage2":          return row.maxVoltage2;
    case "avg_temperature_f":     return C_TO_F(row.temperatureC);
    case "min_temperature_f":     return C_TO_F(row.minTemperatureC);
    case "max_temperature_f":     return C_TO_F(row.maxTemperatureC);
    case "energy_throughput_kwh": return WH_TO_KWH(row.energyThroughputWh);
    case "total_energy_in_wh":    return row.totalEnergyInWh;
    case "total_energy_out_wh":   return row.totalEnergyOutWh;
    case "drive_minutes":         return row.driveMinutes;
    case "idle_minutes":          return row.idleMinutes;
    case "parked_minutes":        return row.parkedMinutes;
    case "day_savings":           return row.daySavings;
    case "end_latitude":          return row.endLatitude;
    case "end_longitude":         return row.endLongitude;
    case "alerts_raised":         return row.alertsRaised;

    default:
      return null;
  }
}
