/**
 * Admin Devices Export — generator entry point.
 *
 * Pulls rows via the storage layer, runs them through the admin cell
 * builder, then hands off to a CSV/Excel writer that is registry-agnostic
 * (it reads `format` off `ADMIN_DEVICE_COLUMNS`). Keeping the writer here
 * (rather than reusing `csv-serializer.ts` / `excel-serializer.ts`) avoids
 * coupling the customer pipeline to the admin column union.
 */

import ExcelJS from "exceljs";
import {
  ADMIN_DEVICE_COLUMNS,
  ADMIN_DEVICE_COLUMN_KEYS,
  type AdminDeviceColumnKey,
  type ColumnFormat,
} from "@shared/export-admin-devices";
import { storage } from "../../storage";
import { extractAdminDeviceCell } from "./admin-devices-cell-builder";
import type { RawCellValue } from "./cell-builder";
import type { AdminDeviceExportRow } from "./admin-types";
import type { GeneratedExport } from "./types";

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
    return Number.isFinite(raw.getTime()) ? raw.toISOString() : "";
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return "";
    switch (fmt) {
      case "integer":       return String(Math.round(raw));
      case "currency":      return raw.toFixed(2);
      case "percent":
      case "wattage":
      case "temperature_f": return raw.toFixed(1);
      case "voltage":
      case "amp_hours":
      case "kwh":
      case "hours":
      case "number":        return raw.toFixed(2);
      default:              return String(raw);
    }
  }
  return neutralizeFormula(String(raw));
}

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
  const headerWidth = Math.min(48, Math.max(8, label.length + 2));
  return Math.min(48, Math.max(configured ?? headerWidth, headerWidth));
}

function cellPayload(raw: RawCellValue): string | number | Date | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  return raw;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateAdminDevicesExportInput {
  format: "csv" | "xlsx";
  organizationId?: number | null;
  organizationName?: string | null; // for filter-summary header
  searchQuery?: string | null;
  /** Storage override for tests. Defaults to the singleton. */
  storage?: {
    getAdminDevicesForExport(filters: {
      organizationId?: number | null;
      searchQuery?: string | null;
    }): Promise<AdminDeviceExportRow[]>;
  };
}

function buildFilterSummary(input: GenerateAdminDevicesExportInput): string {
  const parts: string[] = ["Deecell admin device registry"];
  if (input.organizationName) {
    parts.push(`Org: ${input.organizationName}`);
  } else if (input.organizationId == null) {
    parts.push("Org: All organizations");
  } else {
    parts.push(`Org #${input.organizationId}`);
  }
  if (input.searchQuery && input.searchQuery.trim().length > 0) {
    parts.push(`Search: "${input.searchQuery.trim()}"`);
  }
  parts.push(`Generated ${new Date().toISOString()}`);
  return parts.join(" · ");
}

function buildFilename(input: GenerateAdminDevicesExportInput): string {
  const ymd = new Date().toISOString().slice(0, 10);
  const ext = input.format === "csv" ? "csv" : "xlsx";
  return `Deecell Admin Devices ${ymd}.${ext}`;
}

function buildCsv(rows: AdminDeviceExportRow[], filterSummary: string): Buffer {
  const lines: string[] = [];
  lines.push(`# ${escapeCsv(filterSummary)}`);
  lines.push(
    ADMIN_DEVICE_COLUMN_KEYS.map((k) => escapeCsv(ADMIN_DEVICE_COLUMNS[k].label)).join(","),
  );
  for (const row of rows) {
    const cells = ADMIN_DEVICE_COLUMN_KEYS.map((k) => {
      const raw = extractAdminDeviceCell(row, k);
      return escapeCsv(formatCellForCsv(raw, ADMIN_DEVICE_COLUMNS[k].format));
    });
    lines.push(cells.join(","));
  }
  return Buffer.from(BOM + lines.join(CRLF) + CRLF, "utf8");
}

async function buildExcel(
  rows: AdminDeviceExportRow[],
  filterSummary: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Deecell Fleet Tracking";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Admin Devices", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // Caption row
  sheet.addRow([filterSummary]);
  const caption = sheet.getRow(1);
  caption.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  sheet.mergeCells(1, 1, 1, Math.max(1, ADMIN_DEVICE_COLUMN_KEYS.length));

  // Header row
  const headers = ADMIN_DEVICE_COLUMN_KEYS.map((k) => ADMIN_DEVICE_COLUMNS[k].label);
  sheet.addRow(headers);
  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 18;
  headerRow.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });

  // Columns
  sheet.columns = ADMIN_DEVICE_COLUMN_KEYS.map((k) => {
    const meta = ADMIN_DEVICE_COLUMNS[k];
    return {
      key: k,
      width: widthFor(meta.label, meta.width),
      style: { numFmt: numFmtFor(meta.format) },
    };
  });

  for (const row of rows) {
    const payload = ADMIN_DEVICE_COLUMN_KEYS.map((k) =>
      cellPayload(extractAdminDeviceCell(row, k)),
    );
    sheet.addRow(payload);
  }

  // Tighten widths to sampled values
  const sampleCount = Math.min(rows.length, 200);
  if (sampleCount > 0) {
    ADMIN_DEVICE_COLUMN_KEYS.forEach((k, idx) => {
      const meta = ADMIN_DEVICE_COLUMNS[k];
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

export async function generateAdminDevicesExport(
  input: GenerateAdminDevicesExportInput,
): Promise<GeneratedExport> {
  const store = input.storage ?? storage;
  const rows = await store.getAdminDevicesForExport({
    organizationId: input.organizationId ?? null,
    searchQuery: input.searchQuery ?? null,
  });

  const filterSummary = buildFilterSummary(input);
  const filename = buildFilename(input);

  let buffer: Buffer;
  let contentType: string;
  if (input.format === "csv") {
    buffer = buildCsv(rows, filterSummary);
    contentType = "text/csv; charset=utf-8";
  } else {
    buffer = await buildExcel(rows, filterSummary);
    contentType =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  return {
    buffer,
    filename,
    contentType,
    mimeExtension: input.format,
    rowCount: rows.length,
    columnKeys: [...ADMIN_DEVICE_COLUMN_KEYS] as AdminDeviceColumnKey[],
  };
}
