"use strict";
/**
 * PowerMon Native Addon - TypeScript Wrapper
 *
 * This module provides a TypeScript interface to the libpowermon C++ library
 * for communicating with Thornwave PowerMon battery monitoring devices.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeLogData = exports.getPowerStatusString = exports.getHardwareString = exports.parseAccessURL = exports.getLibraryVersion = exports.PowermonDevice = void 0;
// Import the native addon
const addon = require('../build/Release/powermon_addon.node');
/**
 * PowerMon Device class for communicating with PowerMon battery monitors
 */
class PowermonDevice {
    constructor() {
        this.initialized = false;
        try {
            this.device = new addon.PowermonDevice();
            this.initialized = true;
        }
        catch (error) {
            // BLE initialization may fail on servers without Bluetooth hardware
            // Static methods will still work
            console.warn('PowermonDevice instance creation failed (expected on servers):', error.message);
            this.initialized = false;
        }
    }
    /**
     * Check if the device instance was successfully initialized
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Get the library version
     */
    static getLibraryVersion() {
        return addon.PowermonDevice.getLibraryVersion();
    }
    /**
     * Parse a PowerMon access URL
     */
    static parseAccessURL(url) {
        return addon.PowermonDevice.parseAccessURL(url);
    }
    /**
     * Get hardware revision string
     */
    static getHardwareString(revision) {
        return addon.PowermonDevice.getHardwareString(revision);
    }
    /**
     * Get power status string
     */
    static getPowerStatusString(status) {
        return addon.PowermonDevice.getPowerStatusString(status);
    }
    /**
     * Decode log file data
     */
    static decodeLogData(data) {
        return addon.PowermonDevice.decodeLogData(data);
    }
    /**
     * Connect to a PowerMon device via WiFi
     */
    connect(options) {
        if (!this.initialized) {
            throw new Error('PowermonDevice not initialized (Bluetooth not available)');
        }
        this.device.connect(options);
    }
    /**
     * Disconnect from the device
     */
    disconnect() {
        if (this.initialized) {
            this.device.disconnect();
        }
    }
    /**
     * Check if connected
     */
    isConnected() {
        return this.initialized && this.device.isConnected();
    }
    /**
     * Get device info
     */
    getInfo(callback) {
        if (!this.initialized) {
            callback({ success: false, code: -1 });
            return;
        }
        this.device.getInfo(callback);
    }
    /**
     * Get current monitor data
     */
    getMonitorData(callback) {
        if (!this.initialized) {
            callback({ success: false, code: -1 });
            return;
        }
        this.device.getMonitorData(callback);
    }
    /**
     * Get monitor statistics
     */
    getStatistics(callback) {
        if (!this.initialized) {
            callback({ success: false, code: -1 });
            return;
        }
        this.device.getStatistics(callback);
    }
    /**
     * Get fuelgauge statistics
     */
    getFuelgaugeStatistics(callback) {
        if (!this.initialized) {
            callback({ success: false, code: -1 });
            return;
        }
        this.device.getFuelgaugeStatistics(callback);
    }
    /**
     * Get list of log files
     */
    getLogFileList(callback) {
        if (!this.initialized) {
            callback({ success: false, code: -1 });
            return;
        }
        this.device.getLogFileList(callback);
    }
    /**
     * Read log file data
     */
    readLogFile(fileId, offset, size, callback) {
        if (!this.initialized) {
            callback({ success: false, code: -1 });
            return;
        }
        this.device.readLogFile(fileId, offset, size, callback);
    }
}
exports.PowermonDevice = PowermonDevice;
// Export convenience functions
exports.getLibraryVersion = PowermonDevice.getLibraryVersion;
exports.parseAccessURL = PowermonDevice.parseAccessURL;
exports.getHardwareString = PowermonDevice.getHardwareString;
exports.getPowerStatusString = PowermonDevice.getPowerStatusString;
exports.decodeLogData = PowermonDevice.decodeLogData;
exports.default = PowermonDevice;
