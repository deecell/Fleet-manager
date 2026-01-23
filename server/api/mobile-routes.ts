import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "./auth-routes";

const router = Router();

router.get("/my-truck", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const organizationId = req.session.organizationId!;

    const user = await storage.getUser(organizationId, userId);
    if (!user) {
      return res.status(404).json({ error: "Not found" });
    }

    if (!user.assignedTruckId) {
      return res.status(404).json({ 
        error: "No truck assigned", 
        message: "You don't have a truck assigned to your account. Please contact your fleet manager." 
      });
    }

    const truck = await storage.getTruck(organizationId, user.assignedTruckId);
    if (!truck) {
      return res.status(404).json({ error: "Not found" });
    }

    const device = await storage.getDeviceByTruck(organizationId, truck.id);
    const snapshot = device ? await storage.getSnapshotByTruck(organizationId, truck.id) : null;

    const temperatureFahrenheit = snapshot?.temperature != null 
      ? (snapshot.temperature * 9/5) + 32 
      : null;

    res.json({
      truck: {
        id: truck.id,
        truckNumber: truck.truckNumber,
        make: truck.make,
        model: truck.model,
        year: truck.year,
        status: truck.status,
        isActive: truck.isActive,
      },
      device: device ? {
        id: device.id,
        deviceName: device.deviceName,
        serialNumber: device.serialNumber,
        connectionStatus: device.connectionStatus,
        dataStatus: device.dataStatus,
        lastSeenAt: device.lastSeenAt,
        lastReportedAt: device.lastReportedAt,
        batteryVoltage: device.batteryVoltage,
        batteryAh: device.batteryAh,
        batteryCount: device.batteryCount,
      } : null,
      liveData: snapshot ? {
        voltage1: snapshot.voltage1,
        voltage2: snapshot.voltage2,
        soc: snapshot.soc,
        powerKw: snapshot.power != null ? snapshot.power / 1000 : null,
        energyKwh: snapshot.energy,
        temperatureC: snapshot.temperature,
        temperatureF: temperatureFahrenheit,
        current: snapshot.current,
        charge: snapshot.charge,
        runtime: snapshot.runtime,
        rssi: snapshot.rssi,
        powerStatusString: snapshot.powerStatusString,
        isParked: snapshot.isParked,
        parkedSince: snapshot.parkedSince,
        recordedAt: snapshot.recordedAt,
        updatedAt: snapshot.updatedAt,
      } : null,
    });
  } catch (error) {
    console.error("Error getting driver's truck:", error);
    res.status(500).json({ error: "Failed to get truck data" });
  }
});

router.get("/my-truck/history", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const organizationId = req.session.organizationId!;

    const user = await storage.getUser(organizationId, userId);
    if (!user || !user.assignedTruckId) {
      return res.status(404).json({ error: "Not found" });
    }

    const truck = await storage.getTruck(organizationId, user.assignedTruckId);
    if (!truck) {
      return res.status(404).json({ error: "Not found" });
    }

    const device = await storage.getDeviceByTruck(organizationId, truck.id);
    
    if (!device) {
      return res.json({
        deviceId: null,
        truckId: truck.id,
        hours: parseInt(req.query.hours as string) || 24,
        measurements: [],
        count: 0,
      });
    }

    const hours = parseInt(req.query.hours as string) || 24;
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    const measurements = await storage.getMeasurements(organizationId, device.id, startTime, new Date());

    const formattedMeasurements = measurements.map(m => ({
      voltage1: m.voltage1,
      voltage2: m.voltage2,
      soc: m.soc,
      powerKw: m.power != null ? m.power / 1000 : null,
      energyKwh: m.energy,
      temperatureC: m.temperature,
      temperatureF: m.temperature != null ? (m.temperature * 9/5) + 32 : null,
      current: m.current,
      recordedAt: m.recordedAt,
    }));

    res.json({
      deviceId: device.id,
      truckId: truck.id,
      hours,
      measurements: formattedMeasurements,
      count: formattedMeasurements.length,
    });
  } catch (error) {
    console.error("Error getting truck history:", error);
    res.status(500).json({ error: "Failed to get truck history" });
  }
});

export default router;
