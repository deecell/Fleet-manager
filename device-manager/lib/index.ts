/**
 * PowerMon Native Addon - TypeScript Wrapper
 * 
 * This module provides a TypeScript interface to the libpowermon C++ library
 * for communicating with Thornwave PowerMon battery monitoring devices.
 */

// Import the native addon
const addon = require('../build/Release/powermon_addon.node');

// Types
export interface LibraryVersion {
  major: number;
  minor: number;
  string: string;
}

export interface AccessKey {
  channelId: Uint8Array;
  encryptionKey: Uint8Array;
}

export interface ParsedAccessURL {
  name: string;
  serial: string;
  hardwareRevision: number;
  hardwareString: string;
  channelId: string;
  encryptionKey: string;
  accessKey: AccessKey;
}

export interface DeviceInfo {
  name: string;
  firmwareVersion: string;
  firmwareVersionBcd: number;
  hardwareRevision: number;
  hardwareString: string;
  serial: string;
  timezone: number;
  isUserLocked: boolean;
  isMasterLocked: boolean;
  isWifiConnected: boolean;
}

export interface MonitorData {
  time: number;
  voltage1: number;
  voltage2: number;
  current: number;
  power: number;
  temperature: number;
  coulombMeter: number;
  energyMeter: number;
  powerStatus: number;
  powerStatusString: string;
  soc: number;
  runtime: number;
  rssi: number;
  isTemperatureExternal: boolean;
}

export interface MonitorStatistics {
  secondsSinceOn: number;
  voltage1Min: number;
  voltage1Max: number;
  voltage2Min: number;
  voltage2Max: number;
  peakChargeCurrent: number;
  peakDischargeCurrent: number;
  temperatureMin: number;
  temperatureMax: number;
}

export interface FuelgaugeStatistics {
  timeSinceLastFullCharge: number;
  fullChargeCapacity: number;
  totalDischarge: number;
  totalDischargeEnergy: number;
  totalCharge: number;
  totalChargeEnergy: number;
  minVoltage: number;
  maxVoltage: number;
  maxDischargeCurrent: number;
  maxChargeCurrent: number;
  deepestDischarge: number;
  lastDischarge: number;
  soc: number;
}

export interface LogFileDescriptor {
  id: number;
  size: number;
}

export interface LogSample {
  time: number;
  voltage1: number;
  voltage2: number;
  current: number;
  power: number;
  temperature: number;
  soc: number;
  powerStatus: number;
}

export interface Response<T> {
  success: boolean;
  code: number;
  data?: T;
}

export interface ConnectOptions {
  url?: string;
  accessKey?: AccessKey;
  onConnect?: () => void;
  onDisconnect?: (reason: number) => void;
}

/**
 * PowerMon Device class for communicating with PowerMon battery monitors
 */
export class PowermonDevice {
  private device: any;
  private initialized: boolean = false;

  constructor() {
    this.device = new addon.PowermonDevice();
    this.initialized = true;
    // Note: BLE may not be available, check with isBleAvailable()
    // Static methods always work regardless of BLE status
  }

  /**
   * Check if the device instance was successfully initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if Bluetooth is available for device connections
   */
  isBleAvailable(): boolean {
    if (!this.initialized) return false;
    return this.device.isBleAvailable();
  }

  /**
   * Get the library version
   */
  static getLibraryVersion(): LibraryVersion {
    return addon.PowermonDevice.getLibraryVersion();
  }

  /**
   * Parse a PowerMon access URL
   */
  static parseAccessURL(url: string): ParsedAccessURL | null {
    return addon.PowermonDevice.parseAccessURL(url);
  }

  /**
   * Get hardware revision string
   */
  static getHardwareString(revision: number): string {
    return addon.PowermonDevice.getHardwareString(revision);
  }

  /**
   * Get power status string
   */
  static getPowerStatusString(status: number): string {
    return addon.PowermonDevice.getPowerStatusString(status);
  }

  /**
   * Decode log file data
   */
  static decodeLogData(data: Uint8Array): LogSample[] {
    return addon.PowermonDevice.decodeLogData(data);
  }

  /**
   * Connect to a PowerMon device via WiFi
   */
  connect(options: ConnectOptions): void {
    if (!this.initialized) {
      throw new Error('PowermonDevice not initialized (Bluetooth not available)');
    }
    this.device.connect(options);
  }

  /**
   * Disconnect from the device
   */
  disconnect(): void {
    if (this.initialized) {
      this.device.disconnect();
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.initialized && this.device.isConnected();
  }

  /**
   * Get device info
   */
  getInfo(callback: (response: Response<DeviceInfo>) => void): void {
    if (!this.initialized) {
      callback({ success: false, code: -1 });
      return;
    }
    this.device.getInfo(callback);
  }

  /**
   * Get current monitor data
   */
  getMonitorData(callback: (response: Response<MonitorData>) => void): void {
    if (!this.initialized) {
      callback({ success: false, code: -1 });
      return;
    }
    this.device.getMonitorData(callback);
  }

  /**
   * Get monitor statistics
   */
  getStatistics(callback: (response: Response<MonitorStatistics>) => void): void {
    if (!this.initialized) {
      callback({ success: false, code: -1 });
      return;
    }
    this.device.getStatistics(callback);
  }

  /**
   * Get fuelgauge statistics
   */
  getFuelgaugeStatistics(callback: (response: Response<FuelgaugeStatistics>) => void): void {
    if (!this.initialized) {
      callback({ success: false, code: -1 });
      return;
    }
    this.device.getFuelgaugeStatistics(callback);
  }

  /**
   * Get list of log files
   */
  getLogFileList(callback: (response: Response<LogFileDescriptor[]>) => void): void {
    if (!this.initialized) {
      callback({ success: false, code: -1 });
      return;
    }
    this.device.getLogFileList(callback);
  }

  /**
   * Read log file data
   */
  readLogFile(
    fileId: number,
    offset: number,
    size: number,
    callback: (response: Response<Uint8Array>) => void
  ): void {
    if (!this.initialized) {
      callback({ success: false, code: -1 });
      return;
    }
    this.device.readLogFile(fileId, offset, size, callback);
  }
}

// Export convenience functions
export const getLibraryVersion = PowermonDevice.getLibraryVersion;
export const parseAccessURL = PowermonDevice.parseAccessURL;
export const getHardwareString = PowermonDevice.getHardwareString;
export const getPowerStatusString = PowermonDevice.getPowerStatusString;
export const decodeLogData = PowermonDevice.decodeLogData;

export default PowermonDevice;
