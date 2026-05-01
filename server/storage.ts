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
  type PasswordResetToken, type InsertPasswordResetToken,
  type InvitationToken, type InsertInvitationToken,
  type ShellyDevice, type InsertShellyDevice,
  type ShellySnapshot, type InsertShellySnapshot,
  type ShellyReading, type InsertShellyReading,
  type ExportJob, type InsertExportJob,
} from "@shared/schema";
import type { TruckExportRow } from "./services/exports/types";

// Result of attempting to enqueue an export job (concurrency-limit aware).
export type CreateExportJobResult =
  | { ok: true; job: ExportJob }
  | { ok: false; reason: "user_limit" | "org_limit"; activeUserCount: number; activeOrgCount: number };

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
  updateTruckLocation(organizationId: number, id: number, latitude: number, longitude: number, locationDescription?: string | null): Promise<void>;
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
  resetDeviceConnectionStatus(id: number): Promise<PowerMonDevice | undefined>;
  setDeviceOffline(id: number): Promise<PowerMonDevice | undefined>;
  deleteDevice(organizationId: number, id: number): Promise<boolean>;

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
  // Idempotently provisions the synthetic "Deecell Admin" user + "Deecell
  // Internal" org used to back ADMIN_PASSWORD-based admin sessions. Returns
  // their ids so they can be stashed in the session and used to attribute
  // admin export jobs to a real users.id row (export_jobs.user_id is NOT NULL
  // FK → users.id, and the concurrency-limit advisory lock keys on org id).
  ensureAdminUserAndOrg(): Promise<{ userId: number; organizationId: number }>;
  // Admin Devices Export (Task #5). Returns the flat per-device row shape
  // consumed by the admin export generator. Filters are applied at the SQL
  // layer; all relations are LEFT JOINed so devices without a sim/snapshot/
  // sync row still appear in the output.
  getAdminDevicesForExport(filters: import("./services/exports/admin-types").GetAdminDevicesForExportFilters): Promise<import("./services/exports/admin-types").AdminDeviceExportRow[]>;
  deleteOrganization(id: number): Promise<boolean>;
  listAllDevices(): Promise<PowerMonDevice[]>;
  listAllDevicesWithSnapshots(): Promise<(PowerMonDevice & { snapshot?: DeviceSnapshot })[]>;
  listDevicesWithSnapshots(organizationId: number): Promise<(PowerMonDevice & { snapshot?: DeviceSnapshot })[]>;
  listAllUsers(): Promise<User[]>;
  deleteUser(organizationId: number, id: number): Promise<boolean>;
  getUserByEmailGlobal(email: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  updateUserPassword(userId: number, passwordHash: string): Promise<void>;
  updateUserProfilePicture(userId: number, profilePictureUrl: string | null): Promise<void>;
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
    totalStoredPower: number;
  }>;

  // Password Reset Tokens
  createPasswordResetToken(data: InsertPasswordResetToken): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenUsed(token: string): Promise<void>;

  // Invitation Tokens
  createInvitationToken(data: InsertInvitationToken): Promise<InvitationToken>;
  getInvitationToken(token: string): Promise<InvitationToken | undefined>;
  markInvitationTokenUsed(token: string): Promise<void>;

  // Shelly Devices (vibration sensors)
  createShellyDevice(data: InsertShellyDevice): Promise<ShellyDevice>;
  getShellyDevice(organizationId: number, id: number): Promise<ShellyDevice | undefined>;
  getShellyDeviceByDeviceId(deviceId: string): Promise<ShellyDevice | undefined>;
  getShellyDeviceByTruck(organizationId: number, truckId: number): Promise<ShellyDevice | undefined>;
  listShellyDevices(organizationId: number): Promise<ShellyDevice[]>;
  listAllShellyDevices(): Promise<ShellyDevice[]>;
  updateShellyDevice(organizationId: number, id: number, data: Partial<InsertShellyDevice>): Promise<ShellyDevice | undefined>;
  updateShellyDeviceByDeviceId(deviceId: string, data: Partial<InsertShellyDevice> & { lastSeenAt?: Date }): Promise<ShellyDevice | undefined>;
  assignShellyDeviceToTruck(organizationId: number, deviceId: number, truckId: number): Promise<ShellyDevice | undefined>;
  markShellyDevicesOffline(cutoffTime: Date): Promise<number>;

  // Shelly Snapshots
  upsertShellySnapshot(data: InsertShellySnapshot): Promise<ShellySnapshot>;
  getShellySnapshot(organizationId: number, shellyDeviceId: number): Promise<ShellySnapshot | undefined>;
  getShellySnapshotByTruck(organizationId: number, truckId: number): Promise<ShellySnapshot | undefined>;
  listShellySnapshots(organizationId: number): Promise<ShellySnapshot[]>;
  
  // Shelly Readings (historical data for calibration)
  insertShellyReading(data: InsertShellyReading): Promise<ShellyReading>;
  listShellyReadings(shellyDeviceId: number, limit?: number): Promise<ShellyReading[]>;

  // Exports — single batched query per export to avoid N+1.
  getTrucksForExport(
    organizationId: number,
    options: {
      fleetId?: number;
      operationalStatus?: "in-service" | "not-in-service";
      searchQuery?: string;
      includeStatistics?: boolean;
      includeSims?: boolean;
    },
  ): Promise<TruckExportRow[]>;

  // Historical (single-truck time-series) export — aggregates
  // `device_measurements` and joins per-bucket alert counts. Org-scoped.
  getHistoricalMeasurements(
    opts: import("./services/exports/types").HistoricalQueryOptions,
  ): Promise<import("./services/exports/types").HistoricalQueryResult>;

  // Export Jobs (async pipeline)
  createExportJobWithLimits(
    data: InsertExportJob,
    limits: { userLimit: number; orgLimit: number },
  ): Promise<CreateExportJobResult>;
  getExportJob(organizationId: number, id: number): Promise<ExportJob | undefined>;
  listExportJobsForUser(
    organizationId: number,
    userId: number,
    options?: { limit?: number; statuses?: string[]; includeDismissed?: boolean },
  ): Promise<ExportJob[]>;
  claimNextPendingExportJob(): Promise<ExportJob | undefined>;
  updateExportJob(id: number, data: Partial<ExportJob>): Promise<ExportJob | undefined>;
  dismissExportJob(organizationId: number, userId: number, id: number): Promise<ExportJob | undefined>;
  // Sweep completed jobs whose signed URL has expired → mark expired, clear url.
  expireOverdueExportJobs(now?: Date): Promise<number>;
}

export { dbStorage as storage } from "./db-storage";
