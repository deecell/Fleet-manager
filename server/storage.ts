import {
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

export interface IStorage {
  // Organizations
  createOrganization(data: InsertOrganization): Promise<Organization>;
  getOrganization(id: number): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  listOrganizations(): Promise<Organization[]>;
  updateOrganization(id: number, data: Partial<InsertOrganization>): Promise<Organization | undefined>;

  // Users (tenant-scoped)
  createUser(data: InsertUser): Promise<User>;
  getUser(organizationId: number, id: number): Promise<User | undefined>;
  getUserByEmail(organizationId: number, email: string): Promise<User | undefined>;
  listUsers(organizationId: number): Promise<User[]>;
  updateUser(organizationId: number, id: number, data: Partial<InsertUser>): Promise<User | undefined>;
  updateUserLastLogin(organizationId: number, id: number): Promise<void>;

  // Fleets (tenant-scoped)
  createFleet(data: InsertFleet): Promise<Fleet>;
  getFleet(organizationId: number, id: number): Promise<Fleet | undefined>;
  getFleetByName(organizationId: number, name: string): Promise<Fleet | undefined>;
  listFleets(organizationId: number): Promise<Fleet[]>;
  updateFleet(organizationId: number, id: number, data: Partial<InsertFleet>): Promise<Fleet | undefined>;
  deleteFleet(organizationId: number, id: number): Promise<boolean>;

  // Trucks (tenant-scoped with fleet filtering)
  createTruck(data: InsertTruck): Promise<Truck>;
  getTruck(organizationId: number, id: number): Promise<Truck | undefined>;
  getTruckByNumber(organizationId: number, truckNumber: string): Promise<Truck | undefined>;
  listTrucks(organizationId: number, fleetId?: number, status?: string): Promise<Truck[]>;
  countTrucksByStatus(organizationId: number, fleetId?: number): Promise<{ status: string; count: number }[]>;
  updateTruck(organizationId: number, id: number, data: Partial<InsertTruck>): Promise<Truck | undefined>;
  updateTruckLocation(organizationId: number, id: number, latitude: number, longitude: number): Promise<void>;
  deleteTruck(organizationId: number, id: number): Promise<boolean>;

  // Power Mon Devices (tenant-scoped)
  createDevice(data: InsertPowerMonDevice): Promise<PowerMonDevice>;
  getDevice(organizationId: number, id: number): Promise<PowerMonDevice | undefined>;
  getDeviceBySerial(organizationId: number, serialNumber: string): Promise<PowerMonDevice | undefined>;
  checkSerialExists(serialNumber: string): Promise<boolean>;
  getDeviceByTruck(organizationId: number, truckId: number): Promise<PowerMonDevice | undefined>;
  listDevices(organizationId: number, status?: string): Promise<PowerMonDevice[]>;
  countDevicesByStatus(organizationId: number): Promise<{ status: string; count: number }[]>;
  updateDevice(organizationId: number, id: number, data: Partial<InsertPowerMonDevice>): Promise<PowerMonDevice | undefined>;
  assignDeviceToTruck(organizationId: number, deviceId: number, truckId: number): Promise<PowerMonDevice | undefined>;
  unassignDevice(organizationId: number, deviceId: number): Promise<PowerMonDevice | undefined>;
  updateDeviceStatus(organizationId: number, id: number, status: string): Promise<void>;

  // Device Credentials (tenant-scoped)
  createCredential(data: InsertDeviceCredential): Promise<DeviceCredential>;
  getCredential(organizationId: number, deviceId: number): Promise<DeviceCredential | undefined>;
  updateCredential(organizationId: number, deviceId: number, data: Partial<InsertDeviceCredential>): Promise<DeviceCredential | undefined>;
  deleteCredential(organizationId: number, deviceId: number): Promise<boolean>;

  // Device Snapshots (latest readings)
  upsertSnapshot(data: InsertDeviceSnapshot): Promise<DeviceSnapshot>;
  getSnapshot(organizationId: number, deviceId: number): Promise<DeviceSnapshot | undefined>;
  getSnapshotByTruck(organizationId: number, truckId: number): Promise<DeviceSnapshot | undefined>;
  listSnapshots(organizationId: number, fleetId?: number): Promise<DeviceSnapshot[]>;
  getFleetStats(organizationId: number, fleetId?: number): Promise<{
    totalTrucks: number;
    inServiceCount: number;
    notInServiceCount: number;
    onlineDevices: number;
    offlineDevices: number;
    avgSoc: number;
    avgVoltage: number;
    lowVoltageCount: number;
  }>;

  // Device Measurements (time-series)
  insertMeasurement(data: InsertDeviceMeasurement): Promise<DeviceMeasurement>;
  insertMeasurements(data: InsertDeviceMeasurement[]): Promise<number>;
  getMeasurements(organizationId: number, deviceId: number, startTime: Date, endTime: Date, limit?: number): Promise<DeviceMeasurement[]>;
  getMeasurementsByTruck(organizationId: number, truckId: number, startTime: Date, endTime: Date, limit?: number): Promise<DeviceMeasurement[]>;
  getLatestMeasurement(organizationId: number, deviceId: number): Promise<DeviceMeasurement | undefined>;

  // Device Sync Status (log file offset tracking)
  upsertSyncStatus(data: InsertDeviceSyncStatus): Promise<DeviceSyncStatus>;
  getSyncStatus(organizationId: number, deviceId: number): Promise<DeviceSyncStatus | undefined>;
  updateSyncProgress(organizationId: number, deviceId: number, lastLogFileId: string, lastLogOffset: number): Promise<void>;
  updateSyncError(organizationId: number, deviceId: number, errorMessage: string): Promise<void>;
  updateLastPoll(organizationId: number, deviceId: number): Promise<void>;

  // Alerts (tenant-scoped)
  createAlert(data: InsertAlert): Promise<Alert>;
  getAlert(organizationId: number, id: number): Promise<Alert | undefined>;
  listAlerts(organizationId: number, status?: string, limit?: number, truckId?: number): Promise<Alert[]>;
  listAlertsByTruck(organizationId: number, truckId: number, limit?: number): Promise<Alert[]>;
  countActiveAlerts(organizationId: number): Promise<number>;
  acknowledgeAlert(organizationId: number, id: number, userId: number): Promise<Alert | undefined>;
  resolveAlert(organizationId: number, id: number): Promise<Alert | undefined>;
  resolveAlertsByDevice(organizationId: number, deviceId: number, alertType: string): Promise<number>;

  // Audit Logs (tenant-scoped, append-only)
  createAuditLog(data: InsertAuditLog): Promise<AuditLog>;
  listAuditLogs(organizationId: number, startTime?: Date, endTime?: Date, limit?: number): Promise<AuditLog[]>;

  // Polling Settings (tenant-scoped)
  getOrCreatePollingSettings(organizationId: number): Promise<PollingSetting>;
  updatePollingSettings(organizationId: number, data: Partial<InsertPollingSetting>): Promise<PollingSetting | undefined>;

  // Dashboard Queries (optimized)
  getDashboardData(organizationId: number, fleetId?: number): Promise<{
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
  }>;

  // Admin Operations (cross-tenant)
  deleteOrganization(id: number): Promise<boolean>;
  listAllDevices(): Promise<PowerMonDevice[]>;
  listAllUsers(): Promise<User[]>;
  deleteUser(organizationId: number, id: number): Promise<boolean>;
  getUserByEmailGlobal(email: string): Promise<User | undefined>;
  hasActiveAlertForDevice(organizationId: number, deviceId: number, alertType: string): Promise<boolean>;
  getAdminStats(): Promise<{
    totalOrganizations: number;
    totalFleets: number;
    totalTrucks: number;
    totalDevices: number;
    totalUsers: number;
    onlineDevices: number;
    offlineDevices: number;
    activeAlerts: number;
  }>;
}

export { dbStorage as storage } from "./db-storage";
