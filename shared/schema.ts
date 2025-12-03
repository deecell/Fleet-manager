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
  batteryVoltage: real("battery_voltage"),
  batteryAh: real("battery_ah"),
  numberOfBatteries: integer("number_of_batteries"),
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
  powerStatus: integer("power_status"),
  powerStatusString: text("power_status_string"),
  isParked: boolean("is_parked").default(false),
  parkedSince: timestamp("parked_since"),
  todayParkedMinutes: integer("today_parked_minutes").default(0),
  parkedDate: text("parked_date"),
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
  powerStatus: integer("power_status"),
  powerStatusString: text("power_status_string"),
  source: text("source").default("poll"),
  recordedAt: timestamp("recorded_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgDeviceTimeIdx: index("measurement_org_device_time_idx").on(table.organizationId, table.deviceId, table.recordedAt),
  recordedAtIdx: index("measurement_recorded_at_idx").on(table.recordedAt),
  deviceTimeIdx: index("measurement_device_time_idx").on(table.deviceId, table.recordedAt),
}));

// =============================================================================
// DEVICE STATISTICS (lifetime fuelgauge statistics from PowerMon)
// =============================================================================
export const deviceStatistics = pgTable("device_statistics", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: integer("device_id")
    .notNull()
    .references(() => powerMonDevices.id, { onDelete: "cascade" }),
  truckId: integer("truck_id")
    .references(() => trucks.id, { onDelete: "set null" }),
  totalCharge: real("total_charge"),
  totalChargeEnergy: real("total_charge_energy"),
  totalDischarge: real("total_discharge"),
  totalDischargeEnergy: real("total_discharge_energy"),
  minVoltage: real("min_voltage"),
  maxVoltage: real("max_voltage"),
  maxChargeCurrent: real("max_charge_current"),
  maxDischargeCurrent: real("max_discharge_current"),
  timeSinceLastFullCharge: integer("time_since_last_full_charge"),
  fullChargeCapacity: real("full_charge_capacity"),
  deepestDischarge: real("deepest_discharge"),
  lastDischarge: real("last_discharge"),
  soc: real("soc"),
  secondsSinceOn: integer("seconds_since_on"),
  voltage1Min: real("voltage1_min"),
  voltage1Max: real("voltage1_max"),
  voltage2Min: real("voltage2_min"),
  voltage2Max: real("voltage2_max"),
  peakChargeCurrent: real("peak_charge_current"),
  peakDischargeCurrent: real("peak_discharge_current"),
  temperatureMin: real("temperature_min"),
  temperatureMax: real("temperature_max"),
  recordedAt: timestamp("recorded_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  deviceIdx: uniqueIndex("statistics_device_idx").on(table.deviceId),
  orgIdx: index("statistics_org_idx").on(table.organizationId),
}));

// =============================================================================
// DEVICE SYNC STATUS (tracks polling state, connection, and log file sync)
// Used by Device Manager for connection pool and backfill operations
// =============================================================================
export const deviceSyncStatus = pgTable("device_sync_status", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: integer("device_id")
    .notNull()
    .references(() => powerMonDevices.id, { onDelete: "cascade" }),
  
  // Connection state (managed by Device Manager)
  connectionStatus: text("connection_status").default("disconnected"), // disconnected, connecting, connected, reconnecting
  cohortId: integer("cohort_id").default(0), // Polling cohort for staggered scheduling
  lastConnectedAt: timestamp("last_connected_at"),
  lastDisconnectedAt: timestamp("last_disconnected_at"),
  
  // Polling state
  lastPollAt: timestamp("last_poll_at"),
  lastSuccessfulPollAt: timestamp("last_successful_poll_at"),
  consecutivePollFailures: integer("consecutive_poll_failures").default(0),
  
  // Log file sync state (for backfill)
  lastLogFileId: text("last_log_file_id"),
  lastLogOffset: bigint("last_log_offset", { mode: "number" }).default(0),
  lastLogSyncAt: timestamp("last_log_sync_at"),
  totalSamplesSynced: bigint("total_samples_synced", { mode: "number" }).default(0),
  
  // Backfill state (gap recovery)
  backfillStatus: text("backfill_status").default("idle"), // idle, pending, in_progress, completed, failed
  gapStartAt: timestamp("gap_start_at"), // When offline period started
  gapEndAt: timestamp("gap_end_at"), // When device came back online
  
  // General status
  syncStatus: text("sync_status").default("idle"), // idle, syncing, error
  errorMessage: text("error_message"),
  consecutiveFailures: integer("consecutive_failures").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("sync_status_org_idx").on(table.organizationId),
  deviceIdx: uniqueIndex("sync_status_device_idx").on(table.deviceId),
  connectionStatusIdx: index("sync_status_connection_idx").on(table.connectionStatus),
  cohortIdx: index("sync_status_cohort_idx").on(table.cohortId),
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
// SIM CARDS (from SIMPro - linked to PowerMon devices by name)
// =============================================================================
export const sims = pgTable("sims", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: integer("device_id")
    .references(() => powerMonDevices.id, { onDelete: "set null" }),
  truckId: integer("truck_id")
    .references(() => trucks.id, { onDelete: "set null" }),
  simproId: integer("simpro_id"),
  iccid: text("iccid").notNull().unique(),
  msisdn: text("msisdn"),
  imsi: text("imsi"),
  eid: text("eid"),
  deviceName: text("device_name"),
  status: text("status").default("unknown"),
  workflowStatus: text("workflow_status"),
  ipAddress: text("ip_address"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  locationAccuracy: real("location_accuracy"),
  lastLocationUpdate: timestamp("last_location_update"),
  dataUsedMb: real("data_used_mb").default(0),
  dataLimitMb: real("data_limit_mb"),
  lastUsageUpdate: timestamp("last_usage_update"),
  lastSyncAt: timestamp("last_sync_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("sim_org_idx").on(table.organizationId),
  deviceIdx: index("sim_device_idx").on(table.deviceId),
  truckIdx: index("sim_truck_idx").on(table.truckId),
  iccidIdx: index("sim_iccid_idx").on(table.iccid),
  msisdnIdx: index("sim_msisdn_idx").on(table.msisdn),
  deviceNameIdx: index("sim_device_name_idx").on(table.deviceName),
}));

// =============================================================================
// SIM LOCATION HISTORY (for tracking movement patterns)
// =============================================================================
export const simLocationHistory = pgTable("sim_location_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  simId: integer("sim_id")
    .notNull()
    .references(() => sims.id, { onDelete: "cascade" }),
  truckId: integer("truck_id")
    .references(() => trucks.id, { onDelete: "set null" }),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  accuracy: real("accuracy"),
  source: text("source").default("cell_tower"),
  recordedAt: timestamp("recorded_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgIdx: index("sim_location_org_idx").on(table.organizationId),
  simIdx: index("sim_location_sim_idx").on(table.simId),
  timeIdx: index("sim_location_time_idx").on(table.recordedAt),
  simTimeIdx: index("sim_location_sim_time_idx").on(table.simId, table.recordedAt),
}));

// =============================================================================
// SIM USAGE HISTORY (for data consumption tracking and alerts)
// =============================================================================
export const simUsageHistory = pgTable("sim_usage_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  simId: integer("sim_id")
    .notNull()
    .references(() => sims.id, { onDelete: "cascade" }),
  dataUsedMb: real("data_used_mb").notNull(),
  smsCount: integer("sms_count").default(0),
  period: text("period"),
  recordedAt: timestamp("recorded_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgIdx: index("sim_usage_org_idx").on(table.organizationId),
  simIdx: index("sim_usage_sim_idx").on(table.simId),
  timeIdx: index("sim_usage_time_idx").on(table.recordedAt),
}));

// =============================================================================
// SIM SYNC SETTINGS (SIMPro API configuration per organization)
// =============================================================================
export const simSyncSettings = pgTable("sim_sync_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  locationSyncIntervalMinutes: integer("location_sync_interval_minutes").default(5),
  usageSyncIntervalMinutes: integer("usage_sync_interval_minutes").default(60),
  dataUsageAlertThresholdPercent: integer("data_usage_alert_threshold_percent").default(80),
  isEnabled: boolean("is_enabled").default(true),
  lastSimSyncAt: timestamp("last_sim_sync_at"),
  lastLocationSyncAt: timestamp("last_location_sync_at"),
  lastUsageSyncAt: timestamp("last_usage_sync_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: uniqueIndex("sim_sync_settings_org_idx").on(table.organizationId),
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
// FUEL PRICES (historical diesel prices from EIA API)
// =============================================================================
export const fuelPrices = pgTable("fuel_prices", {
  id: serial("id").primaryKey(),
  priceDate: timestamp("price_date").notNull(),
  pricePerGallon: real("price_per_gallon").notNull(),
  region: text("region").default("US"),
  source: text("source").default("EIA"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  dateRegionIdx: uniqueIndex("fuel_price_date_region_idx").on(table.priceDate, table.region),
  dateIdx: index("fuel_price_date_idx").on(table.priceDate),
}));

// =============================================================================
// SAVINGS CONFIG (organization-specific savings calculation settings)
// =============================================================================
export const savingsConfig = pgTable("savings_config", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  dieselKwhPerGallon: real("diesel_kwh_per_gallon").default(9.0),
  defaultFuelPricePerGallon: real("default_fuel_price_per_gallon").default(3.50),
  useLiveFuelPrices: boolean("use_live_fuel_prices").default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: uniqueIndex("savings_config_org_idx").on(table.organizationId),
}));

// =============================================================================
// DATA MIGRATIONS (tracks which data migrations have been run)
// =============================================================================
export const dataMigrations = pgTable("data_migrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  appliedAt: timestamp("applied_at").defaultNow(),
  appliedBy: text("applied_by").default("system"),
}, (table) => ({
  nameIdx: uniqueIndex("data_migration_name_idx").on(table.name),
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

export const insertDeviceStatisticsSchema = createInsertSchema(deviceStatistics)
  .omit({ id: true, updatedAt: true });

export const insertAlertSchema = createInsertSchema(alerts)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const insertAuditLogSchema = createInsertSchema(auditLogs)
  .omit({ id: true, createdAt: true });

export const insertPollingSettingsSchema = createInsertSchema(pollingSettings)
  .omit({ id: true, updatedAt: true });

export const insertSimSchema = createInsertSchema(sims)
  .omit({ id: true, createdAt: true, updatedAt: true, lastSyncAt: true, lastLocationUpdate: true, lastUsageUpdate: true });

export const insertSimLocationHistorySchema = createInsertSchema(simLocationHistory)
  .omit({ id: true, createdAt: true });

export const insertSimUsageHistorySchema = createInsertSchema(simUsageHistory)
  .omit({ id: true, createdAt: true });

export const insertSimSyncSettingsSchema = createInsertSchema(simSyncSettings)
  .omit({ id: true, updatedAt: true, lastSimSyncAt: true, lastLocationSyncAt: true, lastUsageSyncAt: true });

export const insertFuelPriceSchema = createInsertSchema(fuelPrices)
  .omit({ id: true, createdAt: true });

export const insertSavingsConfigSchema = createInsertSchema(savingsConfig)
  .omit({ id: true, updatedAt: true });

export const insertDataMigrationSchema = createInsertSchema(dataMigrations)
  .omit({ id: true, appliedAt: true });

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
export type DeviceStatistics = typeof deviceStatistics.$inferSelect;
export type DeviceSyncStatus = typeof deviceSyncStatus.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type PollingSetting = typeof pollingSettings.$inferSelect;
export type Sim = typeof sims.$inferSelect;
export type SimLocationHistory = typeof simLocationHistory.$inferSelect;
export type SimUsageHistory = typeof simUsageHistory.$inferSelect;
export type SimSyncSetting = typeof simSyncSettings.$inferSelect;
export type FuelPrice = typeof fuelPrices.$inferSelect;
export type SavingsConfig = typeof savingsConfig.$inferSelect;
export type DataMigration = typeof dataMigrations.$inferSelect;

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
export type InsertDeviceStatistics = z.infer<typeof insertDeviceStatisticsSchema>;
export type InsertDeviceSyncStatus = z.infer<typeof insertDeviceSyncStatusSchema>;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type InsertPollingSetting = z.infer<typeof insertPollingSettingsSchema>;
export type InsertSim = z.infer<typeof insertSimSchema>;
export type InsertSimLocationHistory = z.infer<typeof insertSimLocationHistorySchema>;
export type InsertSimUsageHistory = z.infer<typeof insertSimUsageHistorySchema>;
export type InsertSimSyncSetting = z.infer<typeof insertSimSyncSettingsSchema>;
export type InsertFuelPrice = z.infer<typeof insertFuelPriceSchema>;
export type InsertSavingsConfig = z.infer<typeof insertSavingsConfigSchema>;

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
  driver: z.string(),
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
