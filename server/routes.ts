import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getFileUrl, listFiles, getUploadPresignedUrl } from "./aws/s3";
import { query, testConnection, initializeTables } from "./aws/rds";

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

export async function registerRoutes(app: Express): Promise<Server> {
  // Test AWS RDS connection on startup
  const rdsConnected = await testConnection();
  if (rdsConnected) {
    console.log("AWS RDS connection established");
    try {
      await initializeTables();
    } catch (error) {
      console.error("Failed to initialize tables:", error);
    }
  } else {
    console.warn("AWS RDS connection failed - using in-memory storage");
  }

  // Health check endpoint
  app.get("/api/health", async (req: Request, res: Response) => {
    const rdsStatus = await testConnection();
    res.json({
      status: "ok",
      rds: rdsStatus ? "connected" : "disconnected",
      s3Bucket: process.env.S3_BUCKET_NAME || "not configured",
    });
  });

  // S3 File Operations
  app.get("/api/files", async (req: Request, res: Response) => {
    try {
      const prefix = req.query.prefix as string | undefined;
      const files = await listFiles(prefix);
      res.json({ files });
    } catch (error) {
      console.error("Error listing files:", error);
      res.status(500).json({ error: "Failed to list files" });
    }
  });

  app.get("/api/files/presigned-upload", requireApiKey, async (req: Request, res: Response) => {
    try {
      const { key, contentType } = req.query;
      if (!key || !contentType) {
        return res.status(400).json({ error: "Missing key or contentType" });
      }
      const url = await getUploadPresignedUrl(key as string, contentType as string);
      res.json({ url, key });
    } catch (error) {
      console.error("Error generating presigned URL:", error);
      res.status(500).json({ error: "Failed to generate presigned URL" });
    }
  });

  app.get("/api/files/:key(*)", async (req: Request, res: Response) => {
    try {
      const key = req.params.key;
      const url = await getFileUrl(key);
      res.json({ url });
    } catch (error) {
      console.error("Error getting file URL:", error);
      res.status(500).json({ error: "Failed to get file URL" });
    }
  });

  // Note: File deletion endpoint removed for security - use AWS Console or CLI for file management

  // RDS Database Operations - Trucks
  app.get("/api/rds/trucks", async (req: Request, res: Response) => {
    try {
      const trucks = await query("SELECT * FROM trucks ORDER BY name");
      res.json({ trucks });
    } catch (error) {
      console.error("Error fetching trucks from RDS:", error);
      res.status(500).json({ error: "Failed to fetch trucks" });
    }
  });

  app.get("/api/rds/trucks/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const trucks = await query("SELECT * FROM trucks WHERE id = $1", [id]);
      if (trucks.length === 0) {
        return res.status(404).json({ error: "Truck not found" });
      }
      res.json({ truck: trucks[0] });
    } catch (error) {
      console.error("Error fetching truck from RDS:", error);
      res.status(500).json({ error: "Failed to fetch truck" });
    }
  });

  app.post("/api/rds/trucks", requireApiKey, async (req: Request, res: Response) => {
    try {
      const { id, name, status, location, latitude, longitude, soc, v1, v2, i1, i2, w1, w2, temp1, temp2, model, serial, fw } = req.body;
      await query(
        `INSERT INTO trucks (id, name, status, location, latitude, longitude, soc, v1, v2, i1, i2, w1, w2, temp1, temp2, model, serial, fw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, status = EXCLUDED.status, location = EXCLUDED.location,
           latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, soc = EXCLUDED.soc,
           v1 = EXCLUDED.v1, v2 = EXCLUDED.v2, i1 = EXCLUDED.i1, i2 = EXCLUDED.i2,
           w1 = EXCLUDED.w1, w2 = EXCLUDED.w2, temp1 = EXCLUDED.temp1, temp2 = EXCLUDED.temp2,
           model = EXCLUDED.model, serial = EXCLUDED.serial, fw = EXCLUDED.fw,
           last_updated = CURRENT_TIMESTAMP`,
        [id, name, status, location, latitude, longitude, soc, v1, v2, i1, i2, w1, w2, temp1, temp2, model, serial, fw]
      );
      res.json({ success: true, id });
    } catch (error) {
      console.error("Error saving truck to RDS:", error);
      res.status(500).json({ error: "Failed to save truck" });
    }
  });

  // RDS Database Operations - Truck History
  app.get("/api/rds/trucks/:id/history", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const history = await query(
        "SELECT * FROM truck_history WHERE truck_id = $1 ORDER BY timestamp DESC LIMIT $2",
        [id, limit]
      );
      res.json({ history });
    } catch (error) {
      console.error("Error fetching truck history from RDS:", error);
      res.status(500).json({ error: "Failed to fetch truck history" });
    }
  });

  app.post("/api/rds/trucks/:id/history", requireApiKey, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { timestamp, soc, voltage, current, watts } = req.body;
      await query(
        `INSERT INTO truck_history (truck_id, timestamp, soc, voltage, current, watts)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, timestamp, soc, voltage, current, watts]
      );
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving truck history to RDS:", error);
      res.status(500).json({ error: "Failed to save truck history" });
    }
  });

  // RDS Database Operations - Notifications
  app.get("/api/rds/notifications", async (req: Request, res: Response) => {
    try {
      const notifications = await query("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50");
      res.json({ notifications });
    } catch (error) {
      console.error("Error fetching notifications from RDS:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  app.post("/api/rds/notifications", requireApiKey, async (req: Request, res: Response) => {
    try {
      const { id, truck_id, type, title, message } = req.body;
      await query(
        `INSERT INTO notifications (id, truck_id, type, title, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, truck_id, type, title, message]
      );
      res.json({ success: true, id });
    } catch (error) {
      console.error("Error saving notification to RDS:", error);
      res.status(500).json({ error: "Failed to save notification" });
    }
  });

  app.patch("/api/rds/notifications/:id/read", requireApiKey, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await query("UPDATE notifications SET read = TRUE WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ error: "Failed to update notification" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
