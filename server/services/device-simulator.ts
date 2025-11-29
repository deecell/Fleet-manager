import { storage } from "../storage";
import type { PowerMonDevice, InsertDeviceSnapshot, InsertDeviceMeasurement } from "@shared/schema";

const POLL_INTERVAL_MS = 30000;
const ORGANIZATION_ID = 6;
const MAX_CONCURRENT_POLLS = 5;
const BUCKET_COUNT = 6;

// Alert thresholds
const ALERT_THRESHOLDS = {
  LOW_VOLTAGE: 11.5,      // V - critical
  LOW_SOC: 20,            // % - warning
  HIGH_TEMP: 50,          // °C - warning
  LOW_TEMP: 5,            // °C - warning
  OFFLINE_CHANCE: 0.08,   // 8% chance per poll cycle to go offline (for demo visibility)
  RECOVERY_CHANCE: 0.4,   // 40% chance per poll cycle to come back online
};

interface DeviceState {
  deviceId: number;
  truckId: number | null;
  fleetId: number | null;
  voltage1: number;
  voltage2: number;
  current: number;
  soc: number;
  temperature: number;
  energy: number;
  charge: number;
  runtime: number;
  lastUpdate: Date;
  bucket: number;
  isOffline: boolean;
  offlineSince: Date | null;
}

interface SchedulerStats {
  totalPolls: number;
  bucketsProcessed: number;
  lastBucketTime: Date | null;
  averagePollDuration: number;
}

const deviceStates: Map<number, DeviceState> = new Map();
const schedulerStats: SchedulerStats = {
  totalPolls: 0,
  bucketsProcessed: 0,
  lastBucketTime: null,
  averagePollDuration: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomVariation(base: number, maxDelta: number): number {
  return base + (Math.random() - 0.5) * 2 * maxDelta;
}

function addJitter(baseMs: number, maxJitterMs: number): number {
  return baseMs + Math.floor(Math.random() * maxJitterMs);
}

function initializeDeviceState(device: PowerMonDevice, bucketIndex: number): DeviceState {
  const baseVoltage = 12.0 + Math.random() * 2;
  const baseSoc = 50 + Math.random() * 40;
  
  return {
    deviceId: device.id,
    truckId: device.truckId,
    fleetId: null,
    voltage1: baseVoltage,
    voltage2: baseVoltage * 0.98,
    current: -5 + Math.random() * 30,
    soc: baseSoc,
    temperature: 20 + Math.random() * 15,
    energy: 1000 + Math.random() * 5000,
    charge: 50 + Math.random() * 100,
    runtime: Math.floor(Math.random() * 86400),
    lastUpdate: new Date(),
    bucket: bucketIndex,
    isOffline: false,
    offlineSince: null,
  };
}

function simulateReading(state: DeviceState): DeviceState {
  // Simulate device going offline or coming back online
  let isOffline = state.isOffline;
  let offlineSince = state.offlineSince;
  
  if (isOffline) {
    // Device is currently offline - check if it recovers
    if (Math.random() < ALERT_THRESHOLDS.RECOVERY_CHANCE) {
      isOffline = false;
      offlineSince = null;
      console.log(`[Simulator] Device ${state.deviceId} came back ONLINE`);
    }
  } else {
    // Device is online - small chance it goes offline
    if (Math.random() < ALERT_THRESHOLDS.OFFLINE_CHANCE) {
      isOffline = true;
      offlineSince = new Date();
      console.log(`[Simulator] Device ${state.deviceId} went OFFLINE`);
    }
  }
  
  // If offline, don't update readings (they stay stale)
  if (isOffline) {
    return {
      ...state,
      isOffline,
      offlineSince,
    };
  }
  
  const isCharging = Math.random() > 0.3;
  const currentFlow = isCharging ? Math.abs(state.current) : -Math.abs(state.current) * 0.5;
  
  // Simulate more dramatic SoC changes to trigger alerts occasionally
  let socDelta = isCharging ? 0.1 + Math.random() * 0.3 : -(0.05 + Math.random() * 0.2);
  
  // Occasionally simulate a rapid discharge scenario (10% chance for demo visibility)
  if (!isCharging && Math.random() < 0.10) {
    socDelta = -(3 + Math.random() * 7); // Rapid 3-10% drop
  }
  
  const newSoc = clamp(state.soc + socDelta, 5, 100);
  
  const voltageBase = 11.5 + (newSoc / 100) * 2.5;
  const chargeAdjustment = isCharging ? 0.3 : -0.1;
  
  // Simulate temperature with occasional extremes
  let tempDelta = (Math.random() - 0.5) * 2; // Normal ±1°C variation
  
  // Occasionally simulate temperature spikes (8% chance for demo visibility)
  if (Math.random() < 0.08) {
    tempDelta = (Math.random() > 0.5 ? 1 : -1) * (8 + Math.random() * 15); // ±8-23°C spike
  }
  
  const newTemp = clamp(state.temperature + tempDelta, -10, 65);
  
  return {
    ...state,
    voltage1: clamp(randomVariation(voltageBase + chargeAdjustment, 0.1), 10.5, 14.8),
    voltage2: clamp(randomVariation(voltageBase + chargeAdjustment - 0.1, 0.1), 10.4, 14.7),
    current: clamp(randomVariation(currentFlow, 2), -50, 100),
    soc: newSoc,
    temperature: newTemp,
    energy: state.energy + (isCharging ? Math.random() * 10 : 0),
    charge: state.charge + (isCharging ? Math.random() * 0.5 : -Math.random() * 0.1),
    runtime: state.runtime + 30,
    lastUpdate: new Date(),
    isOffline,
    offlineSince,
  };
}

async function pollSingleDevice(device: PowerMonDevice): Promise<void> {
  const startTime = Date.now();
  
  let state = deviceStates.get(device.id);
  const bucketIndex = state?.bucket ?? (device.id % BUCKET_COUNT);
  
  if (!state) {
    state = initializeDeviceState(device, bucketIndex);
    deviceStates.set(device.id, state);
  } else {
    state = simulateReading(state);
    deviceStates.set(device.id, state);
  }

  const truck = device.truckId ? await storage.getTruck(ORGANIZATION_ID, device.truckId) : null;
  const fleetId = truck?.fleetId ?? null;
  const truckNumber = truck?.truckNumber ?? device.serialNumber;

  // Handle device offline status
  if (state.isOffline) {
    // Update device status to offline
    await storage.updateDeviceStatus(ORGANIZATION_ID, device.id, "offline");
    
    // Create offline alert if not already exists
    const hasOfflineAlert = await storage.hasActiveAlertForDevice(ORGANIZATION_ID, device.id, "offline");
    if (!hasOfflineAlert) {
      await storage.createAlert({
        organizationId: ORGANIZATION_ID,
        deviceId: device.id,
        truckId: device.truckId,
        fleetId: fleetId,
        alertType: "offline",
        severity: "critical",
        title: "Device Offline",
        message: `Device ${device.serialNumber} on ${truckNumber} is offline`,
        threshold: null,
        actualValue: null,
        status: "active",
      });
      console.log(`[Simulator] Alert: Device ${device.serialNumber} went OFFLINE`);
    }
    
    // Don't update readings when offline - skip to stats
    const duration = Date.now() - startTime;
    schedulerStats.totalPolls++;
    schedulerStats.averagePollDuration = 
      (schedulerStats.averagePollDuration * (schedulerStats.totalPolls - 1) + duration) / schedulerStats.totalPolls;
    return;
  }
  
  // Device is online - update status and resolve offline alerts
  await storage.updateDeviceStatus(ORGANIZATION_ID, device.id, "online");
  await storage.resolveAlertsByDevice(ORGANIZATION_ID, device.id, "offline");

  const snapshotData: InsertDeviceSnapshot = {
    organizationId: ORGANIZATION_ID,
    deviceId: device.id,
    truckId: device.truckId,
    fleetId: fleetId,
    voltage1: state.voltage1,
    voltage2: state.voltage2,
    current: state.current,
    power: state.voltage1 * state.current,
    temperature: state.temperature,
    soc: state.soc,
    energy: state.energy,
    charge: state.charge,
    runtime: state.runtime,
    rssi: -40 - Math.floor(Math.random() * 30),
    recordedAt: new Date(),
  };

  await storage.upsertSnapshot(snapshotData);

  const measurementData: InsertDeviceMeasurement = {
    organizationId: ORGANIZATION_ID,
    deviceId: device.id,
    truckId: device.truckId,
    recordedAt: new Date(),
    voltage1: state.voltage1,
    voltage2: state.voltage2,
    current: state.current,
    power: state.voltage1 * state.current,
    temperature: state.temperature,
    soc: state.soc,
    energy: state.energy,
    charge: state.charge,
    runtime: state.runtime,
  };

  await storage.insertMeasurement(measurementData);

  // Check for LOW VOLTAGE alert
  if (state.voltage1 < ALERT_THRESHOLDS.LOW_VOLTAGE) {
    const hasLowVoltageAlert = await storage.hasActiveAlertForDevice(ORGANIZATION_ID, device.id, "low_voltage");
    
    if (!hasLowVoltageAlert) {
      await storage.createAlert({
        organizationId: ORGANIZATION_ID,
        deviceId: device.id,
        truckId: device.truckId,
        fleetId: fleetId,
        alertType: "low_voltage",
        severity: "critical",
        title: "Critical: Low Voltage",
        message: `Voltage dropped to ${state.voltage1.toFixed(2)}V on ${truckNumber}`,
        threshold: ALERT_THRESHOLDS.LOW_VOLTAGE,
        actualValue: state.voltage1,
        status: "active",
      });
      console.log(`[Simulator] Alert: Low voltage (${state.voltage1.toFixed(2)}V) on ${device.serialNumber}`);
    }
  } else {
    await storage.resolveAlertsByDevice(ORGANIZATION_ID, device.id, "low_voltage");
  }

  // Check for LOW SOC alert
  if (state.soc < ALERT_THRESHOLDS.LOW_SOC) {
    const hasLowSocAlert = await storage.hasActiveAlertForDevice(ORGANIZATION_ID, device.id, "low_soc");
    
    if (!hasLowSocAlert) {
      await storage.createAlert({
        organizationId: ORGANIZATION_ID,
        deviceId: device.id,
        truckId: device.truckId,
        fleetId: fleetId,
        alertType: "low_soc",
        severity: "warning",
        title: "Low Battery",
        message: `Battery at ${state.soc.toFixed(0)}% on ${truckNumber}`,
        threshold: ALERT_THRESHOLDS.LOW_SOC,
        actualValue: state.soc,
        status: "active",
      });
      console.log(`[Simulator] Alert: Low SoC (${state.soc.toFixed(0)}%) on ${device.serialNumber}`);
    }
  } else {
    await storage.resolveAlertsByDevice(ORGANIZATION_ID, device.id, "low_soc");
  }

  // Check for HIGH TEMPERATURE alert
  if (state.temperature > ALERT_THRESHOLDS.HIGH_TEMP) {
    const hasHighTempAlert = await storage.hasActiveAlertForDevice(ORGANIZATION_ID, device.id, "high_temp");
    
    if (!hasHighTempAlert) {
      await storage.createAlert({
        organizationId: ORGANIZATION_ID,
        deviceId: device.id,
        truckId: device.truckId,
        fleetId: fleetId,
        alertType: "high_temp",
        severity: "warning",
        title: "High Temperature",
        message: `Temperature at ${state.temperature.toFixed(1)}°C on ${truckNumber}`,
        threshold: ALERT_THRESHOLDS.HIGH_TEMP,
        actualValue: state.temperature,
        status: "active",
      });
      console.log(`[Simulator] Alert: High temp (${state.temperature.toFixed(1)}°C) on ${device.serialNumber}`);
    }
  } else {
    await storage.resolveAlertsByDevice(ORGANIZATION_ID, device.id, "high_temp");
  }

  // Check for LOW TEMPERATURE alert
  if (state.temperature < ALERT_THRESHOLDS.LOW_TEMP) {
    const hasLowTempAlert = await storage.hasActiveAlertForDevice(ORGANIZATION_ID, device.id, "low_temp");
    
    if (!hasLowTempAlert) {
      await storage.createAlert({
        organizationId: ORGANIZATION_ID,
        deviceId: device.id,
        truckId: device.truckId,
        fleetId: fleetId,
        alertType: "low_temp",
        severity: "warning",
        title: "Low Temperature",
        message: `Temperature at ${state.temperature.toFixed(1)}°C on ${truckNumber}`,
        threshold: ALERT_THRESHOLDS.LOW_TEMP,
        actualValue: state.temperature,
        status: "active",
      });
      console.log(`[Simulator] Alert: Low temp (${state.temperature.toFixed(1)}°C) on ${device.serialNumber}`);
    }
  } else {
    await storage.resolveAlertsByDevice(ORGANIZATION_ID, device.id, "low_temp");
  }

  const duration = Date.now() - startTime;
  schedulerStats.totalPolls++;
  schedulerStats.averagePollDuration = 
    (schedulerStats.averagePollDuration * (schedulerStats.totalPolls - 1) + duration) / schedulerStats.totalPolls;
}

async function processBatch(devices: PowerMonDevice[]): Promise<void> {
  const results: Promise<void>[] = [];
  
  for (let i = 0; i < devices.length; i += MAX_CONCURRENT_POLLS) {
    const batch = devices.slice(i, i + MAX_CONCURRENT_POLLS);
    await Promise.all(batch.map(device => pollSingleDevice(device)));
  }
}

async function pollBucket(bucketIndex: number, allDevices: PowerMonDevice[]): Promise<void> {
  const bucketDevices = allDevices.filter(d => {
    const state = deviceStates.get(d.id);
    const assignedBucket = state?.bucket ?? (d.id % BUCKET_COUNT);
    return assignedBucket === bucketIndex;
  });

  if (bucketDevices.length === 0) return;

  console.log(`[Simulator] Bucket ${bucketIndex + 1}/${BUCKET_COUNT}: ${bucketDevices.length} devices`);
  
  await processBatch(bucketDevices);
  
  schedulerStats.bucketsProcessed++;
  schedulerStats.lastBucketTime = new Date();
}

async function runStaggeredPolling(): Promise<void> {
  try {
    const devices = await storage.listDevices(ORGANIZATION_ID, "online");
    
    if (devices.length === 0) {
      console.log("[Simulator] No online devices");
      return;
    }

    const bucketInterval = Math.floor(POLL_INTERVAL_MS / BUCKET_COUNT);
    
    console.log(`[Simulator] Starting cycle: ${devices.length} devices in ${BUCKET_COUNT} buckets (${bucketInterval}ms apart)`);

    for (let bucket = 0; bucket < BUCKET_COUNT; bucket++) {
      const jitteredDelay = bucket === 0 ? 0 : addJitter(bucketInterval, 500);
      
      if (bucket > 0) {
        await new Promise(resolve => setTimeout(resolve, jitteredDelay));
      }
      
      await pollBucket(bucket, devices);
    }

    console.log(`[Simulator] Cycle complete: ${devices.length} devices, avg ${schedulerStats.averagePollDuration.toFixed(0)}ms/device`);
  } catch (error) {
    console.error("[Simulator] Error in polling cycle:", error);
  }
}

let pollTimeout: NodeJS.Timeout | null = null;
let isRunning = false;

async function schedulerLoop(): Promise<void> {
  if (!isRunning) return;
  
  await runStaggeredPolling();
  
  if (isRunning) {
    const nextRunDelay = addJitter(POLL_INTERVAL_MS, 1000);
    pollTimeout = setTimeout(schedulerLoop, nextRunDelay);
  }
}

export function startDeviceSimulator(): void {
  if (isRunning) {
    console.log("[Simulator] Already running");
    return;
  }
  
  isRunning = true;
  console.log(`[Simulator] Starting staggered polling: ${POLL_INTERVAL_MS / 1000}s interval, ${BUCKET_COUNT} buckets, max ${MAX_CONCURRENT_POLLS} concurrent`);
  
  schedulerLoop();
}

export function stopDeviceSimulator(): void {
  isRunning = false;
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
  console.log("[Simulator] Stopped");
}

export function getSimulatorStatus(): { 
  running: boolean; 
  deviceCount: number; 
  lastPoll: Date | null;
  stats: SchedulerStats;
} {
  return {
    running: isRunning,
    deviceCount: deviceStates.size,
    lastPoll: deviceStates.size > 0 ? Array.from(deviceStates.values())[0].lastUpdate : null,
    stats: { ...schedulerStats },
  };
}
