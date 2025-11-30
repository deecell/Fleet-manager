# Deecell Device Manager

Node.js native addon for communicating with Thornwave PowerMon battery monitoring devices via WiFi.

## Overview

The Device Manager provides a JavaScript interface to Thornwave's `libpowermon` C++ library, enabling:

- WiFi connections to PowerMon-W devices via Thornwave's relay service
- Real-time voltage, current, power, temperature, and SOC readings
- Lifetime statistics (total charge/discharge, voltage ranges, current peaks)
- Log file access for historical data backfill

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Node.js Application                       │
├─────────────────────────────────────────────────────────────┤
│              powermon_addon.node (Native Addon)              │
│                    ↓ N-API bindings ↓                        │
├─────────────────────────────────────────────────────────────┤
│           powermon_wrapper.cpp (C++ Wrapper)                 │
│                    ↓ C++ calls ↓                             │
├─────────────────────────────────────────────────────────────┤
│              libpowermon v1.17 (Thornwave)                   │
│                    ↓ WebSocket ↓                             │
├─────────────────────────────────────────────────────────────┤
│              Thornwave Relay Service                         │
│                    ↓ WiFi ↓                                  │
├─────────────────────────────────────────────────────────────┤
│                 PowerMon-W Device                            │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18+ with node-gyp
- Python 3.x (for node-gyp)
- C++ compiler (g++ on Linux)

## Building

```bash
cd device-manager
npx node-gyp rebuild
```

The compiled addon will be at `build/Release/powermon_addon.node`.

## Quick Start

```javascript
const addon = require('./device-manager/build/Release/powermon_addon.node');

// Parse an applink URL
const url = 'https://applinks.thornwave.com/?n=DCL-Moeck&s=a3a5b30ea9b3ff98&h=41&c=...&k=...';
const parsed = addon.PowermonDevice.parseAccessURL(url);

console.log('Device:', parsed.name);           // "DCL-Moeck"
console.log('Hardware:', parsed.hardwareString); // "PowerMon-W"
console.log('Serial:', parsed.serial);          // "A3A5B30EA9B3FF98"

// Create device instance and connect
const device = new addon.PowermonDevice();

device.connect({
    accessKey: parsed.accessKey,
    onConnect: () => {
        console.log('Connected!');
        
        // Read live data
        device.getMonitorData((result) => {
            if (result.success) {
                console.log('Voltage:', result.data.voltage1, 'V');
                console.log('Current:', result.data.current, 'A');
                console.log('SOC:', result.data.soc, '%');
            }
            device.disconnect();
        });
    },
    onDisconnect: (reason) => {
        console.log('Disconnected:', reason);
    }
});
```

## API Reference

### Static Methods

#### `PowermonDevice.getLibraryVersion()`
Returns the libpowermon library version.

```javascript
const version = addon.PowermonDevice.getLibraryVersion();
// { major: 1, minor: 17, string: "1.17" }
```

#### `PowermonDevice.parseAccessURL(url)`
Parses a Thornwave applink URL into connection parameters.

```javascript
const parsed = addon.PowermonDevice.parseAccessURL(url);
// {
//   name: "DCL-Moeck",
//   serial: "A3A5B30EA9B3FF98",
//   hardwareRevision: 65,
//   hardwareString: "PowerMon-W",
//   channelId: "7351CEBEF19361EE...",
//   encryptionKey: "A8DD7D829D4DC932...",
//   accessKey: { channelId: Uint8Array, encryptionKey: Uint8Array }
// }
```

### Instance Methods

#### `new PowermonDevice()`
Creates a new PowerMon device instance.

```javascript
const device = new addon.PowermonDevice();
console.log('BLE available:', device.isBleAvailable()); // false on servers
```

#### `device.connect(options)`
Connects to a PowerMon device via WiFi.

```javascript
device.connect({
    accessKey: parsed.accessKey,  // From parseAccessURL()
    onConnect: () => { },         // Called when connected
    onDisconnect: (reason) => { } // Called when disconnected
});
```

#### `device.disconnect()`
Disconnects from the current device.

#### `device.isConnected()`
Returns `true` if currently connected.

#### `device.isBleAvailable()`
Returns `true` if Bluetooth is available (always `false` on servers).

#### `device.getInfo(callback)`
Retrieves device information.

```javascript
device.getInfo((result) => {
    if (result.success) {
        console.log(result.data);
        // {
        //   name: "DCL-Moeck",
        //   firmwareVersion: "1.32",
        //   hardwareRevision: 65,
        //   hardwareString: "PowerMon-W",
        //   serial: "A3A5B30EA9B3FF98",
        //   timezone: 0,
        //   isUserLocked: false,
        //   isMasterLocked: false,
        //   isWifiConnected: true
        // }
    }
});
```

#### `device.getMonitorData(callback)`
Retrieves current readings from the device.

```javascript
device.getMonitorData((result) => {
    if (result.success) {
        const d = result.data;
        console.log('Voltage:', d.voltage1, 'V');
        console.log('Current:', d.current, 'A');
        console.log('Power:', d.power, 'W');
        console.log('Temperature:', d.temperature, '°C');
        console.log('SOC:', d.soc, '%');
        console.log('Runtime:', d.runtime, 'minutes');
        console.log('Power Status:', d.powerStatusString);
        console.log('Coulomb Meter:', d.coulombMeter, 'Ah');
        console.log('Energy Meter:', d.energyMeter, 'Wh');
        console.log('RSSI:', d.rssi);
    }
});
```

#### `device.getStatistics(callback)`
Retrieves session statistics (since device power-on).

```javascript
device.getStatistics((result) => {
    if (result.success) {
        const s = result.data;
        console.log('Seconds Since On:', s.secondsSinceOn);
        console.log('Voltage1 Min/Max:', s.voltage1Min, '/', s.voltage1Max);
        console.log('Peak Charge Current:', s.peakChargeCurrent);
        console.log('Peak Discharge Current:', s.peakDischargeCurrent);
        console.log('Temperature Min/Max:', s.temperatureMin, '/', s.temperatureMax);
    }
});
```

#### `device.getFuelgaugeStatistics(callback)`
Retrieves lifetime fuel gauge statistics.

```javascript
device.getFuelgaugeStatistics((result) => {
    if (result.success) {
        const s = result.data;
        console.log('Total Charge:', s.totalCharge, 'Ah');
        console.log('Total Charge Energy:', s.totalChargeEnergy, 'Wh');
        console.log('Total Discharge:', s.totalDischarge, 'Ah');
        console.log('Total Discharge Energy:', s.totalDischargeEnergy, 'Wh');
        console.log('Min Voltage:', s.minVoltage, 'V');
        console.log('Max Voltage:', s.maxVoltage, 'V');
        console.log('Max Charge Current:', s.maxChargeCurrent, 'A');
        console.log('Max Discharge Current:', s.maxDischargeCurrent, 'A');
        console.log('SOC:', s.soc, '%');
    }
});
```

#### `device.getLogFileList(callback)`
Retrieves list of log files stored on the device.

```javascript
device.getLogFileList((result) => {
    if (result.success) {
        result.data.forEach(file => {
            console.log('File ID:', file.id, 'Size:', file.size);
        });
    }
});
```

#### `device.readLogFile(fileId, callback)`
Reads samples from a specific log file.

```javascript
device.readLogFile(fileId, (result) => {
    if (result.success) {
        result.data.samples.forEach(sample => {
            console.log('Time:', sample.time);
            console.log('Voltage:', sample.voltage1);
            console.log('Current:', sample.current);
            console.log('SOC:', sample.soc);
        });
    }
});
```

## Data Structures

### MonitorData
| Field | Type | Description |
|-------|------|-------------|
| `time` | number | Unix timestamp |
| `voltage1` | number | Primary voltage (V) |
| `voltage2` | number | Secondary voltage (V) |
| `current` | number | Current (A), negative = discharging |
| `power` | number | Power (W), negative = discharging |
| `temperature` | number | Temperature (°C) |
| `soc` | number | State of charge (0-100%) |
| `runtime` | number | Remaining runtime (minutes) |
| `coulombMeter` | number | Coulomb counter (Ah) |
| `energyMeter` | number | Energy counter (Wh) |
| `powerStatus` | number | Power status code |
| `powerStatusString` | string | "OFF", "CHARGING", "DISCHARGING" |
| `rssi` | number | Signal strength |

### FuelgaugeStatistics
| Field | Type | Description |
|-------|------|-------------|
| `totalCharge` | number | Lifetime charge (Ah) |
| `totalChargeEnergy` | number | Lifetime charge energy (Wh) |
| `totalDischarge` | number | Lifetime discharge (Ah) |
| `totalDischargeEnergy` | number | Lifetime discharge energy (Wh) |
| `minVoltage` | number | All-time minimum voltage (V) |
| `maxVoltage` | number | All-time maximum voltage (V) |
| `maxChargeCurrent` | number | Peak charge current (A) |
| `maxDischargeCurrent` | number | Peak discharge current (A) |
| `timeSinceLastFullCharge` | number | Seconds since last full charge |
| `fullChargeCapacity` | number | Battery capacity (Ah) |
| `deepestDischarge` | number | Deepest discharge (Ah) |
| `lastDischarge` | number | Last discharge (Ah) |
| `soc` | number | Current SOC (%) |

## Hardware Support

| Model | Connection | Status |
|-------|------------|--------|
| PowerMon-W | WiFi via Thornwave relay | ✅ Verified |
| PowerMon-E | Ethernet (local) | Supported |
| PowerMon (BLE) | Bluetooth | Requires BLE adapter |
| PowerMon-5S (BLE) | Bluetooth | Requires BLE adapter |

## Error Handling

All callback results include:
- `success`: boolean indicating if the operation succeeded
- `code`: numeric response code (0 = success)
- `data`: the actual data (only if success is true)

```javascript
device.getMonitorData((result) => {
    if (!result.success) {
        console.error('Failed with code:', result.code);
        return;
    }
    // Use result.data
});
```

## Disconnect Reasons

| Code | Reason |
|------|--------|
| 0 | CLOSED (normal disconnect) |
| 1 | NO_ROUTE |
| 2 | FAILED |
| 3 | UNEXPECTED_ERROR |
| 4 | UNEXPECTED_RESPONSE |
| 5 | WRITE_ERROR |
| 6 | READ_ERROR |

## Troubleshooting

### Build Errors
Ensure you have the required build tools:
```bash
npm install -g node-gyp
```

### Connection Timeouts
- Verify the device is online and connected to WiFi
- Check that the applink URL is valid and not expired
- Ensure network connectivity to Thornwave's relay service

### BLE Not Available
This is expected on cloud servers. WiFi connections work without BLE.
```javascript
const device = new addon.PowermonDevice();
console.log('BLE available:', device.isBleAvailable()); // false is OK
// WiFi connections will still work!
```

## Files

```
device-manager/
├── README.md              # This file
├── binding.gyp            # Node-gyp build configuration
├── package.json           # Package metadata
├── Makefile               # Alternative build system
├── src/
│   ├── addon.cpp          # N-API addon entry point
│   ├── powermon_wrapper.cpp  # C++ wrapper implementation
│   └── powermon_wrapper.h    # C++ wrapper header
├── lib/
│   ├── index.ts           # TypeScript entry (alternative)
│   └── bridge-client.ts   # Subprocess bridge (fallback)
└── build/
    └── Release/
        └── powermon_addon.node  # Compiled addon
```

## Version History

- **v1.17** (Nov 30, 2025): BLE separated from createInstance(), WiFi works on servers
- **v1.16**: Initial integration, required BLE for createInstance()

## License

Thornwave libpowermon is provided under Thornwave Labs Inc. license.
See `libpowermon_bin/inc/powermon.h` for full license text.
