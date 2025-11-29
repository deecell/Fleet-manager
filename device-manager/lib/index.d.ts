/**
 * PowerMon Native Addon - TypeScript Wrapper
 *
 * This module provides a TypeScript interface to the libpowermon C++ library
 * for communicating with Thornwave PowerMon battery monitoring devices.
 */
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
export declare class PowermonDevice {
    private device;
    private initialized;
    constructor();
    /**
     * Check if the device instance was successfully initialized
     */
    isInitialized(): boolean;
    /**
     * Get the library version
     */
    static getLibraryVersion(): LibraryVersion;
    /**
     * Parse a PowerMon access URL
     */
    static parseAccessURL(url: string): ParsedAccessURL | null;
    /**
     * Get hardware revision string
     */
    static getHardwareString(revision: number): string;
    /**
     * Get power status string
     */
    static getPowerStatusString(status: number): string;
    /**
     * Decode log file data
     */
    static decodeLogData(data: Uint8Array): LogSample[];
    /**
     * Connect to a PowerMon device via WiFi
     */
    connect(options: ConnectOptions): void;
    /**
     * Disconnect from the device
     */
    disconnect(): void;
    /**
     * Check if connected
     */
    isConnected(): boolean;
    /**
     * Get device info
     */
    getInfo(callback: (response: Response<DeviceInfo>) => void): void;
    /**
     * Get current monitor data
     */
    getMonitorData(callback: (response: Response<MonitorData>) => void): void;
    /**
     * Get monitor statistics
     */
    getStatistics(callback: (response: Response<MonitorStatistics>) => void): void;
    /**
     * Get fuelgauge statistics
     */
    getFuelgaugeStatistics(callback: (response: Response<FuelgaugeStatistics>) => void): void;
    /**
     * Get list of log files
     */
    getLogFileList(callback: (response: Response<LogFileDescriptor[]>) => void): void;
    /**
     * Read log file data
     */
    readLogFile(fileId: number, offset: number, size: number, callback: (response: Response<Uint8Array>) => void): void;
}
export declare const getLibraryVersion: typeof PowermonDevice.getLibraryVersion;
export declare const parseAccessURL: typeof PowermonDevice.parseAccessURL;
export declare const getHardwareString: typeof PowermonDevice.getHardwareString;
export declare const getPowerStatusString: typeof PowermonDevice.getPowerStatusString;
export declare const decodeLogData: typeof PowermonDevice.decodeLogData;
export default PowermonDevice;
