import { describe, it, expect } from "vitest";
import {
  EXPORT_BUNDLES,
  resolveColumns,
  bundleNeedsStatistics,
  bundleNeedsSims,
  type ColumnKey,
} from "../shared/export-columns";
import { buildCsvBuffer } from "../server/services/exports/csv-serializer";
import { buildExcelBuffer } from "../server/services/exports/excel-serializer";
import type { TruckExportRow, ExportContext } from "../server/services/exports/types";
import { generateExport } from "../server/services/exports";
import { vi } from "vitest";

describe("resolveColumns", () => {
  it("returns the bundle's columns in registry order", () => {
    const cols = resolveColumns("default");
    expect(cols.length).toBe(EXPORT_BUNDLES.default.columnKeys.length);
    expect(cols[0]).toBe(EXPORT_BUNDLES.default.columnKeys[0]);
  });

  it("respects excludeColumns", () => {
    const cols = resolveColumns("default", undefined, ["truck_number"]);
    expect(cols).not.toContain("truck_number");
  });

  it("respects includeColumns and de-dupes", () => {
    const cols = resolveColumns("default", ["sim_carrier", "sim_carrier"]);
    expect(cols.filter((c) => c === "sim_carrier").length).toBe(1);
    expect(cols).toContain("sim_carrier");
  });

  it("silently drops unknown column keys", () => {
    const cols = resolveColumns("default", ["nonsense_column"]);
    expect(cols).not.toContain("nonsense_column" as ColumnKey);
  });

  it("operations bundle includes all three status columns together", () => {
    const cols = resolveColumns("operations");
    expect(cols).toContain("operational_status");
    expect(cols).toContain("connection_status");
    expect(cols).toContain("activity_status");
  });

  it("connectivity bundle includes all three status columns together", () => {
    const cols = resolveColumns("connectivity");
    expect(cols).toContain("operational_status");
    expect(cols).toContain("connection_status");
    expect(cols).toContain("activity_status");
  });
});

describe("bundleNeeds* helpers", () => {
  it("battery_health bundle requires deviceStatistics", () => {
    expect(bundleNeedsStatistics(resolveColumns("battery_health"))).toBe(true);
  });
  it("default bundle does not require sims", () => {
    expect(bundleNeedsSims(resolveColumns("default"))).toBe(false);
  });
  it("connectivity bundle requires sims", () => {
    expect(bundleNeedsSims(resolveColumns("connectivity"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Serializer smoke tests
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<TruckExportRow> = {}): TruckExportRow {
  return {
    truck: {
      id: 1,
      organizationId: 1,
      truckNumber: "GFR-70",
      driverName: "Jane Doe",
      model: "Cascadia",
      make: "Freightliner",
      year: 2022,
      vinNumber: null,
      licensePlate: null,
      status: "in-service",
      isActive: true,
      latitude: "33.873",
      longitude: "-118.147",
      locationDescription: "Long Beach, CA",
      country: "USA",
      fleetId: 1,
      lastReported: new Date("2026-04-27T12:00:00Z"),
      lastSeenAt: new Date("2026-04-27T12:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    fleetName: "Coastal Fleet",
    device: {
      id: 100,
      serialNumber: "PM-123",
      name: "PowerMon-100",
      hardwareRevision: "v1",
      firmwareVersion: "1.17",
    } as any,
    snapshot: {
      voltage1: "12.45",
      voltage2: "12.50",
      soc: "78.3",
      power: "120.5",
      temperature: "25.0",
      ampHours: "100",
      batteryCount: 4,
      isCharging: true,
      signalRssi: -82,
      timestamp: new Date("2026-04-27T12:00:00Z"),
    } as any,
    activeAlertCount: 2,
    ...overrides,
  };
}

const ctx: ExportContext = {
  savings: new Map<number, { todaySavings: number; mtdSavings: number }>(),
  now: new Date("2026-04-27T12:00:00Z"),
};

describe("buildCsvBuffer", () => {
  it("starts with UTF-8 BOM and includes the filter preamble + header", () => {
    const buf = buildCsvBuffer({
      rows: [makeRow()],
      columnKeys: resolveColumns("default"),
      filterSummary: ["Bundle: default", "Rows: 1"],
      ctx,
    });
    const text = buf.toString("utf8");
    // RFC 4180 + UTF-8 BOM. Preamble is one `# `-prefixed CSV row whose cells
    // are the filter summary entries.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toMatch(/^\uFEFF# Bundle: default/);
    expect(text).toContain("Rows: 1");
    expect(text).toContain("Truck Number");
    expect(text).toContain("GFR-70");
  });

  it("neutralizes leading =/+/-/@ in text cells (formula injection defense)", () => {
    const buf = buildCsvBuffer({
      rows: [makeRow({ truck: { ...makeRow().truck, driverName: "=cmd|/c calc!A1" } as any })],
      columnKeys: ["driver_name"] as ColumnKey[],
      filterSummary: [],
      ctx,
    });
    const text = buf.toString("utf8");
    // The cell starts with `=`, which spreadsheets would interpret as a
    // formula — the serializer must prefix it with an apostrophe.
    expect(text).toMatch(/'=cmd/);
    expect(text).not.toMatch(/(^|\r\n|\n)=cmd/);
  });
});

describe("buildExcelBuffer", () => {
  it("returns a non-empty XLSX buffer", async () => {
    const buf = await buildExcelBuffer({
      rows: [makeRow(), makeRow({ truck: { ...makeRow().truck, id: 2, truckNumber: "GFR-71" } as any })],
      columnKeys: resolveColumns("default"),
      filterSummary: ["Bundle: default", "Rows: 2"],
      ctx,
    });
    expect(buf.length).toBeGreaterThan(1000);
    // XLSX is a zip — first two bytes are PK
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});

// ---------------------------------------------------------------------------
// generateExport contract: returns required fields with correct extension/type
// ---------------------------------------------------------------------------

describe("generateExport contract", () => {
  // Pre-computed empty savings map skips the savings-calculator's DB roundtrip.
  const noSavings = new Map<number, { todaySavings: number; mtdSavings: number }>();

  it("returns {buffer, filename, contentType, mimeExtension} for csv", async () => {
    const fakeStorage = {
      getTrucksForExport: vi.fn().mockResolvedValue([makeRow()]),
    } as any;
    const out = await generateExport({
      storage: fakeStorage,
      organizationId: 1,
      bundleKey: "default",
      format: "csv",
      savingsByTruckId: noSavings,
    });
    expect(out.mimeExtension).toBe("csv");
    expect(out.contentType).toMatch(/text\/csv/);
    expect(out.filename).toMatch(/^fleet_default(_.*)?_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(out.buffer.length).toBeGreaterThan(0);
  });

  it("returns {buffer, filename, contentType, mimeExtension} for xlsx", async () => {
    const fakeStorage = {
      getTrucksForExport: vi.fn().mockResolvedValue([makeRow()]),
    } as any;
    const out = await generateExport({
      storage: fakeStorage,
      organizationId: 1,
      bundleKey: "battery_health",
      format: "xlsx",
      savingsByTruckId: noSavings,
    });
    expect(out.mimeExtension).toBe("xlsx");
    expect(out.contentType).toMatch(/spreadsheetml/);
    // Bundle key must preserve underscores in the filename.
    expect(out.filename).toMatch(/^fleet_battery_health_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("includes search and status segments in the filename", async () => {
    const fakeStorage = {
      getTrucksForExport: vi.fn().mockResolvedValue([makeRow()]),
    } as any;
    const out = await generateExport({
      storage: fakeStorage,
      organizationId: 1,
      bundleKey: "operations",
      format: "csv",
      filters: { operationalStatus: "in-service", searchQuery: "Coastal" },
      savingsByTruckId: noSavings,
    });
    expect(out.filename).toContain("in-service");
    expect(out.filename).toContain("search-coastal");
  });

  it("calls storage.getTrucksForExport with the resolved orgId (tenant scoped)", async () => {
    const fakeStorage = {
      getTrucksForExport: vi.fn().mockResolvedValue([]),
    };
    await generateExport({
      storage: fakeStorage as any,
      organizationId: 42,
      bundleKey: "default",
      format: "csv",
      savingsByTruckId: noSavings,
    });
    expect(fakeStorage.getTrucksForExport).toHaveBeenCalledWith(
      42,
      expect.any(Object),
    );
  });
});
