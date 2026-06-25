# Data Accuracy Issue: API Returns Stale Cellular Network State

**To:** InHand Networks Support / Engineering
**From:** Deecell (account: andy@deecell.com)
**Date:** 2026-06-25
**Re:** Cellular telemetry (`cid` / `lac` / signal) returned by the API is stale and does not match the device's actual live radio state

---

## Scope of this request (please read first)

**This is a data-accuracy issue, not a request for a GPS/tracking product.** We are **not** asking the router to be a vehicle tracker. We are reporting that the **cellular network fields your API already returns** — serving cell ID (`cid`), location area code (`lac`), carrier (`mcc`/`mnc`), and `signalStrength` — **do not reflect the device's real, live radio state.** The router inherently knows these values at all times (it must, in order to maintain its cellular connection), so when the API returns stale or unchanging values for a device that has physically moved, that is a defect in the data pipeline, not a missing feature.

---

## The core defect (the part that can't be explained by "we're not a tracker")

On a controlled drive, one of our routers traveled **22 miles from West Spokane, WA to the Idaho state line on I-90** and back. Over that drive, your API reported:

- **`info.cid = 107713764` — UNCHANGED the entire 22-mile leg.**
- **`lac = 37122` — UNCHANGED the entire 22-mile leg** (including crossing from the Spokane market into Idaho).
- The signal-block cell ID (`signalStrength.cid`) changed **exactly once** in 22 miles.

**This is physically impossible for a live cellular connection.** A vehicle driving 22 miles on an interstate passes through **dozens of distinct cell sectors**; the serving `cid` must change many times, and `lac` should change at least once across that distance and a state-line/market boundary. A single change (and zero change in the `info` block) can only mean one thing: **the API is returning a cached/stale serving-cell value, not the device's actual current cell.**

The router never lost service during this drive (it kept its data connection the whole time), so the radio knew the truth in real time — your cloud simply isn't surfacing it.

> Note on carrier code: `mcc/mnc` stayed `310/410` (AT&T). That one is *expected* if the device stayed on AT&T for the whole drive, so we are **not** citing it as evidence. The unambiguous proof is `cid` (and `lac`), which cannot remain fixed across 22 miles of driving.

---

## Supporting evidence

### 1. The telemetry timestamp freezes, then "catches up" in one jump
- `signalStrength.ts` only advances about **every 5 minutes** at best.
- When the device was on a weaker tower near the Idaho border, the data **stopped updating for 35+ minutes** — whether the truck was parked or moving — and then **jumped forward in a single step** once it returned to stronger coverage (e.g., last update leapt from 16:30 to 17:00 UTC at once).
- This pattern indicates the cloud serves a **last-known cached value** while the device-to-cloud sync is degraded, rather than buffering timestamped samples and uploading them on reconnect. It is a **reporting/sync problem, not a radio problem.**

### 2. `info.updatedAt` lags the real world
The `info` block carried an `updatedAt` that froze for long stretches during the drive, confirming the `info` payload (which contains `cid`/`lac`) is refreshed far less often than the device's actual cell changes.

### 3. The reported location is also stale (downstream of the same problem)
Separately, `location.source = "cellTower"` with `location.time` stuck **4+ days in the past** (e.g., a 2026-06-21 timestamp during a 2026-06-25 drive), and across all 48 of our devices **0 report `source: "gps"`**. Even the cell-tower geolocation is not re-run when the (also stale) cell ID changes.

---

## What we need from InHand

### Primary (data accuracy — the must-fix)
1. **Return the device's live serving cell.** `info.cid` / `lac` (and `signalStrength.cid`) must reflect the **current** tower the radio is attached to, and update **on every handoff**. Please confirm why these fields remain unchanged across a 22-mile drive and fix the staleness.
2. **Explain and fix the `info.updatedAt` / telemetry freeze.** Why does the serving-cell/signal payload stop updating for 30+ minutes, and how do we get it to report on the actual cadence the radio changes?
3. **Buffer and forward telemetry across weak-signal gaps (store-and-forward).** When backhaul degrades, the device should **queue timestamped samples and upload them on reconnect**, rather than the API serving a frozen last-known value. Does the platform/firmware support this, and how do we enable it?
4. **Allow a shorter reporting interval.** We currently see `config.timeout = 300000` (5 min). What is the **minimum supported reporting interval**, and how do we lower it (e.g., to 30–60 s) for `cid`/`lac`/`signalStrength`?
5. **Per-sample timestamps on serving-cell data**, so we can reliably order handoffs over time.

### Secondary (optional, separate from the above)
6. If the **IR300** hardware includes a **GNSS/GPS module**, we'd like to know how to enable it so `location.source` becomes `"gps"`. This is a *nice to have* — but note it is **not required** to fix the primary issue above. Even with cell data alone, accurate `cid`/`lac` would let us tell that a truck has moved between towers.

### Summary of questions
1. Why do `info.cid` and `lac` stay fixed across a 22-mile drive, and how is this fixed?
2. Why does the telemetry timestamp freeze for 30+ minutes, then jump?
3. Does the platform buffer/forward telemetry during connectivity gaps?
4. What is the minimum reporting interval, and how do we configure it?
5. (Optional) Does this IR300 SKU have GNSS, and how is it enabled?

We can provide our full raw drive logs (30-second samples with timestamps, `cid`, `lac`, `mcc`, `mnc`, and all `signalStrength` fields) and re-run the test on any device you specify. Our ask is simple and reasonable: **the cellular network data your API returns should match the radio's actual live state.**

Thank you,
Deecell

---

## Technical reference

**Example device (used in the drive test):**
- Name: `DCL-Moeck-Fleet`
- Model: **IR300** · Product no.: 302FQ38-WLAN · Serial: **RF3022532644350**
- Firmware: swVersion **V3.5.99**, bootVersion 1.1.3.r4956, hwVersion V1.0
- Current config: `{ "sync": 2, "timeout": 300000, "ackTimeout": 120000, "ackRetries": 3 }`

**API endpoints we use:** `GET /api/devices?verbose=100` (bulk) and `GET /api/devices/{id}/signal`.

**Drive-test timeline (UTC; local was Pacific = UTC−7), West Spokane → ID and back:**

| UTC | Event | `info.cid` | `lac` | `signalStrength.cid` | Signal | Telemetry ts |
|---|---|---|---|---|---|---|
| 16:23 | Leave shop (W Spokane) | 107713764 | 37122 | 158248449 | rssi −71, sinr +12 | 16:15 |
| 16:37 | Driving I-90 E | 107713764 | 37122 | 107567895 | rssi −85, sinr −3 | 16:30 |
| 16:54 | Arrive ID border (~22 mi) | **107713764** | **37122** | 107567895 | weak | 16:30 (then froze) |
| 17:05 | Parked ID (weak signal) | 107713764 | 37122 | 107567895 | rsrp −120, sinr −4 | 16:30 (35+ min stale) |
| 17:21 | Back near Spokane | 107713764 | 37122 | 107594505 | rssi −79, sinr 0 | jumped → 17:00 |

**The smoking gun:** `info.cid` and `lac` are identical at 16:23 (West Spokane) and 16:54 (Idaho state line, 22 miles later). A live radio cannot stay on one cell across that distance.
