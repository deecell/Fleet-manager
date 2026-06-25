# Data Accuracy & Upload-Interval Issue: InHand Cloud Reports Stale Cellular State

**To:** InHand Networks Support / Engineering
**From:** Deecell (account: andy@deecell.com)
**Date:** 2026-06-25
**Re:** (1) Device Manager upload intervals are capped at 1 hour; (2) even at that cap, location/cell data is stale and does not match the device's live radio state

---

## Scope of this request (please read first)

**This is a data-accuracy and configuration issue, not a request for a GPS/tracking product.** We are **not** asking the router to be a vehicle tracker. We are reporting two concrete problems with the **cellular network data your cloud already collects** — serving cell ID (`cid`), location area code (`lac`), carrier (`mcc`/`mnc`), `signalStrength`, and cell-tower location (LBS):

1. Your **Device Manager** service will not upload this data more often than **once per hour** (the config field's valid range is **1–24 hours**), and
2. Even at that 1-hour setting, the data we receive is **far older than an hour and does not reflect the device's actual current cell**.

The router inherently knows its serving cell and signal at all times (it must, to keep its data connection up), so this is a defect/limitation in the **cloud upload pipeline and its configurable cadence**, not a missing hardware feature.

---

## Finding 1 — The upload interval is capped at 1 hour (this is the core blocker)

On `DCL-Moeck-Fleet` (IR300), under **Service Manager → Device Manager** (Server: `iot.inhandnetworks.com`), the relevant settings are:

| Setting | Current value | Meaning |
|---|---|---|
| **LBS info Upload Interval** | **1 Hour** | Cell-tower (LBS) location upload cadence |
| **Series Info Upload Interval** | **1 Hour** | Signal / cell telemetry time-series upload cadence |
| Channel Keepalive | 30 Seconds | — |

Both are **already at the minimum**. Attempting to set either below 1 returns the error: **"valid values are 1–24"** (hours). So the fastest the router will push cell/LBS/signal telemetry to your cloud — which is what our API (`GET /api/devices?verbose=100`, `GET /api/devices/{id}/signal`) reads — is **once per hour**.

**What we need:** a supported way to upload LBS and Series Info at **sub-hour intervals — ideally ~1 minute (30–60 s)**. Specifically:
- Is there a **CLI, advanced config, or firmware option** that allows an upload interval below 1 hour?
- If not, can the platform be updated to **accept seconds/minutes** for these fields?
- If 1 hour is a hard platform limit, please tell us directly so we can plan around it.

---

## Finding 2 — Even at the 1-hour cap, the data is stale and wrong

This is independent of the interval cap and, we believe, a genuine bug.

### 2a. Location is days stale, not 1 hour
Baseline reading (2026-06-25 22:10 UTC) from your API for `DCL-Moeck-Fleet`:
- `location.source = "cellTower"`, **`location.time = 2026-06-21T01:03:08Z`** — i.e., **~4.5 days old**, despite the LBS upload interval being set to 1 hour.
- Across all 48 of our devices, **0 report `location.source: "gps"`**, and `location.time` is routinely multiple days stale.

If LBS were honoring its 1-hour interval, location should be at most ~1 hour old. It is not. **Why does LBS exceed its own configured upload interval?**

### 2b. The serving cell does not change across a 22-mile drive
We ran a controlled drive: one router traveled **22 miles from West Spokane, WA to the Idaho state line on I-90** and back. Over that drive your API reported:

- **`info.cid = 107713764` — UNCHANGED the entire 22-mile leg.**
- **`lac = 37122` — UNCHANGED the entire 22-mile leg** (including crossing into the Idaho market).
- The signal-block `signalStrength.cid` changed **only once** in 22 miles.

A vehicle driving 22 miles on an interstate passes through **dozens of cell sectors**; the serving `cid` must change many times and `lac` should change at least once. A single change (and zero change in the `info` block) means the uploaded values are **cached/stale, not the device's actual current serving cell.**

> We are **not** citing `mcc/mnc` (310/410, AT&T) as evidence — that is expected to stay constant if the device remained on AT&T. The unambiguous proof is **`cid`** (and `lac`), which cannot remain fixed across 22 miles.

### 2c. Telemetry freezes during weak signal, then jumps
When the device was on a weaker tower near the Idaho border, the telemetry timestamp **stopped advancing for 35+ minutes** (parked or moving), then **jumped forward in a single step** once back in stronger coverage. This suggests the cloud serves a **last-known cached value** rather than buffering timestamped samples and uploading them on reconnect (store-and-forward).

---

## What we need from InHand (summary)

**Primary**
1. **Allow sub-hour upload intervals** for LBS info and Series Info (your field caps at 1–24 hours; we need ~1 minute). Is there a CLI/advanced/firmware path, or can the limit be changed?
2. **Fix LBS not honoring its interval** — explain why `location.time` is days stale when LBS is set to 1 hour.
3. **Report the live serving cell** — `info.cid`/`lac` (and `signalStrength.cid`) must reflect the device's current tower at each upload, not a cached value.
4. **Store-and-forward** — buffer timestamped telemetry during weak-signal gaps and upload on reconnect, instead of serving a frozen last-known value.

**Secondary (optional)**
5. If the **IR300** (product 302FQ38-WLAN, serial RF3022532644350) has a **GNSS/GPS module**, how do we enable it so `location.source` becomes `"gps"` with continuous fixes? Helpful, but not required to fix items 1–4.

### Questions
1. How do we set LBS/Series upload intervals below 1 hour (CLI, firmware, or platform change)? Is 1 hour a hard limit?
2. Why is `location.time` days stale when LBS upload is set to 1 hour?
3. Why do `info.cid`/`lac` stay fixed across a 22-mile drive?
4. Does the platform support store-and-forward of telemetry across connectivity gaps?
5. (Optional) Does this IR300 SKU have GNSS, and how is it enabled?

We can provide our full raw drive logs (30-second API samples with timestamps, `cid`, `lac`, `mcc`, `mnc`, and all `signalStrength` fields) and a screenshot of the Device Manager settings, and we can re-run the test on any device you specify. Our ask is simple: **let the router upload its real, current cellular state at a useful cadence.**

Thank you,
Deecell

---

## Technical reference

**Example device (used in the drive test):**
- Name: `DCL-Moeck-Fleet`
- Model: **IR300** · Product no.: 302FQ38-WLAN · Serial: **RF3022532644350**
- Firmware: swVersion **V3.5.99**, bootVersion 1.1.3.r4956, hwVersion V1.0
- Device Manager service config: LBS info Upload Interval = **1 Hour** (min, range 1–24), Series Info Upload Interval = **1 Hour** (min, range 1–24), Channel Keepalive = 30 s
- Internal poll config seen via API: `{ "sync": 2, "timeout": 300000, "ackTimeout": 120000, "ackRetries": 3 }`

**API endpoints we read:** `GET /api/devices?verbose=100` (bulk) and `GET /api/devices/{id}/signal`.

**Baseline reading — 2026-06-25 22:10 UTC:**
| Field | Value | Age |
|---|---|---|
| `location.time` | 2026-06-21T01:03:08Z (cellTower) | ~4.5 days |
| `signalStrength.ts` | 2026-06-25T22:00:00Z | on the hour |
| `info.cid` / `lac` | 108634129 / 37122 | — |
| `info.updatedAt` | 2026-06-25T21:43:55Z | ~27 min |

**Drive-test timeline (UTC; local Pacific = UTC−7), West Spokane → ID border and back:**

| UTC | Event | `info.cid` | `lac` | `signalStrength.cid` | Signal | Telemetry ts |
|---|---|---|---|---|---|---|
| 16:23 | Leave shop (W Spokane) | 107713764 | 37122 | 158248449 | rssi −71, sinr +12 | 16:15 |
| 16:37 | Driving I-90 E | 107713764 | 37122 | 107567895 | rssi −85, sinr −3 | 16:30 |
| 16:54 | Arrive ID border (~22 mi) | **107713764** | **37122** | 107567895 | weak | 16:30 (then froze) |
| 17:05 | Parked ID (weak signal) | 107713764 | 37122 | 107567895 | rsrp −120, sinr −4 | 16:30 (35+ min stale) |
| 17:21 | Back near Spokane | 107713764 | 37122 | 107594505 | rssi −79, sinr 0 | jumped → 17:00 |

**The smoking gun:** `info.cid` and `lac` are identical at 16:23 (West Spokane) and 16:54 (Idaho state line, 22 miles later). A live radio cannot stay on one cell across that distance.
