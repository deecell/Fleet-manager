import { pgTable, serial, text, timestamp, integer, boolean, varchar, index, real, bigint, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// =============================================================================
// ORGANIZATIONS (Tenants / Customers)
// =============================================================================
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").default("standard"),
  isActive: boolean("is_active").default(true),
  settings: text("settings"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  slugIdx: index("org_slug_idx").on(table.slug),
}));

// =============================================================================
// USERS
// =============================================================================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").default("user"),
  isActive: boolean("is_active").default(true),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  emailOrgIdx: uniqueIndex("user_email_org_idx").on(table.email, table.organizationId),
  orgIdx: index("user_org_idx").on(table.organizationId),
}));

// =============================================================================
// FLEETS (1-N per organization, each with custom name)
// =============================================================================
export const fleets = pgTable("fleets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  timezone: text("timezone").default("America/Los_Angeles"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("fleet_org_idx").on(table.organizationId),
  orgNameIdx: uniqueIndex("fleet_org_name_idx").on(table.organizationId, table.name),
}));

// =============================================================================
// TRUCKS (belong to a fleet)
// =============================================================================
export const trucks = pgTable("trucks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fleetId: integer("fleet_id")
    .notNull()
    .references(() => fleets.id, { onDelete: "cascade" }),
  truckNumber: text("truck_number").notNull(),
  driverName: text("driver_name"),
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  vinNumber: text("vin_number"),
  licensePlate: text("license_plate"),
  status: text("status").default("in-service"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  lastLocationUpdate: timestamp("last_location_update"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("truck_org_idx").on(table.organizationId),
  fleetIdx: index("truck_fleet_idx").on(table.fleetId),
  orgFleetStatusIdx: index("truck_org_fleet_status_idx").on(table.organizationId, table.fleetId, table.status),
  truckNumberIdx: index("truck_number_idx").on(table.organizationId, table.truckNumber),
}));

// =============================================================================
// POWER MON DEVICES (1:1 with truck)
// =============================================================================
export const powerMonDevices = pgTable("power_mon_devices", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  truckId: integer("truck_id")
    .references(() => trucks.id, { onDelete: "set null" }),
  serialNumber: text("serial_number").notNull().unique(),
  deviceName: text("device_name"),
  hardwareRevision: text("hardware_revision"),
  firmwareVersion: text("firmware_version"),
  hostId: text("host_id"),
  status: text("status").default("offline"),
  lastSeenAt: timestamp("last_seen_at"),
  assignedAt: timestamp("assigned_at"),
  unassignedAt: timestamp("unassigned_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("device_org_idx").on(table.organizationId),
  truckIdx: index("device_truck_idx").on(table.truckId),
  serialIdx: index("device_serial_idx").on(table.serialNumber),
  statusIdx: index("device_status_idx").on(table.organizationId, table.status),
}));

// =============================================================================
// DEVICE CREDENTIALS (encrypted WifiAccessKey storage)
// =============================================================================
export const deviceCredentials = pgTable("device_credentials", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: integer("device_id")
    .notNull()
    .references(() => powerMonDevices.id, { onDelete: "cascade" }),
  connectionKey: text("connection_key").notNull(),
  accessKey: text("access_key").notNull(),
  applinkUrl: text("applink_url"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("credential_org_idx").on(table.organizationId),
  deviceIdx: uniqueIndex("credential_device_idx").on(table.deviceId),
}));

// =============================================================================
// DEVICE SNAPSHOTS (latest readings for fast dashboard queries)
// =============================================================================
export const deviceSnapshots = pgTable("device_snapshots", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: integer("device_id")
    .notNull()
    .references(() => powerMonDevices.id, { onDelete: "cascade" }),
  truckId: integer("truck_id")
    .references(() => trucks.id, { onDelete: "set null" }),
  fleetId: integer("fleet_id")
    .references(() => fleets.id, { onDelete: "set null" }),
  voltage1: real("voltage1"),
  voltage2: real("voltage2"),
  current: real("current"),
  power: real("power"),
  temperature: real("temperature"),
  soc: real("soc"),
  energy: real("energy"),
  charge: real("charge"),
  runtime: integer("runtime"),
  rssi: integer("rssi"),
  recordedAt: timestamp("recorded_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  deviceIdx: uniqueIndex("snapshot_device_idx").on(table.deviceId),
  orgIdx: index("snapshot_org_idx").on(table.organizationId),
  orgFleetIdx: index("snapshot_org_fleet_idx").on(table.organizationId, table.fleetId),
}));

// =============================================================================
// DEVICE MEASUREMENTS (time-series data - will be partitioned by month)
// =============================================================================
export const deviceMeasurements = pgTable("device_measurements", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: integer("device_id")
    .notNull()
    .references(() => powerMonDevices.id, { onDelete: "cascade" }),
  truckId: integer("truck_id")
    .references(() => trucks.id, { onDelete: "set null" }),
  voltage1: real("voltage1"),
  voltage2: real("voltage2"),
  current: real("current"),
  power: real("power"),
  temperature: real("temperature"),
  soc: real("soc"),
  energy: real("energy"),
  charge: real("charge"),
  runtime: integer("runtime"),
  rssi: integer("rssi"),
  source: text("source").default("poll"),
  recordedAt: timestamp("recorded_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgDeviceTimeIdx: index("measurement_org_device_time_idx").on(table.organizationId, table.deviceId, table.recordedAt),
  recordedAtIdx: index("measurement_recorded_at_idx").on(table.recordedAt),
  deviceTimeIdx: index("measurement_device_time_idx").on(table.deviceId, table.recordedAt),
}));

// =============================================================================
// DEVICE SYNC STATUS (tracks log file offset for backfill)
// =============================================================================
export const deviceSyncStatus = pgTable("device_sync_status", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: integer("device_id")
    .notNull()
    .references(() => powerMonDevices.id, { onDelete: "cascade" }),
  lastLogFileId: text("last_log_file_id"),
  lastLogOffset: bigint("last_log_offset", { mode: "number" }).default(0),
  lastSyncAt: timestamp("last_sync_at"),
  lastPollAt: timestamp("last_poll_at"),
  syncStatus: text("sync_status").default("idle"),
  errorMessage: text("error_message"),
  consecutiveFailures: integer("consecutive_failures").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("sync_status_org_idx").on(table.organizationId),
  deviceIdx: uniqueIndex("sync_status_device_idx").on(table.deviceId),
}));

// =============================================================================
// ALERTS (OFFLINE and Low Voltage for V1)
// =============================================================================
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: integer("device_id")
    .references(() => powerMonDevices.id, { onDelete: "cascade" }),
  truckId: integer("truck_id")
    .references(() => trucks.id, { onDelete: "set null" }),
  fleetId: integer("fleet_id")
    .references(() => fleets.id, { onDelete: "set null" }),
  alertType: text("alert_type").notNull(),
  severity: text("severity").default("warning"),
  title: text("title").notNull(),
  message: text("message"),
  threshold: real("threshold"),
  actualValue: real("actual_value"),
  status: text("status").default("active"),
  acknowledgedBy: integer("acknowledged_by")
    .references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("alert_org_idx").on(table.organizationId),
  orgStatusIdx: index("alert_org_status_idx").on(table.organizationId, table.status),
  deviceIdx: index("alert_device_idx").on(table.deviceId),
  typeIdx: index("alert_type_idx").on(table.alertType),
  createdAtIdx: index("alert_created_at_idx").on(table.createdAt),
}));

// =============================================================================
// AUDIT LOGS (SOC2 Requirement)
// =============================================================================
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id"),
  details: text("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgIdx: index("audit_org_idx").on(table.organizationId),
  createdAtIdx: index("audit_created_at_idx").on(table.createdAt),
}));

// =============================================================================
// SESSIONS
// =============================================================================
export const sessions = pgTable("sessions", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: text("sess").notNull(),
  expire: timestamp("expire").notNull(),
}, (table) => ({
  expireIdx: index("session_expire_idx").on(table.expire),
}));

// =============================================================================
// POLLING SETTINGS (configurable per organization)
// =============================================================================
export const pollingSettings = pgTable("polling_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  pollingIntervalSeconds: integer("polling_interval_seconds").default(60),
  logSyncIntervalMinutes: integer("log_sync_interval_minutes").default(15),
  offlineThresholdMinutes: integer("offline_threshold_minutes").default(5),
  lowVoltageThreshold: real("low_voltage_threshold").default(11.5),
  isEnabled: boolean("is_enabled").default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: uniqueIndex("polling_settings_org_idx").on(table.organizationId),
}));

// =============================================================================
// INSERT SCHEMAS (Zod validation for API inputs)
// =============================================================================
export const insertOrganizationSchema = createInsertSchema(organizations)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true, createdAt: true, updatedAt: true, lastLoginAt: true });

export const insertFleetSchema = createInsertSchema(fleets)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const insertTruckSchema = createInsertSchema(trucks)
  .omit({ id: true, createdAt: true, updatedAt: true, lastLocationUpdate: true });

export const insertPowerMonDeviceSchema = createInsertSchema(powerMonDevices)
  .omit({ id: true, createdAt: true, updatedAt: true, lastSeenAt: true });

export const insertDeviceCredentialSchema = createInsertSchema(deviceCredentials)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const insertDeviceSnapshotSchema = createInsertSchema(deviceSnapshots)
  .omit({ id: true, updatedAt: true });

export const insertDeviceMeasurementSchema = createInsertSchema(deviceMeasurements)
  .omit({ id: true, createdAt: true });

export const insertDeviceSyncStatusSchema = createInsertSchema(deviceSyncStatus)
  .omit({ id: true, updatedAt: true });

export const insertAlertSchema = createInsertSchema(alerts)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const insertAuditLogSchema = createInsertSchema(auditLogs)
  .omit({ id: true, createdAt: true });

export const insertPollingSettingsSchema = createInsertSchema(pollingSettings)
  .omit({ id: true, updatedAt: true });

// =============================================================================
// SELECT TYPES (for query results)
// =============================================================================
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Fleet = typeof fleets.$inferSelect;
export type Truck = typeof trucks.$inferSelect;
export type PowerMonDevice = typeof powerMonDevices.$inferSelect;
export type DeviceCredential = typeof deviceCredentials.$inferSelect;
export type DeviceSnapshot = typeof deviceSnapshots.$inferSelect;
export type DeviceMeasurement = typeof deviceMeasurements.$inferSelect;
export type DeviceSyncStatus = typeof deviceSyncStatus.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type PollingSetting = typeof pollingSettings.$inferSelect;

// =============================================================================
// INSERT TYPES (for creating new records)
// =============================================================================
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertFleet = z.infer<typeof insertFleetSchema>;
export type InsertTruck = z.infer<typeof insertTruckSchema>;
export type InsertPowerMonDevice = z.infer<typeof insertPowerMonDeviceSchema>;
export type InsertDeviceCredential = z.infer<typeof insertDeviceCredentialSchema>;
export type InsertDeviceSnapshot = z.infer<typeof insertDeviceSnapshotSchema>;
export type InsertDeviceMeasurement = z.infer<typeof insertDeviceMeasurementSchema>;
export type InsertDeviceSyncStatus = z.infer<typeof insertDeviceSyncStatusSchema>;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type InsertPollingSetting = z.infer<typeof insertPollingSettingsSchema>;

// =============================================================================
// LEGACY SCHEMAS (for backward compatibility with existing dashboard)
// These will be deprecated once we migrate to the new API
// =============================================================================
export const legacyTruckSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  serial: z.string(),
  fw: z.string(),
  v1: z.number(),
  v2: z.number(),
  p: z.number(),
  wh: z.number(),
  ah: z.number(),
  temp: z.number(),
  soc: z.number(),
  runtime: z.number(),
  ps: z.string(),
  address: z.string(),
  x: z.string(),
  rssi: z.number(),
  status: z.enum(["in-service", "not-in-service"]),
  latitude: z.number(),
  longitude: z.number(),
});

export type LegacyTruck = z.infer<typeof legacyTruckSchema>;

export const legacyHistoricalDataPointSchema = z.object({
  timestamp: z.number(),
  soc: z.number(),
  voltage: z.number(),
  current: z.number(),
  watts: z.number(),
});

export type LegacyHistoricalDataPoint = z.infer<typeof legacyHistoricalDataPointSchema>;

export const legacyTruckWithHistorySchema = legacyTruckSchema.extend({
  history: z.array(legacyHistoricalDataPointSchema),
});

export type LegacyTruckWithHistory = z.infer<typeof legacyTruckWithHistorySchema>;

export const legacyNotificationSchema = z.object({
  id: z.string(),
  type: z.enum(["alert", "warning", "info"]),
  title: z.string(),
  message: z.string(),
  truckId: z.string().optional(),
  truckName: z.string().optional(),
  timestamp: z.number(),
  read: z.boolean(),
});

export type LegacyNotification = z.infer<typeof legacyNotificationSchema>;

// =============================================================================
// ALERT TYPE CONSTANTS
// =============================================================================
export const ALERT_TYPES = {
  DEVICE_OFFLINE: "device_offline",
  LOW_VOLTAGE: "low_voltage",
} as const;

export const ALERT_SEVERITY = {
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
} as const;

export const DEVICE_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  UNKNOWN: "unknown",
} as const;

export const TRUCK_STATUS = {
  IN_SERVICE: "in-service",
  NOT_IN_SERVICE: "not-in-service",
} as const;

// =============================================================================
// BACKWARD COMPATIBILITY ALIASES
// =============================================================================
export type TruckWithHistory = LegacyTruckWithHistory;
export type HistoricalDataPoint = LegacyHistoricalDataPoint;
export type Notification = LegacyNotification;
