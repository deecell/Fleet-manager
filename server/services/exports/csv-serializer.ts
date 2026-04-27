/**
 * CSV serializer.
 *
 * - UTF-8 with BOM (so Excel auto-detects the encoding instead of mangling
 *   accented characters and the °, ° symbols in headers).
 * - Properly escapes quotes / commas / newlines per RFC 4180.
 * - First line is a "filter summary" preamble; second line is the header row.
 *   Most CSV readers (Excel, Numbers, Google Sheets) handle the extra preamble
 *   line cleanly when imported via Open dialog. The summary is also commented
 *   with a leading `# ` so command-line tooling can be configured to skip it.
 */

import { EXPORT_COLUMNS, type ColumnKey } from "@shared/export-columns";
import { extractCell, type ExtractionContext, type RawCellValue } from "./cell-builder";
import type { TruckExportRow } from "./types";

const BOM = "\uFEFF";
const CRLF = "\r\n";

/**
 * Spreadsheet-formula-injection defense. If a cell starts with a character that
 * Excel/Numbers/LibreOffice will treat as a formula (`=`, `+`, `-`, `@`, `\t`,
 * `\r`), prefix it with a single quote so the value is rendered as text. Only
 * applied to text-formatted cells; numbers/dates are emitted via numeric
 * formatting and never start with these characters.
 */
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

function formatCellForCsv(raw: RawCellValue, columnKey: ColumnKey): string {
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? raw.toISOString() : "";
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return "";
    const fmt = EXPORT_COLUMNS[columnKey].format;
    switch (fmt) {
      case "integer":
        return String(Math.round(raw));
      case "currency":
        return raw.toFixed(2);
      case "percent":
      case "wattage":
      case "temperature_f":
        return raw.toFixed(1);
      case "voltage":
      case "amp_hours":
      case "kwh":
      case "hours":
      case "number":
        return raw.toFixed(2);
      default:
        return String(raw);
    }
  }
  // String value — defend against spreadsheet formula injection. Numeric and
  // date branches above already produce safe leading characters.
  return neutralizeFormula(String(raw));
}

export function buildCsvBuffer(opts: {
  rows: TruckExportRow[];
  columnKeys: ColumnKey[];
  filterSummary: string;
  ctx: ExtractionContext;
}): Buffer {
  const { rows, columnKeys, filterSummary, ctx } = opts;

  const lines: string[] = [];
  // Preamble — leading "# " keeps it out of the way of strict-CSV consumers
  // that allow comment lines.
  lines.push(`# ${escapeCsv(filterSummary)}`);
  lines.push(columnKeys.map((k) => escapeCsv(EXPORT_COLUMNS[k].label)).join(","));

  for (const row of rows) {
    const cells = columnKeys.map((k) => {
      const raw = extractCell(row, k, ctx);
      return escapeCsv(formatCellForCsv(raw, k));
    });
    lines.push(cells.join(","));
  }

  return Buffer.from(BOM + lines.join(CRLF) + CRLF, "utf8");
}
