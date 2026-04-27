/**
 * Public entry point for the Fleet export feature.
 *
 * This is the function the async export worker (next task) calls. It is also
 * what the existing legacy CSV route can be migrated to.
 *
 *   const result = await generateExport({
 *     organizationId,
 *     bundleKey: "default",
 *     format: "csv",
 *     filters: { searchQuery: "1234", operationalStatus: "in-service" },
 *   });
 *
 * Pure with respect to (orgId, filters, columnSelection, format) — given the
 * same database state and inputs, the same `{buffer, filename, contentType}`
 * comes out.
 */

import { format as formatDate } from "date-fns";
import {
  EXPORT_BUNDLES,
  bundleNeedsSims,
  bundleNeedsStatistics,
  resolveColumns,
  type ColumnKey,
} from "@shared/export-columns";
import { storage } from "../../storage";
import { savingsCalculator } from "../savings-calculator";
import { buildCsvBuffer } from "./csv-serializer";
import { buildExcelBuffer } from "./excel-serializer";
import type {
  ExportFilters,
  GenerateExportInput,
  GeneratedExport,
  TruckExportRow,
} from "./types";

// Allow letters, digits, hyphens, AND underscores in fragments — the bundle
// key fragment intentionally uses underscores (e.g. `battery_health`) per the
// documented filename pattern `fleet_<bundleKey>...`.
const FILENAME_SAFE = /[^a-z0-9_-]+/gi;

function sanitizeFilenameFragment(text: string, maxLen = 24): string {
  const cleaned = text.trim().toLowerCase().replace(FILENAME_SAFE, "-").replace(/^[-_]+|[-_]+$/g, "");
  return cleaned.slice(0, maxLen) || "all";
}

function buildFilename(
  bundleKey: string,
  filters: ExportFilters | undefined,
  ext: "csv" | "xlsx",
): string {
  // Bundle keys are statically defined and already filename-safe; passing them
  // through the sanitizer would still preserve underscores, but we use them as-
  // is to be unambiguous about the intent.
  const parts: string[] = ["fleet", bundleKey];
  if (filters?.operationalStatus) {
    parts.push(sanitizeFilenameFragment(filters.operationalStatus));
  }
  if (filters?.searchQuery && filters.searchQuery.trim().length > 0) {
    parts.push(`search-${sanitizeFilenameFragment(filters.searchQuery)}`);
  }
  parts.push(formatDate(new Date(), "yyyy-MM-dd"));
  return `${parts.join("_")}.${ext}`;
}

function buildFilterSummary(
  bundleKey: string,
  filters: ExportFilters | undefined,
  rowCount: number,
  generatedAt: Date,
): string {
  const bits: string[] = [];
  bits.push(`Bundle: ${EXPORT_BUNDLES[bundleKey as keyof typeof EXPORT_BUNDLES]?.label ?? bundleKey}`);
  if (filters?.fleetId !== undefined) bits.push(`Fleet ID: ${filters.fleetId}`);
  if (filters?.operationalStatus) bits.push(`Status: ${filters.operationalStatus}`);
  if (filters?.searchQuery && filters.searchQuery.trim().length > 0) {
    bits.push(`Search: "${filters.searchQuery.trim()}"`);
  }
  bits.push(`Trucks: ${rowCount}`);
  bits.push(`Generated: ${generatedAt.toISOString()}`);
  return bits.join(" · ");
}

/**
 * Compute today's & MTD savings per truck. Wraps the existing SavingsCalculator
 * so the export and dashboard agree on regional pricing and gallons-per-hour.
 *
 * Returns an empty map on failure rather than throwing — the export should
 * still produce a usable file with $0.00 in the savings columns instead of
 * failing wholesale.
 */
async function computeSavingsMap(organizationId: number) {
  const map = new Map<number, { todaySavings: number; mtdSavings: number }>();
  try {
    const result = await savingsCalculator.calculateSavings(organizationId);
    for (const t of result.truckBreakdown) {
      map.set(t.truckId, { todaySavings: t.todaySavings, mtdSavings: t.mtdSavings });
    }
  } catch (err) {
    console.error("[exports] Failed to compute savings map; falling back to zeros:", err);
  }
  return map;
}

export async function generateExport(
  input: GenerateExportInput,
): Promise<GeneratedExport> {
  const {
    organizationId,
    bundleKey,
    format,
    filters,
    includeColumns,
    excludeColumns,
  } = input;

  const columnKeys: ColumnKey[] = resolveColumns(bundleKey, includeColumns, excludeColumns);
  if (columnKeys.length === 0) {
    throw new Error(`generateExport: no columns resolved for bundle ${bundleKey}`);
  }

  const needsStatistics = bundleNeedsStatistics(columnKeys);
  const needsSims = bundleNeedsSims(columnKeys);

  const rows: TruckExportRow[] = await storage.getTrucksForExport(organizationId, {
    fleetId: filters?.fleetId,
    operationalStatus: filters?.operationalStatus,
    searchQuery: filters?.searchQuery,
    includeStatistics: needsStatistics,
    includeSims: needsSims,
  });

  // Savings: compute once per export, regardless of how many rows we have.
  // Skip the call entirely if no savings columns are selected.
  const needsSavings = columnKeys.includes("today_savings") || columnKeys.includes("month_savings");
  const savings = input.savingsByTruckId ?? (needsSavings
    ? await computeSavingsMap(organizationId)
    : new Map<number, { todaySavings: number; mtdSavings: number }>());

  const generatedAt = new Date();
  const ctx = { savings, now: generatedAt };
  const filterSummary = buildFilterSummary(bundleKey, filters, rows.length, generatedAt);

  if (format === "csv") {
    const buffer = buildCsvBuffer({ rows, columnKeys, filterSummary, ctx });
    return {
      buffer,
      filename: buildFilename(bundleKey, filters, "csv"),
      contentType: "text/csv; charset=utf-8",
      mimeExtension: "csv",
      rowCount: rows.length,
      columnKeys,
    };
  }

  const buffer = await buildExcelBuffer({ rows, columnKeys, filterSummary, ctx });
  return {
    buffer,
    filename: buildFilename(bundleKey, filters, "xlsx"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mimeExtension: "xlsx",
    rowCount: rows.length,
    columnKeys,
  };
}

// Re-exports for callers that want to do their own composition.
export { buildCsvBuffer } from "./csv-serializer";
export { buildExcelBuffer } from "./excel-serializer";
export type { GeneratedExport, GenerateExportInput, ExportFilters, TruckExportRow } from "./types";
