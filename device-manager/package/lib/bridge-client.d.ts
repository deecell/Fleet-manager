import { EventEmitter } from 'events';

export interface BridgeResult<T = any> {
  type: 'result';
  id: string;
  success: boolean;
  code: number;
  data?: T;
}

export interface LibraryVersion {
  major: number;
  minor: number;
  string: string;
}

export interface ParsedURL {
  name: string;
  serial: string;
  hardwareRevision: number;
  hardwareString: string;
  channelId: string;
  encryptionKey: string;
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

export interface ConnectionStatus {
  connected: boolean;
  connecting: boolean;
}

export interface PowermonBridgeClientOptions {
  bridgePath?: string;
}

export declare class PowermonBridgeClient extends EventEmitter {
  constructor(options?: PowermonBridgeClientOptions);
  
  start(): Promise<void>;
  stop(): void;
  
  getVersion(): Promise<BridgeResult<LibraryVersion>>;
  parseURL(url: string): Promise<BridgeResult<ParsedURL>>;
  connect(url: string): Promise<BridgeResult>;
  disconnect(): Promise<BridgeResult>;
  getStatus(): Promise<BridgeResult<ConnectionStatus>>;
  getInfo(): Promise<BridgeResult<DeviceInfo>>;
  getMonitorData(): Promise<BridgeResult<MonitorData>>;
  getStatistics(): Promise<BridgeResult<MonitorStatistics>>;
  getFuelgaugeStatistics(): Promise<BridgeResult<FuelgaugeStatistics>>;
  getLogFiles(): Promise<BridgeResult<LogFileDescriptor[]>>;
  readLogFile(fileId: number, offset: number, size: number): Promise<BridgeResult<string>>;
  
  startStreaming(intervalMs?: number, count?: number): void;
  isConnected(): boolean;
  isRunning(): boolean;
  
  on(event: 'ready', listener: () => void): this;
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: (reason: number) => void): this;
  on(event: 'monitor', listener: (data: MonitorData) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'fatal', listener: (message: string) => void): this;
  on(event: 'close', listener: (code: number) => void): this;
  on(event: 'stderr', listener: (data: string) => void): this;
  on(event: 'event', listener: (event: string, msg: any) => void): this;
}

export function createBridgeClient(options?: PowermonBridgeClientOptions): Promise<PowermonBridgeClient>;
