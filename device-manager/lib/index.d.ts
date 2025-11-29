export interface LibraryVersion {
  major: number;
  minor: number;
  string: string;
}

export interface AccessKey {
  channelId: Uint8Array;
  encryptionKey: Uint8Array;
}

export interface DeviceIdentifier {
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

export interface LogReadResponse {
  success: boolean;
  code: number;
  data?: Uint8Array;
}

export interface DecodeLogResult {
  success: boolean;
  code: number;
  samples: LogSample[];
}

export interface ConnectOptions {
  url?: string;
  accessKey?: AccessKey;
  onConnect?: () => void;
  onDisconnect?: (reason: number) => void;
}

export enum DisconnectReason {
  CLOSED = 0,
  NO_ROUTE = 1,
  FAILED = 2,
  UNEXPECTED_ERROR = 3,
  UNEXPECTED_RESPONSE = 4,
  WRITE_ERROR = 5,
  READ_ERROR = 6,
}

export enum ResponseCode {
  RSP_SUCCESS = 0x0000,
  RSP_SUCCESS_MORE = 0x0100,
  RSP_INVALID_REQ = 0x0001,
  RSP_INVALID_PARAM = 0x0002,
  RSP_ERROR = 0x0003,
  RSP_LOCKED_USER = 0x0004,
  RSP_LOCKED_MASTER = 0x0005,
  RSP_CANNOT_UNLOCK = 0x0006,
  RSP_NOT_FOUND = 0x0007,
  RSP_TIMEOUT = 0x0008,
  RSP_INVALID = 0x0009,
  RSP_CANCELLED = 0x000A,
}

export enum PowerStatus {
  PS_OFF = 0,
  PS_ON = 1,
  PS_LVD = 2,
  PS_OCD = 3,
  PS_HVD = 4,
  PS_FGD = 5,
  PS_NCH = 6,
  PS_LTD = 7,
  PS_HTD = 8,
}

export declare class PowermonDevice {
  constructor();
  
  static getLibraryVersion(): LibraryVersion;
  static parseAccessURL(url: string): DeviceIdentifier | null;
  static decodeLogData(data: Uint8Array | ArrayBuffer): DecodeLogResult;
  static getHardwareString(hardwareRevision: number): string;
  static getPowerStatusString(powerStatus: number): string;
  
  connect(options: ConnectOptions): void;
  disconnect(): void;
  isConnected(): boolean;
  
  getInfo(callback: (result: Response<DeviceInfo>) => void): void;
  getMonitorData(callback: (result: Response<MonitorData>) => void): void;
  getStatistics(callback: (result: Response<MonitorStatistics>) => void): void;
  getFuelgaugeStatistics(callback: (result: Response<FuelgaugeStatistics>) => void): void;
  
  getLogFileList(callback: (result: Response<LogFileDescriptor[]>) => void): void;
  readLogFile(fileId: number, offset: number, size: number, callback: (result: LogReadResponse) => void): void;
}

export function createDevice(): PowermonDevice;
export function getLibraryVersion(): LibraryVersion;
export function parseAccessURL(url: string): DeviceIdentifier | null;
export function decodeLogData(data: Uint8Array | ArrayBuffer): DecodeLogResult;
