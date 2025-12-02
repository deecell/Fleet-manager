import { Router, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

const router = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const migrationAuthMiddleware = (req: Request, res: Response, next: Function) => {
  const authHeader = req.headers.authorization;
  
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ 
      error: "Migration service unavailable", 
      message: "ADMIN_PASSWORD not configured" 
    });
  }
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ 
      error: "Unauthorized", 
      message: "Bearer token required" 
    });
  }
  
  const token = authHeader.substring(7);
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ 
      error: "Unauthorized", 
      message: "Invalid token" 
    });
  }
  
  next();
};

router.get("/status", migrationAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tables = await db.execute(sql`
      SELECT table_name, 
             (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    const counts: Record<string, number> = {};
    for (const table of tables.rows as any[]) {
      const countResult = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM "${table.table_name}"`));
      counts[table.table_name] = Number((countResult.rows[0] as any).count);
    }
    
    res.json({ 
      status: "connected",
      tables: counts,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("Migration status error:", error);
    res.status(500).json({ 
      error: "Database error", 
      message: error.message 
    });
  }
});

router.post("/run-sql", migrationAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { statements } = req.body;
    
    if (!statements || !Array.isArray(statements)) {
      return res.status(400).json({ 
        error: "Invalid request", 
        message: "statements array required" 
      });
    }
    
    const results: { statement: string; success: boolean; error?: string }[] = [];
    
    for (const statement of statements) {
      if (!statement.trim()) continue;
      
      try {
        await db.execute(sql.raw(statement));
        results.push({ statement: statement.substring(0, 100), success: true });
      } catch (err: any) {
        results.push({ 
          statement: statement.substring(0, 100), 
          success: false, 
          error: err.message 
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    res.json({ 
      message: `Executed ${successCount} statements successfully, ${failCount} failed`,
      results 
    });
  } catch (error: any) {
    console.error("Migration run error:", error);
    res.status(500).json({ 
      error: "Migration failed", 
      message: error.message 
    });
  }
});

router.post("/import-initial-data", migrationAuthMiddleware, async (req: Request, res: Response) => {
  console.log("[Migration] Starting initial data import...");
  
  try {
    const checkOrgs = await db.execute(sql`SELECT COUNT(*) as count FROM organizations`);
    const orgCount = Number((checkOrgs.rows[0] as any).count);
    
    if (orgCount > 0) {
      return res.status(400).json({ 
        error: "Data already exists", 
        message: `Found ${orgCount} organizations. Use /run-sql for incremental migrations.`,
        existingCount: orgCount
      });
    }
    
    const migrationSQL = `
-- Organizations
INSERT INTO organizations (id, name, slug, plan, "isActive", settings, "createdAt", "updatedAt") VALUES (7, 'Deecell Power Systems', 'deecell', 'enterprise', TRUE, NULL, '2025-12-01T00:42:08.039Z', '2025-12-01T00:42:08.039Z') ON CONFLICT DO NOTHING;
INSERT INTO organizations (id, name, slug, plan, "isActive", settings, "createdAt", "updatedAt") VALUES (8, 'Killin'' Time Racing', 'ktr', 'standard', TRUE, NULL, '2025-12-01T20:23:46.380Z', '2025-12-01T20:23:46.380Z') ON CONFLICT DO NOTHING;
INSERT INTO organizations (id, name, slug, plan, "isActive", settings, "createdAt", "updatedAt") VALUES (9, 'GTO Fast Racing', 'gfr', 'standard', TRUE, NULL, '2025-12-01T20:28:08.870Z', '2025-12-01T20:28:08.870Z') ON CONFLICT DO NOTHING;
INSERT INTO organizations (id, name, slug, plan, "isActive", settings, "createdAt", "updatedAt") VALUES (10, 'Carter Racing', 'carter-racing', 'standard', TRUE, NULL, '2025-12-01T20:37:15.196Z', '2025-12-01T20:37:15.196Z') ON CONFLICT DO NOTHING;

-- Users
INSERT INTO users (id, "organizationId", email, "passwordHash", "firstName", "lastName", role, "isActive", "lastLoginAt", "createdAt", "updatedAt") VALUES (2, 9, 'am@gtofast.com', '$2b$10$rKWhKXtRbFphDlABdMWuC.LBMUJOvEQ0ZPKCi0A5p2OvZMe7B1KKq', 'Admin', 'User', 'super_admin', TRUE, '2025-12-02T03:19:39.627Z', '2025-12-01T00:42:39.643Z', '2025-12-02T03:19:39.627Z') ON CONFLICT DO NOTHING;

-- Fleets
INSERT INTO fleets (id, "organizationId", name, description, timezone, "isActive", "createdAt", "updatedAt") VALUES (5, 7, 'GFR', 'Initial fleet for DCL-Moeck testing', 'America/Los_Angeles', TRUE, '2025-12-01T00:42:43.527Z', '2025-12-01T00:48:41.823Z') ON CONFLICT DO NOTHING;
INSERT INTO fleets (id, "organizationId", name, description, timezone, "isActive", "createdAt", "updatedAt") VALUES (6, 8, 'Hauler', 'Racecar Hauler', 'America/New_York', TRUE, '2025-12-01T20:25:19.230Z', '2025-12-01T20:25:19.230Z') ON CONFLICT DO NOTHING;
INSERT INTO fleets (id, "organizationId", name, description, timezone, "isActive", "createdAt", "updatedAt") VALUES (7, 9, 'GFR', 'Main fleet for GTO Fast Racing', 'America/Los_Angeles', TRUE, '2025-12-01T20:33:38.086Z', '2025-12-01T20:36:26.132Z') ON CONFLICT DO NOTHING;
INSERT INTO fleets (id, "organizationId", name, description, timezone, "isActive", "createdAt", "updatedAt") VALUES (8, 10, 'Carter', 'Racecar Haulers', 'America/Los_Angeles', TRUE, '2025-12-01T20:37:55.102Z', '2025-12-01T20:37:55.102Z') ON CONFLICT DO NOTHING;

-- Trucks
INSERT INTO trucks (id, "organizationId", "fleetId", "truckNumber", "driverName", make, model, year, "vinNumber", "licensePlate", status, latitude, longitude, "lastLocationUpdate", "isActive", "createdAt", "updatedAt") VALUES (20, 9, 7, 'GFR-69', 'A Moeck', 'T&E', '53'' Stacker', 2001, '', '', 'in-service', 37.7749, -122.4194, NULL, TRUE, '2025-12-01T00:42:54.696Z', '2025-12-02T02:37:39.056Z') ON CONFLICT DO NOTHING;
INSERT INTO trucks (id, "organizationId", "fleetId", "truckNumber", "driverName", make, model, year, "vinNumber", "licensePlate", status, latitude, longitude, "lastLocationUpdate", "isActive", "createdAt", "updatedAt") VALUES (21, 8, 6, 'NRC0-Freightliner', 'Jacob Truelove', 'Freightliner', 'NRC', 2001, '', '', 'in-service', NULL, NULL, NULL, TRUE, '2025-12-01T20:26:18.913Z', '2025-12-01T20:26:18.913Z') ON CONFLICT DO NOTHING;
INSERT INTO trucks (id, "organizationId", "fleetId", "truckNumber", "driverName", make, model, year, "vinNumber", "licensePlate", status, latitude, longitude, "lastLocationUpdate", "isActive", "createdAt", "updatedAt") VALUES (22, 10, 8, 'NRC-Freightliner', 'Dean Carter', 'Freightliner', 'NRC', 2026, '', '', 'in-service', NULL, NULL, NULL, TRUE, '2025-12-01T20:38:38.934Z', '2025-12-01T20:38:38.934Z') ON CONFLICT DO NOTHING;
INSERT INTO trucks (id, "organizationId", "fleetId", "truckNumber", "driverName", make, model, year, "vinNumber", "licensePlate", status, latitude, longitude, "lastLocationUpdate", "isActive", "createdAt", "updatedAt") VALUES (23, 9, 7, 'GFR-70', 'A Moeck', 'T&E', '53'' Stacker', 2001, '', '', 'in-service', NULL, NULL, NULL, TRUE, '2025-12-02T03:18:38.642Z', '2025-12-02T03:18:38.642Z') ON CONFLICT DO NOTHING;

-- PowerMon Devices
INSERT INTO power_mon_devices (id, "organizationId", "truckId", "serialNumber", "deviceName", "hardwareRevision", "firmwareVersion", "hostId", status, "lastSeenAt", "assignedAt", "unassignedAt", "isActive", "createdAt", "updatedAt") VALUES (20, 9, 20, 'A3A5B30EA9B3FF98', 'DCL-Moeck', 'PowerMon-W', '1.32', '41', 'online', '2025-12-01T19:50:33.609Z', '2025-12-01T00:43:37.173Z', NULL, TRUE, '2025-12-01T00:43:37.173Z', '2025-12-01T20:33:21.901Z') ON CONFLICT DO NOTHING;
INSERT INTO power_mon_devices (id, "organizationId", "truckId", "serialNumber", "deviceName", "hardwareRevision", "firmwareVersion", "hostId", status, "lastSeenAt", "assignedAt", "unassignedAt", "isActive", "createdAt", "updatedAt") VALUES (21, 10, NULL, 'PM-001-12345', 'DCL-Carter', '4.1', '1.20', NULL, 'offline', NULL, NULL, NULL, TRUE, '2025-12-01T20:41:19.033Z', '2025-12-01T20:41:19.033Z') ON CONFLICT DO NOTHING;
INSERT INTO power_mon_devices (id, "organizationId", "truckId", "serialNumber", "deviceName", "hardwareRevision", "firmwareVersion", "hostId", status, "lastSeenAt", "assignedAt", "unassignedAt", "isActive", "createdAt", "updatedAt") VALUES (23, 9, NULL, 'A3A5B30EA9B3FF99', 'DCL-Moeck-Shop', '1.0', '1.0', NULL, 'offline', NULL, NULL, NULL, TRUE, '2025-12-02T02:40:38.881Z', '2025-12-02T02:40:38.881Z') ON CONFLICT DO NOTHING;

-- Device Credentials
INSERT INTO device_credentials (id, "organizationId", "deviceId", "connectionKey", "accessKey", "applinkUrl", "isActive", "createdAt", "updatedAt") VALUES (1, 7, 20, 'c1HOvvGTYe4HcxZ1AWUUVg==', 'qN19gp1NyTIjTcKXIFUagek74WSxnF9446mW1lX0Ca4=', 'https://applinks.thornwave.com/?n=DCL-Moeck&s=a3a5b30ea9b3ff98&h=41&c=c1HOvvGTYe4HcxZ1AWUUVg%3D%3D&k=qN19gp1NyTIjTcKXIFUagek74WSxnF9446mW1lX0Ca4%3D', TRUE, '2025-12-01T00:43:53.071Z', '2025-12-01T00:43:53.071Z') ON CONFLICT DO NOTHING;
INSERT INTO device_credentials (id, "organizationId", "deviceId", "connectionKey", "accessKey", "applinkUrl", "isActive", "createdAt", "updatedAt") VALUES (2, 9, 23, 'YsksoLgw6cagr3EaqCIPgg==', 'x+gLsbKxlDfY9AvDYVUog3y+qSDRDXb+4V+fzOidX2s=', 'https://applinks.thornwave.com/?n=DCL-Moeck-Shop&s=1982a3044d3599e2&h=10&c=YsksoLgw6cagr3EaqCIPgg%3D%3D&k=x%2BgLsbKxlDfY9AvDYVUog3y%2BqSDRDXb%2B4V%2BfzOidX2s%3D', TRUE, '2025-12-02T02:48:49.243Z', '2025-12-02T02:48:49.243Z') ON CONFLICT DO NOTHING;

-- Device Snapshots
INSERT INTO device_snapshots (id, "organizationId", "deviceId", "truckId", "fleetId", voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, "powerStatus", "powerStatusString", "recordedAt", "updatedAt") VALUES (20, 9, 20, 20, 7, 28.982466, NULL, -1.6367173, -47.436104, 24.710938, 99, -668.526, -25.695, 14149, -24, NULL, 'OFF', '2025-12-01T19:50:38.213Z', '2025-12-01T20:33:47.731Z') ON CONFLICT DO NOTHING;

-- Device Measurements
INSERT INTO device_measurements (id, "organizationId", "deviceId", "truckId", voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, "powerStatus", "powerStatusString", source, "recordedAt", "createdAt") VALUES (4837, 9, 20, 20, 26.544666, NULL, -1.9628624, -52.103527, 19.398438, 97, -647.549, -24.388, 12547, -23, NULL, 'OFF', 'poll', '2025-12-01T01:48:44.499Z', '2025-12-01T01:48:45.531Z') ON CONFLICT DO NOTHING;
INSERT INTO device_measurements (id, "organizationId", "deviceId", "truckId", voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, "powerStatus", "powerStatusString", source, "recordedAt", "createdAt") VALUES (4838, 9, 20, 20, 26.545431, NULL, -1.9103888, -50.712093, 19.46875, 97, -647.739, -24.395, 12472, -23, NULL, 'OFF', 'poll', '2025-12-01T01:48:54.972Z', '2025-12-01T01:48:59.552Z') ON CONFLICT DO NOTHING;
INSERT INTO device_measurements (id, "organizationId", "deviceId", "truckId", voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, "powerStatus", "powerStatusString", source, "recordedAt", "createdAt") VALUES (4839, 9, 20, 20, 26.544447, NULL, -1.9467049, -51.674206, 19.421875, 97, -647.873, -24.4, 12541, -23, NULL, 'OFF', 'poll', '2025-12-01T01:49:08.385Z', '2025-12-01T01:49:09.565Z') ON CONFLICT DO NOTHING;
INSERT INTO device_measurements (id, "organizationId", "deviceId", "truckId", voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, "powerStatus", "powerStatusString", source, "recordedAt", "createdAt") VALUES (4840, 9, 20, 20, 28.978905, NULL, -1.7075294, -49.482334, 22.203125, 99, -632.765, -24.461, 14011, -23, NULL, 'OFF', 'poll', '2025-12-01T19:06:09.317Z', '2025-12-01T19:06:10.466Z') ON CONFLICT DO NOTHING;
INSERT INTO device_measurements (id, "organizationId", "deviceId", "truckId", voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, "powerStatus", "powerStatusString", source, "recordedAt", "createdAt") VALUES (4841, 9, 20, 20, 28.980682, NULL, -1.6313846, -47.27864, 22.53125, 99, -637.183, -24.614, 14414, -23, NULL, 'OFF', 'poll', '2025-12-01T19:11:38.810Z', '2025-12-01T19:11:40.140Z') ON CONFLICT DO NOTHING;
INSERT INTO device_measurements (id, "organizationId", "deviceId", "truckId", voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, "powerStatus", "powerStatusString", source, "recordedAt", "createdAt") VALUES (4842, 9, 20, 20, 28.981285, NULL, -1.617791, -46.885662, 22.578125, 99, -637.323, -24.619, 14619, -23, NULL, 'OFF', 'poll', '2025-12-01T19:11:49.374Z', '2025-12-01T19:11:50.153Z') ON CONFLICT DO NOTHING;
INSERT INTO device_measurements (id, "organizationId", "deviceId", "truckId", voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, "powerStatus", "powerStatusString", source, "recordedAt", "createdAt") VALUES (4843, 9, 20, 20, 28.982466, NULL, -1.6367173, -47.436104, 24.710938, 99, -668.526, -25.695, 14149, -24, NULL, 'OFF', 'poll', '2025-12-01T19:50:38.213Z', '2025-12-01T19:50:39.545Z') ON CONFLICT DO NOTHING;

-- Fuel Prices
INSERT INTO fuel_prices (id, "priceDate", "pricePerGallon", region, source, "createdAt") VALUES (2, '2025-11-24T00:00:00.000Z', 4.514, 'PADD5', 'EIA', '2025-12-01T01:49:25.389Z') ON CONFLICT DO NOTHING;

-- Reset sequences
SELECT setval('organizations_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM organizations), false);
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM users), false);
SELECT setval('fleets_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM fleets), false);
SELECT setval('trucks_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM trucks), false);
SELECT setval('power_mon_devices_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM power_mon_devices), false);
SELECT setval('device_credentials_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM device_credentials), false);
SELECT setval('device_snapshots_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM device_snapshots), false);
SELECT setval('device_measurements_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM device_measurements), false);
SELECT setval('fuel_prices_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM fuel_prices), false);
`;

    const statements = migrationSQL.split(';').filter(s => s.trim() && !s.trim().startsWith('--'));
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      
      try {
        await db.execute(sql.raw(trimmed + ';'));
        successCount++;
      } catch (err: any) {
        errorCount++;
        errors.push(`${trimmed.substring(0, 50)}... -> ${err.message}`);
        console.error(`[Migration] Error: ${err.message}`);
      }
    }
    
    console.log(`[Migration] Complete: ${successCount} success, ${errorCount} errors`);
    
    res.json({
      success: errorCount === 0,
      message: `Imported ${successCount} records with ${errorCount} errors`,
      successCount,
      errorCount,
      errors: errors.slice(0, 10)
    });
    
  } catch (error: any) {
    console.error("[Migration] Fatal error:", error);
    res.status(500).json({ 
      error: "Migration failed", 
      message: error.message 
    });
  }
});

export default router;
