/**
 * Public entry point for historical (single-truck time-series) exports.
 *
 *   const result = await generateHistoricalExport({
 *     organizationId, truckId, startTime, endTime,
 *     granularity: "hour", format: "csv",
 *   });
 *
 * Pure with respect to (orgId, truckId, range, granularity, format) — given
 * the same database state and inputs, the same `{buffer, filename, contentType}`
 * comes out.
 *
 * Filename: `truck_<truckNumber>_<granularity>_<startISO>_to_<endISO>.<ext>`
 *
 * The CSV / Excel writers in this file are intentionally NOT shared with
 * `csv-serializer.ts` / `excel-serializer.ts`. Those work on
 * `TruckExportRow` + `EXPORT_COLUMNS`; the historical pipeline operates on a
 * different row shape (`HistoricalExportRow`) and a different column registry
 * (`HISTORICAL_*`). Sharing would force a generic abstraction that carries no
 * weight here — the formatting primitives are shared via local helpers that
 * key on `ColumnFormat` directly.
 */

import ExcelJS from "exceljs";
import { format as formatDate } from "date-fns";
import {
  HISTORICAL_GRANULARITY_META,
  resolveHistoricalColumns,
  type HistoricalColumnKey,
  type HistoricalGranularity,
} from "@shared/export-historical";
import type { ColumnFormat, ExportColumn } from "@shared/export-columns";
import { storage as defaultStorage } from "../../storage";
import { extractHistoricalCell } from "./historical-cell-builder";
import type { RawCellValue } from "./cell-builder";
import type {
  GenerateHistoricalExportInput,
  GeneratedExport,
  HistoricalExportRow,
} from "./types";

// ---------------------------------------------------------------------------
// Filename
// ---------------------------------------------------------------------------

const FILENAME_SAFE = /[^a-z0-9_-]+/gi;
function sanitizeFragment(text: string, maxLen = 32): string {
  const cleaned = text.trim().toLowerCase().replace(FILENAME_SAFE, "-").replace(/^[-_]+|[-_]+$/g, "");
  return cleaned.slice(0, maxLen) || "x";
}

function buildHistoricalFilename(opts: {
  truckNumber: string;
  granularity: HistoricalGranularity;
  startTime: Date;
  endTime: Date;
  ext: "csv" | "xlsx";
}): string {
  const startStr = formatDate(opts.startTime, "yyyy-MM-dd");
  const endStr = formatDate(opts.endTime, "yyyy-MM-dd");
  return `truck_${sanitizeFragment(opts.truckNumber)}_${opts.granularity}_${startStr}_to_${endStr}.${opts.ext}`;
}

// ---------------------------------------------------------------------------
// Filter summary (mirrors snapshot-export preamble shape)
// ---------------------------------------------------------------------------

function buildFilterSummary(opts: {
  truckNumber: string;
  fleetName: string | null;
  granularity: HistoricalGranularity;
  startTime: Date;
  endTime: Date;
  rowCount: number;
  generatedAt: Date;
}): string {
  const bits: string[] = [];
  bits.push(`Truck: ${opts.truckNumber}`);
  if (opts.fleetName) bits.push(`Fleet: ${opts.fleetName}`);
  bits.push(`Granularity: ${HISTORICAL_GRANULARITY_META[opts.granularity].label}`);
  bits.push(`Range: ${opts.startTime.toISOString()} → ${opts.endTime.toISOString()}`);
  bits.push(`Rows: ${opts.rowCount}`);
  bits.push(`Generated: ${opts.generatedAt.toISOString()}`);
  return bits.join(" · ");
}

// ---------------------------------------------------------------------------
// Format helpers — keyed on ColumnFormat, identical numeric behavior to
// snapshot serializers. Kept local so historical exports do not couple to
// `EXPORT_COLUMNS` lookup keys.
// ---------------------------------------------------------------------------

function formatNumberByFormat(raw: number, fmt: ColumnFormat): string {
  if (!Number.isFinite(raw)) return "";
  switch (fmt) {
    case "integer":        return String(Math.round(raw));
    case "currency":       return raw.toFixed(2);
    case "percent":
    case "wattage":
    case "temperature_f":  return raw.toFixed(1);
    case "voltage":
    case "amp_hours":
    case "kwh":
    case "hours":
    case "number":         return raw.toFixed(2);
    default:               return String(raw);
  }
}

function excelNumFmtFor(format: ColumnFormat): string | undefined {
  switch (format) {
    case "integer":        return "0";
    case "number":         return "#,##0.00";
    case "voltage":        return '0.00 "V"';
    case "wattage":        return '0.0 "W"';
    case "percent":        return '0.0 "%"';
    case "temperature_f":  return '0.0 "°F"';
    case "kwh":            return '0.00 "kWh"';
    case "amp_hours":      return '0.00 "Ah"';
    case "hours":          return '0.00 "h"';
    case "currency":       return '"$"#,##0.00';
    case "date":           return "yyyy-mm-dd";
    case "datetime":       return "yyyy-mm-dd hh:mm:ss";
    default:               return undefined;
  }
}

// ---------------------------------------------------------------------------
// CSV writer
// ---------------------------------------------------------------------------

const BOM = "\uFEFF";
const CRLF = "\r\n";
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function neutralizeFormula(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCellForCsv(raw: RawCellValue, fmt: ColumnFormat): string {
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) {
    if (!Number.isFinite(raw.getTime())) return "";
    return fmt === "date" ? formatDate(raw, "yyyy-MM-dd") : raw.toISOString();
  }
  if (typeof raw === "number") return formatNumberByFormat(raw, fmt);
  return neutralizeFormula(String(raw));
}

function buildHistoricalCsv(opts: {
  rows: HistoricalExportRow[];
  columnList: ExportColumn[];
  columnKeys: HistoricalColumnKey[];
  granularity: HistoricalGranularity;
  filterSummary: string;
}): Buffer {
  const { rows, columnList, columnKeys, granularity, filterSummary } = opts;
  const lines: string[] = [];
  lines.push(`# ${escapeCsv(filterSummary)}`);
  lines.push(columnList.map((c) => escapeCsv(c.label)).join(","));
  for (const row of rows) {
    const cells = columnKeys.map((k, i) => {
      const raw = extractHistoricalCell(row, k, granularity);
      return escapeCsv(formatCellForCsv(raw, columnList[i].format));
    });
    lines.push(cells.join(","));
  }
  return Buffer.from(BOM + lines.join(CRLF) + CRLF, "utf8");
}

// ---------------------------------------------------------------------------
// Excel writer
// ---------------------------------------------------------------------------

function widthFor(label: string, configured?: number): number {
  const headerWidth = Math.min(48, Math.max(8, label.length + 2));
  return Math.min(48, Math.max(configured ?? headerWidth, headerWidth));
}

function excelCellPayload(raw: RawCellValue): string | number | Date | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  return raw;
}

async function buildHistoricalExcel(opts: {
  rows: HistoricalExportRow[];
  columnList: ExportColumn[];
  columnKeys: HistoricalColumnKey[];
  granularity: HistoricalGranularity;
  filterSummary: string;
}): Promise<Buffer> {
  const { rows, columnList, columnKeys, granularity, filterSummary } = opts;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Deecell Fleet Tracking";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Truck History", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // Caption
  sheet.addRow([filterSummary]);
  const captionRow = sheet.getRow(1);
  captionRow.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  sheet.mergeCells(1, 1, 1, Math.max(1, columnList.length));

  // Header
  sheet.addRow(columnList.map((c) => c.label));
  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 18;
  headerRow.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });

  sheet.columns = columnList.map((c) => ({
    key: c.key,
    width: widthFor(c.label, c.width),
    style: { numFmt: excelNumFmtFor(c.format) },
  }));

  for (const row of rows) {
    const payload = columnKeys.map((k) =>
      excelCellPayload(extractHistoricalCell(row, k, granularity)),
    );
    sheet.addRow(payload);
  }

  // Re-tighten widths based on first 200 sampled rows.
  const sampleCount = Math.min(rows.length, 200);
  if (sampleCount > 0) {
    columnList.forEach((meta, idx) => {
      let max = meta.label.length;
      for (let r = 0; r < sampleCount; r++) {
        const cell = sheet.getRow(3 + r).getCell(idx + 1);
        const v = cell.value;
        let len = 0;
        if (v === null || v === undefined) len = 0;
        else if (v instanceof Date) len = 19;
        else if (typeof v === "number") len = String(Math.round(v * 100) / 100).length + 4;
        else len = String(v).length;
        if (len > max) max = len;
      }
      const col = sheet.getColumn(idx + 1);
      col.width = Math.min(48, Math.max(col.width ?? 0, max + 2));
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function generateHistoricalExport(
  input: GenerateHistoricalExportInput,
): Promise<GeneratedExport> {
  const storage = input.storage ?? defaultStorage;
  const { rows, truck, fleetName } = await storage.getHistoricalMeasurements({
    organizationId: input.organizationId,
    truckId: input.truckId,
    startTime: input.startTime,
    endTime: input.endTime,
    granularity: input.granularity,
  });

  const { columnList, columnKeys } = resolveHistoricalColumns(input.granularity);
  const generatedAt = new Date();
  const filterSummary = buildFilterSummary({
    truckNumber: truck.truckNumber,
    fleetName,
    granularity: input.granularity,
    startTime: input.startTime,
    endTime: input.endTime,
    rowCount: rows.length,
    generatedAt,
  });

  if (input.format === "csv") {
    const buffer = buildHistoricalCsv({
      rows,
      columnList,
      columnKeys,
      granularity: input.granularity,
      filterSummary,
    });
    return {
      buffer,
      filename: buildHistoricalFilename({
        truckNumber: truck.truckNumber,
        granularity: input.granularity,
        startTime: input.startTime,
        endTime: input.endTime,
        ext: "csv",
      }),
      contentType: "text/csv; charset=utf-8",
      mimeExtension: "csv",
      rowCount: rows.length,
      // Cast: GeneratedExport's `columnKeys` was originally typed as snapshot
      // ColumnKey[]. Historical keys are a different namespace; the field is
      // only used for `columnCount` on the job record, so the cast is safe.
      columnKeys: columnKeys as unknown as GeneratedExport["columnKeys"],
    };
  }

  const buffer = await buildHistoricalExcel({
    rows,
    columnList,
    columnKeys,
    granularity: input.granularity,
    filterSummary,
  });
  return {
    buffer,
    filename: buildHistoricalFilename({
      truckNumber: truck.truckNumber,
      granularity: input.granularity,
      startTime: input.startTime,
      endTime: input.endTime,
      ext: "xlsx",
    }),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mimeExtension: "xlsx",
    rowCount: rows.length,
    columnKeys: columnKeys as unknown as GeneratedExport["columnKeys"],
  };
}
