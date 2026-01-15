import { Router, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { z } from "zod";

const router = Router();

const requireApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKeyHeader = req.headers["x-api-key"];
  const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  const expectedKey = process.env.FLEET_API_KEY;
  
  if (!expectedKey || expectedKey.trim() === "") {
    return res.status(503).json({ error: "API key not configured on server" });
  }
  
  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: "Unauthorized - valid API key required" });
  }
  
  next();
};

const shellyWebhookSchema = z.object({
  device_id: z.string(),
  frequency: z.number().optional().default(0),
  temperature: z.number().optional(),
  rssi: z.number().optional(),
  is_moving: z.boolean().optional(),
});

// Handler function for vibration webhook (supports both GET and POST)
const handleVibration = async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device_id as string || req.body.device_id;
    const pulseCount = parseInt(req.query.pulse_count as string) || req.body.pulse_count || 0;
    const temperature = req.query.temperature ? parseFloat(req.query.temperature as string) : req.body.temperature;
    const rssi = req.query.rssi ? parseInt(req.query.rssi as string) : req.body.rssi;

    if (!deviceId) {
      return res.status(400).json({ error: "Missing device_id" });
    }

    const existingDevice = await storage.getShellyDeviceByDeviceId(deviceId);
    
    if (!existingDevice) {
      console.log(`[Shelly] Received data from unregistered device: ${deviceId}`);
      return res.status(404).json({ 
        error: "Device not registered",
        device_id: deviceId,
        hint: "Register this device in the admin dashboard first"
      });
    }

    const now = new Date();
    let frequency = 0;

    // Calculate frequency from pulse count delta
    if (existingDevice.lastPulseCount !== null && existingDevice.lastPulseCountAt) {
      const elapsedMs = now.getTime() - new Date(existingDevice.lastPulseCountAt).getTime();
      const elapsedSeconds = elapsedMs / 1000;
      
      if (elapsedSeconds > 0 && elapsedSeconds < 300) { // Ignore gaps > 5 min
        const pulseDelta = pulseCount - (existingDevice.lastPulseCount || 0);
        if (pulseDelta >= 0) { // Handle counter reset
          frequency = pulseDelta / elapsedSeconds; // Hz (pulses per second)
        }
      }
    }

    const movementThreshold = existingDevice.movementThreshold || 10;
    const isMoving = frequency >= movementThreshold;

    await storage.updateShellyDeviceByDeviceId(deviceId, {
      lastSeenAt: now,
      connectionStatus: "online",
      lastFrequency: frequency,
      lastPulseCount: pulseCount,
      lastPulseCountAt: now,
      isMoving: isMoving,
    });

    if (existingDevice.truckId) {
      await storage.upsertShellySnapshot({
        organizationId: existingDevice.organizationId,
        shellyDeviceId: existingDevice.id,
        truckId: existingDevice.truckId,
        frequency: frequency,
        isMoving: isMoving,
        lastMovementAt: isMoving ? now : undefined, // Only update when moving
        temperature: temperature,
        rssi: rssi,
        recordedAt: now,
      });
    }

    // Log reading to historical table for calibration/analysis
    await storage.insertShellyReading({
      organizationId: existingDevice.organizationId,
      shellyDeviceId: existingDevice.id,
      truckId: existingDevice.truckId,
      pulseCount: pulseCount,
      frequency: frequency,
      isMoving: isMoving,
      temperature: temperature,
      rssi: rssi,
      recordedAt: now,
    });

    console.log(`[Shelly] Device ${deviceId}: pulse=${pulseCount}, freq=${frequency.toFixed(2)}Hz, moving=${isMoving}`);

    res.json({
      success: true,
      device_id: deviceId,
      pulse_count: pulseCount,
      frequency: frequency,
      is_moving: isMoving,
      connection_status: "online",
    });
  } catch (error) {
    console.error("[Shelly] Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Register both GET and POST for vibration webhook (Shelly uses GET by default)
router.get("/vibration", handleVibration);
router.post("/vibration", handleVibration);

router.post("/heartbeat", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device_id as string || req.body.device_id;

    if (!deviceId) {
      return res.status(400).json({ error: "Missing device_id" });
    }

    const existingDevice = await storage.getShellyDeviceByDeviceId(deviceId);
    
    if (!existingDevice) {
      return res.status(404).json({ error: "Device not registered" });
    }

    await storage.updateShellyDeviceByDeviceId(deviceId, {
      lastSeenAt: new Date(),
      connectionStatus: "online",
    });

    res.json({ success: true, device_id: deviceId, status: "online" });
  } catch (error) {
    console.error("[Shelly] Heartbeat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/devices", requireApiKey, async (req: Request, res: Response) => {
  try {
    const devices = await storage.listAllShellyDevices();
    res.json({ devices });
  } catch (error) {
    console.error("[Shelly] Error listing devices:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/check-offline", requireApiKey, async (req: Request, res: Response) => {
  try {
    const offlineThresholdMinutes = parseInt(req.query.threshold as string) || 2;
    const cutoffTime = new Date(Date.now() - offlineThresholdMinutes * 60 * 1000);
    
    const markedOffline = await storage.markShellyDevicesOffline(cutoffTime);
    
    console.log(`[Shelly] Marked ${markedOffline} device(s) as offline (threshold: ${offlineThresholdMinutes}min)`);
    
    res.json({
      success: true,
      devices_marked_offline: markedOffline,
      threshold_minutes: offlineThresholdMinutes,
      cutoff_time: cutoffTime.toISOString(),
    });
  } catch (error) {
    console.error("[Shelly] Check-offline error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
