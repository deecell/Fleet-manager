/**
 * Seed Script - Populates database with demo data for Fleet Dashboard
 * 
 * Creates:
 * - 1 Demo Organization (Acme Transport)
 * - 2 Fleets (Flatbed Fleet, Van-Trailer Fleet)
 * - 15 Trucks with realistic US locations
 * - 15 PowerMon devices assigned to trucks
 * - Device snapshots with varied battery states
 * - 48 hours of historical measurements
 * - Sample alerts (active and resolved)
 */

import { db } from "./db";
import {
  organizations, fleets, trucks, powerMonDevices,
  deviceSnapshots, deviceMeasurements, alerts, users,
  type InsertOrganization, type InsertFleet, type InsertTruck,
  type InsertPowerMonDevice, type InsertDeviceSnapshot,
  type InsertDeviceMeasurement, type InsertAlert, type InsertUser,
  TRUCK_STATUS, DEVICE_STATUS, ALERT_TYPES, ALERT_SEVERITY,
} from "@shared/schema";

// Alert status constants (not in schema, using directly)
const ALERT_STATUS = {
  ACTIVE: "active",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
} as const;

// Truck data with realistic US locations (lat/lng)
const FLATBED_TRUCKS = [
  { number: "FLT-001", driver: "John Martinez", lat: 34.0522, lng: -118.2437, city: "Los Angeles, CA" },
  { number: "FLT-002", driver: "Mike Johnson", lat: 33.4484, lng: -112.0740, city: "Phoenix, AZ" },
  { number: "FLT-003", driver: "Carlos Rivera", lat: 29.7604, lng: -95.3698, city: "Houston, TX" },
  { number: "FLT-004", driver: "James Wilson", lat: 32.7157, lng: -117.1611, city: "San Diego, CA" },
  { number: "FLT-005", driver: "Robert Brown", lat: 36.1699, lng: -115.1398, city: "Las Vegas, NV" },
  { number: "FLT-006", driver: "David Lee", lat: 37.7749, lng: -122.4194, city: "San Francisco, CA" },
  { number: "FLT-007", driver: "William Chen", lat: 32.7767, lng: -96.7970, city: "Dallas, TX" },
  { number: "FLT-008", driver: "Thomas Garcia", lat: 33.7490, lng: -84.3880, city: "Atlanta, GA" },
];

const VAN_TRAILER_TRUCKS = [
  { number: "VAN-001", driver: "Sarah Thompson", lat: 34.0195, lng: -118.4912, city: "Santa Monica, CA" },
  { number: "VAN-002", driver: "Jennifer Adams", lat: 37.3382, lng: -121.8863, city: "San Jose, CA" },
  { number: "VAN-003", driver: "Emily Davis", lat: 39.7392, lng: -104.9903, city: "Denver, CO" },
  { number: "VAN-004", driver: "Amanda White", lat: 47.6062, lng: -122.3321, city: "Seattle, WA" },
  { number: "VAN-005", driver: "Michelle Taylor", lat: 45.5152, lng: -122.6784, city: "Portland, OR" },
  { number: "VAN-006", driver: "Lisa Anderson", lat: 40.7608, lng: -111.8910, city: "Salt Lake City, UT" },
  { number: "VAN-007", driver: "Karen Martin", lat: 35.4676, lng: -97.5164, city: "Oklahoma City, OK" },
];

// Generate realistic PowerMon readings
function generateSnapshot(deviceId: number, organizationId: number, truckIndex: number): InsertDeviceSnapshot {
  // Vary SOC between 65-98% with some trucks having lower charge
  const baseSOC = 75 + Math.random() * 20;
  const soc = truckIndex % 5 === 0 ? 65 + Math.random() * 10 : baseSOC; // Every 5th truck has lower SOC
  
  // Voltage varies with SOC (roughly 12.0-14.4V for 12V system)
  const voltage1 = 12.0 + (soc / 100) * 2.4 + (Math.random() - 0.5) * 0.3;
  const voltage2 = 12.0 + (soc / 100) * 2.2 + (Math.random() - 0.5) * 0.2;
  
  // Current draw varies based on activity
  const current = 5 + Math.random() * 25;
  
  // Power = V * I (roughly)
  const power = voltage1 * current;
  
  // Temperature varies 20-45°C
  const temperature = 25 + Math.random() * 15;
  
  // Energy consumed today (Wh)
  const energy = 500 + Math.random() * 2000;
  
  // Charge consumed (Ah)
  const charge = energy / voltage1;
  
  // Estimated runtime in minutes
  const runtime = (soc / 100) * 480; // Up to 8 hours at full charge
  
  // WiFi signal strength
  const rssi = -40 - Math.random() * 30; // -40 to -70 dBm

  return {
    deviceId,
    organizationId,
    voltage1: Math.round(voltage1 * 100) / 100,
    voltage2: Math.round(voltage2 * 100) / 100,
    current: Math.round(current * 100) / 100,
    power: Math.round(power * 100) / 100,
    temperature: Math.round(temperature * 10) / 10,
    soc: Math.round(soc * 10) / 10,
    energy: Math.round(energy),
    charge: Math.round(charge * 100) / 100,
    runtime: Math.round(runtime),
    rssi: Math.round(rssi),
    recordedAt: new Date(),
  };
}

// Generate historical measurements for charts
function generateMeasurements(
  deviceId: number,
  organizationId: number,
  hoursBack: number = 48
): InsertDeviceMeasurement[] {
  const measurements: InsertDeviceMeasurement[] = [];
  const now = new Date();
  const intervalMinutes = 15; // One reading every 15 minutes
  const readingsCount = (hoursBack * 60) / intervalMinutes;
  
  let baseSoc = 85 + Math.random() * 10;
  
  for (let i = 0; i < readingsCount; i++) {
    const timestamp = new Date(now.getTime() - (readingsCount - i) * intervalMinutes * 60 * 1000);
    
    // Simulate SOC declining during day, charging at night
    const hour = timestamp.getHours();
    if (hour >= 8 && hour <= 18) {
      // Daytime: SOC decreases
      baseSoc = Math.max(60, baseSoc - 0.3 - Math.random() * 0.2);
    } else if (hour >= 22 || hour <= 5) {
      // Nighttime: charging
      baseSoc = Math.min(98, baseSoc + 0.5 + Math.random() * 0.3);
    }
    
    const voltage1 = 12.0 + (baseSoc / 100) * 2.4 + (Math.random() - 0.5) * 0.2;
    const voltage2 = 12.0 + (baseSoc / 100) * 2.2 + (Math.random() - 0.5) * 0.15;
    const current = hour >= 8 && hour <= 18 ? 10 + Math.random() * 20 : 2 + Math.random() * 5;
    const power = voltage1 * current;
    const temperature = 20 + Math.random() * 20;
    
    measurements.push({
      deviceId,
      organizationId,
      voltage1: Math.round(voltage1 * 100) / 100,
      voltage2: Math.round(voltage2 * 100) / 100,
      current: Math.round(current * 100) / 100,
      power: Math.round(power * 100) / 100,
      temperature: Math.round(temperature * 10) / 10,
      soc: Math.round(baseSoc * 10) / 10,
      energy: Math.round(500 + i * 10),
      charge: Math.round((500 + i * 10) / voltage1 * 100) / 100,
      runtime: Math.round((baseSoc / 100) * 480),
      rssi: Math.round(-45 - Math.random() * 20),
      recordedAt: timestamp,
    });
  }
  
  return measurements;
}

async function seed() {
  console.log("🌱 Starting seed process...\n");

  // 1. Create demo organization
  console.log("📦 Creating organization...");
  const [org] = await db.insert(organizations).values({
    name: "Acme Transport",
    slug: "acme-transport",
    settings: JSON.stringify({ timezone: "America/Los_Angeles", units: "imperial", contactEmail: "fleet@acmetransport.com", contactPhone: "1-800-555-0123" }),
  } as InsertOrganization).returning();
  console.log(`   ✓ Created organization: ${org.name} (ID: ${org.id})`);

  // 2. Create admin user
  console.log("\n👤 Creating admin user...");
  const [adminUser] = await db.insert(users).values({
    organizationId: org.id,
    email: "admin@acmetransport.com",
    passwordHash: "demo-hash-not-for-production",
    firstName: "Admin",
    lastName: "User",
    role: "org_admin",
  } as InsertUser).returning();
  console.log(`   ✓ Created admin: ${adminUser.email}`);

  // 3. Create fleets
  console.log("\n🚛 Creating fleets...");
  const [flatbedFleet] = await db.insert(fleets).values({
    organizationId: org.id,
    name: "Flatbed Fleet",
    description: "Heavy haul flatbed trucks for construction and industrial transport",
  } as InsertFleet).returning();
  console.log(`   ✓ Created fleet: ${flatbedFleet.name} (ID: ${flatbedFleet.id})`);

  const [vanTrailerFleet] = await db.insert(fleets).values({
    organizationId: org.id,
    name: "Van-Trailer Fleet",
    description: "Enclosed van trailers for general freight and deliveries",
  } as InsertFleet).returning();
  console.log(`   ✓ Created fleet: ${vanTrailerFleet.name} (ID: ${vanTrailerFleet.id})`);

  // 4. Create trucks and devices
  console.log("\n🚚 Creating trucks and PowerMon devices...");
  const createdTrucks: { truck: typeof trucks.$inferSelect; device: typeof powerMonDevices.$inferSelect }[] = [];
  
  // Flatbed trucks
  for (let i = 0; i < FLATBED_TRUCKS.length; i++) {
    const truckData = FLATBED_TRUCKS[i];
    // Use NOT_IN_SERVICE for the truck that would be in maintenance
    const status = i === 2 ? TRUCK_STATUS.NOT_IN_SERVICE : TRUCK_STATUS.IN_SERVICE;
    
    const [truck] = await db.insert(trucks).values({
      organizationId: org.id,
      fleetId: flatbedFleet.id,
      truckNumber: truckData.number,
      driverName: truckData.driver,
      latitude: truckData.lat,
      longitude: truckData.lng,
      status,
    } as InsertTruck).returning();

    // Create PowerMon device
    const serialNumber = `PWM-${String(1000 + i).padStart(4, "0")}`;
    const [device] = await db.insert(powerMonDevices).values({
      organizationId: org.id,
      truckId: truck.id,
      serialNumber,
      firmwareVersion: "1.10.2",
      modelType: "PowerMon Pro",
      status: status === TRUCK_STATUS.NOT_IN_SERVICE ? DEVICE_STATUS.OFFLINE : DEVICE_STATUS.ONLINE,
      assignedAt: new Date(),
    } as InsertPowerMonDevice).returning();

    createdTrucks.push({ truck, device });
    console.log(`   ✓ ${truck.truckNumber} (${truckData.city}) → ${device.serialNumber}`);
  }

  // Van-Trailer trucks
  for (let i = 0; i < VAN_TRAILER_TRUCKS.length; i++) {
    const truckData = VAN_TRAILER_TRUCKS[i];
    const status = i === 4 ? TRUCK_STATUS.NOT_IN_SERVICE : TRUCK_STATUS.IN_SERVICE;
    
    const [truck] = await db.insert(trucks).values({
      organizationId: org.id,
      fleetId: vanTrailerFleet.id,
      truckNumber: truckData.number,
      driverName: truckData.driver,
      latitude: truckData.lat,
      longitude: truckData.lng,
      status,
    } as InsertTruck).returning();

    // Create PowerMon device
    const serialNumber = `PWM-${String(2000 + i).padStart(4, "0")}`;
    const [device] = await db.insert(powerMonDevices).values({
      organizationId: org.id,
      truckId: truck.id,
      serialNumber,
      firmwareVersion: "1.10.2",
      modelType: "PowerMon Pro",
      status: status === TRUCK_STATUS.NOT_IN_SERVICE ? DEVICE_STATUS.UNKNOWN : DEVICE_STATUS.ONLINE,
      assignedAt: new Date(),
    } as InsertPowerMonDevice).returning();

    createdTrucks.push({ truck, device });
    console.log(`   ✓ ${truck.truckNumber} (${truckData.city}) → ${device.serialNumber}`);
  }

  // 5. Create device snapshots
  console.log("\n📊 Creating device snapshots...");
  for (let i = 0; i < createdTrucks.length; i++) {
    const { device } = createdTrucks[i];
    const snapshot = generateSnapshot(device.id, org.id, i);
    await db.insert(deviceSnapshots).values(snapshot);
  }
  console.log(`   ✓ Created ${createdTrucks.length} device snapshots`);

  // 6. Create historical measurements (48 hours for first 5 trucks only to save time)
  console.log("\n📈 Creating historical measurements (this may take a moment)...");
  let totalMeasurements = 0;
  for (let i = 0; i < Math.min(5, createdTrucks.length); i++) {
    const { device, truck } = createdTrucks[i];
    const measurements = generateMeasurements(device.id, org.id, 48);
    
    // Insert in batches of 100
    for (let j = 0; j < measurements.length; j += 100) {
      const batch = measurements.slice(j, j + 100);
      await db.insert(deviceMeasurements).values(batch);
    }
    
    totalMeasurements += measurements.length;
    console.log(`   ✓ ${truck.truckNumber}: ${measurements.length} readings`);
  }
  console.log(`   Total: ${totalMeasurements} measurement records`);

  // 7. Create sample alerts
  console.log("\n🔔 Creating sample alerts...");
  
  // Active low voltage alert
  const lowVoltTruck = createdTrucks[4];
  await db.insert(alerts).values({
    organizationId: org.id,
    deviceId: lowVoltTruck.device.id,
    truckId: lowVoltTruck.truck.id,
    fleetId: flatbedFleet.id,
    alertType: ALERT_TYPES.LOW_VOLTAGE,
    severity: ALERT_SEVERITY.WARNING,
    title: "Low Voltage Warning",
    message: `Low voltage detected on ${lowVoltTruck.truck.truckNumber}: 11.8V`,
    threshold: 12.0,
    actualValue: 11.8,
    status: ALERT_STATUS.ACTIVE,
  } as InsertAlert);
  console.log(`   ✓ Active: Low voltage on ${lowVoltTruck.truck.truckNumber}`);

  // Active offline alert
  const offlineTruck = createdTrucks[2]; // Not in service truck
  await db.insert(alerts).values({
    organizationId: org.id,
    deviceId: offlineTruck.device.id,
    truckId: offlineTruck.truck.id,
    fleetId: flatbedFleet.id,
    alertType: ALERT_TYPES.DEVICE_OFFLINE,
    severity: ALERT_SEVERITY.CRITICAL,
    title: "Device Offline",
    message: `Device ${offlineTruck.device.serialNumber} has been offline for 2 hours`,
    status: ALERT_STATUS.ACTIVE,
  } as InsertAlert);
  console.log(`   ✓ Active: Device offline on ${offlineTruck.truck.truckNumber}`);

  // Resolved alert
  const resolvedTruck = createdTrucks[0];
  await db.insert(alerts).values({
    organizationId: org.id,
    deviceId: resolvedTruck.device.id,
    truckId: resolvedTruck.truck.id,
    fleetId: flatbedFleet.id,
    alertType: ALERT_TYPES.LOW_VOLTAGE,
    severity: ALERT_SEVERITY.WARNING,
    title: "Low Voltage Warning",
    message: `Low voltage detected on ${resolvedTruck.truck.truckNumber}: 11.5V`,
    threshold: 12.0,
    actualValue: 11.5,
    status: ALERT_STATUS.RESOLVED,
    acknowledgedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    acknowledgedBy: adminUser.id,
    resolvedAt: new Date(Date.now() - 23 * 60 * 60 * 1000),
  } as InsertAlert);
  console.log(`   ✓ Resolved: Previous low voltage on ${resolvedTruck.truck.truckNumber}`);

  // Acknowledged but not resolved
  const ackTruck = createdTrucks[7];
  await db.insert(alerts).values({
    organizationId: org.id,
    deviceId: ackTruck.device.id,
    truckId: ackTruck.truck.id,
    fleetId: flatbedFleet.id,
    alertType: ALERT_TYPES.LOW_VOLTAGE,
    severity: ALERT_SEVERITY.WARNING,
    title: "Low Voltage Warning",
    message: `Low voltage detected on ${ackTruck.truck.truckNumber}: 11.9V`,
    threshold: 12.0,
    actualValue: 11.9,
    status: ALERT_STATUS.ACKNOWLEDGED,
    acknowledgedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    acknowledgedBy: adminUser.id,
  } as InsertAlert);
  console.log(`   ✓ Acknowledged: Low voltage on ${ackTruck.truck.truckNumber}`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ Seed complete!");
  console.log("=".repeat(60));
  console.log(`
Summary:
  Organization: ${org.name} (ID: ${org.id})
  Fleets: 2 (Flatbed: ${flatbedFleet.id}, Van-Trailer: ${vanTrailerFleet.id})
  Trucks: ${createdTrucks.length}
  Devices: ${createdTrucks.length}
  Snapshots: ${createdTrucks.length}
  Measurements: ${totalMeasurements}
  Alerts: 4 (2 active, 1 acknowledged, 1 resolved)

Use organization ID ${org.id} in X-Organization-Id header for API calls.
  `);
}

// Run seed
seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  });
