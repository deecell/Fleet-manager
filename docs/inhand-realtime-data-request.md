# Request: Real-Time Location & Cell Telemetry from InHand Routers

**To:** InHand Networks Support / Engineering
**From:** Deecell (account: andy@deecell.com)
**Date:** 2026-06-25
**Re:** Need near-real-time location and cellular telemetry for fleet tracking

---

## Background

We operate a fleet of ~48 InHand cellular routers (IR300 series) installed in clean-energy trucks. We pull each device's data from your cloud API (`GET /api/devices?verbose=100` and `GET /api/devices/{id}/signal`) to power a live fleet-tracking dashboard. We need to show, in near real time, **where each truck is and whether it is moving**.

We recently ran a controlled live drive test with one truck to measure exactly how fresh the data we receive is. The results show the data is **not usable for live tracking today**, and we believe most of this is fixable through configuration and/or platform behavior on your end. This document describes the problem, the evidence, and the specific changes/answers we need.

**Example device used for the test:**
- Name: `DCL-Moeck-Fleet`
- Model: **IR300**
- Serial: **RF3022532644350**
- Product no.: 302FQ38-WLAN
- Firmware: swVersion **V3.5.99**, bootVersion 1.1.3.r4956, hwVersion V1.0

---

## (a) The Problem

We cannot determine a truck's real-time location or movement from the data your API returns:

1. **The reported location is cell-tower geolocation, not GPS, and it is stale by days.** Every device returns `location.source = "cellTower"`. Across all 48 devices, **0 report `source: "gps"`**, and the `location.time` is routinely **4–5 days old**. The position effectively never changes while a truck drives.

2. **The fresher cellular telemetry (signal + serving cell) only updates about every 5 minutes, and stops entirely when signal is weak.** This is far too coarse to track a moving vehicle, and it disappears exactly when we most need it (out of strong coverage).

3. **We have no real movement/route signal.** Over a ~45-mile, ~2-hour round trip, the data showed the truck as essentially stationary the entire time.

---

## (b) What We Observe in the Data

### Live drive test — 2026-06-25 (times in UTC; local was Pacific / UTC−7)

A single truck drove from our shop in Spokane, WA, east on I-90 into Idaho (~22 miles), then back west through Spokane Valley with two stops, then home. We polled your API every 30 seconds the entire time and recorded `location`, `signalStrength`, and `info` (serving cell).

| UTC | Event | What your API reported |
|---|---|---|
| 16:23 | Leave shop | Healthy signal (rssi −71, sinr +12); last telemetry timestamp 16:15 |
| 16:37 | Driving I-90 east | One serving-cell change; signal dropping (rssi −85, sinr −3); telemetry ts → 16:30 |
| 16:54 | Arrive Idaho (~22 mi driven) | **`location` never changed.** Telemetry then went silent. |
| 17:05 | Still parked in Idaho (weak signal) | **No new telemetry for 35+ min** — last ts still 16:30 |
| 17:21 | Back in Spokane (stronger signal) | Telemetry **caught up in one jump**, ts 16:30 → 17:00 |
| 17:36 | In town | Still lagging ~20–30 min behind real time |

### Key measurements

- **`location` (lat/lng) never updated once** during the entire ~45-mile drive. It remained frozen at a value from **2026-06-21** (4+ days earlier).
- **`signalStrength.ts` advances only about every 5 minutes** when signal is good. We confirmed the same 5-minute granularity from the per-device `/signal` history endpoint.
- **Telemetry is signal-gated, not movement-gated.** When the router was on a weak roaming tower (rsrp −120, sinr −4), it stopped reporting to your cloud for 35+ minutes — whether parked or moving — then "caught up" only after returning to strong coverage. This suggests last-known values are served while the device is unreachable, rather than buffered timestamped samples being uploaded on reconnect.
- The **serving cell identity** (`info.cid` / `lac` / `mcc` / `mnc`) is present and does change on tower handoffs, but updates only at the same slow cadence.

### Current device configuration we can see via the API

```json
"config": { "sync": 2, "timeout": 300000, "ackTimeout": 120000, "ackRetries": 3 }
```

The `timeout: 300000` (5 minutes) appears to drive the reporting cadence we observe.

---

## (c) What We Need InHand to Change / Confirm

### 1. Enable real GPS/GNSS (highest priority)
- Does the **IR300 (product 302FQ38-WLAN, serial RF3022532644350)** have a **GNSS/GPS module**?
- If yes: **how do we enable it** (device config and/or platform setting) so that `location.source` becomes `"gps"` with **continuous fixes** while driving? Do we need an external GPS antenna, a firmware option, or a config flag?
- If the hardware has no GNSS: please confirm, and advise which IR-series model/SKU we should standardize on for true GPS tracking.

### 2. Make cell-tower location refresh in near real time
- Today `location.time` stays **days stale** even though the serving cell ID changes. Please explain what controls cell-tower re-geolocation, and **re-geolocate on every tower handoff** (or at least every few minutes) instead of caching for days.

### 3. Reduce the telemetry reporting interval
- We need a **much shorter reporting cadence** — ideally **30–60 seconds** for location, serving cell (`cid/lac/mcc/mnc`), and `signalStrength`. What is the **minimum supported reporting interval**, and how do we configure it (is it the `timeout: 300000` value, and can it safely be lowered)?

### 4. Buffer and forward telemetry across connectivity gaps (store-and-forward)
- When the device loses good backhaul, we need it to **queue timestamped samples and upload them when the connection recovers**, rather than us seeing a frozen "last-known" value. Does the platform/firmware support store-and-forward of historical telemetry? If so, how do we enable it?

### 5. Per-sample timestamps on serving-cell data
- Please confirm that `info.cid/lac/mcc/mnc` carries (or can carry) a **per-sample timestamp** so we can reliably detect handoffs over time.

### Summary of questions
1. Does this IR300 SKU have GNSS hardware? How do we turn it on so `location.source = "gps"`?
2. What controls cell-tower location refresh, and can it update on every handoff?
3. What is the minimum reporting interval, and how do we set it (30–60 s)?
4. Does the platform support store-and-forward buffering during signal loss?
5. Can serving-cell fields carry a per-sample timestamp?

We're happy to share our full raw drive-test logs and run additional tests on a device of your choosing. Our goal is simple: **live position + moving/stopped state per truck**. Please advise the fastest path to get there with our current IR300 fleet, and whether any of it requires a hardware change.

Thank you,
Deecell
