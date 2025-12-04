import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { tenantMiddleware } from "../middleware/tenant";
import {
  insertFleetSchema,
  insertTruckSchema,
  insertPowerMonDeviceSchema,
  insertDeviceCredentialSchema,
  insertAlertSchema,
} from "@shared/schema";
import { z } from "zod";

const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const assignDeviceSchema = z.object({
  truckId: z.number().int().positive(),
});

const updateDeviceStatusSchema = z.object({
  status: z.enum(["online", "offline", "unknown"]),
});

const acknowledgeAlertSchema = z.object({
  userId: z.number().int().positive(),
});

const router = Router();

// ===========================================================================
// FLEETS (Tenant-scoped - requires authenticated session)
// ===========================================================================

router.get("/fleets", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const fleets = await storage.listFleets(req.organizationId!);
    res.json({ fleets });
  } catch (error) {
    console.error("Error listing fleets:", error);
    res.status(500).json({ error: "Failed to list fleets" });
  }
});

router.get("/fleets/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fleet = await storage.getFleet(req.organizationId!, id);
    if (!fleet) {
      return res.status(404).json({ error: "Fleet not found" });
    }
    res.json({ fleet });
  } catch (error) {
    console.error("Error getting fleet:", error);
    res.status(500).json({ error: "Failed to get fleet" });
  }
});

router.post("/fleets", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const data = insertFleetSchema.omit({ organizationId: true }).parse(req.body);
    const fleet = await storage.createFleet({
      ...data,
      organizationId: req.organizationId!,
    });
    res.status(201).json({ fleet });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating fleet:", error);
    res.status(500).json({ error: "Failed to create fleet" });
  }
});

router.patch("/fleets/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = insertFleetSchema.omit({ organizationId: true }).partial().parse(req.body);
    const fleet = await storage.updateFleet(req.organizationId!, id, data);
    if (!fleet) {
      return res.status(404).json({ error: "Fleet not found" });
    }
    res.json({ fleet });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating fleet:", error);
    res.status(500).json({ error: "Failed to update fleet" });
  }
});

router.delete("/fleets/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await storage.deleteFleet(req.organizationId!, id);
    if (!deleted) {
      return res.status(404).json({ error: "Fleet not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting fleet:", error);
    res.status(500).json({ error: "Failed to delete fleet" });
  }
});

// ===========================================================================
// TRUCKS (Tenant-scoped with fleet filtering and pagination)
// ===========================================================================

router.get("/trucks", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const fleetId = req.query.fleetId ? parseInt(req.query.fleetId as string, 10) : undefined;
    const status = req.query.status as string | undefined;
    
    console.log(`[trucks] Fetching trucks for org=${req.organizationId}, fleetId=${fleetId}, status=${status}`);
    const trucks = await storage.listTrucks(req.organizationId!, fleetId, status);
    console.log(`[trucks] Found ${trucks.length} trucks: ${trucks.map(t => t.truckNumber).join(', ')}`);
    
    res.json({ 
      trucks,
      total: trucks.length,
    });
  } catch (error) {
    console.error("Error listing trucks:", error);
    res.status(500).json({ error: "Failed to list trucks" });
  }
});

router.get("/trucks/stats", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const fleetId = req.query.fleetId ? parseInt(req.query.fleetId as string, 10) : undefined;
    const statusCounts = await storage.countTrucksByStatus(req.organizationId!, fleetId);
    res.json({ statusCounts });
  } catch (error) {
    console.error("Error getting truck stats:", error);
    res.status(500).json({ error: "Failed to get truck stats" });
  }
});

router.get("/trucks/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const truck = await storage.getTruck(req.organizationId!, id);
    if (!truck) {
      return res.status(404).json({ error: "Truck not found" });
    }
    
    const device = await storage.getDeviceByTruck(req.organizationId!, id);
    const snapshot = await storage.getSnapshotByTruck(req.organizationId!, id);
    
    res.json({ truck, device, snapshot });
  } catch (error) {
    console.error("Error getting truck:", error);
    res.status(500).json({ error: "Failed to get truck" });
  }
});

router.post("/trucks", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const data = insertTruckSchema.omit({ organizationId: true }).parse(req.body);
    const truck = await storage.createTruck({
      ...data,
      organizationId: req.organizationId!,
    });
    res.status(201).json({ truck });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating truck:", error);
    res.status(500).json({ error: "Failed to create truck" });
  }
});

router.patch("/trucks/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = insertTruckSchema.omit({ organizationId: true, fleetId: true }).partial().parse(req.body);
    const truck = await storage.updateTruck(req.organizationId!, id, data);
    if (!truck) {
      return res.status(404).json({ error: "Truck not found" });
    }
    res.json({ truck });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating truck:", error);
    res.status(500).json({ error: "Failed to update truck" });
  }
});

router.patch("/trucks/:id/location", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = updateLocationSchema.parse(req.body);
    
    await storage.updateTruckLocation(req.organizationId!, id, data.latitude, data.longitude);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating truck location:", error);
    res.status(500).json({ error: "Failed to update truck location" });
  }
});

router.delete("/trucks/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await storage.deleteTruck(req.organizationId!, id);
    if (!deleted) {
      return res.status(404).json({ error: "Truck not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting truck:", error);
    res.status(500).json({ error: "Failed to delete truck" });
  }
});

// ===========================================================================
// DEVICES (Tenant-scoped)
// ===========================================================================

router.get("/devices", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const devices = await storage.listDevices(req.organizationId!, status);
    res.json({ devices });
  } catch (error) {
    console.error("Error listing devices:", error);
    res.status(500).json({ error: "Failed to list devices" });
  }
});

router.get("/devices/stats", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const statusCounts = await storage.countDevicesByStatus(req.organizationId!);
    res.json({ statusCounts });
  } catch (error) {
    console.error("Error getting device stats:", error);
    res.status(500).json({ error: "Failed to get device stats" });
  }
});

router.get("/devices/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const device = await storage.getDevice(req.organizationId!, id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    
    const credential = await storage.getCredential(req.organizationId!, id);
    const syncStatus = await storage.getSyncStatus(req.organizationId!, id);
    const snapshot = await storage.getSnapshot(req.organizationId!, id);
    
    res.json({ device, credential, syncStatus, snapshot });
  } catch (error) {
    console.error("Error getting device:", error);
    res.status(500).json({ error: "Failed to get device" });
  }
});

router.post("/devices", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const data = insertPowerMonDeviceSchema.omit({ organizationId: true }).parse(req.body);
    
    if (await storage.checkSerialExists(data.serialNumber)) {
      return res.status(409).json({ error: "Device with this serial number already exists" });
    }
    
    const device = await storage.createDevice({
      ...data,
      organizationId: req.organizationId!,
    });
    res.status(201).json({ device });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating device:", error);
    res.status(500).json({ error: "Failed to create device" });
  }
});

router.patch("/devices/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = insertPowerMonDeviceSchema.omit({ organizationId: true, serialNumber: true }).partial().parse(req.body);
    const device = await storage.updateDevice(req.organizationId!, id, data);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json({ device });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating device:", error);
    res.status(500).json({ error: "Failed to update device" });
  }
});

router.post("/devices/:id/assign", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = assignDeviceSchema.parse(req.body);
    
    const truck = await storage.getTruck(req.organizationId!, data.truckId);
    if (!truck) {
      return res.status(404).json({ error: "Truck not found" });
    }
    
    const device = await storage.assignDeviceToTruck(req.organizationId!, id, data.truckId);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json({ device });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error assigning device:", error);
    res.status(500).json({ error: "Failed to assign device" });
  }
});

router.post("/devices/:id/unassign", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const device = await storage.unassignDevice(req.organizationId!, id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json({ device });
  } catch (error) {
    console.error("Error unassigning device:", error);
    res.status(500).json({ error: "Failed to unassign device" });
  }
});

router.patch("/devices/:id/status", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = updateDeviceStatusSchema.parse(req.body);
    
    await storage.updateDeviceStatus(req.organizationId!, id, data.status);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating device status:", error);
    res.status(500).json({ error: "Failed to update device status" });
  }
});

// ===========================================================================
// DEVICE CREDENTIALS (Tenant-scoped)
// ===========================================================================

router.post("/devices/:id/credentials", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    
    const device = await storage.getDevice(req.organizationId!, deviceId);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    
    const data = insertDeviceCredentialSchema.omit({ organizationId: true, deviceId: true }).parse(req.body);
    const credential = await storage.createCredential({
      ...data,
      organizationId: req.organizationId!,
      deviceId,
    });
    res.status(201).json({ credential });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating device credential:", error);
    res.status(500).json({ error: "Failed to create device credential" });
  }
});

// ===========================================================================
// DASHBOARD (Aggregated data endpoint)
// ===========================================================================

router.get("/dashboard", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const fleetId = req.query.fleetId ? parseInt(req.query.fleetId as string, 10) : undefined;
    const data = await storage.getDashboardData(req.organizationId!, fleetId);
    res.json(data);
  } catch (error) {
    console.error("Error getting dashboard data:", error);
    res.status(500).json({ error: "Failed to get dashboard data" });
  }
});

router.get("/dashboard/stats", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const fleetId = req.query.fleetId ? parseInt(req.query.fleetId as string, 10) : undefined;
    const stats = await storage.getFleetStats(req.organizationId!, fleetId);
    res.json({ stats });
  } catch (error) {
    console.error("Error getting fleet stats:", error);
    res.status(500).json({ error: "Failed to get fleet stats" });
  }
});

// ===========================================================================
// SNAPSHOTS (Tenant-scoped)
// ===========================================================================

router.get("/snapshots", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const snapshots = await storage.listSnapshots(req.organizationId!);
    res.json({ snapshots });
  } catch (error) {
    console.error("Error listing snapshots:", error);
    res.status(500).json({ error: "Failed to list snapshots" });
  }
});

// ===========================================================================
// ALERTS (Tenant-scoped)
// ===========================================================================

router.get("/alerts", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const truckId = req.query.truckId ? parseInt(req.query.truckId as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const alerts = await storage.listAlerts(req.organizationId!, status, limit, truckId);
    res.json({ alerts });
  } catch (error) {
    console.error("Error listing alerts:", error);
    res.status(500).json({ error: "Failed to list alerts" });
  }
});

router.get("/trucks/:id/events", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const truckId = parseInt(req.params.id, 10);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    
    const alerts = await storage.listAlerts(req.organizationId!, undefined, limit, truckId);
    
    const events = alerts.map(alert => ({
      id: `alert-${alert.id}`,
      type: "alert" as const,
      category: alert.alertType === "device_offline" ? "status" : "alert",
      title: alert.title,
      description: alert.message || "",
      severity: alert.severity,
      status: alert.status,
      timestamp: alert.createdAt,
      resolvedAt: alert.resolvedAt,
      acknowledgedAt: alert.acknowledgedAt,
    }));
    
    res.json({ events, total: events.length });
  } catch (error) {
    console.error("Error getting truck events:", error);
    res.status(500).json({ error: "Failed to get truck events" });
  }
});

router.get("/alerts/count", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const count = await storage.countActiveAlerts(req.organizationId!);
    res.json({ count });
  } catch (error) {
    console.error("Error counting alerts:", error);
    res.status(500).json({ error: "Failed to count alerts" });
  }
});

router.get("/alerts/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const alert = await storage.getAlert(req.organizationId!, id);
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    res.json({ alert });
  } catch (error) {
    console.error("Error getting alert:", error);
    res.status(500).json({ error: "Failed to get alert" });
  }
});

router.post("/alerts", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const data = insertAlertSchema.omit({ organizationId: true }).parse(req.body);
    const alert = await storage.createAlert({
      ...data,
      organizationId: req.organizationId!,
    });
    res.status(201).json({ alert });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating alert:", error);
    res.status(500).json({ error: "Failed to create alert" });
  }
});

router.post("/alerts/:id/acknowledge", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = acknowledgeAlertSchema.parse(req.body);
    
    const alert = await storage.acknowledgeAlert(req.organizationId!, id, data.userId);
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    res.json({ alert });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error acknowledging alert:", error);
    res.status(500).json({ error: "Failed to acknowledge alert" });
  }
});

router.post("/alerts/:id/resolve", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const alert = await storage.resolveAlert(req.organizationId!, id);
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    res.json({ alert });
  } catch (error) {
    console.error("Error resolving alert:", error);
    res.status(500).json({ error: "Failed to resolve alert" });
  }
});

// ===========================================================================
// MEASUREMENTS (Time-series with date range)
// ===========================================================================

router.get("/trucks/:id/measurements", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const truckId = parseInt(req.params.id, 10);
    const startTime = req.query.startTime ? new Date(req.query.startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endTime = req.query.endTime ? new Date(req.query.endTime as string) : new Date();
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 1000;
    
    const measurements = await storage.getMeasurementsByTruck(
      req.organizationId!,
      truckId,
      startTime,
      endTime,
      limit
    );
    
    res.json({ 
      measurements,
      total: measurements.length,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    });
  } catch (error) {
    console.error("Error getting measurements:", error);
    res.status(500).json({ error: "Failed to get measurements" });
  }
});

router.get("/devices/:id/measurements", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    const startTime = req.query.startTime ? new Date(req.query.startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endTime = req.query.endTime ? new Date(req.query.endTime as string) : new Date();
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 1000;
    
    const measurements = await storage.getMeasurements(
      req.organizationId!,
      deviceId,
      startTime,
      endTime,
      limit
    );
    
    res.json({ 
      measurements,
      total: measurements.length,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    });
  } catch (error) {
    console.error("Error getting measurements:", error);
    res.status(500).json({ error: "Failed to get measurements" });
  }
});

// ===========================================================================
// POLLING SETTINGS (Tenant-scoped)
// ===========================================================================

router.get("/settings/polling", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await storage.getOrCreatePollingSettings(req.organizationId!);
    res.json({ settings });
  } catch (error) {
    console.error("Error getting polling settings:", error);
    res.status(500).json({ error: "Failed to get polling settings" });
  }
});

router.patch("/settings/polling", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const { pollingIntervalSeconds, logSyncIntervalMinutes, offlineThresholdMinutes, lowVoltageThreshold, isEnabled } = req.body;
    
    const settings = await storage.updatePollingSettings(req.organizationId!, {
      pollingIntervalSeconds,
      logSyncIntervalMinutes,
      offlineThresholdMinutes,
      lowVoltageThreshold,
      isEnabled,
    });
    
    if (!settings) {
      return res.status(404).json({ error: "Polling settings not found" });
    }
    res.json({ settings });
  } catch (error) {
    console.error("Error updating polling settings:", error);
    res.status(500).json({ error: "Failed to update polling settings" });
  }
});

// ===========================================================================
// CSV EXPORT (Tenant-scoped)
// ===========================================================================

// Helper function to escape CSV values
function escapeCSVValue(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Export all trucks summary to CSV
router.get("/export/trucks", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const trucks = await storage.listTrucks(req.organizationId!);
    const fleets = await storage.listFleets(req.organizationId!);
    
    // Create a fleet lookup map
    const fleetMap = new Map(fleets.map(f => [f.id, f.name]));
    
    // Get snapshots for all trucks
    const trucksWithData = await Promise.all(
      trucks.map(async (truck) => {
        const snapshot = await storage.getSnapshotByTruck(req.organizationId!, truck.id);
        return { truck, snapshot };
      })
    );
    
    // CSV headers
    const headers = [
      "Truck Number",
      "Fleet",
      "Status",
      "Voltage 1 (V)",
      "Voltage 2 (V)",
      "Current (A)",
      "SOC (%)",
      "Power (W)",
      "Temperature (C)",
      "Latitude",
      "Longitude",
      "Last Updated",
    ];
    
    // CSV rows
    const rows = trucksWithData.map(({ truck, snapshot }) => [
      escapeCSVValue(truck.truckNumber),
      escapeCSVValue(fleetMap.get(truck.fleetId) || "Unassigned"),
      escapeCSVValue(truck.status || "unknown"),
      escapeCSVValue(snapshot?.voltage1 ?? ""),
      escapeCSVValue(snapshot?.voltage2 ?? ""),
      escapeCSVValue(snapshot?.current ?? ""),
      escapeCSVValue(snapshot?.soc ?? ""),
      escapeCSVValue(snapshot?.power ?? ""),
      escapeCSVValue(snapshot?.temperature ?? ""),
      escapeCSVValue(truck.latitude ?? ""),
      escapeCSVValue(truck.longitude ?? ""),
      escapeCSVValue(snapshot?.recordedAt ? new Date(snapshot.recordedAt).toISOString() : ""),
    ]);
    
    // Build CSV content
    const csv = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");
    
    // Set headers for CSV download
    const filename = `fleet_trucks_${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error("Error exporting trucks:", error);
    res.status(500).json({ error: "Failed to export trucks" });
  }
});

// Export single truck history to CSV with date range
router.get("/export/trucks/:id", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const truckId = parseInt(req.params.id, 10);
    const startTime = req.query.startTime ? new Date(req.query.startTime as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endTime = req.query.endTime ? new Date(req.query.endTime as string) : new Date();
    
    // Validate date range
    if (startTime > endTime) {
      return res.status(400).json({ error: "Start date must be before end date" });
    }
    
    // Get truck info
    const truck = await storage.getTruck(req.organizationId!, truckId);
    if (!truck) {
      return res.status(404).json({ error: "Truck not found" });
    }
    
    // Get fleet name
    const fleets = await storage.listFleets(req.organizationId!);
    const fleetName = fleets.find(f => f.id === truck.fleetId)?.name || "Unassigned";
    
    // Get measurements for the date range (up to 10000 records)
    const measurements = await storage.getMeasurementsByTruck(
      req.organizationId!,
      truckId,
      startTime,
      endTime,
      10000
    );
    
    // CSV headers
    const headers = [
      "Timestamp",
      "Truck Number",
      "Fleet",
      "Voltage 1 (V)",
      "Voltage 2 (V)",
      "Current (A)",
      "SOC (%)",
      "Power (W)",
      "Temperature (C)",
      "Energy (Wh)",
      "Charge (Ah)",
      "Runtime (s)",
    ];
    
    // CSV rows
    const rows = measurements.map(m => [
      escapeCSVValue(m.recordedAt ? new Date(m.recordedAt).toISOString() : ""),
      escapeCSVValue(truck.truckNumber),
      escapeCSVValue(fleetName),
      escapeCSVValue(m.voltage1 ?? ""),
      escapeCSVValue(m.voltage2 ?? ""),
      escapeCSVValue(m.current ?? ""),
      escapeCSVValue(m.soc ?? ""),
      escapeCSVValue(m.power ?? ""),
      escapeCSVValue(m.temperature ?? ""),
      escapeCSVValue(m.energy ?? ""),
      escapeCSVValue(m.charge ?? ""),
      escapeCSVValue(m.runtime ?? ""),
    ]);
    
    // Build CSV content
    const csv = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");
    
    // Set headers for CSV download
    const safeFileName = truck.truckNumber.replace(/[^a-zA-Z0-9-_]/g, "_");
    const filename = `${safeFileName}_${startTime.toISOString().split("T")[0]}_to_${endTime.toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error("Error exporting truck history:", error);
    res.status(500).json({ error: "Failed to export truck history" });
  }
});

// ===========================================================================
// SAVINGS CALCULATOR (calculates fuel savings from idle reduction/parked time)
// Formula: (parked_minutes / 60) × 1.2 gal/hr × diesel_price
// ===========================================================================
import { savingsCalculator } from "../services/savings-calculator";
import { eiaClient } from "../services/eia-client";

router.get("/savings", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const savings = await savingsCalculator.calculateSavings(req.organizationId!);
    res.json(savings);
  } catch (error) {
    console.error("Error calculating savings:", error);
    res.status(500).json({ error: "Failed to calculate savings" });
  }
});

// Get current fuel price (uses EIA API with fallback to default)
router.get("/fuel-price", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const price = await eiaClient.getCurrentFuelPrice("US");
    res.json({ 
      pricePerGallon: price,
      source: process.env.EIA_API_KEY ? "EIA" : "default",
      currency: "USD"
    });
  } catch (error) {
    console.error("Error getting fuel price:", error);
    res.status(500).json({ error: "Failed to get fuel price" });
  }
});

// ===========================================================================
// FLEET STATS (calculates SOC, runtime, maintenance metrics with 7-day trends)
// ===========================================================================
import { fleetStatsCalculator } from "../services/fleet-stats-calculator";

router.get("/fleet-stats", tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const stats = await fleetStatsCalculator.calculateFleetStats(req.organizationId!);
    res.json(stats);
  } catch (error) {
    console.error("Error calculating fleet stats:", error);
    res.status(500).json({ error: "Failed to calculate fleet stats" });
  }
});

export default router;
