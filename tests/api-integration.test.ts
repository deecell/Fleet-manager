import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

vi.mock("../server/middleware/tenant", () => ({
  tenantMiddleware: (req: any, _res: any, next: any) => {
    req.organizationId = 1;
    req.organizationSlug = "test-org";
    req.userId = 1;
    next();
  },
  adminTenantMiddleware: (req: any, _res: any, next: any) => {
    req.organizationId = 1;
    req.organizationSlug = "test-org";
    next();
  },
  optionalTenantMiddleware: (req: any, _res: any, next: any) => {
    req.organizationId = 1;
    next();
  },
}));

vi.mock("../server/storage", () => {
  const mockTrucks = [
    { id: 1, organizationId: 1, truckNumber: "GFR-70", status: "in-service", make: "Kenworth", model: "T680", year: 2022, driverName: "John Smith", latitude: 33.8736, longitude: -118.1475 },
    { id: 2, organizationId: 1, truckNumber: "GFR-69", status: "in-service", make: "Freightliner", model: "Cascadia", year: 2021, driverName: "Jane Doe", latitude: 33.9425, longitude: -118.2551 },
  ];

  const mockDevices = [
    { id: 1, organizationId: 1, truckId: 1, serialNumber: "PM-001", status: "online", batteryVoltage: 25.6, batteryAh: 200, numberOfBatteries: 2 },
    { id: 2, organizationId: 1, truckId: 2, serialNumber: "PM-002", status: "online", batteryVoltage: 25.6, batteryAh: 200, numberOfBatteries: 2 },
  ];

  const mockSnapshots = [
    { id: 1, organizationId: 1, deviceId: 1, voltage1: 26.8, voltage2: 14.2, soc: 85, power: 150, charge: 50, temperature: 25, runtime: 3600, recordedAt: new Date(), todayParkedMinutes: 120, monthParkedMinutes: 3600 },
    { id: 2, organizationId: 1, deviceId: 2, voltage1: 25.2, voltage2: 12.5, soc: 72, power: 0, charge: 40, temperature: 22, runtime: 2400, recordedAt: new Date(), todayParkedMinutes: 480, monthParkedMinutes: 7200 },
  ];

  const mockShellySnapshots = [
    { id: 1, organizationId: 1, truckId: 1, isMoving: true, frequency: 45.5, lastMovementAt: new Date(), recordedAt: new Date() },
  ];

  const mockFleets = [
    { id: 1, organizationId: 1, name: "West Coast Fleet", description: "California operations" },
  ];

  return {
    storage: {
      listTrucks: vi.fn().mockResolvedValue(mockTrucks),
      getTruck: vi.fn().mockImplementation((orgId, id) => 
        Promise.resolve(mockTrucks.find(t => t.id === id))
      ),
      listDevices: vi.fn().mockResolvedValue(mockDevices),
      getDevice: vi.fn().mockImplementation((orgId, id) => 
        Promise.resolve(mockDevices.find(d => d.id === id))
      ),
      listSnapshots: vi.fn().mockResolvedValue(mockSnapshots),
      getSnapshot: vi.fn().mockImplementation((orgId, deviceId) => 
        Promise.resolve(mockSnapshots.find(s => s.deviceId === deviceId))
      ),
      listShellySnapshots: vi.fn().mockResolvedValue(mockShellySnapshots),
      listFleets: vi.fn().mockResolvedValue(mockFleets),
      getFleet: vi.fn().mockImplementation((orgId, id) => 
        Promise.resolve(mockFleets.find(f => f.id === id))
      ),
      getDeviceByTruck: vi.fn().mockImplementation((orgId, truckId) =>
        Promise.resolve(mockDevices.find(d => d.truckId === truckId))
      ),
      getSnapshotByTruck: vi.fn().mockImplementation((orgId, truckId) => {
        const device = mockDevices.find(d => d.truckId === truckId);
        return Promise.resolve(device ? mockSnapshots.find(s => s.deviceId === device.id) : undefined);
      }),
      getShellySnapshotByTruck: vi.fn().mockImplementation((orgId, truckId) =>
        Promise.resolve(mockShellySnapshots.find(s => s.truckId === truckId))
      ),
      countDevicesByStatus: vi.fn().mockResolvedValue([
        { status: "online", count: 2 },
        { status: "offline", count: 0 },
      ]),
      getFleetStats: vi.fn().mockResolvedValue({
        totalTrucks: 2,
        inServiceCount: 2,
        notInServiceCount: 0,
        onlineDevices: 2,
        offlineDevices: 0,
        avgSoc: 78.5,
        avgVoltage: 26.0,
        lowVoltageCount: 0,
      }),
      getDashboardData: vi.fn().mockResolvedValue({
        trucks: mockTrucks,
        devices: mockDevices,
        snapshots: mockSnapshots,
        shellySnapshots: mockShellySnapshots,
      }),
      getCredential: vi.fn().mockResolvedValue(null),
      getSyncStatus: vi.fn().mockResolvedValue(null),
    },
  };
});

import fleetRoutes from "../server/api/fleet-routes";

function createTestApp() {
  const app = express();
  
  app.use(express.json());
  
  app.use(session({
    secret: "test-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));
  
  app.use((req, _res, next) => {
    (req as any).organizationId = 1;
    (req as any).user = { id: 1, organizationId: 1, email: "test@example.com" };
    next();
  });
  
  app.use("/api/v1", fleetRoutes);
  
  return app;
}

describe("Fleet API Integration Tests", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  describe("GET /api/v1/trucks", () => {
    it("should return list of trucks", async () => {
      const response = await request(app).get("/api/v1/trucks");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("trucks");
      expect(Array.isArray(response.body.trucks)).toBe(true);
      expect(response.body.trucks).toHaveLength(2);
      expect(response.body.trucks[0]).toHaveProperty("truckNumber", "GFR-70");
      expect(response.body.trucks[1]).toHaveProperty("truckNumber", "GFR-69");
    });

    it("should include total count", async () => {
      const response = await request(app).get("/api/v1/trucks");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("total", 2);
    });
  });

  describe("GET /api/v1/trucks/:id", () => {
    it("should return specific truck", async () => {
      const response = await request(app).get("/api/v1/trucks/1");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("truck");
      expect(response.body.truck).toHaveProperty("truckNumber", "GFR-70");
    });

    it("should return 404 for non-existent truck", async () => {
      const response = await request(app).get("/api/v1/trucks/999");

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error", "Truck not found");
    });
  });

  describe("GET /api/v1/devices", () => {
    it("should return list of devices", async () => {
      const response = await request(app).get("/api/v1/devices");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("devices");
      expect(Array.isArray(response.body.devices)).toBe(true);
      expect(response.body.devices).toHaveLength(2);
    });

    it("should include device serial numbers", async () => {
      const response = await request(app).get("/api/v1/devices");

      expect(response.body.devices[0]).toHaveProperty("serialNumber", "PM-001");
    });
  });

  describe("GET /api/v1/devices/:id", () => {
    it("should return specific device with snapshot", async () => {
      const response = await request(app).get("/api/v1/devices/1");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("device");
      expect(response.body.device).toHaveProperty("serialNumber", "PM-001");
      expect(response.body).toHaveProperty("snapshot");
    });
  });

  describe("GET /api/v1/snapshots", () => {
    it("should return device snapshots", async () => {
      const response = await request(app).get("/api/v1/snapshots");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("snapshots");
      expect(Array.isArray(response.body.snapshots)).toBe(true);
      expect(response.body.snapshots).toHaveLength(2);
    });

    it("should include voltage and SoC data", async () => {
      const response = await request(app).get("/api/v1/snapshots");

      const snapshot = response.body.snapshots[0];
      expect(snapshot).toHaveProperty("voltage1");
      expect(snapshot).toHaveProperty("voltage2");
      expect(snapshot).toHaveProperty("soc");
    });
  });

  describe("GET /api/v1/shelly-snapshots", () => {
    it("should return Shelly vibration sensor snapshots", async () => {
      const response = await request(app).get("/api/v1/shelly-snapshots");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("snapshots");
      expect(Array.isArray(response.body.snapshots)).toBe(true);
    });

    it("should include movement status", async () => {
      const response = await request(app).get("/api/v1/shelly-snapshots");

      if (response.body.snapshots.length > 0) {
        expect(response.body.snapshots[0]).toHaveProperty("isMoving");
        expect(response.body.snapshots[0]).toHaveProperty("frequency");
      }
    });
  });

  describe("GET /api/v1/fleets", () => {
    it("should return list of fleets", async () => {
      const response = await request(app).get("/api/v1/fleets");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("fleets");
      expect(Array.isArray(response.body.fleets)).toBe(true);
    });
  });

  describe("GET /api/v1/devices/stats", () => {
    it("should return device status counts", async () => {
      const response = await request(app).get("/api/v1/devices/stats");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("statusCounts");
      expect(Array.isArray(response.body.statusCounts)).toBe(true);
    });
  });

  describe("GET /api/v1/dashboard/stats", () => {
    it("should return fleet statistics", async () => {
      const response = await request(app).get("/api/v1/dashboard/stats");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("stats");
      expect(response.body.stats).toHaveProperty("totalTrucks");
      expect(response.body.stats).toHaveProperty("inServiceCount");
      expect(response.body.stats).toHaveProperty("onlineDevices");
    });
  });

  describe("Dashboard Data Flow Validation", () => {
    it("should correctly correlate trucks with devices", async () => {
      const trucksResponse = await request(app).get("/api/v1/trucks");
      const devicesResponse = await request(app).get("/api/v1/devices");

      const trucks = trucksResponse.body.trucks;
      const devices = devicesResponse.body.devices;

      expect(devices.every((d: any) => 
        trucks.some((t: any) => t.id === d.truckId)
      )).toBe(true);
    });

    it("should correctly correlate devices with snapshots", async () => {
      const devicesResponse = await request(app).get("/api/v1/devices");
      const snapshotsResponse = await request(app).get("/api/v1/snapshots");

      const devices = devicesResponse.body.devices;
      const snapshots = snapshotsResponse.body.snapshots;

      expect(snapshots.every((s: any) => 
        devices.some((d: any) => d.id === s.deviceId)
      )).toBe(true);
    });

    it("should have valid voltage readings for status determination", async () => {
      const response = await request(app).get("/api/v1/snapshots");

      const snapshots = response.body.snapshots;
      
      snapshots.forEach((snapshot: any) => {
        expect(snapshot.voltage2).toBeGreaterThanOrEqual(0);
        expect(snapshot.voltage2).toBeLessThan(20);
      });
    });

    it("should distinguish engine-on vs engine-off based on voltage2", async () => {
      const response = await request(app).get("/api/v1/snapshots");

      const snapshots = response.body.snapshots;
      
      const engineOnSnapshot = snapshots.find((s: any) => s.voltage2 >= 13.2);
      const engineOffSnapshot = snapshots.find((s: any) => s.voltage2 < 13.2);
      
      expect(engineOnSnapshot).toBeDefined();
      expect(engineOffSnapshot).toBeDefined();
      expect(engineOnSnapshot.voltage2).toBeGreaterThanOrEqual(13.2);
      expect(engineOffSnapshot.voltage2).toBeLessThan(13.2);
    });
  });
});
