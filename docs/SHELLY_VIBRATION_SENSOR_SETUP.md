# Shelly Plus Uni Vibration Sensor Setup Guide

## Overview

This document details the hardware setup for detecting truck movement states (Driving, Idling, Parked) using a vibration sensor connected to a Shelly Plus Uni WiFi controller. The system monitors vibration frequency to determine truck status and integrates with the Deecell Fleet Tracking Dashboard.

## Components

### 1. Shelly Plus Uni
- **Model**: Shelly Plus Uni (WiFi 2.4 GHz)
- **Purpose**: Universal WiFi sensor input controller
- **Power Input**: 5V DC (via +5VDC terminal) or 9-28V DC (via VAC1/VAC2)
- **Inputs**: 
  - IN1, IN2: Digital inputs (active-low, trigger below 1.5V)
  - COUNT IN: Pulse counter input with frequency measurement
  - ANALOG IN: 0-15V or 0-30V analog input
  - DATA: 1-Wire data input (for DS18B20 temperature sensors)
- **Outputs**: OUT1, OUT2 (potential-free relay outputs, 24V AC/DC, 2A max)
- **Connectivity**: WiFi 2.4 GHz, HTTP/RPC API
- **Documentation**: https://kb.shelly.cloud/knowledge-base/shelly-plus-uni

### 2. DC-DC Converter
- **Input Voltage**: 12-24V DC (from truck electrical system)
- **Output Voltage**: 5V DC (measured 5.3V under load)
- **Purpose**: Steps down truck voltage to power Shelly Plus Uni
- **Connection**: Truck 12V/24V battery → DC-DC input; DC-DC 5V output → Shelly +5VDC

### 3. SW-420 Vibration Sensor Module
- **Model**: SW-420 (or compatible vibration sensor module)
- **Operating Voltage**: 3.3V - 5V DC
- **Output Type**: Digital (HIGH when vibration detected)
- **Sensitivity**: Adjustable via onboard potentiometer
  - Counter-clockwise = More sensitive
  - Clockwise = Less sensitive
- **Indicators**: 
  - Power LED (green, solid when powered)
  - Vibration LED (green, flashes when vibration detected)
- **Pins**: VCC, GND, DO (Digital Output)
- **Amazon Link**: https://www.amazon.com/EC-Buying-SW-420-Vibration-Arduino/dp/B0BKZ7L1SS

## Wiring Diagram

### Wire Color and Number Reference (Shelly Plus Uni Cable)

| Wire # | Color  | Terminal      | Function                    |
|--------|--------|---------------|-----------------------------|
| 6      | Gray   | +5VDC         | 5V DC power input           |
| 7      | Green  | GND           | Ground (shared)             |
| 8      | Purple | COUNT IN      | Pulse counter input         |
| 9      | Yellow | SENSOR VCC    | 5V output for sensors       |
| 10     | Orange | IN1           | Digital input 1 (not used)  |

### Connection Table

| Source                  | Destination              | Wire Color | Wire # |
|-------------------------|--------------------------|------------|--------|
| DC-DC Converter +5V OUT | Shelly +5VDC             | Gray       | #6     |
| DC-DC Converter GND OUT | Shelly GND               | Green      | #7     |
| Vibration Sensor VCC    | Shelly SENSOR VCC        | Yellow     | #9     |
| Vibration Sensor GND    | Shelly GND               | Green      | #7     |
| Vibration Sensor DO     | Shelly COUNT IN          | Purple     | #8     |

### Visual Wiring Diagram

```
TRUCK 12V/24V BATTERY
         │
         ▼
┌─────────────────────┐
│   DC-DC Converter   │
│   (12-24V → 5V)     │
│                     │
│  IN+ ← 12V/24V+     │
│  IN- ← 12V/24V-     │
│                     │
│  OUT+ (5V) ─────────┼──────────────────────────────────┐
│  OUT- (GND) ────────┼───────────────────────────────┐  │
└─────────────────────┘                               │  │
                                                      │  │
                      ┌───────────────────────────────┼──┼───────┐
                      │       SHELLY PLUS UNI         │  │       │
                      │                               │  │       │
                      │  +5VDC (Gray #6) ◄────────────┼──┘       │
                      │  GND (Green #7) ◄─────────────┴──────┐   │
                      │                                      │   │
                      │  SENSOR VCC (Yellow #9) ─────────────┼───┼──► Sensor VCC
                      │  GND (Green #7) ─────────────────────┼───┼──► Sensor GND
                      │  COUNT IN (Purple #8) ◄──────────────┼───┼─── Sensor DO
                      │                                      │   │
                      └──────────────────────────────────────┼───┘
                                                             │
                                              ┌──────────────┴──────────────┐
                                              │    SW-420 VIBRATION SENSOR  │
                                              │                             │
                                              │   VCC ◄── 5V from Shelly    │
                                              │   GND ◄── GND from Shelly   │
                                              │   DO  ──► COUNT IN          │
                                              │                             │
                                              │   [POT] Sensitivity Adjust  │
                                              │   [LED] Power (green solid) │
                                              │   [LED] Vibration (flashes) │
                                              └─────────────────────────────┘
```

## Shelly Configuration

### Network Setup
1. Power on the Shelly Plus Uni
2. Connect to the Shelly's WiFi hotspot: `ShellyPlusUni-XXXX`
3. Open browser to `192.168.33.1` or `192.168.4.1`
4. Configure WiFi credentials for your network
5. Note the assigned IP address (e.g., `192.168.1.240`)

### Input Configuration
- **Input (2) / COUNT IN**: Used for vibration pulse counting
  - Displays pulse count and frequency (Hz)
  - No inversion needed for COUNT IN
  - Report Threshold: 1 (report every pulse)

### Why COUNT IN vs IN1/IN2?
- **IN1/IN2**: Digital inputs with active-low logic (trigger below 1.5V)
  - Requires "Invert" setting for sensors that output HIGH when active
  - Best for simple ON/OFF state detection
- **COUNT IN**: Pulse counter with frequency measurement
  - Measures Hz (pulses per second)
  - Better for distinguishing movement states by vibration intensity
  - No inversion needed

## Movement State Detection

### Frequency Thresholds (to be calibrated per truck)

| State    | Expected Hz Range | Description                        |
|----------|-------------------|------------------------------------|
| Parked   | 0 Hz              | No vibration, engine off           |
| Idling   | 1-10 Hz           | Engine running, truck stationary   |
| Driving  | 10+ Hz            | Truck in motion, road vibration    |

**Note**: These thresholds are estimates and should be calibrated through real-world testing on each truck model.

### Sensitivity Adjustment
- Use the onboard potentiometer to adjust detection sensitivity
- **Counter-clockwise**: More sensitive (detects smaller vibrations)
- **Clockwise**: Less sensitive (requires stronger vibrations)
- Recommended: Start with medium sensitivity and adjust based on testing

## API Integration

### Shelly HTTP API Endpoints

**Base URL**: `http://<shelly-ip>` (e.g., `http://192.168.1.240`)

#### Get Input Status
```bash
# Get COUNT IN status (Input 2)
GET http://192.168.1.240/rpc/Input.GetStatus?id=2

# Response example:
{
  "id": 2,
  "counts": {
    "total": 1234,
    "by_minute": [45, 52, 48, ...]
  },
  "freq": 12.5
}
```

#### Get Device Info
```bash
GET http://192.168.1.240/rpc/Shelly.GetDeviceInfo
```

#### Get All Input Statuses
```bash
GET http://192.168.1.240/rpc/Shelly.GetStatus
```

### Webhook Configuration (Optional)
The Shelly can be configured to send HTTP webhooks when input state changes:
1. Go to Shelly web interface → Actions
2. Add action for Input 2 state change
3. Configure webhook URL to your fleet dashboard endpoint

## Fleet Dashboard Integration

### Database Schema (Future)
```sql
-- Shelly devices table
CREATE TABLE shelly_devices (
  id SERIAL PRIMARY KEY,
  truck_id INTEGER REFERENCES trucks(id),
  device_id VARCHAR(50) UNIQUE,
  ip_address VARCHAR(45),
  name VARCHAR(100),
  firmware_version VARCHAR(20),
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Vibration readings table
CREATE TABLE vibration_readings (
  id SERIAL PRIMARY KEY,
  shelly_device_id INTEGER REFERENCES shelly_devices(id),
  frequency_hz DECIMAL(8,2),
  pulse_count INTEGER,
  movement_state VARCHAR(20), -- 'parked', 'idling', 'driving'
  recorded_at TIMESTAMP DEFAULT NOW()
);
```

### Integration Architecture
```
┌─────────────────┐     HTTP/Webhook     ┌──────────────────┐
│  Shelly Plus    │ ──────────────────►  │  Fleet Dashboard │
│  Uni            │                      │  API Server      │
│  (in truck)     │ ◄──────────────────  │                  │
└─────────────────┘     Polling/Config   └──────────────────┘
                                                  │
                                                  ▼
                                         ┌──────────────────┐
                                         │  PostgreSQL DB   │
                                         │  (vibration data)│
                                         └──────────────────┘
```

## Troubleshooting

### Sensor LED not flashing on vibration
- Check power connections (VCC and GND)
- Adjust potentiometer counter-clockwise for higher sensitivity
- Verify 5V output from DC-DC converter

### Shelly not detecting pulses on COUNT IN
- Verify sensor DO wire is connected to purple wire #8
- Check that sensor LED flashes when tapped
- Verify common ground between sensor and Shelly

### Shelly WiFi not appearing
- Verify power to Shelly (LED should be blinking red)
- Check DC-DC converter output voltage (should be ~5V)
- Try power cycling the Shelly

### Input showing wrong state on IN1/IN2
- Enable "Invert" in input settings (Shelly inputs are active-low)
- Consider using COUNT IN instead for frequency measurement

## Installation in Truck

### Recommended Mounting Locations
1. **Shelly Plus Uni**: Protected location, accessible for WiFi signal
2. **Vibration Sensor**: Mounted to truck frame or chassis for best vibration detection
3. **DC-DC Converter**: Near 12V/24V power source, protected from elements

### Power Connection
- Connect DC-DC input to truck's always-on 12V or 24V circuit
- Consider adding an inline fuse (2A) for protection
- Ensure secure, weatherproof connections

### Network Considerations
- Shelly requires WiFi connectivity to transmit data
- Options:
  - Connect to truck's WiFi hotspot (if available)
  - Use mobile hotspot device
  - Configure for local storage with periodic sync

## Revision History

| Date       | Version | Changes                                    |
|------------|---------|-------------------------------------------|
| 2026-01-14 | 1.0     | Initial documentation, hardware setup     |

## References

- Shelly Plus Uni Knowledge Base: https://kb.shelly.cloud/knowledge-base/shelly-plus-uni
- Shelly Plus Uni API Documentation: https://shelly-api-docs.shelly.cloud/
- SW-420 Vibration Sensor Datasheet: https://components101.com/sensors/sw-420-vibration-sensor-module
