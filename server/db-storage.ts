import { db } from "./db";
import { eq, and, desc, asc, gte, lte, sql, inArray } from "drizzle-orm";
import {
  organizations, users, fleets, trucks, powerMonDevices,
  deviceCredentials, deviceSnapshots, deviceMeasurements,
  deviceSyncStatus, alerts, auditLogs, pollingSettings,
  type Organization, type InsertOrganization,
  type User, type InsertUser,
  type Fleet, type InsertFleet,
  type Truck, type InsertTruck,
  type PowerMonDevice, type InsertPowerMonDevice,
  type DeviceCredential, type InsertDeviceCredential,
  type DeviceSnapshot, type InsertDeviceSnapshot,
  type DeviceMeasurement, type InsertDeviceMeasurement,
  type DeviceSyncStatus, type InsertDeviceSyncStatus,
  type Alert, type InsertAlert,
  type AuditLog, type InsertAuditLog,
  type PollingSetting, type InsertPollingSetting,
} from "@shared/schema";

export class DbStorage {
  // ===========================================================================
  // ORGANIZATIONS
  // ===========================================================================
  
  async createOrganization(data: InsertOrganization): Promise<Organization> {
    const [org] = await db.insert(organizations).values(data).returning();
    return org;
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
    return org;
  }

  async listOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations).orderBy(asc(organizations.name));
  }

  async updateOrganization(id: number, data: Partial<InsertOrganization>): Promise<Organization | undefined> {
    const [org] = await db.update(organizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return org;
  }

  // ===========================================================================
  // USERS (tenant-scoped)
  // ===========================================================================
  
  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async getUser(organizationId: number, id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.id, id)));
    return user;
  }

  async getUserByEmail(organizationId: number, email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.email, email)));
    return user;
  }

  async listUsers(organizationId: number): Promise<User[]> {
    return db.select().from(users)
      .where(eq(users.organizationId, organizationId))
      .orderBy(asc(users.lastName), asc(users.firstName));
  }

  async updateUser(organizationId: number, id: number, data: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(users.organizationId, organizationId), eq(users.id, id)))
      .returning();
    return user;
  }

  async updateUserLastLogin(organizationId: number, id: number): Promise<void> {
    await db.update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(and(eq(users.organizationId, organizationId), eq(users.id, id)));
  }

  // ===========================================================================
  // FLEETS (tenant-scoped)
  // ===========================================================================
  
  async createFleet(data: InsertFleet): Promise<Fleet> {
    const [fleet] = await db.insert(fleets).values(data).returning();
    return fleet;
  }

  async getFleet(organizationId: number, id: number): Promise<Fleet | undefined> {
    const [fleet] = await db.select().from(fleets)
      .where(and(eq(fleets.organizationId, organizationId), eq(fleets.id, id)));
    return fleet;
  }

  async getFleetByName(organizationId: number, name: string): Promise<Fleet | undefined> {
    const [fleet] = await db.select().from(fleets)
      .where(and(eq(fleets.organizationId, organizationId), eq(fleets.name, name)));
    return fleet;
  }

  async listFleets(organizationId: number): Promise<Fleet[]> {
    return db.select().from(fleets)
      .where(eq(fleets.organizationId, organizationId))
      .orderBy(asc(fleets.name));
  }

  async updateFleet(organizationId: number, id: number, data: Partial<InsertFleet>): Promise<Fleet | undefined> {
    const [fleet] = await db.update(fleets)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(fleets.organizationId, organizationId), eq(fleets.id, id)))
      .returning();
    return fleet;
  }

  async deleteFleet(organizationId: number, id: number): Promise<boolean> {
    const result = await db.delete(fleets)
      .where(and(eq(fleets.organizationId, organizationId), eq(fleets.id, id)));
    return (result.rowCount ?? 0) > 0;
  }

  // ===========================================================================
  // TRUCKS (tenant-scoped with fleet filtering)
  // ===========================================================================
  
  async createTruck(data: InsertTruck): Promise<Truck> {
    const [truck] = await db.insert(trucks).values(data).returning();
    return truck;
  }

  async getTruck(organizationId: number, id: number): Promise<Truck | undefined> {
    const [truck] = await db.select().from(trucks)
      .where(and(eq(trucks.organizationId, organizationId), eq(trucks.id, id)));
    return truck;
  }

  async getTruckByNumber(organizationId: number, truckNumber: string): Promise<Truck | undefined> {
    const [truck] = await db.select().from(trucks)
      .where(and(eq(trucks.organizationId, organizationId), eq(trucks.truckNumber, truckNumber)));
    return truck;
  }

  async listTrucks(organizationId: number, fleetId?: number, status?: string): Promise<Truck[]> {
    const conditions = [eq(trucks.organizationId, organizationId)];
    if (fleetId !== undefined) conditions.push(eq(trucks.fleetId, fleetId));
    if (status !== undefined) conditions.push(eq(trucks.status, status));
    
    return db.select().from(trucks)
      .where(and(...conditions))
      .orderBy(asc(trucks.truckNumber));
  }

  async countTrucksByStatus(organizationId: number, fleetId?: number): Promise<{ status: string; count: number }[]> {
    const conditions = [eq(trucks.organizationId, organizationId)];
    if (fleetId !== undefined) conditions.push(eq(trucks.fleetId, fleetId));
    
    const result = await db.select({
      status: trucks.status,
      count: sql<number>`count(*)::int`,
    })
      .from(trucks)
      .where(and(...conditions))
      .groupBy(trucks.status);
    
    return result.map(r => ({ status: r.status || 'unknown', count: r.count }));
  }

  async updateTruck(organizationId: number, id: number, data: Partial<InsertTruck>): Promise<Truck | undefined> {
    const [truck] = await db.update(trucks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(trucks.organizationId, organizationId), eq(trucks.id, id)))
      .returning();
    return truck;
  }

  async updateTruckLocation(organizationId: number, id: number, latitude: number, longitude: number): Promise<void> {
    await db.update(trucks)
      .set({ latitude, longitude, lastLocationUpdate: new Date(), updatedAt: new Date() })
      .where(and(eq(trucks.organizationId, organizationId), eq(trucks.id, id)));
  }

  async deleteTruck(organizationId: number, id: number): Promise<boolean> {
    const result = await db.delete(trucks)
      .where(and(eq(trucks.organizationId, organizationId), eq(trucks.id, id)));
    return (result.rowCount ?? 0) > 0;
  }

  // ===========================================================================
  // POWER MON DEVICES (tenant-scoped)
  // ===========================================================================
  
  async createDevice(data: InsertPowerMonDevice): Promise<PowerMonDevice> {
    const [device] = await db.insert(powerMonDevices).values(data).returning();
    return device;
  }

  async getDevice(organizationId: number, id: number): Promise<PowerMonDevice | undefined> {
    const [device] = await db.select().from(powerMonDevices)
      .where(and(eq(powerMonDevices.organizationId, organizationId), eq(powerMonDevices.id, id)));
    return device;
  }

  async getDeviceBySerial(organizationId: number, serialNumber: string): Promise<PowerMonDevice | undefined> {
    const [device] = await db.select().from(powerMonDevices)
      .where(and(eq(powerMonDevices.organizationId, organizationId), eq(powerMonDevices.serialNumber, serialNumber)));
    return device;
  }

  async checkSerialExists(serialNumber: string): Promise<boolean> {
    const [device] = await db.select({ id: powerMonDevices.id }).from(powerMonDevices)
      .where(eq(powerMonDevices.serialNumber, serialNumber))
      .limit(1);
    return device !== undefined;
  }

  async getDeviceByTruck(organizationId: number, truckId: number): Promise<PowerMonDevice | undefined> {
    const [device] = await db.select().from(powerMonDevices)
      .where(and(eq(powerMonDevices.organizationId, organizationId), eq(powerMonDevices.truckId, truckId)));
    return device;
  }

  async listDevices(organizationId: number, status?: string): Promise<PowerMonDevice[]> {
    const conditions = [eq(powerMonDevices.organizationId, organizationId)];
    if (status !== undefined) conditions.push(eq(powerMonDevices.status, status));
    
    return db.select().from(powerMonDevices)
      .where(and(...conditions))
      .orderBy(asc(powerMonDevices.serialNumber));
  }

  async countDevicesByStatus(organizationId: number): Promise<{ status: string; count: number }[]> {
    const result = await db.select({
      status: powerMonDevices.status,
      count: sql<number>`count(*)::int`,
    })
      .from(powerMonDevices)
      .where(eq(powerMonDevices.organizationId, organizationId))
      .groupBy(powerMonDevices.status);
    
    return result.map(r => ({ status: r.status || 'unknown', count: r.count }));
  }

  async updateDevice(organizationId: number, id: number, data: Partial<InsertPowerMonDevice>): Promise<PowerMonDevice | undefined> {
    const [device] = await db.update(powerMonDevices)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(powerMonDevices.organizationId, organizationId), eq(powerMonDevices.id, id)))
      .returning();
    return device;
  }

  async assignDeviceToTruck(organizationId: number, deviceId: number, truckId: number): Promise<PowerMonDevice | undefined> {
    const [device] = await db.update(powerMonDevices)
      .set({ truckId, assignedAt: new Date(), unassignedAt: null, updatedAt: new Date() })
      .where(and(eq(powerMonDevices.organizationId, organizationId), eq(powerMonDevices.id, deviceId)))
      .returning();
    return device;
  }

  async unassignDevice(organizationId: number, deviceId: number): Promise<PowerMonDevice | undefined> {
    const [device] = await db.update(powerMonDevices)
      .set({ truckId: null, unassignedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(powerMonDevices.organizationId, organizationId), eq(powerMonDevices.id, deviceId)))
      .returning();
    return device;
  }

  async updateDeviceStatus(organizationId: number, id: number, status: string): Promise<void> {
    await db.update(powerMonDevices)
      .set({ status, lastSeenAt: status === 'online' ? new Date() : undefined, updatedAt: new Date() })
      .where(and(eq(powerMonDevices.organizationId, organizationId), eq(powerMonDevices.id, id)));
  }

  // ===========================================================================
  // DEVICE CREDENTIALS (tenant-scoped)
  // ===========================================================================
  
  async createCredential(data: InsertDeviceCredential): Promise<DeviceCredential> {
    const [cred] = await db.insert(deviceCredentials).values(data).returning();
    return cred;
  }

  async getCredential(organizationId: number, deviceId: number): Promise<DeviceCredential | undefined> {
    const [cred] = await db.select().from(deviceCredentials)
      .where(and(eq(deviceCredentials.organizationId, organizationId), eq(deviceCredentials.deviceId, deviceId)));
    return cred;
  }

  async updateCredential(organizationId: number, deviceId: number, data: Partial<InsertDeviceCredential>): Promise<DeviceCredential | undefined> {
    const [cred] = await db.update(deviceCredentials)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(deviceCredentials.organizationId, organizationId), eq(deviceCredentials.deviceId, deviceId)))
      .returning();
    return cred;
  }

  async deleteCredential(organizationId: number, deviceId: number): Promise<boolean> {
    const result = await db.delete(deviceCredentials)
      .where(and(eq(deviceCredentials.organizationId, organizationId), eq(deviceCredentials.deviceId, deviceId)));
    return (result.rowCount ?? 0) > 0;
  }

  // ===========================================================================
  // DEVICE SNAPSHOTS (latest readings - upsert pattern)
  // ===========================================================================
  
  async upsertSnapshot(data: InsertDeviceSnapshot): Promise<DeviceSnapshot> {
    const existing = await db.select().from(deviceSnapshots)
      .where(eq(deviceSnapshots.deviceId, data.deviceId));
    
    if (existing.length > 0) {
      const [snapshot] = await db.update(deviceSnapshots)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(deviceSnapshots.deviceId, data.deviceId))
        .returning();
      return snapshot;
    } else {
      const [snapshot] = await db.insert(deviceSnapshots).values(data).returning();
      return snapshot;
    }
  }

  async getSnapshot(organizationId: number, deviceId: number): Promise<DeviceSnapshot | undefined> {
    const [snapshot] = await db.select().from(deviceSnapshots)
      .where(and(eq(deviceSnapshots.organizationId, organizationId), eq(deviceSnapshots.deviceId, deviceId)));
    return snapshot;
  }

  async getSnapshotByTruck(organizationId: number, truckId: number): Promise<DeviceSnapshot | undefined> {
    const [snapshot] = await db.select().from(deviceSnapshots)
      .where(and(eq(deviceSnapshots.organizationId, organizationId), eq(deviceSnapshots.truckId, truckId)));
    return snapshot;
  }

  async listSnapshots(organizationId: number, fleetId?: number): Promise<DeviceSnapshot[]> {
    const conditions = [eq(deviceSnapshots.organizationId, organizationId)];
    if (fleetId !== undefined) conditions.push(eq(deviceSnapshots.fleetId, fleetId));
    
    return db.select().from(deviceSnapshots)
      .where(and(...conditions))
      .orderBy(desc(deviceSnapshots.recordedAt));
  }

  async getFleetStats(organizationId: number, fleetId?: number): Promise<{
    totalTrucks: number;
    inServiceCount: number;
    notInServiceCount: number;
    onlineDevices: number;
    offlineDevices: number;
    avgSoc: number;
    avgVoltage: number;
    lowVoltageCount: number;
  }> {
    const truckConditions = [eq(trucks.organizationId, organizationId)];
    if (fleetId !== undefined) truckConditions.push(eq(trucks.fleetId, fleetId));
    
    const [truckStats] = await db.select({
      totalTrucks: sql<number>`count(*)::int`,
      inServiceCount: sql<number>`count(*) filter (where ${trucks.status} = 'in-service')::int`,
      notInServiceCount: sql<number>`count(*) filter (where ${trucks.status} = 'not-in-service')::int`,
    }).from(trucks).where(and(...truckConditions));

    const deviceConditions = [eq(powerMonDevices.organizationId, organizationId)];
    const [deviceStats] = await db.select({
      onlineDevices: sql<number>`count(*) filter (where ${powerMonDevices.status} = 'online')::int`,
      offlineDevices: sql<number>`count(*) filter (where ${powerMonDevices.status} = 'offline')::int`,
    }).from(powerMonDevices).where(and(...deviceConditions));

    const snapshotConditions = [eq(deviceSnapshots.organizationId, organizationId)];
    if (fleetId !== undefined) snapshotConditions.push(eq(deviceSnapshots.fleetId, fleetId));
    
    const [snapshotStats] = await db.select({
      avgSoc: sql<number>`coalesce(avg(${deviceSnapshots.soc}), 0)`,
      avgVoltage: sql<number>`coalesce(avg(${deviceSnapshots.voltage1}), 0)`,
      lowVoltageCount: sql<number>`count(*) filter (where ${deviceSnapshots.voltage1} < 11.5)::int`,
    }).from(deviceSnapshots).where(and(...snapshotConditions));

    return {
      totalTrucks: truckStats?.totalTrucks ?? 0,
      inServiceCount: truckStats?.inServiceCount ?? 0,
      notInServiceCount: truckStats?.notInServiceCount ?? 0,
      onlineDevices: deviceStats?.onlineDevices ?? 0,
      offlineDevices: deviceStats?.offlineDevices ?? 0,
      avgSoc: snapshotStats?.avgSoc ?? 0,
      avgVoltage: snapshotStats?.avgVoltage ?? 0,
      lowVoltageCount: snapshotStats?.lowVoltageCount ?? 0,
    };
  }

  // ===========================================================================
  // DEVICE MEASUREMENTS (time-series data)
  // ===========================================================================
  
  async insertMeasurement(data: InsertDeviceMeasurement): Promise<DeviceMeasurement> {
    const [measurement] = await db.insert(deviceMeasurements).values(data).returning();
    return measurement;
  }

  async insertMeasurements(data: InsertDeviceMeasurement[]): Promise<number> {
    if (data.length === 0) return 0;
    const result = await db.insert(deviceMeasurements).values(data);
    return result.rowCount ?? 0;
  }

  async getMeasurements(
    organizationId: number,
    deviceId: number,
    startTime: Date,
    endTime: Date,
    limit: number = 1000
  ): Promise<DeviceMeasurement[]> {
    return db.select().from(deviceMeasurements)
      .where(and(
        eq(deviceMeasurements.organizationId, organizationId),
        eq(deviceMeasurements.deviceId, deviceId),
        gte(deviceMeasurements.recordedAt, startTime),
        lte(deviceMeasurements.recordedAt, endTime)
      ))
      .orderBy(asc(deviceMeasurements.recordedAt))
      .limit(limit);
  }

  async getMeasurementsByTruck(
    organizationId: number,
    truckId: number,
    startTime: Date,
    endTime: Date,
    limit: number = 1000
  ): Promise<DeviceMeasurement[]> {
    return db.select().from(deviceMeasurements)
      .where(and(
        eq(deviceMeasurements.organizationId, organizationId),
        eq(deviceMeasurements.truckId, truckId),
        gte(deviceMeasurements.recordedAt, startTime),
        lte(deviceMeasurements.recordedAt, endTime)
      ))
      .orderBy(asc(deviceMeasurements.recordedAt))
      .limit(limit);
  }

  async getLatestMeasurement(organizationId: number, deviceId: number): Promise<DeviceMeasurement | undefined> {
    const [measurement] = await db.select().from(deviceMeasurements)
      .where(and(
        eq(deviceMeasurements.organizationId, organizationId),
        eq(deviceMeasurements.deviceId, deviceId)
      ))
      .orderBy(desc(deviceMeasurements.recordedAt))
      .limit(1);
    return measurement;
  }

  // ===========================================================================
  // DEVICE SYNC STATUS (tracks log file offset)
  // ===========================================================================
  
  async upsertSyncStatus(data: InsertDeviceSyncStatus): Promise<DeviceSyncStatus> {
    const existing = await db.select().from(deviceSyncStatus)
      .where(eq(deviceSyncStatus.deviceId, data.deviceId));
    
    if (existing.length > 0) {
      const [status] = await db.update(deviceSyncStatus)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(deviceSyncStatus.deviceId, data.deviceId))
        .returning();
      return status;
    } else {
      const [status] = await db.insert(deviceSyncStatus).values(data).returning();
      return status;
    }
  }

  async getSyncStatus(organizationId: number, deviceId: number): Promise<DeviceSyncStatus | undefined> {
    const [status] = await db.select().from(deviceSyncStatus)
      .where(and(eq(deviceSyncStatus.organizationId, organizationId), eq(deviceSyncStatus.deviceId, deviceId)));
    return status;
  }

  async updateSyncProgress(
    organizationId: number,
    deviceId: number,
    lastLogFileId: string,
    lastLogOffset: number
  ): Promise<void> {
    await db.update(deviceSyncStatus)
      .set({
        lastLogFileId,
        lastLogOffset,
        lastSyncAt: new Date(),
        syncStatus: 'synced',
        consecutiveFailures: 0,
        errorMessage: null,
        updatedAt: new Date()
      })
      .where(and(eq(deviceSyncStatus.organizationId, organizationId), eq(deviceSyncStatus.deviceId, deviceId)));
  }

  async updateSyncError(organizationId: number, deviceId: number, errorMessage: string): Promise<void> {
    await db.update(deviceSyncStatus)
      .set({
        syncStatus: 'error',
        errorMessage,
        consecutiveFailures: sql`${deviceSyncStatus.consecutiveFailures} + 1`,
        updatedAt: new Date()
      })
      .where(and(eq(deviceSyncStatus.organizationId, organizationId), eq(deviceSyncStatus.deviceId, deviceId)));
  }

  async updateLastPoll(organizationId: number, deviceId: number): Promise<void> {
    await db.update(deviceSyncStatus)
      .set({ lastPollAt: new Date(), updatedAt: new Date() })
      .where(and(eq(deviceSyncStatus.organizationId, organizationId), eq(deviceSyncStatus.deviceId, deviceId)));
  }

  // ===========================================================================
  // ALERTS (tenant-scoped)
  // ===========================================================================
  
  async createAlert(data: InsertAlert): Promise<Alert> {
    const [alert] = await db.insert(alerts).values(data).returning();
    return alert;
  }

  async getAlert(organizationId: number, id: number): Promise<Alert | undefined> {
    const [alert] = await db.select().from(alerts)
      .where(and(eq(alerts.organizationId, organizationId), eq(alerts.id, id)));
    return alert;
  }

  async listAlerts(organizationId: number, status?: string, limit: number = 100): Promise<Alert[]> {
    const conditions = [eq(alerts.organizationId, organizationId)];
    if (status !== undefined) conditions.push(eq(alerts.status, status));
    
    return db.select().from(alerts)
      .where(and(...conditions))
      .orderBy(desc(alerts.createdAt))
      .limit(limit);
  }

  async listAlertsByTruck(organizationId: number, truckId: number, limit: number = 50): Promise<Alert[]> {
    return db.select().from(alerts)
      .where(and(eq(alerts.organizationId, organizationId), eq(alerts.truckId, truckId)))
      .orderBy(desc(alerts.createdAt))
      .limit(limit);
  }

  async countActiveAlerts(organizationId: number): Promise<number> {
    const [result] = await db.select({
      count: sql<number>`count(*)::int`
    }).from(alerts)
      .where(and(eq(alerts.organizationId, organizationId), eq(alerts.status, 'active')));
    return result?.count ?? 0;
  }

  async acknowledgeAlert(organizationId: number, id: number, userId: number): Promise<Alert | undefined> {
    const [alert] = await db.update(alerts)
      .set({
        status: 'acknowledged',
        acknowledgedBy: userId,
        acknowledgedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(alerts.organizationId, organizationId), eq(alerts.id, id)))
      .returning();
    return alert;
  }

  async resolveAlert(organizationId: number, id: number): Promise<Alert | undefined> {
    const [alert] = await db.update(alerts)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(alerts.organizationId, organizationId), eq(alerts.id, id)))
      .returning();
    return alert;
  }

  async resolveAlertsByDevice(organizationId: number, deviceId: number, alertType: string): Promise<number> {
    const result = await db.update(alerts)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(alerts.organizationId, organizationId),
        eq(alerts.deviceId, deviceId),
        eq(alerts.alertType, alertType),
        eq(alerts.status, 'active')
      ));
    return result.rowCount ?? 0;
  }

  // ===========================================================================
  // AUDIT LOGS (tenant-scoped, append-only)
  // ===========================================================================
  
  async createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(data).returning();
    return log;
  }

  async listAuditLogs(
    organizationId: number,
    startTime?: Date,
    endTime?: Date,
    limit: number = 100
  ): Promise<AuditLog[]> {
    const conditions = [eq(auditLogs.organizationId, organizationId)];
    if (startTime) conditions.push(gte(auditLogs.createdAt, startTime));
    if (endTime) conditions.push(lte(auditLogs.createdAt, endTime));
    
    return db.select().from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  // ===========================================================================
  // POLLING SETTINGS (tenant-scoped)
  // ===========================================================================
  
  async getOrCreatePollingSettings(organizationId: number): Promise<PollingSetting> {
    const [existing] = await db.select().from(pollingSettings)
      .where(eq(pollingSettings.organizationId, organizationId));
    
    if (existing) return existing;
    
    const [settings] = await db.insert(pollingSettings)
      .values({ organizationId })
      .returning();
    return settings;
  }

  async updatePollingSettings(
    organizationId: number,
    data: Partial<InsertPollingSetting>
  ): Promise<PollingSetting | undefined> {
    const [settings] = await db.update(pollingSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(pollingSettings.organizationId, organizationId))
      .returning();
    return settings;
  }

  // ===========================================================================
  // DASHBOARD QUERIES (optimized for fleet dashboard)
  // ===========================================================================
  
  async getDashboardData(organizationId: number, fleetId?: number): Promise<{
    trucks: (Truck & { snapshot?: DeviceSnapshot; device?: PowerMonDevice })[];
    stats: {
      totalTrucks: number;
      inServiceCount: number;
      notInServiceCount: number;
      onlineDevices: number;
      offlineDevices: number;
      avgSoc: number;
      avgVoltage: number;
      lowVoltageCount: number;
    };
    alerts: Alert[];
  }> {
    const truckConditions = [eq(trucks.organizationId, organizationId)];
    if (fleetId !== undefined) truckConditions.push(eq(trucks.fleetId, fleetId));
    
    const truckList = await db.select().from(trucks)
      .where(and(...truckConditions))
      .orderBy(asc(trucks.truckNumber));

    const truckIds = truckList.map(t => t.id);
    
    let snapshotMap = new Map<number, DeviceSnapshot>();
    let deviceMap = new Map<number, PowerMonDevice>();
    
    if (truckIds.length > 0) {
      const snapshots = await db.select().from(deviceSnapshots)
        .where(and(
          eq(deviceSnapshots.organizationId, organizationId),
          inArray(deviceSnapshots.truckId, truckIds)
        ));
      
      for (const s of snapshots) {
        if (s.truckId) snapshotMap.set(s.truckId, s);
      }

      const devices = await db.select().from(powerMonDevices)
        .where(and(
          eq(powerMonDevices.organizationId, organizationId),
          inArray(powerMonDevices.truckId, truckIds)
        ));
      
      for (const d of devices) {
        if (d.truckId) deviceMap.set(d.truckId, d);
      }
    }

    const trucksWithData = truckList.map(truck => ({
      ...truck,
      snapshot: snapshotMap.get(truck.id),
      device: deviceMap.get(truck.id),
    }));

    const stats = await this.getFleetStats(organizationId, fleetId);
    const alertList = await this.listAlerts(organizationId, 'active', 20);

    return {
      trucks: trucksWithData,
      stats,
      alerts: alertList,
    };
  }
}

export const dbStorage = new DbStorage();
