import { db } from "./db";
import { eq, and, desc, asc, gte, lte, sql, inArray, or, ilike, type SQL } from "drizzle-orm";
import {
  organizations, users, fleets, trucks, powerMonDevices,
  deviceCredentials, deviceSnapshots, deviceMeasurements,
  deviceSyncStatus, alerts, auditLogs, pollingSettings,
  passwordResetTokens, invitationTokens, shellyDevices, shellySnapshots, shellyReadings,
  sims, simLocationHistory, savingsConfig, fuelPrices, deviceStatistics, exportJobs,
  EXPORT_JOB_STATUS, EXPORT_JOB_ACTIVE_STATUSES,
  type Sim, type DeviceStatistics,
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
  type PasswordResetToken, type InsertPasswordResetToken,
  type InvitationToken, type InsertInvitationToken,
  type ShellyDevice, type InsertShellyDevice,
  type ShellySnapshot, type InsertShellySnapshot,
  type ShellyReading, type InsertShellyReading,
  type ExportJob, type InsertExportJob,
} from "@shared/schema";
import { sendAlertNotifications, shouldNotifyForAlert } from "./services/alert-notifications";
import type { CreateExportJobResult } from "./storage";
import type {
  AdminDeviceExportRow,
  GetAdminDevicesForExportFilters,
} from "./services/exports/admin-types";

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

  async updateTruckLocation(organizationId: number, id: number, latitude: number, longitude: number, locationDescription?: string | null): Promise<void> {
    const updateData: Record<string, any> = { latitude, longitude, lastLocationUpdate: new Date(), updatedAt: new Date() };
    if (locationDescription !== undefined) {
      updateData.locationDescription = locationDescription;
    }
    await db.update(trucks)
      .set(updateData)
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

  async resetDeviceConnectionStatus(id: number): Promise<PowerMonDevice | undefined> {
    const [device] = await db.update(powerMonDevices)
      .set({
        connectionStatus: null,
        consecutiveDisconnects: 0,
        markedUnstableAt: null,
        markedOfflineAt: null,
        status: 'online',
        updatedAt: new Date(),
      })
      .where(eq(powerMonDevices.id, id))
      .returning();
    return device;
  }

  async setDeviceOffline(id: number): Promise<PowerMonDevice | undefined> {
    const [device] = await db.update(powerMonDevices)
      .set({
        connectionStatus: 'offline',
        status: 'offline',
        markedOfflineAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(powerMonDevices.id, id))
      .returning();
    return device;
  }

  async deleteDevice(organizationId: number, id: number): Promise<boolean> {
    const result = await db.delete(powerMonDevices)
      .where(and(eq(powerMonDevices.organizationId, organizationId), eq(powerMonDevices.id, id)));
    return (result.rowCount ?? 0) > 0;
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
    
    if (shouldNotifyForAlert(alert.alertType)) {
      sendAlertNotifications(alert).catch(err => {
        console.error(`[DbStorage] Failed to send alert notifications for alert ${alert.id}:`, err);
      });
    }
    
    return alert;
  }

  async getAlert(organizationId: number, id: number): Promise<Alert | undefined> {
    const [alert] = await db.select().from(alerts)
      .where(and(eq(alerts.organizationId, organizationId), eq(alerts.id, id)));
    return alert;
  }

  async listAlerts(organizationId: number, status?: string, limit: number = 100, truckId?: number): Promise<Alert[]> {
    const conditions = [eq(alerts.organizationId, organizationId)];
    if (status !== undefined) conditions.push(eq(alerts.status, status));
    if (truckId !== undefined) conditions.push(eq(alerts.truckId, truckId));
    
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

  async hasActiveAlertForDevice(organizationId: number, deviceId: number, alertType: string): Promise<boolean> {
    const [result] = await db.select({
      count: sql<number>`count(*)::int`
    }).from(alerts)
      .where(and(
        eq(alerts.organizationId, organizationId),
        eq(alerts.deviceId, deviceId),
        eq(alerts.alertType, alertType),
        eq(alerts.status, 'active')
      ));
    return (result?.count ?? 0) > 0;
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

  // ===========================================================================
  // ADMIN OPERATIONS (cross-tenant queries)
  // ===========================================================================

  async ensureAdminUserAndOrg(): Promise<{ userId: number; organizationId: number }> {
    // ADMIN_PASSWORD-based admin sessions don't have a real users.id row by
    // default. The export pipeline (Task #2) requires a NOT-NULL FK to
    // users.id and keys its concurrency-limit advisory lock on org id, so we
    // back the admin session with a synthetic, idempotent "Deecell Admin"
    // user inside a synthetic "Deecell Internal" org. This stays usable
    // even after Task #8 introduces real per-admin user rows: the platform
    // admins can be migrated into this same org or replaced entirely.
    const ADMIN_ORG_SLUG = "deecell-internal";
    const ADMIN_ORG_NAME = "Deecell Internal";
    const ADMIN_USER_EMAIL =
      process.env.ADMIN_NOTIFICATION_EMAIL ?? "hello@deecell.com";

    let org = await db.select().from(organizations)
      .where(eq(organizations.slug, ADMIN_ORG_SLUG))
      .then((rows) => rows[0]);

    if (!org) {
      const [created] = await db.insert(organizations).values({
        name: ADMIN_ORG_NAME,
        slug: ADMIN_ORG_SLUG,
        plan: "internal",
        isActive: true,
      }).returning();
      org = created;
    }

    let user = await db.select().from(users)
      .where(and(
        eq(users.organizationId, org.id),
        eq(users.email, ADMIN_USER_EMAIL),
      ))
      .then((rows) => rows[0]);

    if (!user) {
      const [created] = await db.insert(users).values({
        organizationId: org.id,
        email: ADMIN_USER_EMAIL,
        name: "Deecell Admin",
        firstName: "Deecell",
        lastName: "Admin",
        role: "admin",
        isActive: true,
      }).returning();
      user = created;
    } else if (!user.isActive || user.email !== ADMIN_USER_EMAIL) {
      // Repair drift (deactivated by mistake or env email changed) so admin
      // exports always have a deliverable destination.
      const [refreshed] = await db.update(users)
        .set({ isActive: true, email: ADMIN_USER_EMAIL, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      user = refreshed;
    }

    return { userId: user.id, organizationId: org.id };
  }

  async ensureDeecellInternalSetup(): Promise<{
    organizationId: number;
    andyUserId: number;
    andyJustCreated: boolean;
  }> {
    // Idempotent boot-time bootstrap for the platform admin model (Task #8).
    // 1. Make sure the deecell-internal organization exists.
    // 2. Make sure the seed Andy user (andy@deecell.com) exists in that org
    //    with is_platform_admin = true. Password is left NULL so the very
    //    first login forces Andy through /forgot-password — we never bake a
    //    shared/default password into the codebase.
    // The dedicated production migration script does the same thing via
    // SSM → EC2 → psql for the prod DB; this method makes the dev/Replit
    // environment self-bootstrapping so we don't have to also remember to
    // hand-seed the dev database.
    const ADMIN_ORG_SLUG = "deecell-internal";
    const ADMIN_ORG_NAME = "Deecell Internal";
    const SEED_ADMIN_EMAIL = "andy@deecell.com";

    let org = await db.select().from(organizations)
      .where(eq(organizations.slug, ADMIN_ORG_SLUG))
      .then((rows) => rows[0]);

    if (!org) {
      const [created] = await db.insert(organizations).values({
        name: ADMIN_ORG_NAME,
        slug: ADMIN_ORG_SLUG,
        plan: "internal",
        isActive: true,
      }).returning();
      org = created;
    }

    const existing = await db.select().from(users)
      .where(and(
        eq(users.organizationId, org.id),
        eq(users.email, SEED_ADMIN_EMAIL),
      ))
      .then((rows) => rows[0]);

    let andyUserId: number;
    let andyJustCreated = false;
    if (!existing) {
      const [created] = await db.insert(users).values({
        organizationId: org.id,
        email: SEED_ADMIN_EMAIL,
        passwordHash: null,
        name: "Andy Moeck",
        firstName: "Andy",
        lastName: "Moeck",
        role: "admin",
        isActive: true,
        isPlatformAdmin: true,
      }).returning({ id: users.id });
      andyUserId = created.id;
      andyJustCreated = true;
    } else {
      andyUserId = existing.id;
      if (!existing.isPlatformAdmin) {
        // Repair drift: if Andy exists but the flag was cleared, re-flag him
        // so he doesn't get locked out of /admin/login.
        await db.update(users)
          .set({ isPlatformAdmin: true, updatedAt: new Date() })
          .where(eq(users.id, existing.id));
      }
    }

    return { organizationId: org.id, andyUserId, andyJustCreated };
  }

  async getActivePlatformAdminByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users)
      .where(and(
        eq(users.email, email),
        eq(users.isActive, true),
        eq(users.isPlatformAdmin, true),
      ))
      .limit(1);
    return user;
  }

  async listPlatformAdmins(): Promise<User[]> {
    return db.select().from(users)
      .where(eq(users.isPlatformAdmin, true))
      .orderBy(asc(users.email));
  }

  async getAdminDevicesForExport(
    filters: GetAdminDevicesForExportFilters,
  ): Promise<AdminDeviceExportRow[]> {
    // One round-trip with LEFT JOINs so devices missing a sim/snapshot/sync
    // row still show up. Aliases:
    //   d  = power_mon_devices, t = trucks, f = fleets, o = organizations,
    //   c  = device_credentials, s = sims, ss = device_sync_status,
    //   ds = device_snapshots
    // Compose the WHERE clause from typed `SQL` predicates. Each predicate
    // is appended only when it has a value, so we never pass `undefined` into
    // `and()` and never need to fall back to an `any` cast.
    const conditions: SQL[] = [];
    if (filters.organizationId != null) {
      conditions.push(eq(powerMonDevices.organizationId, filters.organizationId));
    }
    if (filters.searchQuery && filters.searchQuery.trim().length > 0) {
      const needle = `%${filters.searchQuery.trim()}%`;
      const searchPredicate = or(
        ilike(powerMonDevices.deviceName, needle),
        ilike(powerMonDevices.serialNumber, needle),
        ilike(sims.iccid, needle),
        ilike(sims.msisdn, needle),
        ilike(trucks.truckNumber, needle),
        ilike(organizations.name, needle),
      );
      if (searchPredicate) conditions.push(searchPredicate);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        deviceId: powerMonDevices.id,
        organizationId: powerMonDevices.organizationId,
        organizationName: organizations.name,
        fleetName: fleets.name,
        truckNumber: trucks.truckNumber,
        serialNumber: powerMonDevices.serialNumber,
        deviceName: powerMonDevices.deviceName,
        hardwareRevision: powerMonDevices.hardwareRevision,
        firmwareVersion: powerMonDevices.firmwareVersion,
        hostId: powerMonDevices.hostId,
        credentialIsActive: deviceCredentials.isActive,
        iccid: sims.iccid,
        imsi: sims.imsi,
        msisdn: sims.msisdn,
        connectionStatus: powerMonDevices.connectionStatus,
        lastReportedAt: powerMonDevices.lastReportedAt,
        lastSeenAt: powerMonDevices.lastSeenAt,
        markedOfflineAt: powerMonDevices.markedOfflineAt,
        workerCohort: deviceSyncStatus.cohortId,
        soc: deviceSnapshots.soc,
        voltage1: deviceSnapshots.voltage1,
        rssi: deviceSnapshots.rssi,
      })
      .from(powerMonDevices)
      .innerJoin(organizations, eq(organizations.id, powerMonDevices.organizationId))
      .leftJoin(trucks, eq(trucks.id, powerMonDevices.truckId))
      .leftJoin(fleets, eq(fleets.id, trucks.fleetId))
      .leftJoin(sims, eq(sims.deviceId, powerMonDevices.id))
      .leftJoin(deviceCredentials, eq(deviceCredentials.deviceId, powerMonDevices.id))
      .leftJoin(deviceSyncStatus, eq(deviceSyncStatus.deviceId, powerMonDevices.id))
      .leftJoin(deviceSnapshots, eq(deviceSnapshots.deviceId, powerMonDevices.id))
      .where(where)
      .orderBy(asc(organizations.name), asc(powerMonDevices.serialNumber));

    return rows.map((r) => ({
      deviceId: r.deviceId,
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      fleetName: r.fleetName ?? null,
      truckNumber: r.truckNumber ?? null,
      serialNumber: r.serialNumber ?? null,
      deviceName: r.deviceName ?? null,
      hardwareRevision: r.hardwareRevision ?? null,
      firmwareVersion: r.firmwareVersion ?? null,
      buildDate: null, // Not stored in schema today; reserved column.
      hostId: r.hostId ?? null,
      credentialIsActive: r.credentialIsActive ?? null,
      iccid: r.iccid ?? null,
      imsi: r.imsi ?? null,
      msisdn: r.msisdn ?? null,
      connectionStatus: r.connectionStatus ?? null,
      lastReportedAt: r.lastReportedAt ?? null,
      lastSeenAt: r.lastSeenAt ?? null,
      markedOfflineAt: r.markedOfflineAt ?? null,
      workerCohort: r.workerCohort ?? null,
      soc: r.soc ?? null,
      voltage1: r.voltage1 ?? null,
      rssi: r.rssi ?? null,
    }));
  }

  async deleteOrganization(id: number): Promise<boolean> {
    const result = await db.delete(organizations).where(eq(organizations.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async listAllDevices(): Promise<PowerMonDevice[]> {
    return db.select().from(powerMonDevices).orderBy(asc(powerMonDevices.serialNumber));
  }

  async listAllDevicesWithSnapshots(): Promise<(PowerMonDevice & { snapshot?: DeviceSnapshot })[]> {
    const deviceList = await db.select().from(powerMonDevices).orderBy(asc(powerMonDevices.serialNumber));
    const deviceIds = deviceList.map(d => d.id);
    
    let snapshotMap = new Map<number, DeviceSnapshot>();
    if (deviceIds.length > 0) {
      const snapshots = await db.select().from(deviceSnapshots)
        .where(inArray(deviceSnapshots.deviceId, deviceIds));
      for (const s of snapshots) {
        snapshotMap.set(s.deviceId, s);
      }
    }
    
    return deviceList.map(device => ({
      ...device,
      snapshot: snapshotMap.get(device.id),
    }));
  }

  async listDevicesWithSnapshots(organizationId: number): Promise<(PowerMonDevice & { snapshot?: DeviceSnapshot })[]> {
    const deviceList = await db.select().from(powerMonDevices)
      .where(eq(powerMonDevices.organizationId, organizationId))
      .orderBy(asc(powerMonDevices.serialNumber));
    const deviceIds = deviceList.map(d => d.id);
    
    let snapshotMap = new Map<number, DeviceSnapshot>();
    if (deviceIds.length > 0) {
      const snapshots = await db.select().from(deviceSnapshots)
        .where(and(
          eq(deviceSnapshots.organizationId, organizationId),
          inArray(deviceSnapshots.deviceId, deviceIds)
        ));
      for (const s of snapshots) {
        snapshotMap.set(s.deviceId, s);
      }
    }
    
    return deviceList.map(device => ({
      ...device,
      snapshot: snapshotMap.get(device.id),
    }));
  }

  async listAllTrucks(): Promise<Truck[]> {
    return db.select().from(trucks).orderBy(asc(trucks.truckNumber));
  }

  async listAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(asc(users.email));
  }

  async getUserByEmailGlobal(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users)
      .where(and(eq(users.email, email), eq(users.isActive, true)));
    return user;
  }

  async deleteUser(organizationId: number, id: number): Promise<boolean> {
    const result = await db.delete(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.id, id)));
    return (result.rowCount ?? 0) > 0;
  }

  async getAdminStats(): Promise<{
    totalOrganizations: number;
    totalFleets: number;
    totalTrucks: number;
    totalDevices: number;
    totalUsers: number;
    onlineDevices: number;
    offlineDevices: number;
    activeAlerts: number;
    totalStoredPower: number;
  }> {
    const [orgCount] = await db.select({
      count: sql<number>`count(*)::int`
    }).from(organizations);

    const [fleetCount] = await db.select({
      count: sql<number>`count(*)::int`
    }).from(fleets);

    const [truckCount] = await db.select({
      count: sql<number>`count(*)::int`
    }).from(trucks);

    const [deviceStats] = await db.select({
      total: sql<number>`count(*)::int`,
      online: sql<number>`count(*) filter (where ${powerMonDevices.status} = 'online')::int`,
      offline: sql<number>`count(*) filter (where ${powerMonDevices.status} = 'offline')::int`,
    }).from(powerMonDevices);

    const [userCount] = await db.select({
      count: sql<number>`count(*)::int`
    }).from(users);

    const [alertCount] = await db.select({
      count: sql<number>`count(*)::int`
    }).from(alerts).where(eq(alerts.status, 'active'));

    const storedPowerResult = await db.execute<{ total: number }>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN d.battery_voltage IS NOT NULL AND d.battery_ah IS NOT NULL AND d.number_of_batteries IS NOT NULL AND ds.soc IS NOT NULL
        THEN d.battery_voltage * d.battery_ah * d.number_of_batteries * (ds.soc / 100.0)
        ELSE 0 END
      ), 0)::real as total
      FROM power_mon_devices d
      LEFT JOIN device_snapshots ds ON ds.device_id = d.id
      WHERE d.is_active = true
    `);
    const storedPowerRow = storedPowerResult.rows[0] as { total: number } | undefined;

    return {
      totalOrganizations: orgCount?.count ?? 0,
      totalFleets: fleetCount?.count ?? 0,
      totalTrucks: truckCount?.count ?? 0,
      totalDevices: deviceStats?.total ?? 0,
      totalUsers: userCount?.count ?? 0,
      onlineDevices: deviceStats?.online ?? 0,
      offlineDevices: deviceStats?.offline ?? 0,
      activeAlerts: alertCount?.count ?? 0,
      totalStoredPower: storedPowerRow?.total ?? 0,
    };
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async updateUserPassword(userId: number, passwordHash: string): Promise<void> {
    await db.update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async updateUserProfilePicture(userId: number, profilePictureUrl: string | null): Promise<void> {
    await db.update(users)
      .set({ profilePictureUrl, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // ===========================================================================
  // PASSWORD RESET TOKENS
  // ===========================================================================

  async createPasswordResetToken(data: InsertPasswordResetToken): Promise<PasswordResetToken> {
    const [token] = await db.insert(passwordResetTokens).values(data).returning();
    return token;
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const [resetToken] = await db.select().from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token));
    return resetToken;
  }

  async markPasswordResetTokenUsed(token: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.token, token));
  }

  // ===========================================================================
  // INVITATION TOKENS
  // ===========================================================================

  async createInvitationToken(data: InsertInvitationToken): Promise<InvitationToken> {
    const [token] = await db.insert(invitationTokens).values(data).returning();
    return token;
  }

  async getInvitationToken(token: string): Promise<InvitationToken | undefined> {
    const [inviteToken] = await db.select().from(invitationTokens)
      .where(eq(invitationTokens.token, token));
    return inviteToken;
  }

  async markInvitationTokenUsed(token: string): Promise<void> {
    await db.update(invitationTokens)
      .set({ usedAt: new Date() })
      .where(eq(invitationTokens.token, token));
  }

  // ===========================================================================
  // SHELLY DEVICES (Vibration sensors)
  // ===========================================================================

  async createShellyDevice(data: InsertShellyDevice): Promise<ShellyDevice> {
    const [device] = await db.insert(shellyDevices).values(data).returning();
    return device;
  }

  async getShellyDevice(organizationId: number, id: number): Promise<ShellyDevice | undefined> {
    const [device] = await db.select().from(shellyDevices)
      .where(and(eq(shellyDevices.organizationId, organizationId), eq(shellyDevices.id, id)));
    return device;
  }

  async getShellyDeviceByDeviceId(deviceId: string): Promise<ShellyDevice | undefined> {
    const [device] = await db.select().from(shellyDevices)
      .where(eq(shellyDevices.deviceId, deviceId));
    return device;
  }

  async getShellyDeviceByTruck(organizationId: number, truckId: number): Promise<ShellyDevice | undefined> {
    const [device] = await db.select().from(shellyDevices)
      .where(and(eq(shellyDevices.organizationId, organizationId), eq(shellyDevices.truckId, truckId)));
    return device;
  }

  async listShellyDevices(organizationId: number): Promise<ShellyDevice[]> {
    return db.select().from(shellyDevices)
      .where(eq(shellyDevices.organizationId, organizationId))
      .orderBy(asc(shellyDevices.deviceName));
  }

  async listAllShellyDevices(): Promise<ShellyDevice[]> {
    return db.select().from(shellyDevices)
      .where(eq(shellyDevices.isActive, true))
      .orderBy(asc(shellyDevices.deviceName));
  }

  async updateShellyDevice(organizationId: number, id: number, data: Partial<InsertShellyDevice>): Promise<ShellyDevice | undefined> {
    const [device] = await db.update(shellyDevices)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(shellyDevices.organizationId, organizationId), eq(shellyDevices.id, id)))
      .returning();
    return device;
  }

  async updateShellyDeviceByDeviceId(deviceId: string, data: Partial<InsertShellyDevice> & { lastSeenAt?: Date }): Promise<ShellyDevice | undefined> {
    const [device] = await db.update(shellyDevices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(shellyDevices.deviceId, deviceId))
      .returning();
    return device;
  }

  async assignShellyDeviceToTruck(organizationId: number, deviceId: number, truckId: number): Promise<ShellyDevice | undefined> {
    const [device] = await db.update(shellyDevices)
      .set({ truckId, updatedAt: new Date() })
      .where(and(eq(shellyDevices.organizationId, organizationId), eq(shellyDevices.id, deviceId)))
      .returning();
    return device;
  }

  async markShellyDevicesOffline(cutoffTime: Date): Promise<number> {
    const result = await db.update(shellyDevices)
      .set({ connectionStatus: 'offline', updatedAt: new Date() })
      .where(
        and(
          eq(shellyDevices.connectionStatus, 'online'),
          lte(shellyDevices.lastSeenAt, cutoffTime)
        )
      );
    return result.rowCount ?? 0;
  }

  // ===========================================================================
  // SHELLY SNAPSHOTS
  // ===========================================================================

  async upsertShellySnapshot(data: InsertShellySnapshot): Promise<ShellySnapshot> {
    // Build update set - only include lastMovementAt if provided (when moving)
    const updateSet: Record<string, unknown> = {
      frequency: data.frequency,
      isMoving: data.isMoving,
      temperature: data.temperature,
      rssi: data.rssi,
      recordedAt: data.recordedAt,
      updatedAt: new Date(),
    };
    
    // Only update lastMovementAt if movement is detected (don't overwrite with null)
    if (data.lastMovementAt) {
      updateSet.lastMovementAt = data.lastMovementAt;
    }
    
    const [snapshot] = await db.insert(shellySnapshots)
      .values(data)
      .onConflictDoUpdate({
        target: shellySnapshots.shellyDeviceId,
        set: updateSet,
      })
      .returning();
    return snapshot;
  }

  async getShellySnapshot(organizationId: number, shellyDeviceId: number): Promise<ShellySnapshot | undefined> {
    const [snapshot] = await db.select().from(shellySnapshots)
      .where(and(eq(shellySnapshots.organizationId, organizationId), eq(shellySnapshots.shellyDeviceId, shellyDeviceId)));
    return snapshot;
  }

  async getShellySnapshotByTruck(organizationId: number, truckId: number): Promise<ShellySnapshot | undefined> {
    const [snapshot] = await db.select().from(shellySnapshots)
      .where(and(eq(shellySnapshots.organizationId, organizationId), eq(shellySnapshots.truckId, truckId)));
    return snapshot;
  }

  async listShellySnapshots(organizationId: number): Promise<ShellySnapshot[]> {
    return db.select().from(shellySnapshots)
      .where(eq(shellySnapshots.organizationId, organizationId));
  }

  // ===========================================================================
  // SHELLY READINGS (historical data for calibration)
  // ===========================================================================
  
  async insertShellyReading(data: InsertShellyReading): Promise<ShellyReading> {
    const [reading] = await db.insert(shellyReadings).values(data).returning();
    return reading;
  }

  async listShellyReadings(shellyDeviceId: number, limit: number = 1000): Promise<ShellyReading[]> {
    return db.select().from(shellyReadings)
      .where(eq(shellyReadings.shellyDeviceId, shellyDeviceId))
      .orderBy(desc(shellyReadings.recordedAt))
      .limit(limit);
  }

  // ===========================================================================
  // EXPORTS
  // ===========================================================================
  //
  // Single batched query that joins everything the export needs in one round
  // trip, then optionally hydrates SIMs and lifetime statistics in two more
  // bounded queries (only when the requested column set actually needs them).
  //
  // Always org-scoped — `organizationId` is the leading predicate on every
  // table touched.

  async getTrucksForExport(
    organizationId: number,
    options: {
      fleetId?: number;
      operationalStatus?: "in-service" | "not-in-service";
      searchQuery?: string;
      includeStatistics?: boolean;
      includeSims?: boolean;
    },
  ): Promise<import("./services/exports/types").TruckExportRow[]> {
    const conditions = [eq(trucks.organizationId, organizationId)];

    if (options.fleetId !== undefined) {
      conditions.push(eq(trucks.fleetId, options.fleetId));
    }
    if (options.operationalStatus) {
      conditions.push(eq(trucks.status, options.operationalStatus));
    }
    if (options.searchQuery && options.searchQuery.trim().length > 0) {
      const q = `%${options.searchQuery.trim()}%`;
      // Mirrors the dashboard's client-side search (Dashboard.tsx) so the
      // export and the on-screen filter agree on what counts as a match:
      // truck number, model, PowerMon serial, and location/address.
      // The serial field is on the latest-device subquery, joined below.
      const search = or(
        ilike(trucks.truckNumber, q),
        ilike(trucks.model, q),
        ilike(trucks.locationDescription, q),
        ilike(powerMonDevices.serialNumber, q),
      );
      if (search) conditions.push(search);
    }

    // Subquery: latest PowerMon device per truck. The schema does not enforce
    // 1:1 (a truck can have a history of devices across reassignments), so we
    // pick the most recently created (`max(id)`) currently-assigned device.
    // This keeps the result at exactly one row per truck and prevents an old
    // device's snapshot from being paired with the truck.
    const latestDeviceSub = db
      .select({
        truckId: powerMonDevices.truckId,
        deviceId: sql<number>`max(${powerMonDevices.id})`.as("device_id"),
      })
      .from(powerMonDevices)
      .where(
        and(
          eq(powerMonDevices.organizationId, organizationId),
          sql`${powerMonDevices.truckId} is not null`,
        ),
      )
      .groupBy(powerMonDevices.truckId)
      .as("latest_device");

    // Same defensive pattern for Shelly snapshots — schema's unique index is
    // on `shellyDeviceId`, not on `truckId`, so multiple Shelly devices on one
    // truck would otherwise duplicate the row.
    const latestShellySub = db
      .select({
        truckId: shellySnapshots.truckId,
        snapshotId: sql<number>`max(${shellySnapshots.id})`.as("shelly_snapshot_id"),
      })
      .from(shellySnapshots)
      .where(
        and(
          eq(shellySnapshots.organizationId, organizationId),
          sql`${shellySnapshots.truckId} is not null`,
        ),
      )
      .groupBy(shellySnapshots.truckId)
      .as("latest_shelly");

    // Active alert counts, grouped by truckId — derived in a subquery so the
    // main result remains 1 row per truck.
    const alertCountsSub = db
      .select({
        truckId: alerts.truckId,
        count: sql<number>`count(*)::int`.as("alert_count"),
      })
      .from(alerts)
      .where(
        and(
          eq(alerts.organizationId, organizationId),
          eq(alerts.status, "active"),
        ),
      )
      .groupBy(alerts.truckId)
      .as("alert_counts");

    // Every join condition pins `organizationId` on the joined table so that a
    // hypothetical orphaned cross-tenant row could never leak in via FK.
    const baseRows = await db
      .select({
        truck: trucks,
        fleetName: fleets.name,
        device: powerMonDevices,
        snapshot: deviceSnapshots,
        shellySnapshot: shellySnapshots,
        alertCount: alertCountsSub.count,
      })
      .from(trucks)
      .leftJoin(fleets, and(
        eq(fleets.id, trucks.fleetId),
        eq(fleets.organizationId, organizationId),
      ))
      .leftJoin(latestDeviceSub, eq(latestDeviceSub.truckId, trucks.id))
      .leftJoin(powerMonDevices, and(
        eq(powerMonDevices.id, latestDeviceSub.deviceId),
        eq(powerMonDevices.organizationId, organizationId),
      ))
      .leftJoin(deviceSnapshots, and(
        eq(deviceSnapshots.deviceId, latestDeviceSub.deviceId),
        eq(deviceSnapshots.organizationId, organizationId),
      ))
      .leftJoin(latestShellySub, eq(latestShellySub.truckId, trucks.id))
      .leftJoin(shellySnapshots, and(
        eq(shellySnapshots.id, latestShellySub.snapshotId),
        eq(shellySnapshots.organizationId, organizationId),
      ))
      .leftJoin(alertCountsSub, eq(alertCountsSub.truckId, trucks.id))
      .where(and(...conditions))
      .orderBy(asc(trucks.truckNumber));

    const truckIds = baseRows.map((r) => r.truck.id);

    let simByTruckId = new Map<number, Sim>();
    if (options.includeSims && truckIds.length > 0) {
      const simRows = await db
        .select()
        .from(sims)
        .where(
          and(
            eq(sims.organizationId, organizationId),
            inArray(sims.truckId, truckIds),
          ),
        );
      // If multiple SIMs exist for the same truck, prefer the most recently
      // updated one — matches what the dashboard surfaces.
      for (const sim of simRows) {
        const existing = simByTruckId.get(sim.truckId!);
        if (!existing) {
          simByTruckId.set(sim.truckId!, sim);
          continue;
        }
        const existingTs = existing.updatedAt?.getTime() ?? 0;
        const newTs = sim.updatedAt?.getTime() ?? 0;
        if (newTs >= existingTs) simByTruckId.set(sim.truckId!, sim);
      }
    }

    let statsByDeviceId = new Map<number, DeviceStatistics>();
    if (options.includeStatistics) {
      const deviceIds = baseRows
        .map((r) => r.device?.id)
        .filter((id): id is number => typeof id === "number");
      if (deviceIds.length > 0) {
        const statRows = await db
          .select()
          .from(deviceStatistics)
          .where(
            and(
              eq(deviceStatistics.organizationId, organizationId),
              inArray(deviceStatistics.deviceId, deviceIds),
            ),
          );
        for (const stat of statRows) statsByDeviceId.set(stat.deviceId, stat);
      }
    }

    return baseRows.map((r) => ({
      truck: r.truck,
      fleetName: r.fleetName ?? "—",
      device: r.device ?? undefined,
      snapshot: r.snapshot ?? undefined,
      shellySnapshot: r.shellySnapshot ?? undefined,
      // SIMs are truck-scoped, not device-scoped: a truck may legitimately have
      // a SIM record without a currently-assigned PowerMon device.
      sim: simByTruckId.get(r.truck.id),
      deviceStatistics:
        r.device && options.includeStatistics
          ? statsByDeviceId.get(r.device.id)
          : undefined,
      activeAlertCount: r.alertCount ?? 0,
    }));
  }

  // ===========================================================================
  // HISTORICAL TIME-SERIES EXPORT (single truck, ≤1 year)
  // ===========================================================================
  //
  // Aggregates `device_measurements` into minute / hour / day buckets and
  // joins per-bucket alert counts. Always org-scoped: the truck FK is checked
  // up front and every measurement WHERE pins `organizationId`.
  //
  // For per-minute / hourly granularity, all aggregates are AVG. For daily
  // granularity, MIN/MAX columns are also computed (the daily column registry
  // displays them). `temperature` and `energy` are stored in C and Wh
  // respectively — the cell-builder converts them to °F and kWh at render
  // time.

  async getHistoricalMeasurements(
    opts: import("./services/exports/types").HistoricalQueryOptions,
  ): Promise<import("./services/exports/types").HistoricalQueryResult> {
    const { organizationId, truckId, startTime, endTime, granularity } = opts;

    if (!(endTime > startTime)) {
      throw new Error("getHistoricalMeasurements: endTime must be after startTime");
    }

    // Org-scoped truck lookup + identity columns. We deliberately resolve
    // these here so the historical export NEVER returns rows whose identity
    // columns belong to a different org's truck (defense-in-depth — the
    // measurements WHERE also pins organizationId).
    const identity = await db
      .select({
        truckId: trucks.id,
        truckNumber: trucks.truckNumber,
        fleetName: fleets.name,
        powerMonSerial: powerMonDevices.serialNumber,
      })
      .from(trucks)
      .leftJoin(fleets, and(
        eq(fleets.id, trucks.fleetId),
        eq(fleets.organizationId, organizationId),
      ))
      .leftJoin(powerMonDevices, and(
        eq(powerMonDevices.truckId, trucks.id),
        eq(powerMonDevices.organizationId, organizationId),
      ))
      .where(and(
        eq(trucks.id, truckId),
        eq(trucks.organizationId, organizationId),
      ))
      .orderBy(desc(powerMonDevices.id))
      .limit(1);

    if (identity.length === 0) {
      throw new Error(`Truck ${truckId} not found in organization ${organizationId}`);
    }
    const id = identity[0];

    // Hard-map enum → date_trunc unit (granularity is zod-validated at the
    // route, but date_trunc takes a literal string so we re-narrow here).
    const truncUnit: "minute" | "hour" | "day" =
      granularity === "minute" ? "minute"
      : granularity === "hour" ? "hour"
      : "day";

    // PowerMon polls every 10 s, so total_energy_in/out_wh = SUM(±power) * 10/3600.
    // Parked/driving counts mirror device-manager (`(voltage2 || 0) < 13`):
    // NULL voltage2 counts as parked, never as driving. idle_minutes stays
    // null — the state machine has only two states.
    const SAMPLE_SECONDS = 10;
    const PARKED_VOLTAGE_THRESHOLD = 13.0;
    const bucketCol = sql<Date>`date_trunc(${truncUnit}, ${deviceMeasurements.recordedAt})`;
    const measurementRows = await db
      .select({
        bucket: bucketCol.as("bucket"),
        avgVoltage1:    sql<number | null>`avg(${deviceMeasurements.voltage1})::float8`.as("avg_v1"),
        avgVoltage2:    sql<number | null>`avg(${deviceMeasurements.voltage2})::float8`.as("avg_v2"),
        avgCurrent:     sql<number | null>`avg(${deviceMeasurements.current})::float8`.as("avg_curr"),
        avgPower:       sql<number | null>`avg(${deviceMeasurements.power})::float8`.as("avg_pow"),
        avgSoc:         sql<number | null>`avg(${deviceMeasurements.soc})::float8`.as("avg_soc"),
        avgTemperature: sql<number | null>`avg(${deviceMeasurements.temperature})::float8`.as("avg_temp"),
        avgEnergy:      sql<number | null>`avg(${deviceMeasurements.energy})::float8`.as("avg_energy"),
        avgCharge:      sql<number | null>`avg(${deviceMeasurements.charge})::float8`.as("avg_charge"),
        avgRssi:        sql<number | null>`avg(${deviceMeasurements.rssi})::float8`.as("avg_rssi"),
        // Last non-null status string seen in the bucket; window-style picks
        // are awkward inside an aggregate query, so we use MAX which is
        // deterministic and good-enough for "what status applied here".
        powerStatusString: sql<string | null>`max(${deviceMeasurements.powerStatusString})`.as("ps_str"),
        powerStatusInt:    sql<number | null>`max(${deviceMeasurements.powerStatus})::float8`.as("ps_int"),

        // Parked / drive sample counts (see comment block above). NULL
        // voltage2 counts as parked to match the device-manager's
        // `(voltage2 || 0) < 13.0` semantics. drivingSamples explicitly
        // requires a non-null reading.
        parkedSamples: sql<number>`count(*) filter (where ${deviceMeasurements.voltage2} <  ${PARKED_VOLTAGE_THRESHOLD} OR ${deviceMeasurements.voltage2} IS NULL)::int`.as("parked_samples"),
        drivingSamples: sql<number>`count(*) filter (where ${deviceMeasurements.voltage2} >= ${PARKED_VOLTAGE_THRESHOLD})::int`.as("drive_samples"),

        // Daily-only MIN/MAX (cheap to compute even on minute/hour buckets,
        // and we just don't render them in those modes).
        minSoc:         sql<number | null>`min(${deviceMeasurements.soc})::float8`.as("min_soc"),
        maxSoc:         sql<number | null>`max(${deviceMeasurements.soc})::float8`.as("max_soc"),
        minVoltage1:    sql<number | null>`min(${deviceMeasurements.voltage1})::float8`.as("min_v1"),
        maxVoltage1:    sql<number | null>`max(${deviceMeasurements.voltage1})::float8`.as("max_v1"),
        minVoltage2:    sql<number | null>`min(${deviceMeasurements.voltage2})::float8`.as("min_v2"),
        maxVoltage2:    sql<number | null>`max(${deviceMeasurements.voltage2})::float8`.as("max_v2"),
        minTemperature: sql<number | null>`min(${deviceMeasurements.temperature})::float8`.as("min_temp"),
        maxTemperature: sql<number | null>`max(${deviceMeasurements.temperature})::float8`.as("max_temp"),
        // Energy throughput = max(energy_remaining) - min(energy_remaining)
        // within the day — a reasonable proxy for total energy that flowed
        // through the bank, given the per-measurement column is cumulative
        // remaining energy.
        energyThroughput: sql<number | null>`(max(${deviceMeasurements.energy}) - min(${deviceMeasurements.energy}))::float8`.as("energy_throughput"),
        // Sign-segregated power sums for total energy in/out (Wh).
        sumPosPower:    sql<number | null>`(sum(case when ${deviceMeasurements.power} > 0 then ${deviceMeasurements.power} else 0 end) * ${SAMPLE_SECONDS} / 3600.0)::float8`.as("energy_in_wh"),
        sumNegPower:    sql<number | null>`(sum(case when ${deviceMeasurements.power} < 0 then -${deviceMeasurements.power} else 0 end) * ${SAMPLE_SECONDS} / 3600.0)::float8`.as("energy_out_wh"),
      })
      .from(deviceMeasurements)
      .where(and(
        eq(deviceMeasurements.organizationId, organizationId),
        eq(deviceMeasurements.truckId, truckId),
        gte(deviceMeasurements.recordedAt, startTime),
        lte(deviceMeasurements.recordedAt, endTime),
      ))
      .groupBy(bucketCol)
      .orderBy(asc(bucketCol));

    // Per-bucket position from sim_location_history (PowerMon doesn't store
    // position). DISTINCT ON keeps the LAST recorded position per bucket, so
    // daily exports get end-of-day position automatically.
    const positionRows = await db.execute<{
      bucket: Date | string;
      latitude: number;
      longitude: number;
    }>(sql`
      SELECT DISTINCT ON (date_trunc(${truncUnit}, recorded_at))
        date_trunc(${truncUnit}, recorded_at) AS bucket,
        latitude::float8                       AS latitude,
        longitude::float8                      AS longitude
      FROM ${simLocationHistory}
      WHERE organization_id = ${organizationId}
        AND truck_id = ${truckId}
        AND recorded_at >= ${startTime}
        AND recorded_at <= ${endTime}
      ORDER BY date_trunc(${truncUnit}, recorded_at), recorded_at DESC
    `);
    const positionByBucket = new Map<number, { latitude: number; longitude: number }>();
    for (const r of positionRows.rows) {
      const ts = (r.bucket instanceof Date ? r.bucket : new Date(r.bucket as unknown as string)).getTime();
      positionByBucket.set(ts, { latitude: r.latitude, longitude: r.longitude });
    }

    // Daily granularity also reports an "alerts raised" count per day.
    // Cheap separate query keyed by `created_at` truncated the same way.
    let alertsByBucket = new Map<number, number>();
    if (granularity === "day") {
      const alertBucket = sql<Date>`date_trunc('day', ${alerts.createdAt})`;
      const alertRows = await db
        .select({
          bucket: alertBucket.as("bucket"),
          count: sql<number>`count(*)::int`.as("alert_count"),
        })
        .from(alerts)
        .where(and(
          eq(alerts.organizationId, organizationId),
          eq(alerts.truckId, truckId),
          gte(alerts.createdAt, startTime),
          lte(alerts.createdAt, endTime),
        ))
        .groupBy(alertBucket);
      for (const r of alertRows) {
        const ts = (r.bucket instanceof Date ? r.bucket : new Date(r.bucket as unknown as string)).getTime();
        alertsByBucket.set(ts, r.count);
      }
    }

    // Savings config (daily mode only). Defaults match savings-calculator.ts
    // when no org row exists.
    let defaultFuelPrice = 3.5;
    let useLiveFuelPrices = true;
    let livePriceByDay = new Map<string, number>();
    if (granularity === "day") {
      const cfg = await db
        .select({
          defaultFuelPricePerGallon: savingsConfig.defaultFuelPricePerGallon,
          useLiveFuelPrices: savingsConfig.useLiveFuelPrices,
        })
        .from(savingsConfig)
        .where(eq(savingsConfig.organizationId, organizationId))
        .limit(1);
      if (cfg.length > 0) {
        defaultFuelPrice = cfg[0].defaultFuelPricePerGallon ?? defaultFuelPrice;
        useLiveFuelPrices = cfg[0].useLiveFuelPrices ?? useLiveFuelPrices;
      }
      // Pre-fetch [windowStart-7d, end] then snap each day to the most recent
      // price on or before it (cheap per-row lookup below).
      if (useLiveFuelPrices) {
        const lookbackStart = new Date(startTime.getTime() - 7 * 86400000);
        const priceRows = await db
          .select({
            priceDate: fuelPrices.priceDate,
            pricePerGallon: fuelPrices.pricePerGallon,
          })
          .from(fuelPrices)
          .where(and(
            gte(fuelPrices.priceDate, lookbackStart),
            lte(fuelPrices.priceDate, endTime),
          ))
          .orderBy(asc(fuelPrices.priceDate));
        // Walk the day window and snap each day to the nearest preceding price.
        const sorted = priceRows.map((r) => ({
          ts: (r.priceDate instanceof Date ? r.priceDate : new Date(r.priceDate as unknown as string)).getTime(),
          price: r.pricePerGallon,
        })).sort((a, b) => a.ts - b.ts);
        let lastPrice = defaultFuelPrice;
        let pi = 0;
        const dayMs = 86400000;
        const startDay = new Date(Date.UTC(
          startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate(),
        )).getTime();
        const endDay = new Date(Date.UTC(
          endTime.getUTCFullYear(), endTime.getUTCMonth(), endTime.getUTCDate(),
        )).getTime();
        for (let d = startDay; d <= endDay; d += dayMs) {
          while (pi < sorted.length && sorted[pi].ts <= d) {
            lastPrice = sorted[pi].price;
            pi++;
          }
          const key = new Date(d).toISOString().slice(0, 10);
          livePriceByDay.set(key, lastPrice);
        }
      }
    }

    const rows = measurementRows.map((m) => {
      const bucketDate = m.bucket instanceof Date ? m.bucket : new Date(m.bucket as unknown as string);
      const psString = m.powerStatusString;
      const psInt = m.powerStatusInt;
      const powerStatus =
        psString && psString.trim().length > 0
          ? psString
          : psInt !== null && psInt !== undefined
            ? String(Math.round(psInt))
            : null;
      // is_parked: majority vote; null when the bucket had no samples at all.
      const totalSamples = (m.parkedSamples ?? 0) + (m.drivingSamples ?? 0);
      const isParked = totalSamples > 0
        ? (m.parkedSamples ?? 0) > totalSamples / 2
        : null;
      // Activity minutes — daily mode only.
      const isDaily = granularity === "day";
      const parkedMinutes = isDaily
        ? Math.round(((m.parkedSamples ?? 0) * SAMPLE_SECONDS / 60) * 10) / 10
        : null;
      const driveMinutes = isDaily
        ? Math.round(((m.drivingSamples ?? 0) * SAMPLE_SECONDS / 60) * 10) / 10
        : null;
      const pos = positionByBucket.get(bucketDate.getTime()) ?? null;
      // day_savings: canonical formula from savings-calculator.ts —
      //   savings = (parked_minutes / 60) * 1.2 gal/hr * fuel_price
      // Reported as 0 on days with no parked time (not null).
      let daySavings: number | null = null;
      if (isDaily) {
        const dayKey = bucketDate.toISOString().slice(0, 10);
        const fuelPrice = livePriceByDay.get(dayKey) ?? defaultFuelPrice;
        const parkedHours = (parkedMinutes ?? 0) / 60;
        daySavings = Math.round(parkedHours * 1.2 * fuelPrice * 100) / 100;
      }
      return {
        bucket: bucketDate,
        truckNumber: id.truckNumber,
        fleetName: id.fleetName,
        powerMonSerial: id.powerMonSerial,
        voltage1: m.avgVoltage1,
        voltage2: m.avgVoltage2,
        current: m.avgCurrent,
        power: m.avgPower,
        soc: m.avgSoc,
        temperatureC: m.avgTemperature,
        energyWh: m.avgEnergy,
        charge: m.avgCharge,
        rssi: m.avgRssi !== null && m.avgRssi !== undefined ? Math.round(m.avgRssi) : null,
        powerStatus,
        isParked,
        latitude: pos?.latitude ?? null,
        longitude: pos?.longitude ?? null,
        minSoc: m.minSoc,
        maxSoc: m.maxSoc,
        minVoltage1: m.minVoltage1,
        maxVoltage1: m.maxVoltage1,
        minVoltage2: m.minVoltage2,
        maxVoltage2: m.maxVoltage2,
        minTemperatureC: m.minTemperature,
        maxTemperatureC: m.maxTemperature,
        energyThroughputWh: m.energyThroughput,
        totalEnergyInWh: m.sumPosPower,
        totalEnergyOutWh: m.sumNegPower,
        driveMinutes,
        // No "idle" state in the underlying state machine (parked/driving
        // only) — see comment block in the aggregation query above.
        idleMinutes: null,
        parkedMinutes,
        daySavings,
        // For daily granularity `latitude`/`longitude` already point to the
        // last position of the day (DISTINCT ON ... ORDER BY recorded_at
        // DESC). We surface the same value as `endLatitude`/`endLongitude`
        // so the daily column contract is satisfied without an extra query.
        endLatitude: isDaily ? (pos?.latitude ?? null) : null,
        endLongitude: isDaily ? (pos?.longitude ?? null) : null,
        alertsRaised: isDaily ? (alertsByBucket.get(bucketDate.getTime()) ?? 0) : null,
      };
    });

    return {
      rows,
      truck: { id: id.truckId, truckNumber: id.truckNumber },
      fleetName: id.fleetName,
      powerMonSerial: id.powerMonSerial,
    };
  }

  // ===========================================================================
  // EXPORT JOBS (async export pipeline)
  // ===========================================================================

  /**
   * Atomically enforce per-user (3) and per-org (10) active-job limits, then
   * insert the new pending job. Implemented with a SERIALIZABLE transaction so
   * two concurrent inserts cannot both pass the limit check.
   *
   * Returns `{ ok: true, job }` on success, or `{ ok: false, reason }` with
   * the current counts when a limit would be exceeded — caller maps to 429.
   */
  async createExportJobWithLimits(
    data: InsertExportJob,
    limits: { userLimit: number; orgLimit: number },
  ): Promise<CreateExportJobResult> {
    return await db.transaction(
      async (tx) => {
        // Serialize ALL export-job inserts within an organization so both the
        // 3-per-user and 10-per-org caps are race-free even when two
        // *different* users in the same org POST simultaneously. We use the
        // two-int overload `pg_advisory_xact_lock(int, int)` (organizationId
        // and userId are `serial`, i.e. 32-bit signed). The second arg is a
        // constant `1` that namespaces this lock to "export-creates" so it
        // does not collide with other features that key on organizationId.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${data.organizationId}::int, 1::int)`,
        );

        const activeUserCount = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(exportJobs)
          .where(
            and(
              eq(exportJobs.organizationId, data.organizationId),
              eq(exportJobs.userId, data.userId),
              inArray(exportJobs.status, EXPORT_JOB_ACTIVE_STATUSES as unknown as string[]),
            ),
          )
          .then((r) => r[0]?.c ?? 0);

        const activeOrgCount = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(exportJobs)
          .where(
            and(
              eq(exportJobs.organizationId, data.organizationId),
              inArray(exportJobs.status, EXPORT_JOB_ACTIVE_STATUSES as unknown as string[]),
            ),
          )
          .then((r) => r[0]?.c ?? 0);

        if (activeUserCount >= limits.userLimit) {
          return {
            ok: false as const,
            reason: "user_limit" as const,
            activeUserCount,
            activeOrgCount,
          };
        }
        if (activeOrgCount >= limits.orgLimit) {
          return {
            ok: false as const,
            reason: "org_limit" as const,
            activeUserCount,
            activeOrgCount,
          };
        }

        const [job] = await tx
          .insert(exportJobs)
          .values({ ...data, status: EXPORT_JOB_STATUS.PENDING })
          .returning();
        return { ok: true as const, job };
      },
    );
  }

  async getExportJob(organizationId: number, id: number): Promise<ExportJob | undefined> {
    const [job] = await db
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.id, id), eq(exportJobs.organizationId, organizationId)));
    return job;
  }

  async listExportJobsForUser(
    organizationId: number,
    userId: number,
    options: { limit?: number; statuses?: string[]; includeDismissed?: boolean } = {},
  ): Promise<ExportJob[]> {
    const conds = [
      eq(exportJobs.organizationId, organizationId),
      eq(exportJobs.userId, userId),
    ];
    if (options.statuses && options.statuses.length > 0) {
      conds.push(inArray(exportJobs.status, options.statuses));
    }
    if (options.includeDismissed === false) {
      conds.push(sql`${exportJobs.dismissedAt} IS NULL`);
    }
    return db
      .select()
      .from(exportJobs)
      .where(and(...conds))
      .orderBy(desc(exportJobs.createdAt))
      .limit(options.limit ?? 50);
  }

  /**
   * Atomically claim the next pending job for processing. Uses
   * `FOR UPDATE SKIP LOCKED` so multiple worker instances on different
   * containers never claim the same row.
   */
  async claimNextPendingExportJob(): Promise<ExportJob | undefined> {
    const result = await db.execute<ExportJob>(sql`
      UPDATE export_jobs
      SET status = ${EXPORT_JOB_STATUS.RUNNING},
          started_at = NOW(),
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM export_jobs
        WHERE status = ${EXPORT_JOB_STATUS.PENDING}
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `);
    const rows = (result as unknown as { rows: ExportJob[] }).rows ?? [];
    return rows[0];
  }

  async updateExportJob(id: number, data: Partial<ExportJob>): Promise<ExportJob | undefined> {
    const [job] = await db
      .update(exportJobs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(exportJobs.id, id))
      .returning();
    return job;
  }

  async dismissExportJob(
    organizationId: number,
    userId: number,
    id: number,
  ): Promise<ExportJob | undefined> {
    const [job] = await db
      .update(exportJobs)
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(exportJobs.id, id),
          eq(exportJobs.organizationId, organizationId),
          eq(exportJobs.userId, userId),
        ),
      )
      .returning();
    return job;
  }

  async expireOverdueExportJobs(now: Date = new Date()): Promise<number> {
    const updated = await db
      .update(exportJobs)
      .set({
        status: EXPORT_JOB_STATUS.EXPIRED,
        downloadUrl: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(exportJobs.status, EXPORT_JOB_STATUS.COMPLETED),
          sql`${exportJobs.downloadUrlExpiresAt} IS NOT NULL`,
          lte(exportJobs.downloadUrlExpiresAt, now),
        ),
      )
      .returning({ id: exportJobs.id });
    return updated.length;
  }
}

export const dbStorage = new DbStorage();
