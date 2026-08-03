/**
 * Computes the "View on Screen" aggregate summary from the same
 * `HistoricalExportRow[]` the CSV/Excel historical export uses — see
 * `historical-generator.ts` for the file-writing counterpart. No file I/O,
 * no job queue; this is a plain in-memory reduction over rows already
 * fetched by `storage.getHistoricalMeasurements`.
 */

import type { HistoricalGranularity, HistoricalMetricSummary, HistoricalSummary } from "@shared/export-historical";
import type { HistoricalExportRow } from "./types";

const C_TO_F = (c: number | null | undefined): number | null =>
  c === null || c === undefined || !Number.isFinite(c) ? null : (c * 9) / 5 + 32;

const WH_TO_KWH = (wh: number | null | undefined): number | null =>
  wh === null || wh === undefined || !Number.isFinite(wh) ? null : wh / 1000;

/**
 * Reduces one reading across all rows. When `minKey`/`maxKey` are given and
 * populated (day-granularity rows only), uses the true daily min/max;
 * otherwise falls back to the min/max of the per-bucket average — the same
 * limitation the file export has for fields with no dedicated min/max column.
 */
function reduceMetric(
  rows: HistoricalExportRow[],
  avgKey: keyof HistoricalExportRow,
  minKey?: keyof HistoricalExportRow,
  maxKey?: keyof HistoricalExportRow,
): HistoricalMetricSummary {
  let sum = 0;
  let count = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const row of rows) {
    const avgVal = row[avgKey] as number | null;
    if (avgVal !== null && Number.isFinite(avgVal)) {
      sum += avgVal;
      count++;
    }
    const minVal = (minKey ? (row[minKey] as number | null) : null) ?? avgVal;
    const maxVal = (maxKey ? (row[maxKey] as number | null) : null) ?? avgVal;
    if (minVal !== null && Number.isFinite(minVal) && minVal < min) min = minVal;
    if (maxVal !== null && Number.isFinite(maxVal) && maxVal > max) max = maxVal;
  }

  return {
    avg: count > 0 ? sum / count : null,
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
  };
}

export function computeHistoricalSummary(
  rows: HistoricalExportRow[],
  dayRowsForEnergy: HistoricalExportRow[],
  opts: { startTime: Date; endTime: Date; granularity: HistoricalGranularity },
): HistoricalSummary {
  const soc = reduceMetric(rows, "soc", "minSoc", "maxSoc");
  const voltage1 = reduceMetric(rows, "voltage1", "minVoltage1", "maxVoltage1");
  const voltage2 = reduceMetric(rows, "voltage2", "minVoltage2", "maxVoltage2");
  const current = reduceMetric(rows, "current");
  const power = reduceMetric(rows, "power");
  const temperatureC = reduceMetric(rows, "temperatureC", "minTemperatureC", "maxTemperatureC");

  const firstWithSoc = rows.find((row) => row.soc !== null);
  const lastWithSoc = [...rows].reverse().find((row) => row.soc !== null);

  let kwhSum = 0;
  let kwhCount = 0;
  for (const row of dayRowsForEnergy) {
    if (row.energyThroughputWh !== null && Number.isFinite(row.energyThroughputWh)) {
      kwhSum += row.energyThroughputWh;
      kwhCount++;
    }
  }

  return {
    startTime: opts.startTime.toISOString(),
    endTime: opts.endTime.toISOString(),
    granularity: opts.granularity,
    dataPoints: rows.length,
    soc: {
      ...soc,
      start: firstWithSoc?.soc ?? null,
      end: lastWithSoc?.soc ?? null,
    },
    voltage1,
    voltage2: voltage2.avg !== null ? voltage2 : null,
    current,
    power,
    temperatureF: temperatureC.avg !== null
      ? { avg: C_TO_F(temperatureC.avg), min: C_TO_F(temperatureC.min), max: C_TO_F(temperatureC.max) }
      : null,
    totalKwh: kwhCount > 0 ? WH_TO_KWH(kwhSum) : null,
  };
}
