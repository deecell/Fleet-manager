/**
 * Excel (.xlsx) serializer using exceljs.
 *
 * - Faint caption row at the very top with the filter summary.
 * - Frozen header row.
 * - Per-format column number/date formatting.
 * - Autosized columns based on header label + first 200 sampled rows.
 */

import ExcelJS from "exceljs";
import { EXPORT_COLUMNS, type ColumnKey, type ColumnFormat } from "@shared/export-columns";
import { extractCell, type ExtractionContext, type RawCellValue } from "./cell-builder";
import type { TruckExportRow } from "./types";

function numFmtFor(format: ColumnFormat): string | undefined {
  switch (format) {
    case "integer":         return "0";
    case "number":          return "#,##0.00";
    case "voltage":         return '0.00 "V"';
    case "wattage":         return '0.0 "W"';
    case "percent":         return '0.0 "%"';
    case "temperature_f":   return '0.0 "°F"';
    case "kwh":             return '0.00 "kWh"';
    case "wh":              return '0 "Wh"';
    case "amp_hours":       return '0.00 "Ah"';
    case "hours":           return '0.00 "h"';
    case "currency":        return '"$"#,##0.00';
    case "date":            return "yyyy-mm-dd";
    case "datetime":        return "yyyy-mm-dd hh:mm:ss";
    default:                return undefined;
  }
}

function widthFor(label: string, configured?: number): number {
  // Slightly larger than label so headers don't truncate. Capped to keep extreme
  // values from blowing up the file.
  const headerWidth = Math.min(48, Math.max(8, label.length + 2));
  return Math.min(48, Math.max(configured ?? headerWidth, headerWidth));
}

function cellPayload(raw: RawCellValue): string | number | Date | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  return raw;
}

export async function buildExcelBuffer(opts: {
  rows: TruckExportRow[];
  columnKeys: ColumnKey[];
  filterSummary: string;
  ctx: ExtractionContext;
}): Promise<Buffer> {
  const { rows, columnKeys, filterSummary, ctx } = opts;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Deecell Fleet Tracking";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Fleet Export", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // ----- Caption row -----
  sheet.addRow([filterSummary]);
  const captionRow = sheet.getRow(1);
  captionRow.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  sheet.mergeCells(1, 1, 1, Math.max(1, columnKeys.length));

  // ----- Header row -----
  const headerLabels = columnKeys.map((k) => EXPORT_COLUMNS[k].label);
  sheet.addRow(headerLabels);
  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 18;
  headerRow.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });

  // ----- Configure columns -----
  sheet.columns = columnKeys.map((k) => {
    const meta = EXPORT_COLUMNS[k];
    return {
      key: k,
      width: widthFor(meta.label, meta.width),
      style: { numFmt: numFmtFor(meta.format) },
    };
  });

  // ----- Data rows -----
  for (const row of rows) {
    const payload = columnKeys.map((k) => cellPayload(extractCell(row, k, ctx)));
    sheet.addRow(payload);
  }

  // Re-tighten widths to accommodate sampled values, but keep capped.
  const sampleCount = Math.min(rows.length, 200);
  if (sampleCount > 0) {
    columnKeys.forEach((k, idx) => {
      const meta = EXPORT_COLUMNS[k];
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
