import { storage } from "../storage";
import type { PowerMonDevice, InsertDeviceSnapshot, InsertDeviceMeasurement } from "@shared/schema";

const POLL_INTERVAL_MS = 30000;
const ORGANIZATION_ID = 6;

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
}

const deviceStates: Map<number, DeviceState> = new Map();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomVariation(base: number, maxDelta: number): number {
  return base + (Math.random() - 0.5) * 2 * maxDelta;
}

function initializeDeviceState(device: PowerMonDevice): DeviceState {
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
  };
}

function simulateReading(state: DeviceState): DeviceState {
  const isCharging = Math.random() > 0.3;
  const currentFlow = isCharging ? Math.abs(state.current) : -Math.abs(state.current) * 0.5;
  
  const socDelta = isCharging ? 0.1 + Math.random() * 0.3 : -(0.05 + Math.random() * 0.2);
  const newSoc = clamp(state.soc + socDelta, 5, 100);
  
  const voltageBase = 11.5 + (newSoc / 100) * 2.5;
  const chargeAdjustment = isCharging ? 0.3 : -0.1;
  
  return {
    ...state,
    voltage1: clamp(randomVariation(voltageBase + chargeAdjustment, 0.1), 10.5, 14.8),
    voltage2: clamp(randomVariation(voltageBase + chargeAdjustment - 0.1, 0.1), 10.4, 14.7),
    current: clamp(randomVariation(currentFlow, 2), -50, 100),
    soc: newSoc,
    temperature: clamp(randomVariation(state.temperature, 1), 15, 55),
    energy: state.energy + (isCharging ? Math.random() * 10 : 0),
    charge: state.charge + (isCharging ? Math.random() * 0.5 : -Math.random() * 0.1),
    runtime: state.runtime + 30,
    lastUpdate: new Date(),
  };
}

async function pollDevices(): Promise<void> {
  try {
    const devices = await storage.listDevices(ORGANIZATION_ID, "online");
    
    if (devices.length === 0) {
      console.log("[Device Simulator] No online devices found");
      return;
    }

    console.log(`[Device Simulator] Polling ${devices.length} devices...`);

    for (const device of devices) {
      let state = deviceStates.get(device.id);
      
      if (!state) {
        state = initializeDeviceState(device);
        deviceStates.set(device.id, state);
      } else {
        state = simulateReading(state);
        deviceStates.set(device.id, state);
      }

      const truck = device.truckId ? await storage.getTruck(ORGANIZATION_ID, device.truckId) : null;
      const fleetId = truck?.fleetId ?? null;

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

      if (state.voltage1 < 11.5) {
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
            message: `Voltage dropped to ${state.voltage1.toFixed(2)}V on device ${device.serialNumber}`,
            threshold: 11.5,
            actualValue: state.voltage1,
            status: "active",
          });
          console.log(`[Device Simulator] Created low voltage alert for device ${device.serialNumber}`);
        }
      } else {
        await storage.resolveAlertsByDevice(ORGANIZATION_ID, device.id, "low_voltage");
      }
    }

    console.log(`[Device Simulator] Updated ${devices.length} devices at ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error("[Device Simulator] Error polling devices:", error);
  }
}

let pollInterval: NodeJS.Timeout | null = null;

export function startDeviceSimulator(): void {
  console.log(`[Device Simulator] Starting with ${POLL_INTERVAL_MS / 1000}s polling interval...`);
  
  pollDevices();
  
  pollInterval = setInterval(pollDevices, POLL_INTERVAL_MS);
}

export function stopDeviceSimulator(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log("[Device Simulator] Stopped");
  }
}

export function getSimulatorStatus(): { running: boolean; deviceCount: number; lastPoll: Date | null } {
  return {
    running: pollInterval !== null,
    deviceCount: deviceStates.size,
    lastPoll: deviceStates.size > 0 ? Array.from(deviceStates.values())[0].lastUpdate : null,
  };
}
