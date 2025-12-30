# PowerMon Ethernet Firmware Bug Report

**Date**: December 30, 2025  
**Reported By**: Deecell Fleet Management Team  
**Product**: PowerMon-E (Ethernet Version)  
**Firmware Version**: 0.2  
**Library Version**: libpowermon v1.11  

---

## Summary

PowerMon devices running Ethernet firmware version 0.2 cause the libpowermon C++ library to crash when attempting to connect. The device connects successfully but disconnects within approximately 2 milliseconds, triggering a fatal crash in the native library. This prevents stable integration with our fleet management system.

---

## Environment

- **Host Platform**: AWS EC2 (Amazon Linux 2023, x86_64)
- **Node.js Version**: 18.x
- **Library**: libpowermon_bin v1.11 (latest from git.thornwave.com)
- **Native Addon**: N-API wrapper around libpowermon
- **Connection Method**: Ethernet (via AppLink URL)

---

## Affected Device

| Field | Value |
|-------|-------|
| Serial Number | 1982A3044D3599E2 |
| Device Name | DCL-Moeck-Shop |
| Connection Type | Ethernet (wired to router) |
| Firmware Version | 0.2 |
| Hardware Revision | Unknown (crashes before retrieval) |

---

## Issue Description

### Observed Behavior

1. Application calls `PowermonDevice.connect()` with the device's AppLink access key
2. `onConnect` callback fires successfully (device appears connected)
3. Within **2 milliseconds**, `onDisconnect` callback fires with `reason: 2`
4. Attempting to call any method (e.g., `getInfo()`, `getMonitorData()`) after disconnect causes the native library to crash
5. Process terminates with:
   ```
   terminate called without an active exception
   Main process exited, code=dumped, status=6/ABRT
   ```

### Timeline from Logs

```
22:53:40.502 - Connecting to device (deviceId: 4, serial: 1982A3044D3599E2)
22:53:40.503 - Connected successfully
22:53:40.503 - Device disconnected (reason: 2, connectionDurationMs: 2)
22:53:40.503 - Error fetching device info: "Not connected"
[CRASH - terminate called without an active exception]
```

### Crash Frequency

The device reconnects after each crash (systemd auto-restart), creating a crash loop every ~19 seconds until we disabled the device.

---

## Comparison with WiFi Devices

| Aspect | WiFi (Firmware 1.18+) | Ethernet (Firmware 0.2) |
|--------|----------------------|------------------------|
| Connection Duration | Stable (hours+) | 2 milliseconds |
| Disconnect Reason | Normal (user-initiated) | Reason code: 2 |
| getInfo() | Works | Crashes library |
| getMonitorData() | Works | Crashes library |
| Polling | Stable every 10s | Not possible |

We have 9 WiFi PowerMon devices running firmware 1.18+ that work perfectly with the same libpowermon library and application code.

---

## Disconnect Reason Code

The `onDisconnect` callback receives `reason: 2`. Could you clarify what this reason code indicates? Our documentation doesn't specify the meaning of disconnect reason codes.

---

## Reproduction Steps

1. Connect to PowerMon-E device with firmware 0.2 via AppLink URL
2. Wait for `onConnect` callback
3. Attempt to call `getInfo()` or `getMonitorData()`
4. Observe crash or immediate disconnect

---

## Questions for Thornwave

1. **Is firmware 0.2 for Ethernet devices still supported?**
2. **Is there an updated Ethernet firmware available?** (We couldn't find one)
3. **What does disconnect reason code 2 indicate?**
4. **Is there a known issue with rapid connect/disconnect on Ethernet devices?**
5. **Are there any recommended connection parameters or timeouts for Ethernet devices that differ from WiFi?**

---

## Workaround

We've implemented a circuit breaker pattern that:
- Detects rapid disconnects (connection duration < 5 seconds)
- Opens after 5 rapid disconnects
- Marks devices as "unstable" in our database
- Skips unstable devices during polling

However, the crash happens so fast that even our mitigation can't prevent all crashes. We've had to completely disable this device from our polling system.

---

## Requested Resolution

Please investigate and provide either:
1. An updated Ethernet firmware that fixes the rapid disconnect issue, or
2. Guidance on how to properly connect to Ethernet firmware 0.2 devices, or
3. Confirmation that firmware 0.2 is deprecated with a recommended upgrade path

---

## Contact

Please reach out if you need additional logs, device access, or clarification.

Thank you for your support.
