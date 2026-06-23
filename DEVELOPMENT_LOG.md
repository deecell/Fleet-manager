# Deecell Fleet Management - Development Log

> This log tracks all development progress, architectural decisions, and implementation details for team reference.

---

## 2026-06-23 — Show matched devices (not just unmatched) in InHand poll log

**Why**: The `InHand poll complete` line only listed `unmatchedDevices`. When diagnosing why a gateway wasn't linking, the operator could see what *didn't* match but had no visibility into what *did* — so there was no way to confirm a given InHand device was matched to the correct truck/SIM, or by which key.

**What changed** (`device-manager/app/inhand-poller.js`):
- The match loop now captures the key that matched (`iccid` / `imsi` / `msisdn` / `name`) instead of resolving the SIM in a single `||` chain, and collects matched devices into a `matched` array alongside the existing `unmatched` array.
- Added a `matchedDevices` field to the `InHand poll complete` log line, rendered as `InHandName→TruckNumber via key` (falls back to the SIM's `device_name`, then `(unassigned)`, when no truck is assigned). The existing `unmatchedDevices` field is unchanged.

**Context**: confirmed during this session that InHand device renames *do* flow into our logs automatically (we read `device.name` raw on each ~2-min poll) — e.g. `IR302_31`→`DCL-Penske-01` and `IR302_34`→`DCL-Radian-Shop` propagated on their own. Names only affect matching if a SIM row already exists with that `device_name` (from Wireless Logic custom_field1); we never store InHand names in our DB.

No schema/DB changes. Must be deployed to the EC2 device-manager to take effect in production.

---

## 2026-06-22 — Device name + clearer color in device-manager logs

**Why**: Several per-device log lines (`onDisconnect fired`, `Scheduling reconnect`, `Connecting to device`, `Connected successfully`, `Disconnected`, `Device disconnected (unexpected)`, `Using firmware-close cooldown delay`) only printed `deviceId`/`serial`/`cohort`, so you had to cross-reference the ID to know which truck. Operator wanted the device name inline like the poll lines, plus more scannable color.

**What changed**:
- `device-manager/app/connection-pool.js`: added `deviceName` to the per-device child logger context (`this.log = logger.child({ deviceName, deviceId, serial, cohort })`). Because every `this.log.*` call in `DeviceConnection` flows through that child, all of those lines now show the truck name automatically — no per-call edits needed.
- `device-manager/app/logger.js`: the colorizer already tinted the level tag (ERROR red, WARN yellow, INFO cyan). Extended it so `warn`/`error` lines now colorize the **whole message** too, so they pop when scanning; `info`/`debug` keep the default bold-white message.

**Note on viewing color**: the logs already emit ANSI color codes. To see the color you need a color-aware viewer — `journalctl -u <unit>` through its pager, or `less -R` / `cat` in a terminal. Opening a redirected `.log` file in a plain text editor shows the raw escape codes, not color (that's inherent to ANSI; a text file can't carry color any other way).

**Follow logs with color (operator command)**: `sudo journalctl -u device-manager -f -o cat`. The `-o cat` mode prints the raw message field, which (a) preserves the app's ANSI colors (the default journald format escapes them) and (b) drops the redundant `Jun 22 ... ip-10-0-12-190 start.sh[PID]:` prefix.

**Shorter timestamp** (`device-manager/app/logger.js`): with `-o cat` the journald prefix is gone, so the app's own timestamp was the only one — and it repeated the full date on every line. Trimmed `2026-06-22 12:36:55.013` → time-only `12:36:55.013` (UTC, ms kept for spotting sub-second flapping). Full date is still recoverable via plain `journalctl` without `-o cat`, since journald stores its own timestamp.

**Timestamp consistency on poll-summary lines** (`device-manager/app/database.js`): the per-poll status line (`DCL-Moeck (GFR-69) parked v1=… v2=…`) builds its own timestamp instead of going through `logger.js`, so it was still printing the full date (`2026-06-22 14:57:28.102`) while every event line had switched to time-only. Aligned it to the same `new Date().toISOString().slice(11, 23)` time-only format so the whole log reads consistently.

No schema/DB changes. Must be deployed to the EC2 device-manager to take effect in production.

---

## 2026-06-19 — Probe guard for devices with no serial number

**Why**: During a live incident, DCL-Howard was set online but never recovered. The supervisor kept spawning solo recovery probes for it, and each probe child died instantly with `WORKER_COHORT_ID or WORKER_SOLO_SERIAL environment variable is required`, then logged a misleading `still offline (probe failed)`. Root cause: a solo probe is keyed on the device's serial number (passed to the child via `WORKER_SOLO_SERIAL` in `forkProbeWorker`). Howard's record had no serial number, so the env var was unset and the child bailed before testing anything. The "probe failed" lines were false — nothing was ever probed. (Confirmed contrast: DCL-Radian-1, which has a serial, spawned a probe that connected fine and genuinely flapped due to marginal cellular — that's a real field fault, not this bug.)

**What changed** (`device-manager/app/supervisor.js`):
- `forkProbeWorker(serial, deviceName)` now guards at the top: if `serial` is null/empty, it logs a clear one-time `PROBE Skipped <device> — no serial number on record; cannot probe (set its serial in the dashboard)` and returns without spawning a doomed child. A new `this.noSerialWarned` Set throttles the message to once per device per process so the loop doesn't spam logs every check.
- `_logSkippedDevices` skip-list now renders `(no serial — cannot probe; set its serial in the dashboard)` for a flapping device with no serial, instead of the misleading `(probe #N failed, retry in Xm)`.

**Not changed**: `worker.js` is correct as-is (it only errors when *both* env vars are missing). This is purely a supervisor-side guard so a misconfigured record produces an honest log instead of a fake probe-failure loop. The actual fix for a Howard-type device is to populate its serial number (+ active credentials) on the device record.

No schema or migration needed — no DB changes.

---

## 2026-05-28 — Dashboard verdict labels (Task #25 follow-up)

After Task #25 deployed and the new three-bucket verdict logic verified in prod logs, surfaced the same verdicts on two dashboard surfaces so operators see the honest diagnosis instead of the misleading "Flapping" label (DCL-Carter was rendering as "Flapping" when it's actually fully powered off).

**Shared classifier**
- New `shared/flapping-verdict.ts` exports `classifyFlappingVerdict(routerSignalUpdatedAt, lastReportedAt)` returning `{ bucket: "outage" | "powermon_offline" | "powermon_flap", label, tooltip }`. TS port of the device-manager `classifyFlappingVerdict` so both surfaces speak the same language. Thresholds match: router fresh < 10 min, PowerMon recent < 6 h. Uses `Math.floor` for strict-less-than boundary parity with the JS version. Missing/stale router timestamps collapse to "Router/cellular outage" — matching the device-manager runtime (a device whose router signal we've never seen is, for the operator, unreachable). Never returns null, so callers don't need fallback branches.

**Backend (db-storage.ts)**
- `listDevices` (customer `/api/v1/devices`), `listAllDevicesWithSnapshots` (admin all-orgs), and `listDevicesWithSnapshots` (admin per-org) now also fetch `sims.router_signal_updated_at` and attach as `routerSignalUpdatedAt` on each device. Reused the same single-query sims join pattern that already existed for `routerRssi`. Customer `listDevices` previously had no sims join at all — added one.

**Frontend**
- `client/src/pages/admin/DevicesPage.tsx`: when `connectionStatus` is `flapping` OR `unstable`, compute the verdict and render `verdict.label` ("Router/cellular outage", "PowerMon offline", or "PowerMon-side flap") instead of the raw "Flapping"/"Unstable" pill. Color: powermon_offline → orange, outage + flap → red. Tooltip carries the full explanation. Falls back to the original label + color when liveness data is missing so we never lose information.
- `client/src/components/FleetTable.tsx`: extended the WifiOff icon to trigger on `unstable` as well as `flapping`, and the tooltip now reads "`{verdict.label} — {verdict.tooltip}`" instead of the generic "Flapping (repeated instant disconnects)". Icon color matches the bucket (orange for PowerMon offline, red otherwise).
- `client/src/lib/api.ts`: extended `LegacyTruckWithDevice` with `deviceLastReportedAt` + `deviceRouterSignalUpdatedAt`, populated in `useLegacyTrucks` from the customer devices response.
- `client/src/lib/admin-api.ts`: extended `DeviceWithSnapshot` with `routerSignalUpdatedAt`.

**Expected after deploy** (based on the prod values from Task #25 verification):
- DCL-Carter → orange "Router/cellular outage" pill (router stale 30m, PowerMon silent 6+ days)
- DCL-Radian-1 → orange "PowerMon offline" pill (router fresh 0m, PowerMon silent ~7 days)
- DCL-Radian-2 → red "PowerMon-side flap" pill (router fresh 1m, PowerMon recent 17m)

No schema or migration needed — both fields already exist (`sims.router_signal_updated_at`, `power_mon_devices.last_reported_at`).

**Follow-up — Data Status sort fix:** the `/admin/devices` "Data Status" column sort was keying on the raw `dataStatus` DB column, but the pill text follows a render-priority chain (verdict → probing → offline → disconnected → dataStatus). That meant a "Router/cellular outage" row sorted by its underlying `dataStatus` ("no data"/"stale") and interleaved with genuine "No data" rows. Added a module-level `getDataStatusLabel(device)` in `DevicesPage.tsx` that returns the exact displayed pill text, and the sort now keys on that so identical pills group together.

---

## Latest Updates (May 28, 2026)

### FLAPPING DIAGNOSTIC verdict matrix (Task #25)
- **Why**: The previous verdict ternary in `connection-pool.js` (the line that fires from `logger.warn('FLAPPING DIAGNOSTIC', …)` when the circuit breaker opens) decided "PowerMon issue vs network issue" based purely on whether the InHand applink TCP-pings and how old the GPS update is. Two recent real-world failures showed the limit of that:
  1. **DCL-Epler** (PowerMon-W fw 1.35): router on inverter, inverter switched off; router was briefly TCP-pingable during a momentary inverter check, so the verdict came back "PowerMon-side firmware/RF/USB issue" when the truth was "everything off." Wasted operator triage time.
  2. **DCL-Moeck-Shop** (PowerMon-E fw 1.4): router healthy, cellular signal strong, but PowerMon silent 23+ h — a genuine firmware wedge. Same generic "PowerMon-side issue" verdict regardless of how long the silence had lasted, so long-term degradation went unflagged.
- **What changed** (`device-manager/app/connection-pool.js` + `device-manager/app/database.js`):
  - New DB helper `db.getDeviceLivenessSnapshot(deviceId, truckId)` returns `{ powerMonLastReportedAt, routerSignalUpdatedAt }` in a single query (joins `power_mon_devices` with the freshest `sims.router_signal_updated_at` for the truck's SIMs — multi-SIM trucks take the max).
  - New module-level helper `classifyFlappingVerdict(routerSignalMinutesAgo, lastReportedMinutesAgo)` implements a three-bucket matrix:
    - Router fresh (<10 min) AND PowerMon recent (<6 h) → `PowerMon-side flap — actively connecting + failing (likely firmware/RF/USB)`
    - Router fresh AND PowerMon stale → `PowerMon offline — verify physically (powered off OR firmware-wedged)`
    - Router stale (or unknown) → `Router/cellular outage — truck unreachable`
  - This works honestly only because Task #24 made `router_signal_updated_at` trustworthy (it now only advances when InHand reports the router online).
- **FLAPPING DIAGNOSTIC log line** now carries two extra fields — `routerSignalMinutesAgo` and `lastReportedMinutesAgo` — plus the new verdict string. `routerReachable`, `gpsLastUpdate`, `gpsAgeMinutes`, `gpsLocation` are kept for backwards-compatible log parsing.
- **Supervisor CLI mirror**: `_probeFlappingDevices` `[still off]` line uses the same verdict via the same helper, so operators see consistent wording in both surfaces. Router ping is kept as a small `(applink ping OK/FAIL)` tail note for log parity but no longer drives the wording.
- **Expected verdicts on current production state** after deploy:
  - DCL-Carter (router off, PowerMon off ~6+ days) → `Router/cellular outage — truck unreachable`
  - DCL-Moeck-Shop (if it flaps again — router on, PowerMon silent 23 h) → `PowerMon offline — verify physically`
  - DCL-Moeck (router on, PowerMon actively flapping) → `PowerMon-side flap`
- **Scope**: pure JS change, no schema/migration. After `sudo systemctl restart device-manager`, the next breaker trip on any device will emit the new format.

### InHand poller — trust router-online state (Task #24)
- **Symptom**: DCL-Carter (id=5, truck CTR-69) was physically powered off for 6+ days (batteries dead, parked indoors, no shore power, router LED off — confirmed visually by Andy). Database showed `router_rssi = -87 dBm` with `router_signal_updated_at = 26 seconds ago`. The data was being fabricated by our InHand poller on every cycle.
- **Root cause** (`device-manager/app/inhand-poller.js`): the matched-SIM update block unconditionally wrote `router_signal_updated_at = NOW()` plus whatever RSSI value `_extractRssi()` returned, regardless of `device.online`. InHand's bulk `/api/devices?verbose=100` response retains last-known-good signal fields for offline routers (the cloud's own caching), so we kept stamping the cached value as fresh truth. The per-device `/signal` enrichment in `_enrichSignalFromPerDevice` already gated correctly on `online === 1`, but the bulk-path write did not.
- **Why this matters beyond cosmetics**: any diagnostic that uses `router_signal_updated_at` as proxy for "router currently alive" inherits the lie. Specifically blocked Task #25's FLAPPING DIAGNOSTIC verdict matrix, which needs an honest router-alive signal to distinguish "PowerMon powered off" from "PowerMon firmware-wedged" — the exact distinction we missed on DCL-Epler earlier this month.
- **Fix**: gated the SIM signal write on `device.online === 1`. When online: write RSSI + bump `router_signal_updated_at` (existing behavior). When offline (or `online` field missing — conservative treats undefined as offline): clear `router_rssi` to NULL so the UI's SignalCell renders `—`, but leave `router_signal_updated_at` untouched so the freshness clock continues to reflect the last moment we genuinely knew the router was up. The NULL write is guarded by `WHERE router_rssi IS NOT NULL` to avoid pointless updates on already-cleared rows. Also added `simsOnline` / `simsOffline` counters to the `InHand poll complete` log line so the new behavior is verifiable from journalctl without DB queries.
- **Expected verification after deploy**: `sudo systemctl restart device-manager`, then within one poll cycle (~2 min):
  - DCL-Carter's `router_signal_updated_at` stops advancing; `router_rssi` becomes NULL on the next poll cycle.
  - DCL-Moeck and DCL-Moeck-Shop (powered bench units) continue to advance their freshness timestamp every ~2 minutes as before.
  - `journalctl -u device-manager | grep "InHand poll complete" | tail -3` shows the new `simsOnline` and `simsOffline` fields broken out.
- **Scope**: pure JS change in `device-manager/app/inhand-poller.js`. No schema change, no native rebuild. Unblocks Task #25.

## Latest Updates (May 25, 2026)

### PowerMon-E fw 1.4 flap-cascade fix — instant threshold + firmware-close cooldown
- **Symptom**: GFR-69 (DCL-Moeck, deviceId=3) and GFR-70 (DCL-Moeck-Shop, deviceId=20), both PowerMon-E fw 1.4, both bench units 25' apart in Spokane on constant power, repeatedly tripped the circuit breaker. GFR-69 tripped 3× in 23h; GFR-70 tripped 2× and got stuck in the supervisor's `[5,15,60,240]` solo-probe ladder, showing "No data" on the dashboard for hours.
- **Diagnosis**: 23h of journalctl on GFR-69 revealed an extremely consistent pattern — a long stable session (200-1700 seconds, `hadSuccessfulPoll=true`) ends with `reason=2`, then the next 1-2 reconnect attempts within ~1 second each get `reason=2 connDurationMs=2-3ms` (firmware accepts the TCP socket then immediately closes it), then the device successfully reconnects on the 3rd-4th attempt. Out of 28 reason=2 events on GFR-69 in the window, only 3 escalated to breaker trips — 25 self-recovered. The 2-instants-trips-breaker rule was eating self-healing devices. **This is normal PowerMon-E fw 1.4 behavior, not a fault** — the firmware's session state needs ~1-3 seconds to clear after a close.
- **Patch A (raise instant threshold)** — `connection-pool.js`: added `INSTANT_DISCONNECTS_TO_OPEN_CIRCUIT = 3` constant and changed the breaker condition from `>= 2` to `>= INSTANT_DISCONNECTS_TO_OPEN_CIRCUIT`. Every cascade observed in the 23h dataset had exactly 2 instants then recovered, so this retroactively predicts 0 breaker trips on GFR-69. A genuinely dead device (the field unit DCL-Radian-1 gets *continuous* 2-5ms instants forever) still trips on the 3rd instant within milliseconds. Pre-trip early-warning logs now fire for each instant 1..N-1 instead of only #1, so visibility is unchanged.
- **Patch B (firmware-close cooldown)** — `connection-pool.js`: added `POST_FIRMWARE_CLOSE_DELAY_MS = 2000` constant and a `firmwareClosedAfterSession` flag, set in `onDisconnect` when `reason === 2 && connDurationMs >= FLAPPING_INSTANT_THRESHOLD_MS` (i.e., the firmware closed a real session, not an instant reject). `scheduleReconnect` consumes the flag one-shot to apply a 2s delay before the next attempt — long enough for the device's session state to clear. Cleared on successful poll alongside `hadRecentPollFailure`. This is the *prevention* (stop the cascade from starting); Patch A is the *safety net* (don't trip the breaker if it does).
- **Scope**: Pure JS change in `device-manager/app/connection-pool.js`. No native rebuild needed — just `sudo systemctl restart device-manager` after deploy.
- **Verification after deploy**: Within an hour or two, `journalctl -u device-manager | grep "Using firmware-close cooldown delay"` should show occurrences on PowerMon-E devices. Breaker trips for GFR-69/GFR-70 should drop to ~0. DCL-Radian-1 should still trip the breaker normally (its 100% instant-reject pattern is unaffected — we just give it one extra instant before tripping).

## Latest Updates (May 24, 2026)

### libpowermon version-string BCD decode fix
- **Symptom**: `getLibraryVersion().string` reported `"1.32"` in prod even though the deployed Thornwave tag is `v1.20`. Same quirk silently affected firmware strings whose minor byte happens to encode a nibble ≥ 0xA (none observed yet, but PowerMon-E firmware `1.10` would have shown as `1.16`).
- **Root cause**: Thornwave packs the version as `(major_bcd << 8) | minor_bcd`. The wrapper printed the low byte as plain decimal, so `0x20` came out as `32` instead of BCD-decoding to `20`.
- **Fix**: Added `bcdByteToInt()` helper in both `src/powermon_wrapper.cpp` and `src/powermon_bridge.cpp`. Applied to `GetLibraryVersion`, `DeviceInfoToObject` firmware string, `cmd_version`, and `device_info_to_json` firmware string. `firmwareVersionBcd` (raw uint16) is unchanged for callers that decode themselves.
- **Verification on deploy**: `node -e "console.log(require('./build/Release/powermon_addon.node').PowermonDevice.getLibraryVersion().string)"` should print `1.20` (was `1.32`). PowerMon-E firmware logs should continue to show `1.4` (0x04 BCD → 4 decimal, unchanged for low values).
- **Scope**: Cosmetic — no behavioral change to polling or reconnection. README + version history updated.

### `recoverDisconnectedDevices` v2.1 — drop the lastConnectedAt floor
- **Symptom**: Andy left v2 running overnight without restarting. By 8 AM only 4 of ~16 active devices were "Reporting" (Curtis-2, Thibert, KTR, Kruse). Roughly 12 devices clustered around `Last Reported = 4:59–5:12 PM` the previous day and never came back. Re-arm fired hundreds of times overnight, yet none of those devices recovered. GFR-70 (Moeck-Shop) — the very device v2 had recovered at 22:25:37 — was back to "No data" with last report 9:44 PM.
- **Root cause**: line 1416 of `recoverDisconnectedDevices` used `referenceTime = max(lastSuccessfulPollAt, lastConnectedAt)` as the staleness anchor. The original intent was "don't false-positive on a brand-new connection that hasn't taken its first poll yet". The actual effect was an **infinite re-arm loop with no real recovery**: when a device hits the silent-stall failure mode, `conn.connect()` typically succeeds at the TCP/native layer — the native lib reports "connected" and `onConnect` (line 270) sets `lastConnectedAt = Date.now()` — but the device then produces zero polls (which is exactly the failure we're trying to detect). The `max()` reset the staleness clock to 0 on every re-arm, so we'd "successfully recover" the device every 5 minutes forever while the dashboard sat on "No data" all night.
- **Fix** (`device-manager/app/connection-pool.js` ~line 1411): split the cases:
  - If the device has **ever** polled successfully (`lastSuccessfulPollAt > 0`): only that timestamp counts. A fresh connect that doesn't produce polls is the failure mode, not a reason to extend grace. Threshold stays at 5 min.
  - If the device has **never** polled (genuinely new connection): grace 60 s after `lastConnectedAt`, then treat as stalled. 60 s is generous — healthy devices poll within ~10 s of connect.
- **Why the previous "verification" passed**: the 22:25:37 re-arm of GFR-70 *did* recover it for real (we saw 8 ms recovery in the log). That was the lucky case where the new connect actually produced polls. The failure mode I missed is when connect succeeds but polls don't follow — then the max() bug masks the perpetual failure as "fixed every 5 min" forever.
- **Verification plan**: push → `sudo systemctl restart device-manager` → within 10 min every device with a live router should return to "Reporting"; re-arm log lines should show `reason=silent_stall stalledForMs=<large>` followed by a real poll log line within seconds (not just another re-arm 5 min later for the same device).
- **Cosmetic fix bundled in**: the `Re-arming stalled devices` log line previously printed `devices=[object Object]` because our pretty-print logger calls `toString()` on object values. Wrapped the device list in `JSON.stringify(...)` so the diagnostic is actually readable.

## Latest Updates (May 21, 2026)

### `recoverDisconnectedDevices` v2 — liveness-based, not budget-based (SUPERSEDED by v2.1 on May 22)
- **Why v2**: v1 (May 20) only re-armed devices that had `reconnectAttempts >= maxReconnectAttempts`. The 19h of production logs after deploy proved that filter was too narrow:
  - **GFR-69 (DCL-Moeck)**: hit poll-timeout at 22:15:30 UTC May 20, then went totally silent for 19h. The per-poll 8s watchdog calls `disconnect(false) + scheduleReconnect()` — next tick reconnects successfully and the `onConnect` handler resets `reconnectAttempts` to 0. Poll times out again. Loop never accumulates budget exhaustion, so v1's filter never triggered. Dashboard showed "Stale" since 3:14 PM the previous day.
  - **GFR-70 (DCL-Moeck-Shop)**: instant-disconnected at 21:52:58 (connectionDurationMs=2), got flagged `flapping`, supervisor took over via solo-probe, then disappeared from logs entirely. Stranded in a half-handoff state — not in the cohort's active polling, not in the skip list, not recovered.
  - Both routers were online (Router Sig -81 dBm in InHand) the entire time. Pure PowerMon-side stall.
- **Fix** (`device-manager/app/connection-pool.js`): rewrote `recoverDisconnectedDevices` to check `lastSuccessfulPollAt` instead of `reconnectAttempts`. New criterion: if `max(lastSuccessfulPollAt, lastConnectedAt)` is older than 5 min, force a hard reset — `disconnect(true)` to cleanly null out the native device, wait 250 ms for the async native onDisconnect callback to drain, clear `reconnectTimer` / `reconnectAttempts` / `consecutiveFailures` / `hadRecentPollFailure`, then call `connect()` fresh. Still preserves the budget-exhausted branch as a secondary trigger (defense-in-depth for the clean-prolonged-outage case).
- **Race avoidance**: deliberately do NOT clear `intentionalDisconnect` ourselves — `onDisconnect` clears it on its own (connection-pool.js line 303). If we cleared it synchronously the late native callback would see `wasIntentional=false`, take the error path, increment `rapidDisconnectCount`, and call `scheduleReconnect()` alongside our own in-flight `connect()` — could cascade into spurious flapping. The 250 ms settle lets the callback land first with `wasIntentional=true` and take the safe path.
- **Why 5 min staleness threshold**: healthy devices poll every ~10 s, so `lastSuccessfulPollAt` updates near-continuously. 5 min without a successful poll is unambiguous "this is broken". Brand-new connections that haven't yet taken their first poll are protected by the `referenceTime > 0` guard.
- **Still skipped**: `intentionalDisconnect` (admin-disabled) and `isCircuitOpen` (flapping/unstable — supervisor solo-probe owns those; stealing them back would race the probe worker).
- **Loop cadence unchanged**: 5 min in `worker.js`. Worst-case recovery time = ~10 min (5 min to become stale + 5 min until next loop tick).
- **Verification plan**: deploy → `sudo systemctl restart device-manager` → expect any device currently in "Stale" with router online to come back to "Reporting" within 10 min, and see `Re-arming stalled devices` log lines with `reason=silent_stall`.

## Latest Updates (May 20, 2026)

### Auto-recover devices stuck in `disconnected` after extended power loss (v1 — superseded by May 21 entry)
- **Symptom**: Andy powered off the DCL-Moeck-Shop (GFR-70) router to test offline behavior. The dashboard correctly showed "No data" within a couple of minutes. When he plugged the router back in ~5 min later, the dashboard never returned to "Reporting" without intervention.
- **Root cause**: `connection-pool.js` `scheduleReconnect()` uses exponential backoff (1s → 2s → 4s → 8s → 16s, capped at 60s) and gives up after `maxReconnectAttempts` (5). A router off for more than ~30 s burns through all 5 attempts in the first half-minute and logs `Max reconnect attempts reached`. Nothing in the supervisor re-arms a plain `disconnected` device — the solo-probe loop only handles `flapping`/`unstable`. Result: a single brief power loss left the device dead until `sudo systemctl restart device-manager`.
- **Fix** (`device-manager/app/connection-pool.js`, `device-manager/app/worker.js`):
  - New method `recoverDisconnectedDevices()` on `connectionPool`. Scans `this.connections` in-process for entries that are not `connected`/`connecting`, not `intentionalDisconnect`, not circuit-broken (flapping/unstable have their own recovery), and have `reconnectAttempts >= maxReconnectAttempts`. For each: clears the pending timer, resets `reconnectAttempts` to 0, clears `hadRecentPollFailure`, calls `connect()`. On success the device returns to `online` (the existing success handler at line 269 zeroes out state). On failure the normal backoff ladder restarts from attempt 0 and we re-arm again 5 min later.
  - Wired into `worker.js` as a 5-minute `setInterval` next to the existing `recoverUnstableDevices` interval.
- **Why in-process (worker) instead of supervisor**: the DeviceConnection objects live inside the worker — the supervisor can't directly mutate `reconnectAttempts`. The flapping/unstable recovery uses fork-a-probe-worker because those devices are quarantined OUT of the regular pool; plain disconnected devices never leave the pool, so we just kick them where they live. Zero IPC, zero new processes.
- **Cadence**: 5 min. A real dead router gets retried 12 times/hour with one TCP connect each — negligible. A device that comes back gets noticed in ≤5 min, polled immediately after the next tick, and visible as `Reporting` on `/admin/devices` within ~1 poll cycle.
- **Verification plan**: deploy → restart device-manager once to load the new code → power-cycle a test router with >30 s off-time → expect "Reporting" within 5 min with no service restart.

### Per-device "Refresh SIM from Wireless Logic" admin action
- **Symptom**: DCL-Carter's physical InHand router was replaced in the field. The new router shows up in InHand fine, but `/admin/devices` "Router Sig" column stayed at `--` for the truck. Diagnostic SQL on prod showed the `sims` row for DCL-Carter still carried the **old** SIM identifiers (ICCID `894446...4616283`, MSISDN `883190603400853`); the new router carries MSISDN `883190603657509`. The InHand poller matches by `iccid`/`imsi`/`msisdn`/`device_name`, none of which lined up, so the new router landed in the unmatched-devices warning every poll cycle.
- **Root cause**: there was no operator-facing path to re-pull the new SIM identifiers from Wireless Logic into our `sims` row after a router swap. The periodic SIMPro sync only refreshes `data_used_mb` / `last_location_update` on existing rows (loose helper) — it never replaces `iccid`/`msisdn`/`imsi`. The original Task #21 strict registration path bound a SIM at create time, but didn't cover the "swap the physical SIM under an existing device" lifecycle.
- **Fix**: new admin endpoint `POST /api/v1/admin/devices/:id/refresh-sim` and a small Refresh icon on each row of `/admin/devices` (rotating arrow between the offline/online toggle and the trash icon). The endpoint reuses the existing `simProClient.getSimByDeviceName()` strict-single helper and the same structured error codes as registration:
  - `SIM_NOT_FOUND` → "set Custom Field 1 on the new SIM in Wireless Logic, then retry"
  - `SIM_MULTIPLE_MATCH` → "clean up duplicates in Wireless Logic first"
  - `SIM_ALREADY_LINKED` (409) → "this ICCID is already linked to device #N; detach in Wireless Logic console first" — same no-silent-steal rule as registration
- **ICCID-drift handling** (the whole point of this endpoint): runs in a single transaction with three cases:
  1. A `sims` row already exists with the **new** ICCID (typical when the periodic sync already saw the new SIM) → update that row in place with `deviceId` + all identifiers; if a *different* row was the current `sims` row for this device, null its `deviceId`/`truckId` so we don't dangle two rows per device. The old row is kept (not deleted) for historical `data_used_mb` continuity.
  2. No row exists with the new ICCID, but there IS a current `sims` row for this device → overwrite that row in place with the new ICCID + identifiers.
  3. No current row and no new-ICCID row → fresh insert.
  When the ICCID actually drifted, the endpoint clears `routerRssi` + `routerSignalUpdatedAt` on the active row so the UI shows `--` until the next InHand poll (~2 min) repopulates from the new router.
- **UI**: result dialog shows a before/after diff (ICCID/MSISDN/IMSI) with the "after" panel highlighted when the ICCID changed, plus a hint that signal will populate within ~2 min. Toast on structured errors (no need to keep a dialog open — there's no form to preserve).
- **Operator playbook for DCL-Carter (once deployed)**:
  1. Confirm in Wireless Logic that the new SIM has `Custom Field 1 = DCL-Carter`.
  2. Open `/admin/devices`, find the DCL-Carter row, click the rotating-arrow icon.
  3. Expect the dialog to show the ICCID changed from `894446...4616283` → new value, MSISDN changes to `883190603657509`.
  4. Wait ~2 min, refresh `/admin/devices`, "Router Sig" populates.
- **Files**:
  - `server/api/admin-routes.ts` — new `POST /devices/:id/refresh-sim` route (~190 lines).
  - `client/src/lib/admin-api.ts` — `RefreshSimResult` type + `useRefreshDeviceSim` hook.
  - `client/src/pages/admin/DevicesPage.tsx` — refresh icon per row + result dialog.
  - `replit.md` — Device Registration section updated with the swap-SIM lifecycle.
  - `DEVELOPMENT_LOG.md` — this entry.
- **Sync hardening (caught in code review)**: the periodic SIMPro sync used to reassign `deviceId`/`truckId` on every existing-row UPDATE from a `custom_field1` name match. That would have silently re-linked the row we intentionally detached during a refresh (the old SIM is typically still active in Wireless Logic with the same Custom Field 1 for a while), reverting the swap on the next sync tick. Patched `server/services/sim-sync-service.ts` to preserve `existingSim.deviceId`/`truckId` in the UPDATE branch — sync now only freshens SIMPro-side fields on existing rows. The fresh-insert branch still auto-links by name so first-time SIMs continue to wire themselves up; registration / refresh-sim / backfill remain the authoritative re-link paths once a row exists.
- **Out of scope**: bulk "refresh all SIMs" button (the existing Backfill SIM Links button already covers devices that have no `sims` row at all — refresh is for devices that DO have a row but it's stale).

### Phase 1 hotfix — per-poll hard timeout in the scheduler
- **Symptom**: 2 hrs after Phase 1 deploy, prod logs (us-east-2) showed most cohort workers (PIDs 382654 / 382668 / 382669 = cohorts 1, 5, 6) connect to their devices, fetch device info, then sit for ~39 s with `hadSuccessfulPoll=false` before reason=2 disconnect — over and over. Cohort 4 (KTR-01, Elite-Hospitality) polled cleanly every 10 s. UI showed most devices as "No Data".
- **Root cause**: `polling-scheduler.js` `pollDevice()` awaited `conn.poll()` with no timeout. PowerMon's native lib uses a callback-based API (`device.getMonitorData(cb)`); on PowerMon-W firmware 1.35 the callback can silently never fire after a successful TCP connect, so the Promise wrapping it never resolves. `Promise.allSettled` in `processTick` blocked forever, and the `finally { scheduleTick() }` never ran — freezing that cohort's scheduler. Every stuck device in the log was PowerMon-W 1.35; the working cohort was PowerMon-E 1.4. Pre-Phase-1 the worker's `process.exit(1)` defense was incidentally acting as a watchdog (worker died → supervisor respawned → poll loop restarted). Removing exit removed the watchdog.
- **Fix** (`device-manager/app/polling-scheduler.js`, `pollDevice`): `Promise.race` against an 8 s timeout (<10 s tick). On timeout: log, call `conn.disconnect(false)` to tear down the native session, call `conn.scheduleReconnect()` so the next tick picks it back up, return null. Scheduler tick completes normally, other cohort siblings keep polling, and the timed-out device reconnects fresh.
- **Files**: `device-manager/app/polling-scheduler.js` only. No DB migration, no web-app change, no schema change.
- **Verification plan**: deploy → `sudo systemctl restart device-manager` → tail journalctl for ~5 min → expect `Poll timed out` warnings for any PowerMon-W 1.35 device that hits the firmware bug, followed by clean reconnect + successful poll on the next tick. /admin/devices "Reporting"/"No Data" badges should normalize within 1–2 minutes.

---

## Latest Updates (May 14, 2026)

### Phase 1 — Honest connection-state taxonomy + drop process.exit defense
- **What changed**: rewrote the rapid-disconnect circuit-breaker so it (a) uses causally-honest state names that reflect what we actually observed and (b) no longer kills the worker process. The old design used `no_power` and `weak_signal` as if we knew the root cause was power loss or cellular RF — we never did. We only ever observed "the connection won't stay up". The whole "global C++ corruption → SIGABRT → must exit(1)" defense was investigated against 30+ days of production journal logs (us-east-2 device-manager EC2): **zero SIGABRT, zero SIGSEGV, zero core dumps**. Every "crash" in that window was our own `process.exit(1)` firing inside the circuit breaker. The defense was solving a problem that doesn't exist; meanwhile it was nuking healthy cohort-mates whenever any one device flapped.
- **State machine**:
  | New state | Trigger | Persisted? |
  |---|---|---|
  | `flapping` | ≥2 instant disconnects (<200 ms) | yes — until probe recovers |
  | `unstable` | ≥3 rapid (<5 s, none instant) disconnects | yes — same TTL/recovery as flapping |
  | `probing` | solo probe worker is currently testing the device | yes (transient) |
  | `offline` | admin-initiated only | yes |
  | `online` / `connected` / `disconnected` / `connecting` | normal poll lifecycle | yes |
  
  **Removed**: `no_power` (renamed → `flapping`), `weak_signal` (collapsed; we still log the 1st instant-disconnect as an early-warning, but no longer write any DB state for it — it auto-clears the moment the next poll succeeds, with zero schema noise).
- **Files (device-manager)**:
  - `connection-pool.js` — constants `NO_POWER_*` → `FLAPPING_*`. Circuit breaker block: dropped `nativeLibraryShutdown=true` set, dropped the loop that nulled `device` on every other pool member, dropped the `setTimeout(process.exit(1), 3000)`. Kept `nativeLibraryShutdown` flag declaration + the read-side guards as cheap defense-in-depth (if a real abort ever fires, the guards still bail before touching native state). Renamed `recoverNoPowerDevices()` → `recoverFlappingDevices()`. `WEAK_SIGNAL` / `NO_POWER` log-prefixes → `FLAPPING DIAGNOSTIC`. The 1st instant-disconnect early-warning is now log-only (no DB write, no `markDeviceWeakSignal` call).
  - `database.js` — dropped `markDeviceWeakSignal()` entirely. `markDeviceUnstable(id, status)` accepts `'unstable' | 'flapping'` (was `'unstable' | 'no_power'`). Renamed `getNoPowerDevicesReadyForRecovery()` → `getFlappingDevicesReadyForRecovery()`. SQL `IN (…)` lists, the `markDeviceDisconnected` `CASE` block (also dropped the `weak_signal` branch — anything that wasn't `unstable`/`offline`/`flapping` becomes `disconnected`), startupRecoverySweep doc comment, and module exports all updated.
  - `supervisor.js` — `_probeNoPowerDevices()` → `_probeFlappingDevices()`. `NO_POWER_QUARANTINE_MS` → `FLAPPING_QUARANTINE_MS`. Probe-failure SQL writes `connection_status='flapping'`. `_logSkippedDevices` SELECTs the new state name and the per-row TTL hint reads from the same column.
  - `worker.js` — solo-probe doc comment + the timeout-path `markDeviceUnstable(…, 'flapping')` call.
  - `index.js` — periodic `recoverFlappingDevices()` invocation.
- **Files (web app)**:
  - `client/src/pages/admin/DevicesPage.tsx` — `/admin/devices` Connection column now renders a single red "Flapping" badge (with hover-title explaining "repeated near-instant disconnects — device isolated to a solo probe") instead of separate "No Power" + "Weak Signal" badges. The "Reset Status" button condition matches the new state.
  - `client/src/components/FleetTable.tsx` — fleet truck list shows a single red `WifiOff` icon with tooltip "Flapping (repeated instant disconnects)" instead of separate weak-signal/no-power icons.
  - `server/services/exports/admin-devices-cell-builder.ts` — `circuit_breaker_state` derivation maps `flapping` → `flapping_quarantine` (was `no_power_quarantine`). Comment updated.
  - `shared/export-admin-devices.ts` + `server/services/exports/admin-types.ts` — comments now reference the new taxonomy.
- **Database migration**: `scripts/migrations/2026-05-14_rename_connection_states.{sh,sql}` — single `UPDATE power_mon_devices SET connection_status='flapping' WHERE connection_status IN ('no_power','weak_signal')`. Idempotent (re-run is a no-op). Uses the standard SSM `send-command` pattern from the 2026-05-07 router-rssi script. Run from MacBook Pro (`/Users/amoeck/Development/Fleet-manager/scripts/migrations/2026-05-14_rename_connection_states.sh`).
- **Why no `process.exit(1)`**: even *if* native corruption were real, killing the entire cohort worker (5–10 healthy devices) because one device flaps is the wrong blast radius. The supervisor already has solo-probe machinery — that's the right unit of isolation. The bad device gets its native ref nulled, its DB state set to `flapping`, and 5 minutes later a one-process-one-device probe attempts recovery. Zero impact on healthy devices in the same cohort.
- **Out of scope (intentionally)**: rewriting the alerting layer (no DB state for `flapping` already covers the "alert fires" case identically to old `no_power`); changing the 200 ms instant-disconnect threshold; tweaking the 5-minute quarantine. Phase 2 will add operator-facing observability (e.g. surfacing the `FLAPPING DIAGNOSTIC` verdict in the admin UI) once we have a few weeks of real flapping data with the new taxonomy.
- **Deploy + post-deploy steps for prod**:
  1. Push to `main` → GitHub Actions deploys ECS web app + device-manager EC2.
  2. From MacBook Pro, run the migration script. Confirm the printed row counts show zero `no_power` / `weak_signal` rows after.
  3. Watch the device-manager journal for `FLAPPING DIAGNOSTIC` log lines on the next flap event — the `verdict` field replaces what used to be the `NO_POWER DIAGNOSTIC` line. Worker should NOT exit/respawn anymore.
- **Files**: `device-manager/app/{connection-pool.js,database.js,supervisor.js,worker.js,index.js}`, `client/src/pages/admin/DevicesPage.tsx`, `client/src/components/FleetTable.tsx`, `server/services/exports/admin-devices-cell-builder.ts`, `server/services/exports/admin-types.ts`, `shared/export-admin-devices.ts`, `scripts/migrations/2026-05-14_rename_connection_states.{sh,sql}`, `replit.md`.

---

### Task #21 — Link SIM at device registration (synchronous, fail-loud)
- **What changed**: SIM linkage no longer relies on the periodic SIMPro sync + InHand poller match-by-iccid race. The admin "Register Device" flow now performs a strict, synchronous Wireless Logic lookup before creating the device row, and a one-time "Backfill SIM Links" button repairs any existing fleet members that are unlinked.
  1. **`server/services/simpro-client.ts`** — added `getSimByDeviceName(deviceName)` strict-single helper returning a discriminated `{ kind: 'none' | 'one' | 'multiple' }` result. The loose `getSimsByDeviceName` is kept as-is so the periodic sync (`sim-sync-service.ts`) continues to behave the same.
  2. **`server/api/admin-routes.ts` — `POST /api/v1/admin/organizations/:orgId/devices`** now: (a) requires `deviceName` (returns `code: DEVICE_NAME_REQUIRED` with 400 otherwise), (b) creates the SIMPro client (503 `SIMPRO_NOT_CONFIGURED` if missing creds), (c) calls `getSimByDeviceName`, (d) returns 400 `SIM_NOT_FOUND` (with the searched name in the message) or 400 `SIM_MULTIPLE_MATCH` (with count), (e) on the single-match happy path runs `db.transaction` containing the device insert + a `sims` upsert keyed on `iccid` (`onConflictDoUpdate`) so the device row and its SIM are committed atomically. SIMPro API errors surface as 502 `SIMPRO_LOOKUP_FAILED`.
  2a. **Hard guard against silent SIM theft.** Both registration and backfill pre-check `sims` by `iccid` before any write: if a row already exists with `device_id` set to a *different* device, registration returns 409 `SIM_ALREADY_LINKED` (operator must detach in Wireless Logic first or pick a different name), and backfill records the entry under a `failed_already_linked` bucket and skips. Existing rows with `device_id IS NULL` (created by the periodic SIMPro sync) are safe to claim and get an in-place `UPDATE`. Brand-new ICCIDs get `INSERT`. This replaces the original `onConflictDoUpdate` which would have silently overwritten a SIM's `device_id` if the operator typed a name that collided with another truck's ICCID. The success response also returns `{ sim, message }` so the toast can confirm the linkage explicitly (`"Device registered – Linked to SIM ICCID … (MSISDN …)"`).
  3. **`server/api/admin-routes.ts` — new `POST /api/v1/admin/devices/backfill-sim-links`** — `adminMiddleware`-gated, idempotent. Selects every `power_mon_devices` row that has no `sims` row pointing at it (left-join + `IS NULL`), runs the same strict-single lookup sequentially per device (so we don't hammer Wireless Logic), upserts the matching SIM, and returns a per-bucket summary `{ scanned, linked, skipped_no_name[], failed_no_match[], failed_multiple_match[], failed_api_error[] }`. Never overwrites an existing SIM link.
  4. **`device-manager/app/inhand-poller.js`** — added `device_name` as a 4th match key after `iccid`/`imsi`/`msisdn`. The SQL pre-filter now also includes `LOWER(s.device_name) = ANY($4)` and the in-process map `simsByDeviceName` falls through to a case-insensitive lookup on `device.deviceName`. Pure belt-and-suspenders — once registration enforces linkage at create time this rarely fires, but it cleanly catches existing legacy devices.
  5. **`client/src/lib/admin-api.ts`** — introduced `AdminApiError` subclass that preserves the server's structured `code` (so the form can branch on `SIM_NOT_FOUND` / `SIM_MULTIPLE_MATCH` instead of brittle string-matching). Added `useBackfillSimLinks` hook returning the typed summary.
  6. **`client/src/pages/admin/DevicesPage.tsx`** — Device Name field is now visually required (`*` + helper text "Must match Custom Field 1 of an existing SIM in Wireless Logic"). Failed registration with one of the three structured codes keeps the dialog open and renders an inline destructive alert near the top with code-aware heading + the server's message — operator can fix the name and retry without re-entering battery specs. New "Backfill SIM Links" outline button in the page header (next to Register Device) triggers the backfill mutation; the result lands in a summary dialog showing scanned/linked counts plus the per-bucket failure lists so the operator knows exactly which devices to fix in Wireless Logic.
- **Why this approach**: silent failure was the real problem (GFR-69 / TRK-02 went days without router-sig before anyone noticed). Synchronous, structured-error-coded validation at create time means misalignment surfaces immediately to the operator who has the context to fix it. The transaction guarantees we never end up with a device row that has no SIM mate. The poller fallback + backfill button give us a clean migration path without needing a manual SQL session.
- **Out of scope (intentionally)**: editing/replacing a SIM on an existing device (still a manual DB fix), provisioning SIMs in Wireless Logic from our app (Wireless Logic remains source of truth), and the periodic SIMPro sync stays unchanged as the freshener for `data_used_mb`/`last_location_update`.
- **Schema migration**: none required — `sims.device_name` already exists. No new tables, no new columns.
- **Deploy + post-deploy steps for prod**:
  1. Push to `main` → GitHub Actions deploys ECS web app.
  2. Open `/admin/devices` as a platform admin, click **Backfill SIM Links**.
  3. Read the summary dialog: `linked` should cover GFR-69 / TRK-02; anything in `failed_no_match` or `failed_multiple_match` is an actual data hygiene problem in Wireless Logic to fix.
  4. Within one InHand poll cycle (~2 min) confirm Router Sig populates on the affected rows.
- **Files**: `server/services/simpro-client.ts`, `server/api/admin-routes.ts`, `device-manager/app/inhand-poller.js`, `client/src/lib/admin-api.ts`, `client/src/pages/admin/DevicesPage.tsx`, `replit.md`.

---

## Latest Updates (May 13, 2026)

### Fixed: InHand router signal pipeline (URL flip + per-device endpoint + ASU classification)
- **What changed**: production InHand router signal data now actually populates `sims.router_rssi`. Three coordinated fixes:
  1. **Migration `scripts/migrations/2026-05-13_fix_inhand_baseurl.sh`** flips the EC2 env var `INHAND_API_BASE_URL` from `https://na.inhandcloud.com` (DNS-dead globally — `getaddrinfo ENOTFOUND` in journalctl) to `https://iot.inhandnetworks.com` (the global URL listed in the InHand Device Manager API doc, confirmed reachable by the laptop probe). Sed-replaces the one line inside the existing sentinel-bracketed managed block in `/opt/device-manager/start.sh`, restarts the service via SSM, then waits 140 s and checks journalctl + `SELECT COUNT(*) FILTER (WHERE router_rssi IS NOT NULL) FROM sims`. Idempotent.
  2. **`device-manager/app/inhand-poller.js` now hits the per-device signal endpoint.** Bulk `/api/devices?verbose=100` does not carry signal for IR302 (probe confirmed 52/52 devices online but 0 with signal in the bulk payload). After the bulk fetch we call `GET /api/devices/{_id}/signal?begin=<5min ago>&end=<now>` for every online device with a Mongo `_id`, take the last `[time, asu]` value, skip 99, convert via `dBm = -113 + 2*asu`, and override the bulk-extracted rssi. Concurrency capped at 10 in-flight via chunked `Promise.all`. Per-device failures log at debug and don't sink the batch. New `inhandClient.getDeviceSignal(deviceId, beginIso, endIso)` wraps the endpoint (ISO 8601 timestamps per the API doc's "General agreement" section) and returns `{ time, asu } | null`.
  3. **`info.rssi` reclassified as ASU, not dBm.** Per the InHand API doc (line 306 of `attached_assets/Device_Manager_API_-en_1778694184895.pdf`): *"info.rssi — Equipment signal strength value in asu"*. Previously `_extractRssi` tried `info.rssi` first as a dBm candidate, which silently produced garbage like `+10 dBm` for the example payload `info.rssi: 10`. Moved `info.rssi` from the dBm-first list to the ASU/CSQ list in both `inhand-poller.js::_extractRssi` AND `scripts/probe/inhand_signal_probe.sh` (both the per-row jq and the summary jq). The probe's `DEFAULT_BASE_URL` also flipped to `https://iot.inhandnetworks.com` to match production.
- **Why per-device, not just-fix-the-bulk**: the bulk endpoint genuinely doesn't carry the signal field for IR302 firmware — the API doc shows `info.rssi` as the bulk field but in practice it's null/missing for our routers. The per-device `/signal` endpoint is the only path that returns signal for our fleet. The bulk extraction stays as a fallback for any router model where `info.rssi` does come back populated.
- **Concurrency**: 52 routers / 10 in-flight = 6 chunks per poll cycle. At ~200 ms each that's ~1.2 s of extra latency per 2-minute poll — well within budget.
- **Out of scope**: schema unchanged (`sims.router_rssi` + `sims.router_signal_updated_at` already exist from the May 7 migration); no DB migration needed. UI unchanged — `/admin/devices` "Router Sig" column reads the same column. The Mongo `_id` is opaque to us; we just pass it through from the bulk response.
- **Verification path**: probe (`scripts/probe/inhand_signal_probe.sh`) now defaults to `iot.inhandnetworks.com` so re-running it confirms the auth flow without needing a fallback. After the migration, `journalctl -u device-manager` should stop emitting `ENOTFOUND` and start emitting `InHand poll complete { simsRssiUpdated: ~52, ... }`. The DB spot-check inside the migration prints the live count.

---

## Latest Updates (May 8, 2026)

### Added: Standalone InHand signal-strength probe script (laptop diagnostic)
- **What changed**: new `scripts/probe/inhand_signal_probe.sh` — a zero-side-effect bash script that authenticates against InHand from a laptop and prints per-device cellular signal data. Created because the production credential wiring (yesterday's `2026-05-08_wire_inhand_creds_into_device_manager.sh`) ran clean but the in-script DB verification step came back empty, and we want to prove the API actually returns signal before chasing more infra.
- **What it does**:
  1. Prompts for `INHAND_API_USERNAME` (visible) and `INHAND_API_PASSWORD` (hidden, no echo) plus an optional base-URL override (defaults to `https://na.inhandcloud.com`).
  2. Authenticates via `POST /oauth2/access_token` using the same OAuth2 password-grant flow as `device-manager/app/inhand-client.js` — MD5-hashed password, `password_type=2`, hardcoded `client_id`/`client_secret` lifted verbatim from the client. If NA auth fails, the script offers a one-shot interactive retry against the alternate region `https://iot.inhandnetworks.com`.
  3. Paginates through `GET /api/devices?verbose=100` (cursor + limit, defensive 1000-page guard) and aggregates all pages **in memory** into a single bash JSON variable — no temp files, no disk writes.
  4. For every device, prints a tab-separated row: name, serialNumber, online, msisdn, iccid, lat, lng, **the raw signal field name + value that matched** (e.g. `info.signalLevel=24` or `device.rssi=-83`), and the **normalized dBm**. Tries dBm fields first (`device.rssi`, `info.rssi`, `info.signalStrength`, `device.signalStrength`), then CSQ candidates (`info.signalLevel`, `info.csq`, `device.signalLevel`, `info.signal`) via `dBm = -113 + 2*csq`, skipping CSQ=99 — exactly mirroring `inhand-poller.js::_extractRssi`.
  5. Ends with a summary: `N devices total, M with signal data, signal data found in field(s): <list>`.
- **Why print the raw field name**: the open question is which field these specific InHand router models actually populate (dBm vs CSQ), which is the same ambiguity the `_extractRssi` fallback chain absorbs. Surfacing the matched field tells us at a glance.
- **Failure mode**: any non-2xx HTTP response or non-JSON body prints the status code + first 500 chars of the body and exits non-zero. No stack traces, no infinite spinners.
- **Dependencies**: macOS-only stack — `bash`, `curl`, `jq`, plus any of `md5`/`md5sum`/`python3` for password hashing. No npm, no AWS CLI, no SSM, no DB. **Zero disk writes** — pagination state lives in a bash variable, jq reads via heredoc.
- **Mirroring nuance**: jq's `tonumber` is stricter than JS `parseFloat`/`parseInt`, so the script defines `parse_float` / `parse_int` helpers that accept a leading numeric prefix (e.g. `"-83 dBm"`, `"24 bars"`) — exactly what production's `_extractRssi` does via `parseFloat`/`parseInt`. Without this, the probe would silently report "no signal" where production would extract a valid value.
- **Out of scope (intentional)**: does not modify the production poller, EC2, or Secrets Manager. Does not persist results, generate CSV, or reconcile devices to truck records — `_extractIdentifiers`/MSISDN matching already lives in the poller. Does not handle refresh tokens (one auth call → done). Does not get added to the device-manager bundle, CI, or any cron.
- **How to run**: `cd /Users/amoeck/Development/Fleet-manager && ./scripts/probe/inhand_signal_probe.sh`. Pipe through `column -t -s$'\t'` for a pretty table.
- **Why `https://na.inhandcloud.com` is the default** (not the `inhand-client.js`/`config.js` default `https://iot.inhandnetworks.com`): the production migration scripts (`2026-02-10_add_inhand_gps_poller.sh`, `2026-05-08_wire_inhand_creds_into_device_manager.sh`) both pin the NA region — the dev default is a known mismatch we explicitly do not want to chase.

---

## Latest Updates (May 7, 2026)

### Added: Router signal column on /admin/devices (InHand cellular RSSI)
- **What changed**: `/admin/devices` now has a second sortable, color-coded "Router Sig" column next to the existing PowerMon "PM Sig" column. Both cells reuse the shared `<SignalCell>` (-XX dBm, green/amber/red bands, "—" for null/sentinel, hover tooltip with quality label).
- **Where the data comes from**: the InHand poller (`device-manager/app/inhand-poller.js`) now extracts cellular signal on every poll and persists it to two new columns on `sims`:
  - `router_rssi` (integer, dBm)
  - `router_signal_updated_at` (timestamp — bumped on every poll, even when InHand omits a signal field, so freshness is observable)
- **InHand field handling**: `_extractRssi(device)` tries dBm fields first (`device.rssi`, `info.rssi`, `info.signalStrength`, `device.signalStrength`) accepting any negative value in (-200, 0). Falls back to CSQ scale (0–31, with 99 = "no signal") via `info.signalLevel | info.csq | device.signalLevel | info.signal` and converts using the standard `dBm = -113 + 2 * csq`. Returns null when nothing matches; the UI shows "—".
- **Poller refactor**: previously the loop only collected devices that had BOTH GPS and identifiers, so signal-only devices were silently dropped. Now we collect every device with at least one identifier (msisdn/iccid/imsi), update `sims.router_rssi` for every match, and only do the truck-side GPS update when coords are present AND a truck is assigned. New log line: `InHand poll complete { totalDevices, devicesWithIds, simsMatched, simsRssiUpdated, trucksUpdated, ... }`.
- **API**: `storage.listAllDevicesWithSnapshots()` and `storage.listDevicesWithSnapshots(orgId)` now do a parallel `select` from `sims` keyed by `device_id` and return `routerRssi: number | null` on each row. `DeviceWithSnapshot` (in `client/src/lib/admin-api.ts`) is the canonical type and now carries `routerRssi`.
- **Migration**: production needs the new sims columns before the deploy goes live. Runnable script per the standing convention:
  - `scripts/migrations/2026-05-07_add_router_rssi_to_sims.sh` (SSM → EC2 → psql via Secrets Manager)
  - `scripts/migrations/2026-05-07_add_router_rssi_to_sims.sql` (`ADD COLUMN IF NOT EXISTS` for both columns + a verification SELECT). Idempotent, safe to re-run.
- **Renamed header**: the existing PowerMon RSSI column header on `/admin/devices` changed from "Signal" to "PM Sig" so the two columns are unambiguous side-by-side.
- **Out of scope (intentional)**: customer-side `FleetTable` is not touched — its 3-sub-table layout needs a width rebalance and that's a follow-up. Admin device-registry CSV/Excel export is also not extended yet (RSSI column there still refers to PowerMon `device_snapshots.rssi`).

---

## Latest Updates (May 5, 2026)

### Removed: per-device export icon and top "Export" button on /admin/devices
- **What changed**: removed the per-row Download icon and the top-right "Export" button from `/admin/devices`. Deleted the now-unused `client/src/components/AdminExportDialog.tsx` and `client/src/components/AdminTruckHistoryExportDialog.tsx`.
- **Why**: after using both surfaces in production the team preferred the consolidated `/admin/export` page (device-registry export + per-truck historical export + recent-exports table in one place). The per-row icon's "Assign a truck to enable history export" disabled state was clunky, and the duplicate top-button was redundant with the dedicated page.
- **Where to export now**: `/admin/export` (linked from the admin sidebar). Backend route (`POST /api/admin/exports` with discriminated `kind: 'devices' | 'historical'`), worker, S3 layout (`exports/admin/<jobId>/...`), email pipeline, and concurrency accounting are all unchanged — only the two entry-point UIs on `/admin/devices` were removed. Earlier `DEVELOPMENT_LOG.md` entries describing those entry points should be read as historical.

### Bug fix: exports failing with "The specified bucket does not exist"
- **Symptom**: with the SQL fixes in place, the export worker now generated the file successfully but blew up at the S3 upload step with `The specified bucket does not exist`.
- **Root cause**: production never set `S3_BUCKET_NAME` on the ECS task definition, so `server/aws/s3.ts` fell back to its hardcoded dev default `deecell-fleet-files` — which doesn't exist in the prod account. Terraform actually creates the production bucket as `${name_prefix}-assets-${unique_suffix}` (e.g. `deecell-fleet-production-assets-XXXXXXXX`) and `aws_iam_role_policy.ecs_task` already grants the task role read/write/list to it (`terraform/iam.tf` L120, L129). The wiring just stopped at Terraform — the env var was never added to `terraform/ecs.tf`'s `environment = [...]` block.
- **Fix (Terraform parity)**: added `S3_BUCKET_NAME = aws_s3_bucket.assets.bucket` and `AWS_REGION = var.aws_region` to the ECS container's `environment` block in `terraform/ecs.tf` so future `terraform apply` runs stay aligned.
- **Fix (applied to prod)**: shipped a targeted ECS-only script `scripts/migrations/2026-05-05_set_ecs_s3_bucket_env.sh` to avoid running a full `terraform apply` (which can surface unrelated drift on a long-lived stack). The script:
  1. Discovers the actual bucket via `aws s3api list-buckets` (matches `deecell-fleet-production-assets-*`; fails fast on 0 or >1 matches).
  2. Pulls the current ECS task definition JSON.
  3. Idempotently injects `S3_BUCKET_NAME` + `AWS_REGION` (no-op if already correct).
  4. Registers a new task revision and rolls the `deecell-fleet` service.
  5. Prints both the rollout-watch command and the explicit rollback command (`aws ecs update-service --task-definition <previous-arn>`) so revert is one paste away.
  Reversible, scoped to ECS only, no other infra touched. Next `terraform apply` will be a no-op for this since both sides match.
- **No DB migration**.

### Bug fix: historical exports failing with DISTINCT ON / ORDER BY mismatch
- **Symptom**: after the prod migration added `sim_location_history.truck_id`, historical exports advanced past aggregation but then died with `SELECT DISTINCT ON expressions must match initial ORDER BY expressions`.
- **Root cause**: same parameter-vs-literal trap as the earlier GROUP BY fix, but in the per-bucket position query (`server/db-storage.ts` ~L1759). `${truncUnit}` was used three times — DISTINCT ON, SELECT, ORDER BY — and Drizzle emitted a fresh `$N` placeholder for each. Postgres requires the DISTINCT ON expressions to textually match the leading ORDER BY expressions, which `date_trunc($1, …)` and `date_trunc($N, …)` don't.
- **Fix**: hoisted `const truncUnitLit = sql.raw(\`'${truncUnit}'\`)` once and reused that fragment everywhere in the position query, so all three occurrences emit identical `date_trunc('day', recorded_at)` text. Same safety justification as before — `truncUnit` is a hard-narrowed enum.
- **No production migration**: code-only fix.

### Bug fix: historical exports failing with `column "truck_id" does not exist`
- **Symptom**: after the GROUP BY fix shipped, historical exports got further but then died on the per-bucket position lookup with `column "truck_id" does not exist`.
- **Root cause**: schema drift. `shared/schema.ts` (L491-L512) has had `truck_id` on `sim_location_history` for a long time, but it was never migrated to production — only dev's `db:push` got it. The historical export query filters `WHERE organization_id = … AND truck_id = … AND recorded_at BETWEEN …`, which detonates against the prod table.
- **Fix**: new migration script `scripts/migrations/2026-05-05_add_sim_location_truck_id.{sh,sql}`. Adds the column with `ON DELETE SET NULL` (matches Drizzle), backfills `truck_id` from the owning SIM's current assignment (`UPDATE sim_location_history slh SET truck_id = s.truck_id FROM sims s WHERE slh.sim_id = s.id AND slh.truck_id IS NULL AND s.truck_id IS NOT NULL`), and adds a composite index `(organization_id, truck_id, recorded_at)` so the export query stays fast. Idempotent via `IF NOT EXISTS`. Run with the standard SSM→EC2→psql flow from MacBook Pro.
- **No code change required**: the application already references `truck_id` correctly via the schema; this is purely a prod-DB-catch-up.
- **Index divergence note**: the new `sim_location_truck_time_idx` exists in production but not in `shared/schema.ts`. Filed follow-up to reflect it back in the schema so dev parity is restored.

### Bug fix: historical exports failing with GROUP BY error
- **Symptom**: after deploying the snake_case fix, historical exports started actually running but immediately died with `column "device_measurements.recorded_at" must appear in the GROUP BY clause or be used in an aggregate function`.
- **Root cause**: in `getTruckHistoryAggregated` (`server/db-storage.ts` ~L1689) the `bucketCol` chunk was `sql\`date_trunc(${truncUnit}, ${deviceMeasurements.recordedAt})\``. Drizzle treats `${truncUnit}` as a parameter, and when the same `bucketCol` is reused in both SELECT and GROUP BY it emits a fresh `$N` placeholder for each occurrence. Postgres sees `date_trunc($1, recorded_at)` in SELECT and `date_trunc($N, recorded_at)` in GROUP BY as different expressions, so it can't match them and throws.
- **Fix**: inline `truncUnit` as a SQL literal via `sql.raw(\`'${truncUnit}'\`)`. `truncUnit` is hard-narrowed to the enum `"minute" | "hour" | "day"` immediately above (zod-validated upstream at the route), so there's no SQL injection surface. Now SELECT and GROUP BY emit identical `date_trunc('day', …)` text and Postgres groups them correctly.
- **No production migration**: code-only fix.

### Bug fix: historical exports failing with "missing required fields"
- **Symptom**: every historical export (customer + admin) failed instantly with `Historical export job is missing required fields (truckId, startTime, endTime, intervalSeconds)` even though the POST handler correctly persisted all four fields. Surfaced today on the new per-device admin export icon, but the bug affected all historical exports.
- **Root cause**: `claimNextPendingExportJob` in `server/db-storage.ts` was using raw `db.execute(sql\`UPDATE … RETURNING *\`)` with a TypeScript cast to `ExportJob`. The cast was lying — Postgres returned snake_case column names (`historical_interval_seconds`, `historical_truck_id`, `historical_start_time`, `historical_end_time`), not Drizzle's camelCase. The worker then read `job.historicalIntervalSeconds` and got `undefined` on every claim, hitting the validation guard before the generator ran.
- **Fix**: rewrote the claim to go through Drizzle's typed query builder (`db.update(exportJobs).set(...).where(sql\`id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)\`).returning()`). Drizzle now handles the column-name mapping, so the returned row matches `ExportJob` for real. `FOR UPDATE SKIP LOCKED` semantics preserved via the inner subquery — multiple worker instances behind the ALB still won't double-claim a row.
- **No production migration**: code-only fix.
- **Why it slipped through dev**: dev never has multiple historical jobs queued, and the in-process worker often picks rows up via the `nudge()` path which… also calls `claimNextPendingExportJob`, so this should have repro'd. It likely did once or twice (see commit `5b1edfe Fix recurring crashes caused by missing export job data` from May 4) but was misdiagnosed as a missing-column issue. Filed follow-up to add a real integration test for the worker claim → process loop.

### Per-device truck-history export icon on /admin/devices
- **What shipped**: Added a per-row Download icon to the actions column on `/admin/devices`. Click it on a device that's assigned to a truck and a compact dialog opens pre-seeded to that truck — admin picks range / granularity / format / opt-in email and the worker enqueues an `admin_historical` export through the existing pipeline. On unassigned devices the button is disabled with a tooltip "Assign a truck to enable history export".
- **Frontend**:
  - `client/src/components/AdminTruckHistoryExportDialog.tsx` (new) — small dialog (Range preset Last 24h/7d/30d/90d/1y, granularity radio, format CSV/XLSX, "Email me when ready" default-OFF, live row estimate with 600k cap warning). Submits via the existing `useCreateAdminExport` hook with `kind: "historical"`.
  - `client/src/pages/admin/DevicesPage.tsx` — new Download icon button (blue) inserted between the connection-status (Reset/Offline) action and the Delete action. Disabled-when-no-truck. Resolves `truckNumber` via the existing `allTrucks` lookup and `organizationName` via `organizations`. Mounts the dialog at the bottom alongside the existing `AdminExportDialog`.
- **Backend**: nothing new — admin export pipeline already supports `kind: "historical"` (see "Admin Export Soft Launch" in replit.md). Job is owned by the synthetic Deecell admin user (concurrency + email lookup); target customer org rides on `filters.organizationId`.
- **Notifications**: respects the global opt-in email contract — defaults to OFF, surfaces in the admin `ExportsBanner` immediately, only emails the admin if the box is ticked.
- **No production migration**: pure UI wiring on top of the already-deployed admin export endpoint and `kind` column.
- **Why**: admins were having to log into the customer's account just to grab one truck's history file. The icon shaves that to one click on the device row they were already looking at, attributed to the admin who triggered it (audit trail intact).

### Resend invitation: rescue users + admins whose 7-day token expired
- **What changed**: Added a "resend invitation" action to both the `/admin/users` table and the Manage Platform Admins panel. Previously, if a user (or admin) didn't accept their invitation within 7 days, the only fix was a manual SQL insert into `invitation_tokens`. Now an admin clicks the small Send icon next to "Never" in the Last Login column and a fresh 7-day invitation email goes out.
- **Backend** (`server/api/admin-routes.ts`):
  - `POST /api/v1/admin/organizations/:orgId/users/:userId/resend-invitation` — `adminMiddleware`-gated, scoped to one org's users.
  - `POST /api/v1/admin/platform-admins/:id/resend-invitation` — `platformAdminMiddleware`-gated, mirrors the customer-side endpoint for users in `deecell-internal`.
  - Both share a single `mintAndSendInvitation()` helper that mints `nanoid(32)`, inserts into `invitation_tokens` with `expires_at = now + 7 days`, then calls `sendInvitationEmail(...)`. Old superseded tokens stay in the table — `accept-invitation` already filters by `expires_at > now AND used_at IS NULL` so they're harmless.
  - **Eligibility**: 400 if `password_hash IS NOT NULL` ("user has already accepted — use Reset password instead"). Prevents accidentally clobbering a real account into invitation purgatory.
  - **Email config**: 503 if `!isEmailConfigured()`, 502 if SendGrid returns `false` (and the cooldown is rolled back so the admin can immediately retry).
  - **Cooldown**: in-memory `Map<userId, lastSentAt>`, 60s per user_id, returns 429 with seconds-remaining message. Process-local — fine for single-Fargate-task; a noisy double-click just gets a 429 instead of two emails.
- **Frontend** (`client/src/pages/admin/UsersPage.tsx`, `client/src/lib/admin-api.ts`):
  - New hooks `useResendUserInvitation(orgId)` and `useResendPlatformAdminInvitation()` — both POST to the new endpoints, invalidate the relevant lists on success.
  - Org users table: `Send` icon button (`h-6 w-6`) shown next to "Never" in Last Login when `!user.passwordHash && user.email`. `e.stopPropagation()` so it doesn't trigger row-level handlers.
  - Manage Platform Admins panel: same `Send` icon, placed left of the existing Trash button, shown only when `!admin.hasPassword`. Self-row continues to render "You" with no actions.
  - Toasts: "Invitation resent — New 7-day invitation emailed to <email>" on success; surfaces server error message on failure (cooldown 429, missing email config, etc).
- **No production migration**: reuses the existing `invitation_tokens` table from `2026-01-20_add_invitation_tokens.sh`. Nothing to run on the prod DB.
- **Why**: every few weeks a customer admin would email asking why a new driver couldn't log in, and the answer was always "their token expired, I'll re-issue one manually." This closes the loop in the UI and removes the operational drag without changing the underlying invitation contract.

### Export pipeline: opt-in email notifications (drop email default everywhere)
- **What changed**: Email notifications are now opt-in for ALL export types — customer snapshot, customer historical, admin device-registry, admin truck-history. The recent-exports table + `ExportsBanner` are the default notification surfaces; users tick "Email me when ready" on the export form to additionally receive a SendGrid email.
- **Schema** (`shared/schema.ts`): added `notify_by_email BOOLEAN NOT NULL DEFAULT FALSE` to `export_jobs`. Default false matches the new product behavior — existing rows backfill to "no email".
- **Production migration** (`scripts/migrations/2026-05-05_add_export_notify_by_email.{sh,sql}`): runnable from MacBook (`cd /Users/amoeck/Development/Fleet-manager && ./scripts/migrations/2026-05-05_add_export_notify_by_email.sh`); idempotent ADD COLUMN IF NOT EXISTS via SSM → EC2 → psql.
- **Worker** (`server/services/exports/job-worker.ts`): both the success (`sendExportReadyEmail`) and failure (`sendExportFailedEmail`) paths now silently skip when `job.notifyByEmail === false`, logging `email skipped (notifyByEmail=false)`. Same flag gates both — symmetric with the user's choice on the form.
- **Routes**: customer (`server/api/exports-routes.ts`) and admin (`server/api/admin-exports-routes.ts`) accept `notifyByEmail: z.boolean().optional()` and persist `input.notifyByEmail ?? false`.
- **Frontend**: opt-in checkbox (default OFF) on every export form — `ExportDialog` (snapshot + historical), `AdminExportDialog` (`/admin/devices`), `ExportPage` `HistoricalForm` and `DevicesForm` (`/admin/export`). Toast copy switches between "We'll email you when ready" (toggle on) and "Track progress in the exports list" (toggle off). `ExportsBanner` pending-job subtitle changed from "We'll email you when it's ready" to "We'll update this banner when it's ready".
- **Why**: with the new persistent recent-exports table on `/admin/export` (and the always-visible `ExportsBanner`), an unconditional email was a third notification surface for the same event — extra noise + extra SendGrid dependency. Opt-in keeps the long-running "fire and forget" case (close the tab, get pinged hours later) covered without spamming everyone else. Customer + admin behavior stays symmetric.

---

## Previous Updates (May 4, 2026)

### Task #N: New /admin/export page (admin truck-history + device-registry exports)
- **What shipped**: New left-nav `/admin/export` page that combines the admin truck-history export and the existing admin device-registry export into one form, plus a recent-exports table that polls every 5s.
- **Frontend** (`client/src/pages/admin/ExportPage.tsx`): mode radio (Truck history / Device registry); historical form sequence org → truck → range preset (or custom dates) → granularity → format with live row estimate, 1-year-range warning, and 600k-row cap warning; devices form keeps the existing org+search+format inputs; recent-exports table with status badges, row/size columns, download links. Polling lives in `useAdminExportJobs(limit)` (TanStack Query, `refetchInterval: 5000`).
- **Backend** (`server/api/admin-exports-routes.ts`): `POST /api/admin/exports` switched from a single object schema to a discriminated Zod union (`kind: 'devices' | 'historical'`). Historical branch validates dates, enforces `HISTORICAL_MAX_RANGE_MS` (1 year) and `HISTORICAL_MAX_ROWS` (600k via `estimateHistoricalRows`), looks up org and `storage.getTruck(orgId, truckId)`, then enqueues a job with `kind = 'admin_historical'`. `GET /api/admin/exports` filters to admin kinds (`admin_devices`, `admin_historical`).
- **Worker** (`server/services/exports/job-worker.ts`): new `EXPORT_JOB_KIND.ADMIN_HISTORICAL` branch reads the target customer org from `filters.organizationId` (NOT `job.organizationId`, which stays as the admin's Deecell Internal org for concurrency caps + email lookup) and passes it into `generateHistoricalExport`. S3 keys land under `exports/admin/<jobId>/<filename>`. Email bundle label becomes `Admin Truck History (Hourly · Org: X · Truck T-104)`.
- **Schema** (`shared/schema.ts`): added `EXPORT_JOB_KIND.ADMIN_HISTORICAL = 'admin_historical'` and extended the `filters` jsonb type to include optional `truckNumber` for table labeling. **No DB column changes — `npm run db:push` not required.**
- **Backwards compat**: existing `/admin/devices` "Export" dialog now sends `kind: 'devices'` to satisfy the discriminated union; behavior is unchanged.
- **Code review**: passed — confirmed correct org-targeting semantics, guardrails, S3 segregation, and email labels.
- **Post-deploy bug + defensive hardening (May 4)**: After deploy, both admin truck-history exports and the device-registry export started failing with `Cannot read properties of undefined (reading 'columnKeys')`. Diagnosis traced to `shared/export-columns.ts:273` — when the worker fell through to the snapshot dispatcher with a `bundleKey` that isn't in `EXPORT_BUNDLES` (e.g. `"admin_historical"`), `bundle.columnKeys` threw the cryptic message above. Two hardening edits to `server/services/exports/job-worker.ts` make this self-diagnosing and prevent the regression:
  1. **Dispatch by `kind`, not just `historicalMode`** — the historical branch now also matches `jobKind === HISTORICAL || jobKind === ADMIN_HISTORICAL`. So even if the `historical_mode` boolean somehow comes back false (column missing, default fired, etc.), the new admin job kinds still route to the historical generator.
  2. **Defensive bundle guard in the snapshot fallthrough** — before calling `generateExport`, the worker checks `EXPORT_BUNDLES[job.bundleKey]` and throws a labelled error (`"Worker dispatched job N (kind=…, historicalMode=…) into the snapshot branch, but bundleKey=… is not a registered EXPORT_BUNDLES entry"`) instead of letting `resolveColumns` crash on `undefined`. Future dispatch mismatches surface with the actual job id, kind, and flag values in the error message.


### Incident: ECS task restart loop after first admin login (May 4, 2026)
- **Context**: Right after Andy completed his first platform-admin login (Task #8) and the admin dashboard rendered (17 orgs, 18 devices, 18 trucks, 14 users), every admin endpoint started returning 502/504, and shortly after the entire app at `app.deecell.com` went 502. Triaged from MacBook via AWS CLI.
- **Diagnosis**:
  - `aws ecs describe-services --cluster deecell-fleet-production-cluster --services deecell-fleet` showed `desired:1, pending:1, running:0` — the service was flapping between starts and drains.
  - `aws ecs describe-tasks` on two stopped tasks (`b08fb97f…`, `d195c19b…`) returned `stopCode: EssentialContainerExited`, `exitCode: 1`. Exit code 1 = Node unhandled error/explicit exit, **not** OOM (137).
  - `aws logs tail /ecs/deecell-fleet-production --since 15m` showed each task booted cleanly, served `/api/health` 200s for ~15 minutes, then died. **No admin requests appear in the logs immediately before the crash** — health checks are the only traffic visible. That points at a background job (exports worker, polling, or unhandled promise rejection) as the killer, not the admin endpoints themselves.
  - The `truck_history_truck_id_fkey` error in startup logs (`Key columns "truck_id" and "id" are of incompatible types: character varying and integer`) is a **pre-existing schema drift** from the legacy `initializeTables()` path. The server logs the error and continues past it (`serving on port 5000` lands on the next line), so it is not the cause of the restart loop.
- **Resolution (immediate)**: ECS auto-restart placed a healthy task (`45ff5d04…` at 20:32 UTC) and the site came back. Andy verified the admin dashboard loads.
- **Root cause (recurring crash)**: pulling the tail of the two stopped streams via `aws logs get-log-events --no-start-from-head` showed both tasks died on:
  ```
  /app/node_modules/pg-pool/index.js:45
        Error.captureStackTrace(err)
                  ^
  error: column "kind" does not exist
  ```
  That is `export_jobs.kind`, the discriminator column added by Task #5 (Admin Devices Export). The export worker polls `export_jobs` every ~15 min, the SELECT references `kind`, Postgres throws, the rejection bubbles past the worker into the Node process and trips `EssentialContainerExited` / `exit 1`. The pre-existing `2026-05-01_add_export_kind_column.sh` migration script had been written but never executed against prod — Task #5 was deployed on the assumption the column was already there.
- **Fix**: ran `./scripts/migrations/2026-05-01_add_export_kind_column.sh` from MacBook (SSM → device-manager EC2 → psql against `deecell-fleet-production/database-url`). `ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'snapshot'` succeeded; verification query confirmed `kind text 'snapshot'::text NOT NULL`. `SELECT kind, COUNT(*) FROM export_jobs GROUP BY kind` returned 0 rows (table was empty, no backfill needed). After this the worker poll stops crashing and the ECS task stays alive past the ~15-minute mark.
- **Hardening follow-up (deferred)**: add a top-level `process.on('unhandledRejection', ...)` handler in `server/index.ts` (or the exports worker boot file) that logs the full stack to stderr and then exits — so future crashes show up in CloudWatch with a real stack trace instead of a bare `exit 1` plus a fragmented chain of pg-pool frames. Also wrap the worker's poll loop in a try/catch so a single failed query does not take down the whole process.
- **Separately worth fixing (lower priority)**: the `truck_history_truck_id_fkey` startup error. The legacy `initializeTables()` in `server/db/init.ts` (or wherever `initializeTables` lives in `dist/index.js:2887`) is trying to add an FK from `truck_history.truck_id (varchar)` → `trucks.id (integer)`. Either the column type in `truck_history` should be `integer` to match `trucks.id`, or the FK should be dropped from the legacy init path entirely (Drizzle migrations are the source of truth now). Non-blocking — the server starts up despite the error — but it's noise in every boot log.

---

## Latest Updates (May 2, 2026)

### Hotfix: Device Manager deploy zip missing PowerMon SDK (May 2, 2026)
- **Context**: After the Device Manager EC2 was rebuilt fresh on Apr 29, the first run of the `Deploy Device Manager` GitHub Actions workflow failed during `npm rebuild` on the target instance. The native addon build crashed with `fatal error: powermon.h: No such file or directory`. Polling has been down for 3 days, blocking all dashboard data.
- **Root cause**: `device-manager/binding.gyp` references `<(module_root_dir)/libpowermon_bin/inc` (headers) and `<(module_root_dir)/libpowermon_bin/powermon_lib_pic.a` (static lib). The workflow's Package step copied `app/`, `lib/`, `src/`, `build/`, `package*.json`, `binding.gyp` — but never copied `libpowermon_bin/`. The previous EC2 instance presumably had a stale copy from an older deploy; the fresh box did not, so node-gyp blew up the moment it tried to find the header. The Ubuntu user-data already installs `libbluetooth-dev` and `libdbus-1-dev`, so system deps were never the issue.
- **Fix** (`.github/workflows/deploy-device-manager.yml`): added two lines to the Package step to ship `libpowermon_bin/inc/` and `libpowermon_bin/powermon_lib_pic.a` inside the zip. Total size add ≈ 650KB. The on-box `/opt/device-manager/deploy.sh` (`npm ci --only=production` then `npm rebuild`) is unchanged — it now succeeds because node-gyp finds the headers.
- **Recovery sequence**: push the workflow fix from Replit → run `Deploy Device Manager` (workflow_dispatch) → verify via `aws ssm send-command "systemctl status device-manager"` and `SELECT MAX(created_at) FROM device_data`.
- **Follow-ups (deferred until prod is back up)**:
  1. Auto-fire the deploy workflow on ASG instance launch (EventBridge rule on `EC2 Instance Launch Successful` + `aws events put-events` calling GitHub via repository_dispatch). Today nothing wires terraform-replaces-the-box to the deploy workflow.
  2. CloudWatch alarm: "no Device Manager logs for >10 min" via metric filter on the existing `/ec2/deecell-fleet-production/device-manager` log group → SNS → Andy. Would have paged him on Apr 29 instead of him noticing 3 days later.

---

## Latest Updates (May 1, 2026)

### Feature: Per-Admin Identity — Replace Shared `ADMIN_PASSWORD` (May 1, 2026)
- **Context**: Task #8. The admin login has historically been gated by a single shared `ADMIN_PASSWORD` secret, with no per-person attribution. Task #5 (Admin Devices Export) added a synthetic "Deecell Admin" user as a workaround so the async export pipeline had a `user_id` to attach jobs to. This task swaps that workaround for real per-admin identity: every platform admin is now a real `users` row with their own email and bcrypt password, gated by a new `is_platform_admin` boolean. Andy is seeded as the first admin and other admins are invited in-app.
- **What's new**:
  - **Schema (`shared/schema.ts`)**: added `is_platform_admin BOOLEAN NOT NULL DEFAULT false` to `users`. Insert/select Zod schemas pick it up automatically (no `omit`).
  - **Storage (`server/storage.ts` + `server/db-storage.ts`)**: new `IStorage.listPlatformAdmins(): Promise<User[]>` and `IStorage.ensureDeecellInternalSetup(): Promise<{ organization, andy }>`. The bootstrap is fully idempotent — it upserts the `Deecell Internal` org (slug `deecell-internal`) and seeds Andy (`andy@deecell.com`, `is_platform_admin=true`, `password_hash=NULL`) only if they don't exist. Andy's NULL password forces him through the existing `/forgot-password` reset flow on first login (SendGrid is already wired up), so we never ship a default plaintext credential. The legacy `ensureAdminUserAndOrg()` from Task #5 is **kept as-is** because historical `export_jobs.user_id` rows still reference the synthetic admin user — the new bootstrap runs alongside it.
  - **Backend auth (`server/api/admin-routes.ts`)**: replaced `adminMiddleware` with `platformAdminMiddleware`, which re-validates the user on every request (re-fetches `getUserById`, re-checks `isPlatformAdmin` and `isActive`, plus organization `isActive`) so a revoked admin loses access immediately without waiting for session expiry. Sets `req.userId`, `req.organizationId`, `req.userEmail`, `req.userName`. The legacy `adminMiddleware` symbol is re-exported as an alias of `platformAdminMiddleware` for back-compat with `admin-exports-routes.ts` etc. `POST /api/v1/admin/login` now takes `{email, password}`, looks up the user via `getUserByEmail`, verifies `bcrypt.compare(password, passwordHash)`, and gates on `isPlatformAdmin && isActive`. Generic 401 for unknown email / wrong password / non-admin to avoid email enumeration; explicit "Account not configured" 401 only when `passwordHash` is NULL (which prompts the forgot-password flow); explicit "Organization is inactive" 401 when the org is disabled. Session now stores `userId / organizationId / userEmail / userName / isPlatformAdmin`. `GET /api/v1/admin/session` returns `{isPlatformAdmin, email, name, isAdmin}` (the `isAdmin` alias keeps older clients happy). The shared `ADMIN_PASSWORD` is no longer read for login; it remains in `server/api/migration-routes.ts` (one-shot migration endpoint) and as a fallback for `SESSION_SECRET` only.
  - **Manage Admins endpoints (`server/api/admin-routes.ts`)**: new `GET /api/v1/admin/platform-admins` (list), `POST /api/v1/admin/platform-admins` (invite — creates a user with `isPlatformAdmin=true, passwordHash=NULL` then issues a nanoid invitation token via the existing invitation-token table so the new admin sets their own password), and `DELETE /api/v1/admin/platform-admins/:id` (revoke — clears `isPlatformAdmin` while leaving the user row intact for audit). Self-revoke is blocked with a 400 to prevent admins from accidentally locking themselves out.
  - **Bootstrap (`server/routes.ts`)**: moved `ensureDeecellInternalSetup()` out of the `if (rdsConnected)` branch so it runs against whatever Postgres `dbStorage` points at (local Replit DB in dev, RDS in prod), independent of the AWS RDS health check. Wrapped in try/catch so a missing column (e.g. before `db:push` runs) logs and continues without crashing the boot.
  - **Security hardening (architect review fixes)**:
    - **Sanitized DTO for `/platform-admins`** (`server/api/admin-routes.ts` — new `toPlatformAdminDto()`, `client/src/lib/admin-api.ts` — new `PlatformAdminDto` type): the list and invite endpoints used to return raw `User` objects, which include `passwordHash`. Now they emit `{id, email, name, firstName, lastName, role, isActive, isPlatformAdmin, organizationId, lastLoginAt, hasPassword}` and the UI keys off the boolean `hasPassword` for the "Active" vs "Pending invite" badge instead of seeing the bcrypt string itself. No bcrypt hash is ever sent to the client.
    - **Org-active re-check in `platformAdminMiddleware`**: the middleware now re-loads the user's organization on every request and returns 401 if it's deactivated, mirroring `tenantMiddleware`'s contract. Also re-pins `req.session.userId / organizationId` to the freshly loaded user so a downstream org migration is reflected immediately. Login already had a one-shot org check; this closes the gap for already-authenticated sessions.
    - **Deterministic admin email lookup**: replaced `getUserByEmailGlobal()` (which scans across all orgs and returns the first active row) with `getUserByEmail(deecellOrgId, email)` for both `/admin/login` and `POST /platform-admins`. The schema's UNIQUE key is `(email, organization_id)`, so a customer with the same email as an admin used to make global lookups nondeterministic; scoping to deecell-internal makes admin auth and invite both deterministic and prevents a customer-side row from being mis-identified as a platform admin.
  - **Admin exports (`server/api/admin-exports-routes.ts`)**: `getAdminIds()` now reads `req.session.userId / organizationId` directly — no more synthetic-user lookup per request.
  - **Frontend admin shell (`client/src/lib/admin-api.ts`)**: `AdminSession` shape is now `{authenticated, isPlatformAdmin, email, name, isAdmin}`. `useAdminLogin` payload is `{email, password}` (was `{password}`). New hooks: `usePlatformAdmins`, `useInvitePlatformAdmin`, `useRevokePlatformAdmin`. `client/src/pages/admin/AdminLogin.tsx` swaps the username field for an email field with email validation and adds a "Forgot password?" link. `client/src/components/AdminLayout.tsx` checks `isPlatformAdmin` for gating and renders "Signed in as <name or email>" in the sidebar footer.
  - **Manage Admins UI (`client/src/pages/admin/UsersPage.tsx`)**: new `<PlatformAdminsCard/>` panel (rendered after the page header) lists current platform admins with revoke buttons (with a confirm dialog and self-revoke disabled), and an Invite dialog that takes `{email, firstName, lastName}` and shows the resulting invitation link toast on success.
  - **Production migration (`scripts/migrations/2026-05-01_add_platform_admin.sh` + `.sql`)**: SSM → EC2 → psql runner script following the user's MacBook workflow (run from `/Users/amoeck/Development/Fleet-manager`). SQL is fully idempotent: `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin`, `INSERT INTO organizations ... ON CONFLICT (slug) DO NOTHING`, `INSERT INTO users ... WHERE NOT EXISTS`, plus an `UPDATE` drift-repair that re-flags Andy if he exists but his flag got cleared (e.g. accidental revoke before first login). Verification queries print the new column metadata and the full platform admin roster at the end.
- **Smoke test (dev)**:
  - `npm run db:push` → schema applied.
  - Workflow restart → boot logs show no errors; `ensureDeecellInternalSetup` succeeded (Andy row visible in `users` with `is_platform_admin=t, password_hash=NULL`).
  - `GET /api/v1/admin/session` → `{"isPlatformAdmin":false,"email":null,"name":null,"isAdmin":false}` (unauthenticated shape).
  - `POST /api/v1/admin/login {email:"andy@deecell.com",password:"wrong"}` → 401 `"Account not configured. Please use 'Forgot password?' to set up your password"` (correctly identifies Andy and routes him to the reset flow because his `password_hash` is NULL — exactly the intended first-login UX).
  - `GET /api/v1/admin/platform-admins` (no session) → 401 (route correctly gated).
- **Decisions / call-outs**:
  1. **Andy seeded with NULL password, not a default**: avoids ever shipping a plaintext credential in the migration script or in the codebase. First login goes through `/forgot-password` → SendGrid email → reset token → set password. Same flow that customers use.
  2. **`platformAdminMiddleware` re-validates per request**: chosen over a session-only check because revoking an admin needs to take effect immediately, not whenever their session happens to expire. The extra `getUserById` per admin request is fine at admin-traffic volumes.
  3. **`adminMiddleware` alias kept**: `admin-exports-routes.ts` and a couple of other admin route files still import the old name. Aliasing it to `platformAdminMiddleware` lets every admin surface inherit the new identity check with zero diff in those files.
  4. **`ensureAdminUserAndOrg` not deleted**: there are existing `export_jobs.user_id` rows that point at the synthetic Deecell Admin user from Task #5. Deleting that user would either FK-fail or require backfilling every old job. The synthetic user stays as a historical record and the new pipeline simply uses real admin `userId`s going forward.
- **Round 2 architect-review fixes (May 1, 2026)**:
  1. **Customer `/api/auth/login` no longer authenticates platform admins** (`server/api/auth-routes.ts`): added an explicit `isPlatformAdmin` check after the user lookup that rejects with `"Use admin login"` 401 — admins are forced to `/admin/login` regardless of which org their row lives in.
  2. **`platformAdminMiddleware` now writes identity onto the request object** (`server/api/admin-routes.ts`): sets `req.userId / req.organizationId / req.userEmail / req.userName` from the freshly re-validated user, mirroring `tenantMiddleware`'s contract. `server/api/admin-exports-routes.ts` `getAdminIds()` now reads `req.userId / req.organizationId` (with safe session fallback) so admin export jobs are attributed to the actual logged-in admin's `users.id` row instead of synthetic identity.
  3. **`ensureDeecellInternalSetup` now signals first-creation + bootstrap sends Andy's invitation email** (`server/storage.ts`, `server/db-storage.ts`, `server/routes.ts`): the storage method now returns `{ organizationId, andyUserId, andyJustCreated }`. When Andy is freshly INSERTed, the boot path mints a `nanoid` invitation token via `createInvitationToken` and calls `sendInvitationEmail`, mirroring the in-app invite flow. So admins don't need to discover the `/forgot-password` form — they get a one-click password-setup email automatically. Logs `[admin-bootstrap] Andy seed user invited; email sent=...` on success.
  4. **`as any` casts removed** (`server/api/admin-routes.ts`): the `updateUser` and `createUser` calls in the platform-admin endpoints no longer cast — `InsertUser` already includes `isPlatformAdmin` and `passwordHash` since neither is `omit`ed in `insertUserSchema`.
- **Round 3 architect-review fixes (May 1, 2026)**:
  1. **Customer login admin-rejection is deterministic across duplicate-email scenarios** (`server/api/auth-routes.ts`, `server/storage.ts`, `server/db-storage.ts`): the schema enforces `UNIQUE(email, organization_id)` only, so the same email could theoretically exist as both a customer row in one org and a platform-admin row in deecell-internal. Relying on `getUserByEmailGlobal()` (which returns the first matching active row with no ordering) made the gate nondeterministic. Added `getActivePlatformAdminByEmail(email)` to `IStorage` + `DbStorage` that queries for any active `isPlatformAdmin=true` row for the email, and customer login calls it as the first gate — if it returns a row, we 401 with "Use admin login" before even fetching the customer row.
- **Round 8 hotfix — invitation email URL (May 1, 2026)**:
  - User reported the invitation email link pointed at `http://localhost:5000/accept-invitation?token=...` and was unreachable.
  - Root cause: `server/services/email-service.ts` only switched `APP_URL` to `https://app.deecell.com` when `NODE_ENV === "production"`. The Replit dev workspace has SendGrid configured (it actually delivers real emails) but runs as non-production, so every link in every email pointed at unreachable `localhost`.
  - Fix: `APP_URL` now resolves in priority order — explicit `APP_URL` env var → `NODE_ENV=production` canonical URL → `REPLIT_DOMAINS` auto-detected dev workspace public URL → final localhost fallback. Production is unchanged; the dev workspace now emits links recipients can actually open.
  - Re-minted Andy's invitation token via the storage layer + `sendInvitationEmail` and confirmed delivery (`email sent = true`).
- **Round 7 architect-review fixes (May 1, 2026)** — final polish:
  1. **Session type augmentation consolidated** (`server/types/session.d.ts`, `server/api/admin-routes.ts`, `server/api/auth-routes.ts`): the two split `declare module "express-session"` blocks (one in admin-routes, one in auth-routes) are replaced by a single shared `.d.ts` file picked up via `tsconfig.json`'s `server/**/*` include. One source of truth for `userId`, `organizationId`, `userEmail`, `userName`, `isPlatformAdmin`, `adminEmail` — no more drift risk as fields are added.
  - **Re-smoke (round 7)**: `npx tsc --noEmit` clean for the touched files; admin login + session + platform-admin list all return correctly.
- **Round 6 architect-review fixes (May 1, 2026)** — non-blocking polish:
  1. **`listPlatformAdmins` scoped to deecell-internal org** (`server/db-storage.ts`): the storage method now `INNER JOIN organizations ON slug = 'deecell-internal'` so an accidental `is_platform_admin = true` row in a customer org never appears in the Manage Admins panel and is never treated as a real platform admin.
  2. **Promote-existing-user invite parity** (`server/api/admin-routes.ts`): when the `POST /platform-admins` invite endpoint promotes an existing deecell-internal user (e.g. revoked-then-re-invited), it now also mints an invitation token + sends the email if that user has `passwordHash IS NULL`. Previously they would have had to discover `/forgot-password` themselves. Returns `invitationEmailSent` in the response for symmetry with the new-user path.
  3. **SQL header comment + `replit.md` Authentication section synced to runtime truth**: SQL header now states the `.sh` wrapper sends the email immediately after SQL, with the app boot as an idempotent fallback. `replit.md` no longer claims `ADMIN_PASSWORD` is a SESSION_SECRET fallback (it isn't anymore) and now describes the migration script's email-sending step + boot fallback.
  - **Re-smoke (round 6)**: admin login + Manage Admins list endpoint return Andy from organizationId 11 (deecell-internal) only.
- **Round 5 validator fixes (May 1, 2026)** — final cutover requirements:
  1. **`ADMIN_PASSWORD` removed from session-secret fallback** (`server/routes.ts`): the session middleware now reads `SESSION_SECRET` only. In production, missing `SESSION_SECRET` throws at startup (fail-fast). In dev, a clearly-labelled insecure fallback string is used with a warning. `ADMIN_PASSWORD` no longer appears in any application code path — it lives only in `server/api/migration-routes.ts` (the one-shot `/api/migrate-database` gate).
  2. **Migration script sends Andy's invitation email itself** (`scripts/migrations/2026-05-01_add_platform_admin.sh`): the SSM payload now extends past the SQL execution to (a) check whether Andy needs an invite via SQL, (b) generate a 32-char URL-safe token via `openssl rand`, (c) INSERT it into `invitation_tokens` (7-day expiry) using parameterized psql, (d) resolve the SendGrid secret name via `aws secretsmanager list-secrets` (handles the Terraform `unique_suffix`), and (e) POST the "Accept Invitation" email to `https://api.sendgrid.com/v3/mail/send` with an HTML body that mirrors the in-app `sendInvitationEmail` template (same brand color, structure, and `${APP_URL}/accept-invitation?token=…` link). The step is gated on the same `(NULL password ∧ isPlatformAdmin ∧ no active invitation token)` predicate as the app boot, so re-runs after a successful first run skip SendGrid. App boot remains a no-op fallback.
  - **Re-smoke (round 5)**: `bash -n` passes, the Python payload generator produces JSON that round-trips cleanly (1.8 KB), admin login + session re-verified post-fix (`isPlatformAdmin: true`, `userId: 8`).
- **Round 4 architect-review fixes (May 1, 2026)** — restored migration semantics + made revoke durable:
  1. **SQL migration restores org + Andy seed** (`scripts/migrations/2026-05-01_add_platform_admin.{sh,sql}`): brought back `INSERT INTO organizations ... ON CONFLICT DO NOTHING` and `INSERT INTO users ... WHERE NOT EXISTS` for the Andy row (per the original task acceptance criteria). The deploy script now does the work the task spec requires; only the email-sending step remains in the app boot.
  2. **Bootstrap email gating refactored to `needsInvitation`** (`server/storage.ts`, `server/db-storage.ts`, `server/routes.ts`): `ensureDeecellInternalSetup` now returns `{ organizationId, andyUserId, andyJustCreated, needsInvitation }`. `needsInvitation` is true iff Andy currently exists, has `isPlatformAdmin=true`, has `passwordHash IS NULL`, AND has no unused/non-expired invitation token. This single condition handles both the dev path (app inserts Andy) and the prod path (SQL pre-inserts Andy, app boots, observes "needs invitation", mints token, emails). It is naturally idempotent across reboots — once a token is minted, the next boot sees the active token and skips re-sending.
  3. **`is_platform_admin` drift-repair removed** (`server/db-storage.ts` + SQL migration comment): the boot bootstrap no longer auto-re-flags Andy if `isPlatformAdmin` was cleared, and the SQL migration intentionally omits the corresponding `UPDATE`. Once an admin is revoked (UI or manual SQL), the revoke persists across every reboot and re-run of the migration. `needsInvitation` also short-circuits to false when Andy is revoked, so a revoked admin is never re-invited.
  - **Re-smoke (round 4)**: manual `UPDATE users SET is_platform_admin=false WHERE email='andy@deecell.com'` → restart → `SELECT` confirms `is_platform_admin=f` (revoke persists). Then `UPDATE ... SET is_platform_admin=true, password_hash=NULL` + clear invitation_tokens → restart → CloudWatch shows `[admin-bootstrap] Andy seed user invited; email sent=true`. Second consecutive restart shows zero bootstrap lines (active token present → idempotent skip).
- **Re-smoke test (after rounds 2 + 3)**:
  - `POST /api/v1/admin/login {email:"andy@deecell.com",password:"TestPass2026!"}` → 200 `{success, user:{id, email, name}}`.
  - `GET /api/v1/admin/platform-admins` (with admin session) → 200 sanitized DTO `{admins:[{id, email, name, …, hasPassword:true}]}` — no `passwordHash` field.
  - `POST /api/auth/login {email:"andy@deecell.com",password:"TestPass2026!"}` (correct password) → 401 `"Use admin login"`.
  - `POST /api/auth/login {email:"andy@deecell.com",password:"wrong"}` (wrong password) → 401 `"Use admin login"` — the deterministic admin-email gate fires before any password check, so admins cannot be probed via the customer endpoint.

---

### Feature: Admin Devices Export — Soft Launch (May 1, 2026)
- **Context**: Task #5 — extend the async export pipeline (worker + S3 + signed URLs + branded email + sticky banner) shipped for customers in Tasks #1–#4 to the admin side, starting with the `/admin/devices` registry. Admins can now export a 20-column device snapshot across one organization or all organizations, optionally narrowed by the page's search box. Same async UX (toast → sticky banner → emailed download link), same concurrency limits, but gated by `adminMiddleware` instead of `tenantMiddleware`.
- **What's new**:
  - **Synthetic admin identity (`server/storage.ts` + `server/db-storage.ts`)**: new `ensureAdminUserAndOrg()` idempotently creates a "Deecell Internal" organization (slug `deecell-internal`) and a "Deecell Admin" user inside it (email defaults to `process.env.ADMIN_NOTIFICATION_EMAIL ?? 'hello@deecell.com'`, role `admin`). `POST /api/v1/admin/login` calls it on every login and stashes `adminUserId` + `adminOrganizationId` in the session; `adminMiddleware` lazily backfills both for already-logged-in admins so nobody has to re-auth. The synthetic user/org are reused as `export_jobs.user_id` / `organization_id` so the existing per-user (3) and per-org (10) concurrency limits and `getUserById` email lookup work unmodified.
  - **Schema (`shared/schema.ts`)**: added `kind text NOT NULL DEFAULT 'snapshot'` to `export_jobs`. The worker switches on `kind` first (`'snapshot' | 'historical' | 'admin_devices'`); legacy rows backfill to `'snapshot'` via the column default and the existing `historical_mode` branch still wins for old historical rows. `filters` jsonb `$type` widened to also accept `{ organizationId, organizationName, searchQuery }` for admin jobs.
  - **Admin column registry (`shared/export-admin-devices.ts`)**: 20 columns grouped as Identity (5) → Hardware (3) → Connectivity (6) → Operations (3) → Worker / live (4). Connectivity adds an explicit `is_active` ("Credential Active") column sourced from `device_credentials.is_active` so admins can spot devices whose stored WiFi access key has been disabled even when the device is still online; Worker / live adds `rssi` (dBm) from `device_snapshots.rssi`. Reuses the same `ColumnDef` shape as the customer registry so CSV/Excel serializers stay registry-agnostic. Build date stays null (not currently stored); `circuit_breaker_state` is derived from the device manager's `connection_status` (`device-manager/app/database.js`) into the operator-facing taxonomy `healthy | no_power_quarantine | unstable_pending | offline` (no_power → no_power_quarantine, unstable → unstable_pending, offline / `markedOfflineAt` set → offline, else healthy).
  - **Storage (`server/db-storage.ts`)**: new `getAdminDevicesForExport({ organizationId?, searchQuery? })` joins `power_mon_devices`, `device_snapshots`, `sims`, `device_credentials`, `device_sync_status`, `trucks`, `fleets`, `organizations`. Search query matches across device name, serial, ICCID, MSISDN, truck number, and org name (case-insensitive). Returns null for missing relations.
  - **Cell builder + generator (`server/services/exports/admin-devices-cell-builder.ts`, `admin-devices-generator.ts`)**: per-column extractor table returning `RawCellValue`; own format helpers keyed on `ColumnFormat` so the admin bundle stays decoupled from snapshot/historical bundles. Filename pattern: `Deecell Admin Devices YYYY-MM-DD.{csv|xlsx}`. Includes a single-line filter summary row at the top of each file ("Org: Acme · Search: 'inhand'" or "All organizations").
  - **Worker dispatch (`server/services/exports/job-worker.ts`)**: branches on `job.kind` first — `'admin_devices'` calls the admin generator with `filters.{organizationId, searchQuery}`; the existing `historicalMode` and snapshot branches handle everything else. S3 key for admin jobs is `exports/admin/<jobId>/<filename>` (vs. the per-org `exports/<orgId>/<jobId>/<filename>` for customer jobs) so admin downloads are co-located and easy to lifecycle-rule separately.
  - **Email (`server/services/email-service.ts`)**: `sendExportReadyEmail` accepts an `admin: { orgName?, searchQuery? }` block; when present the summary table renders an "Admin export of devices for <orgName or 'all organizations'>" line plus the search-query echo. All admin fields are HTML-escaped before interpolation.
  - **Admin export routes (`server/api/admin-exports-routes.ts`, mounted at `/api/v1/admin/exports` in `server/routes.ts` BEFORE `/api/v1/admin` so the parent admin router doesn't swallow it)**: `POST /` (creates the job — body `{ format, organizationId?, searchQuery? }`), `GET /?active=true` (sticky banner feed), `GET /:id`, `PATCH /:id/dismiss`. All gated by `adminMiddleware` and read `adminUserId` + `adminOrganizationId` from the session. Reuses the same `createExportJobWithLimits` advisory-lock + concurrency-limit machinery as the customer pipeline. Stores the user-friendly bundle label as a synthesized `bundleLabel` field ("Admin Devices — Acme" or "Admin Devices — All organizations") so the banner shows something readable. `bundleKey: "admin_devices"` acts as the sentinel.
  - **Generic banner (`client/src/components/ExportsBanner.tsx`, renamed from `PendingExportsBanner.tsx` with a thin re-export alias for backwards compatibility)**: now accepts an `endpoint` prop. `client/src/lib/exports-api.ts` refactored so `useActiveExports`, `useCreateExport`, `useDismissExport` all accept an `endpoint` arg (default `/api/v1/exports`); query keys are scoped per endpoint via `activeExportsQueryKey()` so admin and customer caches stay isolated. New `client/src/lib/admin-exports-api.ts` thin wrapper exposes `useCreateAdminExport()` for the admin dialog.
  - **AdminLayout (`client/src/components/AdminLayout.tsx`)**: mounts `<ExportsBanner endpoint={ADMIN_EXPORTS_ENDPOINT} />` between the side nav and the main content area so the banner sticks across every `/admin/*` page.
  - **DevicesPage (`client/src/pages/admin/DevicesPage.tsx` + new `client/src/components/AdminExportDialog.tsx`)**: added an "Export" button (outline variant) next to "Register Device" in the page header. Opens a dialog with format radio (CSV/Excel) + a one-line filter summary derived from the page's current `selectedOrgId` / `searchQuery`. Submit hits `POST /api/v1/admin/exports` and toasts "Export started". Dialog is unconditionally enabled (admins can export across orgs, even when no specific org is selected).
- **Migration**: `scripts/migrations/2026-05-01_add_export_kind_column.{sh,sql}` — idempotent `ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'snapshot'`. Reuses the same `aws ssm send-command` + dynamic device-manager EC2 lookup pattern as `2026-04-28_add_export_jobs_table.sh`. Run from the MacBook: `./scripts/migrations/2026-05-01_add_export_kind_column.sh`.
- **Smoke test (dev)**: `POST /api/v1/admin/login` → 200; `POST /api/v1/admin/exports` → 202 with `kind: "admin_devices"`; worker log shows `processing job 1 (kind=admin_devices, …)` proving dispatch; the generator ran end-to-end through cell building + CSV serialization (only the S3 upload step failed with `NoSuchBucket` — same expected dev-environment behavior as the customer pipeline). The synthetic admin user + org bootstrap correctly auto-provisions on first login.
- **Backwards compatibility**: zero customer-facing surface area changed. The customer dashboard's `<PendingExportsBanner />` mount in `App.tsx` was switched to `<ExportsBanner />` but the old name is still exported as a thin alias for any external imports. The `kind` column defaults to `'snapshot'` so every existing customer job continues to dispatch through the same code path.
- **Post-review fixes (same day, May 1)**: Code review flagged three issues against the initial cut, all addressed in the same commit:
  1. **Missing columns**: the registry was 18 columns; reviewer pointed out `device_credentials.is_active` (so admins can see disabled credentials even on otherwise healthy devices) and `device_snapshots.rssi` (signal strength in dBm) were missing. Added both — registry is now 20 columns, storage joins `device_credentials` (was previously joined only via `power_mon_devices.host_id`), and the cell builder formats `is_active` as Yes/No and `rssi` as a raw number.
  2. **Wrong circuit-breaker enum**: the cell builder originally emitted `Tripped | Recovering | Closed`, which doesn't match how the device manager actually reasons about state. Replaced with `healthy | no_power_quarantine | unstable_pending | offline` keyed off `connection_status` (with `markedOfflineAt` as a tiebreaker).
  3. **`as any[]` cast in `getAdminDevicesForExport`**: rewrote the WHERE composition to push typed `SQL` predicates onto a `SQL[]` array and call `and(...conditions)` only when non-empty, removing the cast and importing `type SQL` from `drizzle-orm`.
  - Re-ran the smoke test: `POST /api/v1/admin/exports {"format":"csv"}` → 202; worker dispatched `kind=admin_devices` and made it past row extraction + serialization (only S3 upload still fails with `NoSuchBucket` — expected in dev). The synthetic shared admin identity stays as-is by design: `ADMIN_PASSWORD` is a single shared credential so there is no per-admin identity to attribute to; this is now documented inline in `server/api/admin-routes.ts` so future readers know the trade-off and the path forward (swap for per-user lookup if admin auth ever becomes per-user).

---

## Previous Updates (April 30, 2026)

### Feature: Fleet Export — Historical Time-Series Mode (April 30, 2026)
- **Context**: Task #4 (final task) of the Fleet Dashboard CSV/Excel export feature. Tasks #1-#3 shipped the snapshot pipeline (data layer, async worker + S3 + email, dialog + banner). Task #4 layers a single-truck **time-series** mode on top of the same async pipeline so the legacy synchronous `GET /api/v1/export/trucks/:id` endpoint (used by the "Download History" button on the truck detail page) can be retired.
- **What's new**:
  - **`shared/export-historical.ts`** (new): two column registries — `HISTORICAL_TIMESERIES_COLUMNS` (17 cols including `is_parked`, `latitude`, `longitude` so per-minute/hourly exports include parked-state and GPS) and `HISTORICAL_DAILY_COLUMNS` (26 cols — daily roll-ups for voltage/current/power/SOC/temp + `total_energy_in_wh`, `total_energy_out_wh` (raw Wh, not kWh, per the export contract — uses a new `wh` `ColumnFormat` rendered as `0 "Wh"`), `drive_minutes`, `idle_minutes`, `parked_minutes`, `day_savings`, `end_lat`, `end_lng`, sample count). `HISTORICAL_GRANULARITIES = ["minute","hour","day"]` with metadata (label, description, default interval seconds, approx bytes/row); `HISTORICAL_MAX_RANGE_MS` (1 year), `HISTORICAL_MAX_ROWS` (**600,000** — raised from 200k so a full 1-year hourly export of one truck (~8,760 rows) and a 30-day per-minute export (~43k rows) both fit comfortably under the cap); `defaultGranularityForRangeDays()` (≤7d → minute, ≤90d → hour, else day) so default suggestions match the realistic limits; and `estimateHistoricalRows({granularity, startMs, endMs})` returning `{rowCount, approxBytes, exceedsMaxRows}`. Frontend, API, and worker all share these so the row estimate matches between the dialog and the server pre-flight check.
  - **`server/storage.ts` + `server/db-storage.ts`**: new `getHistoricalMeasurements({organizationId, truckId, startTime, endTime, intervalSeconds})` returning aggregated rows. Bucketed by `date_trunc`-style SQL (interval → bucket alignment), pulls min/max/avg of voltage/current/power/SOC/temp per bucket plus `total_energy_in_wh` / `total_energy_out_wh` (computed via `SUM(CASE WHEN power_w>0 THEN power_w ELSE 0 END) * SAMPLE_SECONDS / 3600` so charging vs. discharging are split, matching how the snapshot's lifetime stats are computed) and a sample count. Tenant-scoped via `organization_id` filter on the join.
    - **Activity state (`is_parked`, `parked_minutes`, `drive_minutes`)**: derived from the chassis-voltage column the device-manager already uses to set `device_snapshots.is_parked` (`voltage2 < 13.0 V` — see `device-manager/app/database.js:PARKED_VOLTAGE_THRESHOLD`). To stay byte-for-byte aligned with the device-manager (which evaluates `(voltage2 || 0) < 13.0`, treating NULL as parked), the SQL aggregate counts NULL `voltage2` as a parked sample and only treats explicit `voltage2 >= 13` as driving. Per-row mapper sets `isParked` to whichever side has the majority and (for daily granularity only) reports `parked_minutes` / `drive_minutes` as samples × 10s / 60. `idle_minutes` stays null because the underlying state machine has only two states.
    - **Per-bucket lat/long + `end_lat`/`end_lng`**: pulled from `sim_location_history` via a separate `DISTINCT ON (date_trunc(unit, recorded_at)) ... ORDER BY ... recorded_at DESC` query (PowerMon devices themselves don't store position). Map keyed by bucket timestamp is joined in the row mapper, so buckets with no SIM update in their window stay null. Daily mode reuses the same per-day position for `end_lat`/`end_lng` since `DISTINCT ON ... DESC` already returns the last position of that day.
    - **`day_savings` (daily mode)**: uses the canonical formula from `server/services/savings-calculator.ts` — `(parked_minutes / 60) × 1.2 gal/hr × fuel_price` (savings accrue from APU/idle reduction while parked, never from energy-in). Pre-fetches `savings_config` (default fuel price + `useLiveFuelPrices` flag) and `fuel_prices` for the whole window, then per day picks the most recent EIA price on or before that day, falling back to the org's default when live prices are disabled or none are available. Reported as `0` (not null) on days with no parked time so the column reads "no savings this day" rather than "missing data".
  - **`server/services/exports/historical-cell-builder.ts` + `historical-generator.ts`** (new): own format helpers keyed on `ColumnFormat` (datetime/number/percent/etc.) so the historical bundle stays decoupled from the snapshot bundle's wider column registry. CSV + Excel writers reuse the same pure cell-formatting layer. The generator now returns a `historicalMeta: {truckNumber, fleetName}` block alongside the file so the worker can include the truck identity in the completion email and bundle label without re-querying.
  - **`server/services/exports/types.ts`**: `GeneratedExport.columnKeys` widened to `ColumnKey[] | HistoricalColumnKey[]` (was `ColumnKey[]` only — historical generator was using a type cast). `GeneratedExport.historicalMeta?: {truckNumber, fleetName}` added so the worker has identity info for emails.
  - **`server/services/exports/job-worker.ts`**: dispatch now branches on `historicalMode`. New `intervalSecondsToGranularity()` helper maps the persisted `historical_interval_seconds` (60 / 3600 / 86400) back to the granularity string. Email payload includes a `historical: {truckNumber, fleetName, granularityLabel, startTime, endTime}` block, and the bundle label string is now `"Truck History (Hourly · T-104)"` so the email subject and the in-app banner both surface which truck the file is for at a glance.
  - **`server/api/exports-routes.ts`**: dropped the `501 Not Implemented` historical guard. POST body now accepts `historicalGranularity: "minute"|"hour"|"day"` (mapped to `intervalSeconds` server-side), enforces the 1-year max range, and runs `estimateHistoricalRows()` as a pre-check — if the estimate exceeds `HISTORICAL_MAX_ROWS` (600k), returns `400 {error, estimatedRowCount, maxRows}` so the client can show the same plain-English message it would show inline.
  - **`server/services/email-service.ts`**: `sendExportReadyEmail`'s `historical` opts extended with `truckNumber` + optional `fleetName`. When present the summary block renders a "Truck" row above Granularity/Range — `"T-104 · West Coast Fleet"`. All historical fields are HTML-escaped (`escapeHtml` covers `&<>"'`) before being interpolated into the email body so a maliciously named truck or fleet can't inject markup into the recipient's email client.
  - **`client/src/lib/exports-api.ts`**: `CreateExportJobInput` extended with `historicalMode`, `historicalTruckId`, `historicalStartTime`, `historicalEndTime`, `historicalGranularity`. `CreateExportJobError` now carries `estimatedRowCount` + `maxRows` for the pre-check 400.
  - **`client/src/components/ExportDialog.tsx`**: top-level **Mode toggle** ("Fleet snapshot" / "Truck history") shown above the existing snapshot UI. In historical mode the snapshot sections (bundle / filters / Advanced columns) hide and four new sections appear: **searchable truck combobox** (`TruckCombobox` — Popover + cmdk Command, type to filter, scales past large fleets), date-range presets (Last 24h / Last 7d / Last 30d / Last 90d / Last 1y / Month-to-date / Year-to-date / Last month / Last year / Custom — Custom reveals a **Calendar range picker** (`CustomRangePicker` — Popover + Calendar `mode="range"` two-month view, future dates disabled, auto-closes when both ends picked) instead of a pair of date inputs), granularity radio (auto-suggests via `defaultGranularityForRangeDays` until the user manually picks), and a live estimate row (`≈ N rows / ≈ M MB`). Presets are defined as `RangePreset[]` with `{id, label, days?, resolve(now)}` and looked up by `id` so calendar-anchored presets (MTD/YTD/last-month/last-year) compose with the same UI. The Format toggle is shared between modes. Submit is disabled until truck + valid range + granularity within the row cap are all set; on success the same "Export queued — we'll email you when it's ready" toast fires. Accepts `initialMode`, `initialTruckId`, `initialRangeDays` props so the truck detail page can seed it.
  - **`client/src/components/TruckDetail.tsx`**: removed the legacy popover (date pickers + synchronous CSV download) and its `handleExportHistory` handler. The "Export" button in the truck detail header now opens the global `ExportDialog` seeded with `initialMode="historical"`, `initialTruckId={truck.id}`, `initialRangeDays={30}` (a 30-day window matches what the truck detail page itself trends and yields ~720 hourly rows — a round, fast export the user can immediately tweak). Cleared dead imports (`Popover`, `CalendarComponent`, `useToast`, `Loader2`, `format`, `subDays`, `calendarIcon`).
  - **`server/api/fleet-routes.ts`**: removed the deprecated `GET /export/trucks/:id` route entirely (the only caller was the popover that we just deleted). Left a one-paragraph comment in its place pointing future readers at `POST /api/v1/exports` with `historicalMode=true`.
- **Schema impact**: none. The historical fields (`historical_truck_id`, `historical_start_time`, `historical_end_time`, `historical_interval_seconds`, `historical_mode`) were already added to the `export_jobs` table during Task #2's migration in anticipation of this work, so no new production migration is required.
- **Backwards compatibility**: deleting the legacy endpoint is a breaking change for any external scripts that may have been hitting it directly, but inside the app the only caller was the popover removed in the same task. The async historical export emits an `.xlsx` or `.csv` file with the same schema the popover used to download (timestamp + truck info + voltage/current/SOC/power/temp/energy/charge/runtime), plus daily-mode adds min/max/avg rollups + split charge/discharge energy + savings + end-of-day GPS.

---

## Previous Updates (April 29, 2026)

### Production Migration: `export_jobs` table applied (April 29, 2026)
- **What ran**: `scripts/migrations/2026-04-28_add_export_jobs_table.sh` — created the `export_jobs` table + 5 supporting indexes (`export_job_org_idx`, `export_job_org_status_idx`, `export_job_user_status_idx`, `export_job_status_idx`, `export_job_expires_idx`) plus the implicit `export_jobs_pkey`. Idempotent (`CREATE … IF NOT EXISTS`); verification query reported `row count: 0`, all 6 indexes present.
- **Where**: production RDS via the device-manager EC2 box (`i-0a435441556fc5ab1`, us-east-2). Secret `deecell-fleet-production/database-url`.
- **How (architecture change)**: rewrote the script to use `aws ssm send-command` instead of an interactive `aws ssm start-session`. The interactive path failed for two reasons that compounded each other: (1) macOS Terminal pasted the heredoc faster than the SSM channel could ingest, corrupting the SQL stream mid-transit; (2) the SSM session lands in `sh` (Debian dash) with a stripped PATH that didn't include `psql`. `send-command` ships the SQL via the AWS API as structured JSON (no terminal paste), runs as root with a full PATH, and (since this Ubuntu 24.04 device-manager AMI doesn't ship `psql`) auto-installs `postgresql-client` via apt before running `psql -f`. Output and exit status are fetched back to the MacBook for visibility. The script now also dynamically discovers the device-manager instance ID via `aws ec2 describe-instances --filters tag:Name=*device-manager*` so future EC2 redeploys don't break it.
- **Iteration log** (for posterity, in case the next migration script runs into the same traps):
  1. First version used a literal em-dash in a comment → broke macOS bash 3.2 source loading. Stripped to ASCII.
  2. Second version used a heredoc inside `$()` → still broke bash 3.2. Split SQL out into a sidecar `.sql` file.
  3. Third version hardcoded an old device-manager instance ID (`i-05443904f977d7301`) that had been replaced by Terraform → switched to dynamic lookup.
  4. Fourth version used interactive `start-session` → hit paste corruption + `sh: psql: not found`. Final version uses `send-command`.
- **Production state**: `export_jobs` table now exists in prod with the same schema Drizzle generates locally. Once Task #3 is approved and merged, the next deploy of the web app will pick up the routes/worker that read & write this table; nothing else is needed on the infra side. The S3 lifecycle rule (`exports/*` → 14-day delete) was already added in Task #2's Terraform changes and was applied during that task's `terraform apply`.

### Feature: Fleet Export — Export Dialog & Pending Exports Banner (April 28, 2026)
- **Context**: Task #3 of the Fleet Dashboard CSV/Excel export feature. Tasks #1 and #2 shipped the data layer + async pipeline. This task delivers the user-facing UI: a configuration dialog (bundle picker + Advanced per-column controls + format toggle + filter chip strip) and a persistent pending-exports banner that surfaces in-flight + recently-finished jobs across every page.
- **What's new**:
  - **`client/src/lib/exports-api.ts`** (new): TanStack Query hooks for the new endpoints.
    - `useActiveExports()` — polls `GET /api/v1/exports?active=true` every 5s **only while at least one job is in flight** (refetchInterval returns `false` once the list is empty so we're not hammering the server).
    - `useCreateExport()` — POSTs to `/api/v1/exports` and surfaces structured error info on 429 (`reason`, `activeUserCount`, `activeOrgCount`, `userLimit`, `orgLimit`, `featureFlag`) so the dialog can show plain-English copy inline. Invalidates the active-exports query on success.
    - `useDismissExport()` — PATCHes `/dismiss` with optimistic removal across every org-scoped variant of the query, with full rollback on error.
    - `SerializedExportJob` matches the server's `serializeJob` shape exactly; status union includes `expired`.
  - **`client/src/components/ExportDialog.tsx`** (new):
    - Bundle radio (Default · Operations · Battery Health · Connectivity & SIM · Full Export) with per-bundle column count + description.
    - Format toggle (CSV / Excel).
    - Active-filters chip strip from the dashboard (`Status: …`, `Search: …`, `Fleet: …`) with explicit "No filters applied — exporting all trucks." copy when empty.
    - "Advanced — choose columns" `Collapsible` with checkboxes grouped by registry `group` (Identity / Status / Location / Live readings / Battery configuration / Idle & savings / Health & timestamps / Lifetime stats / SIM / Hardware), preserving registry order.
    - Selecting a bundle resets checkboxes to that bundle's defaults; manual edits are then preserved while the same bundle stays selected. Submit computes the `includeColumns` / `excludeColumns` diff against the bundle so the server stores only what the user actually changed.
    - Disabled Submit while pending; Cancel disabled while pending. 429 errors render inline (no destructive toast — the action is "wait for one to finish"); other failures get both inline + toast so the message survives an outside-click close. Success → toast "Export queued — we'll email you when it's ready" + close.
  - **`client/src/components/PendingExportsBanner.tsx`** (new):
    - Sticky banner in the app shell. Renders nothing when there are no jobs, so the login page (no org context → query disabled) and any user with an empty queue both see no extra chrome.
    - Per-job rows with three states:
      - **Pending/Running** — spinner + "Export in progress — <bundle> (<format>)" + "We'll email you when it's ready." (no dismiss; in-flight jobs cannot be dismissed per server's 409).
      - **Completed** — green check + "Your export is ready — <bundle>" + filename + "Expires in N day(s)" derived from `downloadUrlExpiresAt` + Download button (opens signed URL in a new tab) + X dismiss.
      - **Failed** — red icon + "Export failed: <reason>" + X dismiss.
    - Multiple jobs stack vertically; banner auto-hides as jobs are dismissed (optimistic UI).
  - **`client/src/pages/Dashboard.tsx`**: removed the synchronous `handleExportAllTrucks` (which called the legacy `/api/v1/export/trucks` endpoint and triggered a browser download). The "Export CSV" buttons (mobile + desktop) are now "Export" triggers that open `<ExportDialog filters={{ status, searchQuery }} />`. Filter chips inside the dialog reflect what the dashboard has applied.
  - **`client/src/App.tsx`**: mounted `<PendingExportsBanner />` inside `OrgProvider` / `TooltipProvider` and above the `<Router />` so it's visible on every authenticated page (Dashboard, all `/admin/*` pages) without polluting page components. The banner gates itself on `useOrganization()` so unauthenticated routes (`/login`, `/forgot-password`, etc.) make zero requests.
- **Architectural notes**:
  - The dialog is the only place the user picks bundle/columns/format. Dashboard owns filters and passes them in as props (no editing inside the dialog — dashboard is the source of truth).
  - All UI uses existing shadcn primitives (Dialog, Checkbox, RadioGroup, Collapsible, Button, Badge, Toast). No new design tokens added.
  - Polling discipline: the active-exports query's `refetchInterval` is a function that inspects current data — `false` when nothing is in flight, `5000` when something is. Combined with `refetchIntervalInBackground: false`, an idle dashboard makes one fetch on mount and then stays quiet.
  - `setQueryData` in the optimistic dismiss iterates every cached variant of the active-exports query (org-scoped key) so the row disappears from every consumer in lockstep.
- **Files changed**: `client/src/lib/exports-api.ts` (new), `client/src/components/ExportDialog.tsx` (new), `client/src/components/PendingExportsBanner.tsx` (new), `client/src/pages/Dashboard.tsx` (export buttons swapped, dialog mounted), `client/src/App.tsx` (banner mounted in shell).
- **Out of scope** (Task #4): `historicalMode=true` is rejected server-side with 501 and is not exposed in the dialog. Truck-detail "Download History" still uses the legacy `GET /api/v1/export/trucks/:id` endpoint until #4 ships the historical generator.

---

## Earlier Updates (April 27, 2026)

### Feature: Fleet Export — Async Job Pipeline, S3 Delivery, Email (April 27, 2026)
- **Context**: Task #2 of the Fleet Dashboard CSV/Excel export feature. Task #1 shipped the pure data + serializer layer. This task wraps it in an async job pipeline so the HTTP request returns instantly (<100ms) regardless of fleet size, files are delivered via S3 + 7-day signed URL, and the requester gets a SendGrid email when their export is ready.
- **What's new**:
  - **`export_jobs` table** (`shared/schema.ts`): tracks every export request with `status` (pending/running/completed/failed/expired), `format`, `bundleKey`, JSON `filters` / `includeColumns` / `excludeColumns`, S3 metadata (`s3Key`, `s3Filename`, `downloadUrl`, `downloadUrlExpiresAt`), historical-mode fields (`historicalMode`, `historicalTruckId`, `historicalStartTime`, `historicalEndTime`, `historicalIntervalSeconds`), `errorMessage`, `rowCount`, `columnCount`, `fileSizeBytes`, and lifecycle timestamps. Indexes on `(organization_id, user_id, status)` and `status` so the worker's claim query and per-user banner query are both index-only. Constants exported alongside the table: `EXPORT_JOB_STATUS`, `EXPORT_JOB_ACTIVE_STATUSES`, `EXPORT_USER_CONCURRENCY_LIMIT=3`, `EXPORT_ORG_CONCURRENCY_LIMIT=10`, `EXPORT_DOWNLOAD_TTL_SECONDS=7d`. `npm run db:push` synced the table cleanly.
  - **Storage methods** (`server/storage.ts` + `server/db-storage.ts`): `createExportJobWithLimits` enforces the 3/user and 10/org concurrency limits inside a single transaction guarded by `pg_advisory_xact_lock(organization_id, user_id)` so two simultaneous POSTs cannot both slip past the count check. Returns a discriminated union `{ ok: true, job } | { ok: false, reason: 'user_limit'|'org_limit', activeUserCount, activeOrgCount }`. `claimNextPendingExportJob` uses `UPDATE … WHERE id = (SELECT id FROM export_jobs WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` so multi-instance deployments are race-free. Other methods: `getExportJob`, `listExportJobsForUser`, `updateExportJob`, `dismissExportJob`, `expireOverdueExportJobs`.
  - **Background worker** (`server/services/exports/job-worker.ts`): in-process singleton started in `server/index.ts` after `server.listen`. Polls every 5s, drains up to 5 jobs per tick, runs an hourly-by-the-minute sweep that flips overdue rows to `expired`. For each claimed job it calls `generateExport` from Task #1, uploads to `exports/<orgId>/<jobId>/<filename>`, signs a 7-day URL via the existing `getFileUrl(key, ttl)`, persists `s3Key/downloadUrl/downloadUrlExpiresAt/rowCount/columnCount/fileSizeBytes` on the job, then sends the ready email. Failures are caught, the row goes to `failed` with a 1000-char-truncated `errorMessage`, and a failure email is sent. Email send is best-effort and never re-queues the job.
  - **Endpoints** (`server/api/exports-routes.ts`, mounted at `/api/v1/exports`):
    - `POST /` — Zod-validated body (bundleKey ∈ `EXPORT_BUNDLES`, format ∈ `csv|xlsx`, optional filters/include/exclude, optional historical fields). Historical mode adds server-side guards: ≤1 year window, ≥60s interval, truck must belong to org. Returns `202 { job }` or `429 { reason, activeUserCount, activeOrgCount, userLimit, orgLimit }`.
    - `GET /` — list this user's recent jobs (banner data source). Supports `?limit`, `?status=`, `?includeDismissed=false`.
    - `GET /:id` — single-job poll target.
    - `PATCH /:id/dismiss` — banner dismiss.
    - All routes are `tenantMiddleware`-scoped; `serializeJob` strips internal `s3Key` and exposes `bundleLabel`, `filename`, `downloadUrl`.
  - **Email** (`server/services/email-service.ts`): `sendExportReadyEmail({ firstName, filename, rowCount, bundleLabel, downloadUrl, expiresAt })` and `sendExportFailedEmail({ firstName, bundleLabel, errorMessage })` both use the existing `getEmailWrapper` for brand consistency (`#FA4B1E`, `hello@deecell.com`). Ready email shows file/rows/expiration in a bordered table plus a primary "Download export" button. Failure email shows the error in a monospace block and links back to the dashboard.
  - **Legacy endpoint kept (deprecated)** (`server/api/fleet-routes.ts`): the synchronous `GET /api/v1/export/trucks/:id` CSV export is preserved temporarily so the truck-detail "Download History" button keeps working without a regression. It now sends an `X-Deprecated` header pointing callers at the new async API. Task #4 will remove it once `POST /api/v1/exports` with `historicalMode=true` ships its historical generator (currently returns 501). The summary `/export/trucks` endpoint is unchanged.
  - **Terraform** (`terraform/iam.tf`): added `aws_s3_bucket_lifecycle_configuration.assets` with prefix `exports/`, 14-day current-version expiration, 14-day non-current expiration, and a 1-day abort-incomplete-multipart cleanup. Run `terraform apply` from the user's MacBook to deploy. The 7-day signed-URL TTL is enforced separately by `getFileUrl`; the lifecycle rule is purely housekeeping so files don't accumulate.
- **Concurrency model**: a single web container runs the worker today. `FOR UPDATE SKIP LOCKED` makes scaling out safe — every running container will independently claim work without double-processing. The 5s poll plus 250ms initial nudge keeps dev iteration snappy without spamming the DB.
- **Tests**: 16/16 export tests from Task #1 still pass (59/59 total) — the new pipeline doesn't break the existing pure layer.
- **Files changed**: `shared/schema.ts`, `server/storage.ts`, `server/db-storage.ts`, `server/services/exports/job-worker.ts` (new), `server/api/exports-routes.ts` (new), `server/services/email-service.ts`, `server/api/fleet-routes.ts` (legacy single-truck endpoint deprecated, kept until Task #4), `server/routes.ts` (mount), `server/index.ts` (worker start), `terraform/iam.tf` (lifecycle).
- **Out of scope** (covered by remaining tasks): Export dialog + in-app banner UI (Task #3), historical time-series generator (Task #4 — currently throws `"Historical export mode is not yet implemented"`), Admin Devices soft-launch entry point (Task #5).
- **Code-review fixes applied during this task**:
  - Switched the advisory lock from `pg_advisory_xact_lock(orgId::bigint, userId::bigint)` (no such Postgres overload) to `pg_advisory_xact_lock(orgId::int, 1::int)` and made it org-scoped, so the 10/org cap is now race-free across different users in the same org (the previous per-user keying allowed two users to slip past the org count check).
  - `includeColumns` / `excludeColumns` now go through a `superRefine` that rejects any key not in the column registry (`isColumnKey`) with a 400 listing the offending names.
  - `GET /api/v1/exports?active=true` is now a first-class banner shortcut (pending + running + completed-not-dismissed + failed-not-dismissed). The original `?status` / `?includeDismissed` filtering is preserved when `active` is not set.
  - `PATCH /api/v1/exports/:id/dismiss` now returns 409 if the job is still pending or running — only completed/failed/expired rows can be dismissed.
  - **IDOR fix on `GET /api/v1/exports/:id`**: the route now requires `job.userId === req.userId` (in addition to org scope). Same-org users can no longer fetch another user's signed download URL by guessing the integer job id.
  - 429 messages on the create endpoint now return the spec's plain-English copy (`"You already have 3 exports in progress — wait for one to finish."` and the org equivalent) so the Task #3 dialog can surface them inline.
  - Ready email now links back to `${APP_URL}/dashboard` so users can re-download an export from the app while the link is still valid.
  - `serializeJob` is now strictly typed with an exported `SerializedExportJob` interface (was previously `any`) so the API contract is type-safe end to end.
  - `POST /api/v1/exports` now nudges the worker (`exportJobWorker.nudge()` → `setImmediate(tick)`) so processing starts within milliseconds of enqueue instead of waiting up to a full 5s poll interval.
  - `filters` / `include_columns` / `exclude_columns` are now stored as `jsonb` (was `text`) so future read paths can index/query inside the structures without another migration. The worker reads these natively (no `JSON.parse`).
  - Sweeper cadence is now hourly (`60 * 60 * 1000`) rather than every minute, matching the spec.
  - `POST /api/v1/exports` now rejects `historicalMode=true` with `501 { error: "Historical exports are coming soon — only snapshot exports are available right now.", featureFlag: "historicalExports" }`. The dialog in Task #3 should hide the "Historical" toggle until the feature flag flips.
  - **Legacy `GET /api/v1/export/trucks/:id` is intentionally kept (deprecated)** so the truck-detail "Download History" button keeps working. Task #4 will remove it once the async historical pipeline ships. Response now includes an `X-Deprecated` header pointing callers to the new API.
  - Replaced `catch (err: any)` in the worker with `catch (err: unknown)` and a typed `errorToString(unknown)` helper.

### Feature: Fleet Export — Data Layer & Serializers (April 27, 2026)
- **Context**: First of five tasks for the new Fleet Dashboard CSV/Excel export feature. This task builds the foundational pure layer; Tasks #2–#5 add async pipeline (S3 + email + banner), Export dialog, historical time-series mode, and the Admin Devices soft launch.
- **What's new**:
  - **Column registry** (`shared/export-columns.ts`): single source of truth for ~45 columns, each with `format`, `source`, `width`, and `group` metadata. Five named bundles (Default, Operations, Battery Health, Connectivity & SIM, Full Export). Helpers: `resolveColumns()`, `bundleNeedsStatistics()`, `bundleNeedsSims()`. Type guard `isColumnKey()` and `EXPORT_COLUMN_LIST` for iteration.
  - **3-status split** (Operational / Connection / Activity) — Activity Status delegates to the existing `determineTruckStatus()` in `@shared/truck-status`, so the dashboard table and the export agree byte-for-byte.
  - **Storage method** `getTrucksForExport(orgId, options)` (`server/db-storage.ts`): a single batched query joining `trucks → fleets / power_mon_devices / device_snapshots / shelly_snapshots` with an `alerts` subquery for active counts. SIMs and `device_statistics` are hydrated only when the resolved column set requires them. Org-scoped at every level.
  - **Serializers** (`server/services/exports/`): `cell-builder.ts` extracts raw values per column from a `TruckExportRow`. `csv-serializer.ts` emits UTF-8 + BOM with a `# `-prefixed filter-summary preamble line, RFC 4180 escaping. `excel-serializer.ts` uses ExcelJS — frozen header at row 2, faint italic caption at row 1, per-format number/date formats (currency, kWh, V, °F, etc.), autosized columns capped at 48 chars based on header label + first 200 sampled rows.
  - **Entry point** `generateExport({ organizationId, bundleKey, format, filters?, includeColumns?, excludeColumns? })` — what the async worker (Task #2) and any future direct route will call. Returns `{ buffer, filename, contentType, rowCount, columnKeys }`. Filenames follow `fleet_<bundle>[_<status>][_search-<text>]_<YYYY-MM-DD>.<ext>` with sanitized fragments. Savings are computed once per export via the existing `SavingsCalculator` (skipped if no savings columns are selected); failure falls back to zeros so the export is never blocked by a transient EIA hiccup.
- **Files changed**: `shared/export-columns.ts` (new), `server/services/exports/{types,cell-builder,csv-serializer,excel-serializer,index}.ts` (new), `server/storage.ts` (added `getTrucksForExport` to `IStorage`), `server/db-storage.ts` (implementation + new `sims`/`deviceStatistics` imports + `or`/`ilike` operators), `package.json` (exceljs added).
- **Out of scope** (covered by remaining tasks): async job model + S3 + SendGrid (Task #2), Export dialog & banner (Task #3), historical time-series mode (Task #4), Admin Devices soft launch (Task #5).

---

## Earlier Updates (April 16, 2026)

### Fix: Solo Probe Worker Isolation Hardening (April 16, 2026)
- **Problem**: Code review identified three critical issues with the solo probe worker implementation:
  1. **Race condition**: `initializeForSoloDevice()` reset device status to `NULL` before the probe proved health, making the device immediately eligible for shared cohort workers via `checkForNewDevicesInCohort`.
  2. **False success**: `runProbe()` exited 0 after 30 seconds unconditionally — regardless of whether a successful poll actually occurred. This cleared backoff even for unhealthy devices.
  3. **Startup bypass**: `getActiveDevicesWithCredentials()` auto-reset expired no_power devices and added them to the active set, bypassing solo probe isolation entirely.
- **Fixes**:
  - **New `probing` status**: Probe sets device to `connection_status='probing'` during the probe window. Shared workers exclude `probing` from their active device queries, preventing race conditions. On success (exit 0), supervisor clears to `NULL`; on failure, supervisor resets to `no_power` for backoff.
  - **Verified probe success**: Replaced unconditional 30s timeout with a 5-second interval checker (up to 6 checks = 30s). Probe only exits 0 if `hasAnySuccessfulPoll()` returns true (device connected AND completed at least one poll). If no poll succeeds, probe re-marks device as `no_power` and exits 1.
  - **Removed startup auto-reset**: Deleted the no_power quarantine auto-reset block from `getActiveDevicesWithCredentials()`. All no_power recovery now flows exclusively through the supervisor's `_probeNoPowerDevices()` → solo probe worker path.
  - **Guard in `initializeForSoloDevice`**: Added check that device must be in `no_power` status before starting probe. Prevents probing devices whose status changed (e.g., admin set offline) between selection and spawn.
  - **Cleanup robustness**: Wrapped probe cleanup (pollingScheduler, batchWriter, connectionPool, db) in try/catch to prevent stuck processes.
  - **Admin UI**: Added "Probing" status badge (blue) to the Devices page, and added `probing` to the "Set Online" button visibility.
- **Files changed**: `device-manager/app/supervisor.js`, `device-manager/app/worker.js`, `device-manager/app/connection-pool.js`, `device-manager/app/database.js`, `client/src/pages/admin/DevicesPage.tsx`

### Architecture: Supervisor/Worker Process Isolation (April 15, 2026)
- **Problem**: When the circuit breaker fires (e.g., a device corrupts the native C++ library), the entire device manager process exits. ALL devices go offline until systemd restarts the process. This is a 100% blast radius for a single bad device.
- **Solution**: Refactored to a supervisor/worker architecture. The supervisor forks one worker process per cohort. Each worker loads its own copy of the native library and manages only its cohort's devices. If a device corrupts the library, only that worker crashes (~10% blast radius). The supervisor detects the exit and respawns the worker with exponential backoff.
- **Architecture**:
  - **Supervisor** (`supervisor.js`): Forks N workers (one per cohort), monitors them, respawns on crash with exponential backoff (3s → 6s → 12s → ... → 60s max, resets after 10 min stable). Runs shared services: SIM poller, InHand GPS poller, SIM sync, metrics server. Periodically checks for new cohorts (new devices added).
  - **Worker** (`worker.js`): Receives `WORKER_COHORT_ID` env var. Initializes its own DB pool, connection pool (filtered to cohort via `initializeForCohort`), batch writer, polling scheduler, backfill service. Handles its own crash attribution file (`/tmp/device-manager-worker-{cohortId}.json`). Circuit breaker `process.exit(1)` only kills this worker.
  - **Entry point** (`index.js`): Default mode is supervisor. Set `DEVICE_MANAGER_MODE=single` for legacy single-process mode (backward compatible).
- **Key changes**:
  - `connection-pool.js`: Added `initializeForCohort(cohortId, totalCohorts)` and `checkForNewDevicesInCohort()` methods. Added `getAllConnections()` for worker-mode polling. `hashToCohort()` now accepts optional `totalCohorts` parameter.
  - `polling-scheduler.js`: Added `startForWorker()` method — single-cohort mode polls all connections on a simple interval (no timing wheel). `processTick()` uses `getAllConnections()` in worker mode.
  - `database.js`: `recordActiveDevice()` and `readCrashAttribution()` now use cohort-specific crash files in worker mode.
  - `index.js`: Routes to supervisor (default) or single-process mode based on `DEVICE_MANAGER_MODE` env var.
- **Deployment**: No changes needed to systemd service or EC2 config. Same entry point (`node device-manager/app/index.js`) starts supervisor by default. To rollback to single-process: `DEVICE_MANAGER_MODE=single`.
- **Files changed**: `device-manager/app/supervisor.js` (new), `device-manager/app/worker.js` (new), `device-manager/app/index.js`, `device-manager/app/connection-pool.js`, `device-manager/app/polling-scheduler.js`, `device-manager/app/database.js`

### Fix: Null ALL Native Device References on Circuit Breaker (April 15, 2026)
- **Problem**: Despite `nativeLibraryShutdown` flag, DCL-Curtis-1 had an in-flight poll callback when NHRA triggered the circuit breaker. The callback completed, then the post-poll `disconnect()` call hit the corrupted native library → `terminate called without an active exception` → core dump (SIGABRT).
- **Root cause**: Only the triggering device's native reference was nulled. Other devices' native refs were still live, and their in-flight callbacks could trigger further native calls (disconnect, reconnect) during the 3-second exit window.
- **Fix**: When circuit breaker fires, null out `device` reference and clear reconnect timers for **ALL** devices in the pool via `poolInstance.connections`. Added `poolInstance` module-level reference set in `ConnectionPool` constructor.
- **Additional guard**: `getMonitorData` callback now checks `nativeLibraryShutdown || !this.device` at entry, bailing immediately if the library was compromised while the callback was in-flight.
- **Files changed**: `device-manager/app/connection-pool.js`

### Weak Signal State — Early Warning Before No Power (April 15, 2026)
- **Problem**: Devices go straight from "online" to "no_power" with a 30-minute quarantine. No early warning for connectivity issues.
- **Solution**: Added intermediate `weak_signal` state (yellow) between healthy and `no_power`:
  - **1st instant disconnect** (< 200ms) → `weak_signal` — device stays in pool, continues reconnecting normally. Yellow badge shown in both admin and fleet dashboards.
  - **2nd instant disconnect** → `no_power` — circuit breaker opens, process restarts (same as before).
  - **Auto-clears**: When device successfully polls, `markDeviceReporting()` sets `connection_status = 'online'` which clears `weak_signal`.
- **Diagnostic logging**: `WEAK_SIGNAL DIAGNOSTIC` logged with router ping + GPS cross-reference on 1st instant disconnect.
- **UI changes**:
  - **Admin DevicesPage**: Yellow "Weak Signal" badge between "No Power" (red) and "Unstable" (orange).
  - **Fleet Table**: Yellow wifi-off icon with tooltip next to truck name when device has weak signal. Red wifi-off icon for no_power.
  - **Both admin and fleet managers** can see the weak signal state.
- **DB changes**: New `markDeviceWeakSignal()` function; `markDeviceDisconnected()` preserves `weak_signal` status.
- **Files changed**: `device-manager/app/connection-pool.js`, `device-manager/app/database.js`, `client/src/lib/api.ts`, `client/src/components/FleetTable.tsx`, `client/src/pages/admin/DevicesPage.tsx`

### No-Power Diagnostic: Router Ping + GPS Cross-Reference (April 15, 2026)
- **Problem**: 8 devices showing `no_power` simultaneously — suspected Wireless Logic / InHand router connectivity issue rather than actual power loss
- **Solution**: Added diagnostic logging at two critical points:
  1. **Circuit breaker fire** (`connection-pool.js`): When a device triggers `no_power`, immediately pings the applink URL (router) and queries the truck's last GPS update from InHand
  2. **Periodic recovery retry** (`recoverNoPowerDevices`): Before each retry attempt, checks router reachability and GPS age
- **Diagnostic verdict logic**:
  - Router reachable → "likely connectivity issue, NOT power loss"
  - Router unreachable but GPS < 5 minutes old → "transient network issue"
  - Router unreachable + no recent GPS → "could be actual power loss"
- **Files changed**: `device-manager/app/connection-pool.js`, `device-manager/app/database.js`
- **New DB function**: `getTruckLastGpsUpdate(truckId)` — returns lat, long, last_location_update, location_description
- **No behavior changes** — purely diagnostic logging, no changes to circuit breaker logic
- **Deploy**: Push to GitHub, device manager will pick up changes on next deploy/restart

---

## Previous Updates (April 14, 2026)

### Global Native Library Shutdown Flag (April 14, 2026)
- **Problem**: When a device (e.g., DCL-Thibert) triggers the circuit breaker, the process schedules a graceful exit in 3 seconds. During that window, other devices continue polling via the native C++ library, which is now corrupted. This causes `terminate called without an active exception` → core dump (SIGABRT)
- **Fix**: Added `nativeLibraryShutdown` module-level flag in `connection-pool.js`
  - Set to `true` immediately when any circuit breaker fires
  - Checked before ALL native library calls: `connect()`, `poll()`, `fetchAndUpdateDeviceInfo()`, `disconnect()`
  - When flag is set: `connect()` returns skipped, `poll()` returns null, `fetchAndUpdateDeviceInfo()` returns early, `disconnect()` nulls device reference without calling native disconnect
  - Result: The 3-second graceful exit window is now safe — no device touches the native library after corruption is detected
- **Before**: Process crashed with core dump within seconds of circuit breaker
- **After**: Process exits cleanly via `process.exit(1)` after 3 seconds, systemd restarts with clean native state
- **Files changed**: `device-manager/app/connection-pool.js`

### Periodic No-Power Device Auto-Retry (April 14, 2026)
- **Added `recoverNoPowerDevices()`** to connection pool — periodically retries `no_power` devices whose 30-minute quarantine has expired
  - Runs every 30 minutes via `setInterval` in `index.js`
  - Tries devices one at a time with 5-second gaps to protect the native library
  - If device connects successfully → calls `resetDeviceStability()` to bring it back online
  - If device fails again → resets `marked_unstable_at` to restart the 30-minute quarantine timer
  - Compact colored log output with `AUTO` tag: `[retry]`/`[recovered]`/`[still off]` per device
- **Startup: retries expired no_power devices only** — on process restart, only no_power devices whose 30-minute quarantine has expired are retried. Devices that just crashed the process are NOT retried immediately (prevents restart loops)
- **Added `getNoPowerDevicesReadyForRecovery()`** DB query in `database.js`
  - Selects `no_power` devices where `marked_unstable_at < NOW() - 30 minutes` and `is_active = true`
- **Skipped device log updated**: Shows exact minutes remaining (`retry in 12m`) instead of hours
- **Behavior summary**: `no_power` quarantine is 30m (check every 30m), `unstable` backoff is 5m (checked every 5m), `offline` is admin-only (never auto-recovered)
- **Files changed**: `device-manager/app/connection-pool.js`, `device-manager/app/database.js`, `device-manager/app/index.js`

### SIM Sync Moved to Device Manager (April 14, 2026)
- **Removed "Sync SIMs" button** from admin Devices page — webapp is no longer responsible for SIM syncing
- **Removed sync API routes** (`POST /sims/sync`, `POST /organizations/:orgId/sims/sync`) from webapp admin routes
- **Created `device-manager/app/sim-sync.js`** — standalone backend service running on EC2 alongside other pollers
  - Runs on startup (5s delay) and every 10 minutes
  - Fetches all SIMs from SIMPro listing API in a single call
  - Fetches individual SIM details for `custom_field1` (device name) when not in listing, rate-limited with auto-stop after 5 errors
  - Matches SIMs to PowerMon devices by device name, assigns correct `organization_id` from the matched device
  - Only creates new SIM records for SIMs matching a known device (prevents orphan records)
  - Duplicate device name detection: if two orgs share the same device name, skips those matches to prevent cross-tenant data corruption
  - Integrated into device manager lifecycle (start/stop/shutdown)
- **Read-only SIM endpoints remain** in webapp: list SIMs, location history, SIMPro status check

### Sync SIMs Button + ECS SIMPro Credentials (April 13, 2026)
- **Fixed ECS missing SIMPro credentials**: The production web app (ECS Fargate) didn't have `SIMPRO_API_CLIENT` and `SIMPRO_API_KEY` injected — they were only configured for EC2 device manager
  - Updated `terraform/ecs.tf`: Added SIMPro secrets to ECS task definition container secrets (conditional on `enable_simpro`)
  - Updated `terraform/iam.tf`: Added SIMPro secret ARNs (plus OpenAI, EIA, SendGrid) to ECS execution role's `secretsmanager:GetSecretValue` permissions
  - **Action required**: Run `terraform apply` from MacBook to deploy these IAM/ECS changes, then the next ECS deploy will pick them up
- **Fixed SIM sync to only create matched SIMs**: Previously, syncing for one org would create SIM records for ALL 46 SIMs on the account. Now only SIMs that match a device in the selected org are created. Existing SIM records are still updated.
- **Fixed "Body already read" bug**: SIMPro API client was consuming response body twice in error handler.
- **Eliminated excessive API calls**: Removed per-SIM `getSimDetails` calls (was 276 calls). Now uses data from the single `getSims` listing call.
- **Data cleanup needed**: 31 unmatched SIMs were created under GTO Fast Racing org (ID 9) and need to be removed.
- **Files changed**: `client/src/lib/admin-api.ts`, `client/src/pages/admin/DevicesPage.tsx`, `server/services/simpro-client.ts`, `server/services/sim-sync-service.ts`, `terraform/ecs.tf`, `terraform/iam.tf`

---

## Previous Updates (February 16, 2026)

### Definitive Circuit Breaker Fix: TTL Quarantine + Self-Restart (February 20, 2026)
- **Root cause (finally understood)**: ANY rapid connect/disconnect cycle corrupts the native C++ library's shared global state. The corruption is cumulative across devices and manifests asynchronously — a later callback on an innocent device triggers `std::terminate()` → SIGABRT. No amount of cooldowns or delays can fix this because the damage is done the instant a rapid disconnect happens.
- **Previous failed approaches**: 
  - Auto-reset `no_power` on startup → crash loop (12 devices reconnect, multiple rapid-disconnect, aggregate corruption → SIGABRT)
  - 2-second cooldown between connections → still crashed (corruption from earlier devices manifests on later devices)
- **Definitive 3-part fix**:
  1. **No startup reset of `no_power`**: Startup sweep only resets `unstable` devices. `no_power` stays quarantined.
  2. **TTL-based quarantine (4 hours)**: Instead of requiring manual admin "Set Online", `no_power` devices auto-expire after 4 hours. The `getActiveDevicesWithCredentials()` query checks `marked_unstable_at` and includes expired `no_power` devices for retry. Overnight false positives self-heal by morning. Genuine no-power devices get re-quarantined in seconds.
  3. **Process self-restart after circuit breaker**: When any device triggers the circuit breaker (marked `no_power` or `unstable`), the process schedules `process.exit(1)` after 3 seconds (for DB writes to complete). Systemd restarts it with a fresh native library. This is the ONLY safe way to handle native library corruption — discard the entire process.
- **Connection status hierarchy (final)**:
  - `null` → `online` → `reporting` → `disconnected` (normal operation)
  - `unstable`: Circuit breaker after 3 rapid disconnects (>100ms each). Auto-reset on startup.
  - `no_power`: Circuit breaker after 2 instant disconnects (<100ms each). NOT reset on startup. Auto-expires after 4 hours. Admin can also manually "Set Online".
  - `offline`: Admin-set only. Never auto-reset.

### Circuit Breaker Tuning: 2 Instant Disconnects (February 17, 2026)
- **Problem with 1-disconnect threshold**: The instant circuit breaker (open on 1st sub-100ms disconnect) caused widespread false positives. Moeck, Haynes, Kruse, Elite-Hospitality, and others were falsely marked `no_power` — only 2 of 14 devices remained active. A single transient network hiccup can produce a fast disconnect.
- **Problem with 3-disconnect threshold**: The native C++ library crashes after 3 rapid connect/disconnect cycles of a no-power device (each lasting 2-3ms). The corruption manifests later when other devices trigger native callbacks (SIGABRT core dump).
- **Fix**: **2 instant disconnects** is the sweet spot.
  - `< 100ms disconnect × 2` → circuit breaker opens on **2nd** instant disconnect → `no_power`
  - `100ms - 5000ms disconnect × 3` → circuit breaker opens after **3** rapid disconnects → `unstable`
- **Why 2 works**: The native library is stable through 2 rapid cycles (crash observed at 3+). Two consecutive sub-100ms disconnects is extremely unlikely from a transient network issue but guaranteed from a genuine no-power device (which disconnects in 2-3ms every time).
- **Progression**: 5 → 3 → 1 → 2. Each step informed by production data.

### False No-Power Detection Fix (February 16, 2026)
- **Problem**: Devices that were working fine (Carter, Brown, Curtis-1, Curtis-2) were falsely marked as `no_power` after a transient network issue (router reboot, WiFi hiccup, etc.)
- **Root cause**: The fail-fast detection (50ms wait after connect, mark `no_power` on first rapid disconnect) was too aggressive. A single rapid disconnect — which can happen due to any brief network blip — immediately and permanently marked the device as `no_power`.
- **Fix**:
  1. **Removed fail-fast** 50ms checks from all 3 connection paths (`connectAll()`, `checkForNewDevices()` new devices, `checkForNewDevices()` reconnections)
  2. **Lowered circuit breaker threshold** from 5 to 3 rapid disconnects (`MAX_RAPID_DISCONNECTS = 3`). At 3 cycles the native library is still stable (crash was observed at 5). This catches genuine no-power devices faster while still giving transient issues a chance to recover.
  3. The existing `device = null` protection at circuit breaker open (added Feb 15) prevents the C++ crash
- **Why 3 instead of 5**: Looking at the original Kalitta crash log, the native library was still functioning at `rapidDisconnects=3`. The crash occurred after the 5th cycle. Lowering to 3 opens the circuit breaker before the native library reaches a corrupted state. **UPDATE**: Even 3 was not safe enough — see "Instant Circuit Breaker" entry above.
- **Startup recovery sweep**: Still only resets `unstable` devices (not `no_power` or `offline`) — unchanged from Feb 15 fix
- **Result**: Transient disconnects recover naturally through the reconnect cycle. Only devices that fail 3 consecutive rapid connect/disconnect cycles get marked.

### Circuit Breaker Crash Fix (February 15, 2026)
- **Problem**: When a no-power device (e.g., Kalitta-Hospitality) was set back online, the 5 rapid connect/disconnect cycles crashed the native C++ library with `terminate called without an active exception`
- **Root cause**: The native C++ library's internal state gets corrupted during rapid connect/disconnect cycles. The crash occurs on ANY subsequent native call (even on other devices), not just the problematic one.
- **Circuit breaker guards**: When circuit breaker opens (for devices already in the pool), immediately null out `this.device`, clear reconnect timers, and return early. `fetchAndUpdateDeviceInfo()` checks `this.status === 'connected'` and `!this.isCircuitOpen`.
- **Startup recovery sweep change**: No longer auto-resets `no_power` devices on startup. Previously, the sweep reset both `unstable` and `no_power` to NULL, causing Kalitta to reconnect on every restart and crash the process in a loop. Now only `unstable` devices are reset on startup — `no_power` devices require admin "Set Online" to retry.
- **Result**: No-power devices don't cause crash loops on restart.

### Connection Status Semantics Fix (February 15, 2026)
- **BREAKING FIX**: `connection_status = 'offline'` now means **admin-initiated only** (set via dashboard button)
- Previously, any device disconnect was marked 'offline' — even a single disconnect (e.g., Kruse with 1 disconnect was shown as OFFLINE)
- New status `'disconnected'` = normal disconnect, device manager will auto-retry on next poll cycle
- Status hierarchy: `null` → `'online'` → `'reporting'` → `'disconnected'` → `'unstable'` / `'no_power'` / `'offline'`
  - `disconnected`: Temporary, auto-recovers (stays in active device query)
  - `unstable`: Circuit breaker opened after 3 rapid disconnects (excluded from polling, 5-min backoff)
  - `no_power`: All rapid disconnects < 100ms (excluded from polling, 5-min backoff)
  - `offline`: Admin-set only (excluded from polling, requires admin "Set Online" to restore)
- Disabled auto-recovery of 'offline' devices — admin must use "Set Online" button intentionally
- Frontend now shows distinct badges: "Disconnected" (orange), "Offline" (gray), "Unstable" (orange), "No Power" (red)

### Admin Dashboard: Live Online/Offline Device Control (February 15, 2026)
- **Set Online**: Existing button (green refresh icon) resets `connection_status` to null so device manager reconnects automatically
- **Set Offline**: New button (orange wifi-off icon) sets `connection_status` to 'offline' so device manager stops polling
- **No restart required**: Device manager's `checkForNewDevices()` now detects status changes every polling cycle:
  - Devices marked offline from admin dashboard are removed from the connection pool
  - Devices reset to online from admin dashboard are reconnected (circuit breaker state cleared)
- **Polling log improvement**: Now logs both "parked" AND "driving" devices (previously only logged parked, hiding devices with chassis voltage >= 13.0V)
- **Log alignment**: Parked/driving status labels padded to equal width for consistent column alignment

### Separated Service Status (Truck) from Monitoring (Device) (February 15, 2026)
- **Truck level**: Only has "In Service" / "Not In Service" status, controlled by fleet managers. All trucks are always monitored regardless of status.
- **Device level**: Has "Monitoring On/Off" toggle on device credentials, controlled by admins only. This determines whether the device is polled by the device manager.
- Removed all `t.is_active` (truck) checks from device manager polling queries — only `c.is_active` (device credential) matters now
- Removed "Monitoring" column and toggle from Truck admin UI
- Added Monitoring On/Off toggle button in the device credentials dialog (admin only)
- Fleet routes now strip `isActive` from truck create/update payloads to prevent clients from setting it
- Updated device manager logging: replaced "inactive trucks" log with "monitoring disabled" log for devices with `is_active = false` credentials

### "No Power" Device Status Detection (February 15, 2026)
- Added `no_power` connection status to distinguish powered-off devices from software-unstable devices
- **Detection logic**: When circuit breaker opens, if ALL rapid disconnects had connection durations under 100ms, device is marked `no_power` instead of `unstable` — indicates the PowerMon is reachable on the network but can't sustain a connection because trailer batteries are off
- Updated `markDeviceUnstable()` to accept a `status` parameter ('unstable' or 'no_power')
- Updated device polling query to also skip `no_power` devices
- Updated startup recovery sweep to also reset `no_power` devices on restart
- Admin dashboard shows red "No Power" badge and orange "Unstable" badge in the data status column
- "Set Online" button now also appears for `no_power` devices
- Crash culprit attribution remains `unstable` (can't measure durations when process crashes)

### Device Manager Log Reformatting (February 14-15, 2026)
- Replaced raw JSON log output with colorized, human-readable format
- Logger outputs: dim timestamp, colored level tag (red/yellow/cyan/gray), bold message, key=value pairs
- "Truck parked" logs now show truck name instead of deviceId, both voltages (v1/v2), shorter key names
- Skipped device lists formatted as multi-line with bullets (one per line)
- Polling cycle banner shortened to `=== New Polling Cycle ===`
- Fixed `[object Object]` rendering for offline/unstable device list

### "Set Online" Button for Admin Device Management (February 14, 2026)
- Added `resetDeviceConnectionStatus()` method to `IStorage` interface and `DbStorage` implementation
- Resets `connectionStatus` to null, `consecutiveDisconnects` to 0, clears `markedUnstableAt`/`markedOfflineAt`, sets `status` to 'online'
- Added `useResetDeviceStatus()` mutation hook in `admin-api.ts`
- Added green rotate icon button in admin Devices table actions column
- Button only appears when device `connectionStatus` is 'unstable', 'offline', or 'no_power'
- Clicking shows success toast with device name confirmation

---

## Previous Updates (February 10, 2026)

### InHand Networks GPS Location Poller (February 10, 2026)

**Status**: ✅ IMPLEMENTED (pending deployment)

**Purpose**: 
Fetch precise GPS coordinates (latitude/longitude) from InHand Networks routers installed in trucks. This provides real-time truck location tracking on the map, complementing the existing SIMPro poller which provides country/network data.

**How It Works**:
1. Polls InHand API every 2 minutes (`GET /api/devices?verbose=50`)
2. Each InHand device has a "Phone" field = the SIM's MSISDN number
3. Matches InHand Phone number to our SIM record's MSISDN (same identifier, e.g., `883190603571828`)
4. If the SIM is linked to a truck, updates the truck's latitude/longitude
5. Both SIMPro (country/network) and InHand (GPS lat/long) run in parallel

**Authentication**:
- OAuth2 password grant using InHand login credentials
- Access tokens valid ~1 hour, auto-refreshed
- Client ID/secret optional (tries without them first)
- Falls back to `/api/login` endpoint if OAuth token endpoint fails

**Device Matching Strategy**:
- MSISDN (Wireless Logic/SIMPro) = Phone number (InHand Networks)
- Both use the same SIM identifier (e.g., `883190603571828`)
- Lookup: InHand device → SIM record (by MSISDN) → Truck (by truck_id)

**No Database Changes Required**:
- `trucks` table already has `latitude`, `longitude`, `last_location_update` columns
- `sims` table already has `msisdn` column with index

**Environment Variables** (for EC2 Device Manager):
- `INHAND_API_USERNAME` - InHand login email
- `INHAND_API_PASSWORD` - InHand login password
- `INHAND_API_BASE_URL` - `https://na.inhandcloud.com` (default, North America)
- `INHAND_CLIENT_ID` - OAuth2 client ID (optional)
- `INHAND_CLIENT_SECRET` - OAuth2 client secret (optional)
- `INHAND_POLL_INTERVAL_MS` - Poll interval in ms (default: 120000 = 2 minutes)

**Files Changed**:
- `device-manager/app/config.js` - Added InHand config section
- `device-manager/app/inhand-client.js` - New: OAuth2 API client with token management
- `device-manager/app/inhand-poller.js` - New: GPS location poller with MSISDN matching
- `device-manager/app/index.js` - Wired InHand poller into startup/shutdown
- `scripts/migrations/2026-02-10_add_inhand_gps_poller.sh` - Deployment script

**Deployment**:
1. Deploy code via normal CI/CD (GitHub Actions)
2. Run `scripts/migrations/2026-02-10_add_inhand_gps_poller.sh` to add env vars on EC2
3. Restart Device Manager service

### Admin Device Dialog Fix (February 10, 2026)

**Status**: ✅ IMPLEMENTED

- Fixed device assignment dialog to show device name when serial number is empty
- Displays: serial number → device name → "Device #ID" (in fallback order)
- Example: Shows "DCL-Kalitta-Hospitality" instead of empty string

---

## Previous Updates (January 27, 2026)

### Production Redeploy (January 27, 2026)
- Triggering fresh deploy to AWS after confirming build passes locally
- All recent changes: inactive truck exclusion, instant activation/deactivation, admin INACTIVE badge

## Previous Updates (January 25, 2026)

### Device Manager: Inactive Truck Exclusion & Instant Reactivation (January 25, 2026)

**Status**: ✅ IMPLEMENTED

**Problem**:
Two devices (DCL-Thibert, DCL-Elite-Hospitality) were crashing the device manager's native PowerMon library. They connect briefly (2-3ms) then disconnect, causing SIGABRT crashes and restart loops.

**Root Cause**:
The native C++ library crashes when devices rapidly disconnect. The recovery mechanisms were inadvertently resetting device status, causing repeated connection attempts.

**Solution**:
1. **Inactive Truck Exclusion**: Devices with inactive trucks are now excluded from ALL polling:
   - Initial device loading
   - Offline recovery (10-minute cycle)
   - Unstable recovery (5-minute cycle)
   
2. **Instant Reactivation**: When a truck is set back to active, the device is detected and connected within ~10 seconds (at the start of the next polling cycle). No need to wait for the 5-minute refresh.

3. **Status Preservation Fix**: Fixed `markDeviceDisconnected` to preserve 'unstable' status:
   ```sql
   WHEN connection_status = 'unstable' THEN 'unstable'
   ```

4. **Visibility Logging**: Added logging for devices skipped due to inactive trucks.

**How to Disable/Enable a Device**:
- **Disable**: Set the truck as inactive in admin dashboard → device excluded within 10 seconds
- **Enable**: Set the truck as active in admin dashboard → device connected within 10 seconds

**Files Changed**:
- `device-manager/app/database.js` - Added inactive truck logging, fixed status preservation
- `device-manager/app/connection-pool.js` - Added `checkForNewDevices()` method
- `device-manager/app/polling-scheduler.js` - Calls `checkForNewDevices()` at start of each polling cycle

---

### Device Manager: Automatic Offline Device Recovery (January 25, 2026)

**Status**: ✅ IMPLEMENTED

**Feature**:
Added automatic recovery for offline devices. The device manager now periodically checks if powered-off devices have come back online and automatically reconnects them.

**How It Works**:
1. Every 10 minutes, the device manager checks for offline devices
2. Before attempting connection, it **pings the applink URL** to check if the device router is reachable
3. If reachable → attempts full connection
4. If successful → device is brought back online and added to polling
5. If unreachable or connection fails → updates backoff timer and tries again in 10 minutes

**Why Ping First?**
The native PowerMon C++ library crashes (ABRT signal) when attempting to connect to unreachable devices. The ping check prevents this by verifying the device router is accessible before the connection attempt.

**New Database Column**:
- `power_mon_devices.marked_offline_at` - Tracks when a device was marked offline (for backoff timing)

**Files Changed**:
- `shared/schema.ts` - Added `markedOfflineAt` column
- `device-manager/app/database.js` - Added `getOfflineDevicesForRecovery()` and `updateMarkedOfflineAt()`
- `device-manager/app/connection-pool.js` - Added `pingApplinkUrl()` helper and `recoverOfflineDevices()` method
- `device-manager/app/index.js` - Added 10-minute recovery interval

**Production Deployment**:
```bash
# 1. Run database migration (add marked_offline_at column)
./scripts/migrations/2026-01-25_add_offline_recovery.sh

# 2. Deploy device manager on EC2
cd /opt/device-manager
sudo git pull origin main
sudo systemctl restart device-manager
```

---

### Device Manager: Fix Offline Device Polling Crash (January 24, 2026)

**Status**: ✅ IMPLEMENTED

**Problem**:
The device manager was crashing repeatedly when powered-off devices (13: DCL-Thibert, 15: DCL-Elite-Hospitality) were being polled. The native Thornwave PowerMon C++ library crashes with ABRT signal when attempting to connect to unreachable devices.

**Root Cause**:
- The database query `getActiveDevicesWithCredentials()` only excluded devices with `connection_status = 'unstable'`
- Devices that were simply powered off had `connection_status = 'offline'` and were still being polled
- The native library crashes before our circuit breaker can detect the rapid disconnect pattern

**Solution**:
Updated the device manager to skip both 'offline' AND 'unstable' devices during polling:

```sql
-- Before (only skipped unstable):
WHERE d.connection_status != 'unstable'

-- After (skips both):
WHERE d.connection_status NOT IN ('unstable', 'offline')
```

**Status Definitions**:
| Status | Meaning | Action |
|--------|---------|--------|
| `online` | Device is connected and reporting | Normal polling |
| `offline` | Device is powered off/unreachable (temporary) | Skip polling, check periodically |
| `unstable` | Device has hardware/firmware issues | Skip polling, needs manual intervention |

**Files Changed**:
- `device-manager/app/database.js` - Updated `getActiveDevicesWithCredentials()` query
- `scripts/migrations/2026-01-24_fix_offline_device_polling.sh` - Deployment script

**Production Deployment**:
```bash
# On EC2 instance:
cd /opt/device-manager
sudo git pull origin main
sudo systemctl restart device-manager
```

**To mark a device as offline (skip polling)**:
```bash
psql "$DATABASE_URL" -c "UPDATE power_mon_devices SET connection_status = 'offline' WHERE id = <device_id>;"
```

---

## Previous Updates (January 15, 2026)

### Integration Tests for Fleet Dashboard (January 15, 2026)

**Status**: ✅ IMPLEMENTED

**What Changed**:
Added comprehensive integration tests for the Fleet Dashboard data flow, covering truck status detection logic (Parked/Idling/Driving), fuel savings calculations, and state transitions.

**Test Coverage** (43 tests):

| Test File | Tests | Description |
|-----------|-------|-------------|
| **fleet-dashboard.test.ts** | 25 | Unit tests for status detection logic |
| **api-integration.test.ts** | 18 | API endpoint integration tests |

**Unit Tests (fleet-dashboard.test.ts)**:
| Category | Tests | Description |
|----------|-------|-------------|
| Parked Status | 3 | Voltage below threshold, edge cases |
| Driving Status | 4 | Movement detection, 30-min buffer, legacy fallback |
| Idling Status | 4 | No movement, buffer expired, warming up |
| Boundary Tests | 2 | Threshold edge cases |
| State Transitions | 4 | All valid state changes |
| Fuel Savings | 5 | Calculation accuracy |
| Constants | 3 | Threshold validation |

**API Integration Tests (api-integration.test.ts)**:
| Category | Tests | Description |
|----------|-------|-------------|
| GET /trucks | 4 | List trucks, specific truck, 404 handling |
| GET /devices | 3 | List devices, device details |
| GET /snapshots | 3 | Snapshot data with voltage/SoC |
| GET /shelly-snapshots | 2 | Movement status from Shelly sensors |
| GET /fleets | 1 | Fleet listing |
| GET /dashboard/stats | 2 | Fleet statistics and device counts |
| Data Flow Validation | 4 | Truck↔Device↔Snapshot correlation |

**Shared Module Created**: `shared/truck-status.ts`
- Extracted status detection logic into testable pure functions
- `determineTruckStatus()` - Three-state detection with all logic
- `calculateFuelSavings()` - Fuel savings calculation
- Exported constants: `PARKED_VOLTAGE_THRESHOLD`, `IDLE_BUFFER_MINUTES`, `GALLONS_PER_HOUR_IDLING`

**Files Changed**:
- `vitest.config.ts` - Test framework configuration
- `tests/fleet-dashboard.test.ts` - 25 unit tests for status detection
- `tests/api-integration.test.ts` - 18 API endpoint integration tests
- `shared/truck-status.ts` - Shared status detection logic
- `client/src/lib/api.ts` - Refactored to use shared module

**Run Tests**:
```bash
npx vitest run          # Run all tests
npx vitest run --watch  # Watch mode
```

---

### Three-State Status Detection with 30-Minute Buffer (January 15, 2026)

**Status**: ✅ IMPLEMENTED

**What Changed**:
Implemented three-state truck status detection with a 30-minute buffer to prevent false "Idling" status at stoplights, stop-and-go traffic, and quick fuel stops.

| Transition | Condition | Delay |
|------------|-----------|-------|
| ANY → **PARKED** | V2 < 13.0V (engine off) | Immediate |
| PARKED → **IDLING** | V2 ≥ 13.0V + Shelly exists + no movement | Immediate |
| PARKED → **DRIVING** | V2 ≥ 13.0V + no Shelly (legacy fallback) | Immediate |
| IDLING → **DRIVING** | Movement detected by Shelly | Immediate |
| DRIVING → **IDLING** | No movement for 30+ min | 30 min buffer |

**Key Implementation Details**:
1. New field: `shelly_snapshots.last_movement_at` - Tracks when movement was last detected
2. Webhook updates `lastMovementAt` only when `isMoving = true` (preserves last known value)
3. Frontend calculates time since last movement to determine if 30-min threshold exceeded
4. Fallback: Trucks without Shelly sensors default to "Driving" when engine on

**Files Changed**:
- `shared/schema.ts` - Added `lastMovementAt` timestamp to `shellySnapshots`
- `server/api/shelly-routes.ts` - Webhook updates `lastMovementAt` when moving
- `server/db-storage.ts` - Conditional update to preserve `lastMovementAt` when not moving
- `server/api/fleet-routes.ts` - Added `/shelly-snapshots` endpoint
- `client/src/lib/api.ts` - Added 30-minute buffer logic

**Production Migration**:
```bash
cd /Users/amoeck/Development/Fleet-manager
./scripts/migrations/2026-01-15_add_shelly_last_movement_at.sh
```

**Current Test Status**:
- GFR-70 (truck_id: 2) has Shelly sensor: `ShellyPlusUni-78421C548C5C`
- After moving, status stays "Driving" for 30 minutes even if stopped
- After 30+ minutes without movement (engine on) → "Idling"
- Engine off (V2 < 13.0V) → "Parked" (immediate)

---

### Test Drive Data Collection & Analysis (January 15, 2026)

**Status**: ✅ Data collection working, calibration in progress

**Test Drive Summary**:
- 115 readings collected over ~31 minutes
- Route: City streets with stop lights → Freeway in traffic → Back to shop
- POT sensitivity may need adjustment (turned too low)

**Frequency Analysis from Test Drive**:
| State | Frequency Range | Notes |
|-------|----------------|-------|
| **Idling (at stop light)** | 0-20 Hz | Engine running, not moving |
| **City Driving** | 20-60 Hz | Variable, stop-and-go |
| **Highway/Fast Driving** | 60-160 Hz | Higher vibration from road |

**Issues Identified**:
1. **Voltage not being captured** - Readings show NULL for voltage column. Need to investigate why voltage isn't coming through the webhook.
2. **POT sensitivity** - May be set too low, causing gaps in data during idle periods

**Next Steps (January 16)**:
1. Fix voltage capture in webhook handler
2. Adjust POT sensitivity slightly higher
3. Another short test drive to validate thresholds
4. Implement state machine with voltage + frequency

**Key Insight**: Voltage is the cleanest signal for engine on/off (14.2V charging vs 12.7V off). Frequency then distinguishes moving vs stopped.

---

## Previous Updates (January 14, 2026)

### Shelly Vibration Sensor Integration COMPLETE (January 14, 2026)

**Status**: ✅ LIVE AND WORKING IN PRODUCTION

**Webhook URL**:
```
https://app.deecell.com/api/v1/shelly/vibration?device_id=ShellyPlusUni-78421C548C5C&pulse_count=$total
```

**How It Works**:
1. Shelly sends GET request with `$total` (cumulative pulse count)
2. Server calculates frequency: `(current_count - last_count) / elapsed_seconds`
3. Frequency compared to threshold (default 10 Hz) → determines `is_moving`
4. Updates `shelly_devices` and `shelly_snapshots` tables

**Database Tables**:
- `shelly_devices` - Device registration, last reading, movement status
- `shelly_snapshots` - Historical vibration readings per truck

**Key Fields Added**:
- `last_pulse_count` - Previous $total value from Shelly
- `last_pulse_count_at` - When we received last pulse count
- `last_frequency` - Calculated Hz from pulse delta

**First Production Device**:
- Device ID: `ShellyPlusUni-78421C548C5C`
- Assigned to: GFR-70 (truck_id: 2, org_id: 2)
- Name: "GFR-70 Vibration Sensor"

---

### Shelly Plus Uni Vibration Sensor Setup (January 14, 2026)

**Purpose**: Detect truck movement states (Driving, Idling, Parked) using a vibration sensor connected to a Shelly Plus Uni WiFi controller.

**Hardware Components**:
1. **Shelly Plus Uni** - Universal WiFi sensor input controller
2. **DC-DC Converter** - 12-24V input → 5V output to power the Shelly
3. **SW-420 Vibration Sensor Module** - Digital output vibration sensor with adjustable sensitivity

**Final Wiring Configuration**:
| Connection | Wire Color | Wire # |
|------------|------------|--------|
| DC-DC +5V → Shelly +5VDC | Gray | #6 |
| DC-DC GND → Shelly GND | Green | #7 |
| Sensor VCC → Shelly SENSOR VCC | Yellow | #9 |
| Sensor GND → Shelly GND | Green | #7 |
| Sensor DO → Shelly COUNT IN | Purple | #8 |

**Key Configuration Decisions**:
- Used **COUNT IN (Input 2)** instead of IN1/IN2 for frequency measurement (Hz)
- IN1/IN2 use active-low logic (require "Invert" setting); COUNT IN doesn't need inversion
- Frequency measurement allows distinguishing: Parked (0 Hz), Idling (1-10 Hz), Driving (10+ Hz)

**Shelly Network Configuration**:
- IP Address: 192.168.1.240
- Connected to DCL Hauler router with internet access
- HTTP API webhook sends data to app.deecell.com

**Documentation Created**:
- `docs/SHELLY_VIBRATION_SENSOR_SETUP.md` - Comprehensive setup guide with wiring diagrams, API examples, and troubleshooting

**Next Steps**:
1. Calibrate Hz thresholds for real-world driving conditions
2. Add Shelly status to the Fleet Dashboard UI
3. Test with truck engine running to establish idle vs driving thresholds

---

## Previous Updates (January 10, 2026)

### Admin Dashboard kWh Calculation Fix (January 10, 2026)

**Problem**: After updating a device's battery count in the admin dashboard, the kWh value wasn't updating immediately. The fleet dashboard showed the correct value (20.48 kWh) but the admin dashboard showed the old value (10.28 kWh).

**Root Cause**: The admin dashboard was displaying `snapshot.energy` from the Device Manager, which caches battery configuration at connection time. Editing the device in the UI updated the database, but the running Device Manager still had the old values.

**Fix**: Updated admin dashboard to calculate kWh on-the-fly using current device settings:
- Formula: `kWh = (SoC/100) × batteryVoltage × (numberOfBatteries × batteryAh) / 1000`
- Uses `device.batteryVoltage`, `device.numberOfBatteries`, `device.batteryAh` from the database
- Changes to battery configuration now reflect immediately without restarting Device Manager

**Files Changed**:
- `client/src/pages/admin/DevicesPage.tsx` - Calculate kWh on-the-fly instead of using snapshot.energy

---

### Device Connection Timing Logs (January 10, 2026)

**Purpose**: Added detailed timing logs to track how long each device takes to connect during Device Manager startup and refresh operations. This helps diagnose slow startup times and identify problematic devices.

**New Logging Features**:
1. **Startup Summary**: Logs total startup time with success/failed/skipped/timedOut counts
2. **Per-Device Timing**: Each device connection logs its duration in milliseconds
3. **Slow Device Detection**: Warns about devices taking >5 seconds to connect
4. **Refresh Timing**: New devices added via refresh() also log connection timing

**Sample Log Output**:
```
=== STARTUP: Connecting to all devices === { deviceCount: 11, timestamp: "..." }
Connecting device 1/11 { serialNumber: "1A81067CFA117B5B", deviceName: "DCL-Curtis-2", cohort: 3 }
Device 1/11 connected { serialNumber: "1A81067CFA117B5B", durationMs: 2341 }
...
=== STARTUP COMPLETE: Connection Summary === { success: 10, failed: 1, timedOut: 1, totalDurationMs: 47523, averageDurationMs: 4320 }
Slow connections detected { count: 2, devices: [...] }
```

**Files Changed**:
- `device-manager/app/connection-pool.js` - Updated `connect()` to return timing object, enhanced `connectAll()` and `refresh()` with detailed logging

---

### Circuit Breaker Bug Fix (January 10, 2026)

**Problem**: All devices were being marked as "unstable" after a few poll cycles, even though they were working correctly.

**Root Cause**: The circuit breaker was counting ALL disconnects as "rapid disconnects" - including intentional disconnects after successful polls. Since each poll cycle connects, fetches data, and disconnects within 5 seconds, every normal poll was counting toward the circuit breaker threshold.

**Fix**:
1. Added `intentionalDisconnect` flag to `DeviceConnection` class
2. The `disconnect()` method now sets this flag to `true` before calling the native disconnect
3. The `onDisconnect` handler has 3 paths:
   - **Connection phase failures**: Track in DB, count toward circuit breaker
   - **Intentional disconnects**: Don't track in DB, don't schedule reconnect
   - **Unexpected disconnects**: Track in DB, count toward circuit breaker, schedule reconnect
4. Successful polls reset in-memory `rapidDisconnectCount` AND persist to DB via new `db.resetDeviceDisconnects()`
5. Poll failure path (3 consecutive failures) explicitly clears `intentionalDisconnect = false` to ensure any native onDisconnect is tracked as error
6. Database persistence via existing `markDeviceReporting()` (resets `consecutive_disconnects = 0` when measurements written)
7. Database persistence via existing `markDeviceConnected()` (resets on connect)

**New Database Method**:
- `db.resetDeviceDisconnects(deviceId)` - Resets `consecutive_disconnects = 0` in power_mon_devices table

**Logic Change**:
- **Before**: Any disconnect within 5s of connect = rapid disconnect (broken)
- **After**: Only ERROR disconnects within 5s = rapid disconnect (correct)

**Files Changed**:
- `device-manager/app/connection-pool.js` - Added intentional disconnect tracking and 3-path onDisconnect logic
- `device-manager/app/database.js` - Added `resetDeviceDisconnects()` method for persistence

---

### Truck-Based Device Polling Control (January 10, 2026)

**Purpose**: Device Manager polling now follows the truck's `is_active` status instead of the device's own `is_active` flag. This prevents scenarios where a truck is active but its device is not being polled.

**Logic**:
- If a device is assigned to a truck → polls only if the truck's `is_active = true`
- If a device is unassigned (truck_id IS NULL) → always polls (for testing before assignment)
- Setting a truck to Inactive stops polling for its PowerMon device automatically

**UI Changes**:
- Added Active/Inactive column to Trucks admin table
- Added Active/Inactive toggle in Edit Truck dialog
- Consistent with other admin pages (Organizations, Users, Fleets)

**Device Manager Query Changes**:
- `getActiveDevicesWithCredentials()` - Now JOINs trucks table and checks `t.is_active`
- `getUnstableDevicesReadyForRecovery()` - Same truck-based filter for recovery attempts
- Skipped unstable devices log also updated to use truck's is_active

**Files Changed**:
- `client/src/pages/admin/TrucksPage.tsx` - Added Active column and edit toggle
- `device-manager/app/database.js` - Updated 3 queries to use truck's is_active

---

## Previous Updates (January 9, 2026)

### Device Registration UX Improvement (January 9, 2026)

**Purpose**: Streamline device registration by removing the serial number field since it's auto-populated from the PowerMon on first connection.

**Changes**:
- Removed serial number input from the Register Device dialog
- Register button no longer requires serial number to be filled
- Edit Device dialog still displays serial number as read-only (for reference)
- Form state and reset function updated to exclude serialNumber

**Files Changed**:
- `client/src/pages/admin/DevicesPage.tsx` - Removed serial number field from create dialog

---

### Admin Dashboard Auto-Refresh (January 9, 2026)

**Purpose**: Keep admin dashboard data fresh with automatic polling, matching Fleet dashboard behavior.

**Implementation**:
- Added `ADMIN_POLL_INTERVAL = 10000` (10 seconds) constant
- Applied `refetchInterval` to key admin queries:
  - `useAdminStats()` - Dashboard statistics
  - `useAdminOrganizations()` - Organization list
  - `useAdminDevices()` - Devices list (all orgs and org-specific)

**Files Changed**:
- `client/src/lib/admin-api.ts` - Added refetchInterval to React Query hooks

---

### Unit Display Updates (January 9, 2026)

**Purpose**: Display power and energy in more readable units (kW/kWh instead of W/Wh).

**Changes**:
- Power column: Changed from "P (W)" to "P (kW)" - values divided by 1000
- Energy column: Changed from "Wh" to "kWh" - values divided by 1000
- Removed Ah column from admin devices table (not needed)

**Files Changed**:
- `client/src/pages/admin/DevicesPage.tsx` - Updated column headers and value formatting
- `client/src/components/FleetTable.tsx` - Same updates for Fleet dashboard

---

### Calculated Wh Implementation (January 9, 2026)

**Purpose**: Replace unreliable PowerMon energy meter data with calculated Wh based on battery configuration and real-time SoC readings.

**Formula**: 
```
Wh = (SoC/100) × batteryVoltage × (numberOfBatteries × batteryAh)
```

**Data Sources**:
- `batteryVoltage`, `numberOfBatteries`, `batteryAh` → from device configuration in `power_mon_devices` table
- `SoC` → real-time reading from PowerMon device

**Implementation**:

1. **database.js** - Updated queries to include battery config:
   - `getActiveDevicesWithCredentials()` - Added `battery_voltage`, `number_of_batteries`, `battery_ah`
   - `getDevicesNeedingBackfill()` - Added same fields for historical data sync

2. **connection-pool.js** - DeviceConnection class changes:
   - Constructor stores battery config (`batteryVoltage`, `numberOfBatteries`, `batteryAh`)
   - Added `calculateWh(soc)` method implementing the formula
   - `poll()` method uses calculated Wh, falls back to `data.energyMeter` if config missing

3. **backfill-service.js** - Historical data sync changes:
   - Added `calculateWh()` helper function
   - `processBackfill()` calculates Wh for each sample, falls back to `sample.energy` if config missing

**Fallback Behavior**: If battery configuration is missing (null values), the system falls back to using the raw PowerMon energy meter data.

**Files Changed**:
- `device-manager/app/database.js` - SQL query updates
- `device-manager/app/connection-pool.js` - Battery config storage and Wh calculation
- `device-manager/app/backfill-service.js` - Wh calculation for historical data

**Deployment Note**: Deploy Device Manager to EC2 for changes to take effect. Database already has `battery_voltage`, `number_of_batteries`, `battery_ah` columns in `power_mon_devices` table.

---

### Admin Devices Table Redesign (January 9, 2026)

**Purpose**: Redesigned the admin Devices table to match the Figma design, showing real-time device metrics from the latest snapshot data.

**New Table Columns**:
| Column | Description |
|--------|-------------|
| Serial Number - Name | Stacked layout: serial (mono font) on top, device name below |
| Assigned Truck | Badge showing linked truck number |
| Data Status | Color-coded pill: Reporting (green), Stale (orange), No data (gray) |
| Last Reported | Date and time on separate lines |
| V1 | Chassis voltage from PowerMon |
| SoC (%) | State of charge - color-coded: green ≥50%, orange ≥20%, red <20% |
| V2 | Sleeper cab voltage |
| P (kW) | Power consumption |
| Wh | Energy (watt-hours) |
| Ah | Charge (amp-hours) |
| Temp (°F) | Temperature converted from Celsius |

**Backend Changes**:
- Added `listDevicesWithSnapshots(orgId)` method to join devices with latest snapshot
- Added `listAllDevicesWithSnapshots()` method for admin view across all orgs
- Updated admin routes `/api/admin/devices` and `/api/admin/organizations/:orgId/devices`

**Frontend Changes**:
- Updated `DevicesPage.tsx` with new column layout
- Added `DeviceWithSnapshot` type to `admin-api.ts`
- Dark header styling (bg-[#303030]), alternating row backgrounds
- Sortable columns: Serial Number, Assigned Truck, Data Status, Last Reported, SoC, Temp

**Files Changed**:
- `server/api/admin-routes.ts` - Updated device endpoints to use snapshot methods
- `server/db-storage.ts` - Added snapshot join methods
- `server/storage.ts` - Added interface methods
- `client/src/pages/admin/DevicesPage.tsx` - New table layout
- `client/src/lib/admin-api.ts` - Added DeviceWithSnapshot type

---

### IAM Permissions Documentation (January 9, 2026)

Created comprehensive IAM documentation at `docs/IAM_PERMISSIONS.md` covering:
- ECS Execution Role (container startup permissions)
- ECS Task Role (runtime permissions)
- Device Manager EC2 Role (PowerMon/SIM polling)
- GitHub Actions User (CI/CD automation)
- All Secrets Manager resources
- S3 buckets and access patterns
- Security best practices applied
- Troubleshooting guide

---

### Migration Script Workflow (January 8, 2026)

Established new workflow for production database migrations:
- All migrations now have runnable scripts in `scripts/migrations/`
- Scripts are self-contained with embedded SQL
- Naming convention: `YYYY-MM-DD_description.sh`
- Template available at `scripts/migrations/_TEMPLATE.sh`
- User runs from MacBook: `./scripts/migrations/2026-01-08_add_shelly_tables.sh`

---

### New Hire Developer Setup Guide (January 8, 2026)

Created comprehensive onboarding documentation for new developers at `docs/NEW_HIRE_DEVELOPER_SETUP.md`.

**Covers**:
- Homebrew, AWS CLI, and Git installation
- AWS credentials configuration
- Session Manager plugin installation (Intel and Apple Silicon)
- GitHub Personal Access Token setup
- Repository cloning with correct URL
- Production database migration workflow
- Troubleshooting common issues

---

### Shelly Plus Uni Vibration Sensor Integration (January 8, 2026)

**Purpose**: Add support for Shelly Plus Uni devices with SW-420 vibration sensors to detect truck movement, enabling accurate differentiation between Driving, Idling, and Parked states.

**Background**: Currently we can only detect engine state (on/off) via chassis voltage from PowerMon devices. We cannot distinguish between a truck that is driving vs idling because we lack engine RPM, GPS/speed, or cell tower location data.

**Hardware Solution** (~$15/truck):
- Shelly Plus Uni controller
- SW-420 vibration sensor
- 12V-to-5V buck converter (for powering Shelly from truck power)

**Detection Logic**:
- High vibration frequency (≥10 pulses/min) + Engine On = **Driving**
- Low vibration frequency + Engine On (V > 13.8V) = **Idling**
- Low vibration frequency + Engine Off (V ≤ 13.8V) = **Parked**

**Implementation**:

1. **New Database Tables**:
   - `shelly_devices` - Device registry (org_id, truck_id, device_id, device_name, connection_status, last_frequency, is_moving)
   - `shelly_snapshots` - Latest readings for fast dashboard queries

2. **New API Endpoints**:
   - `POST /api/v1/shelly/vibration` - Webhook for vibration data from Shelly devices
   - `POST /api/v1/shelly/heartbeat` - Heartbeat to maintain online status
   - `GET /api/v1/shelly/devices` - List all Shelly devices
   - `POST /api/v1/shelly/check-offline` - Mark devices offline if no data in 2+ minutes

3. **Device Naming Convention**: `{TruckName}-Vibration` (e.g., DCL-Moeck-Vibration)

4. **Connection Monitoring**: Heartbeat every 60 seconds; marked offline if no data in 2+ minutes

**Files Changed**:
- `shared/schema.ts` - Added `shellyDevices` and `shellySnapshots` tables
- `server/storage.ts` - Added Shelly interface methods
- `server/db-storage.ts` - Implemented Shelly storage methods
- `server/api/shelly-routes.ts` - New webhook endpoints
- `server/routes.ts` - Registered Shelly routes
- `migrations/shelly_devices_production.sql` - Production SQL for CloudShell

**Shelly Script Behavior**:

The Shelly Plus Uni runs an onboard script that:
1. **Auto-detects Device ID** - Uses `${info.id}` to get its own MAC/serial automatically
2. **Monitors input:2 frequency** - Reads `${status['input:2'].freq}` from the SW-420 vibration sensor (connected to the counter/purple wire)
3. **Event-driven webhook** - POSTs to our endpoint whenever "Moving" logic is triggered (not polling at fixed intervals)

**Webhook Payload**:
```
POST https://app.deecell.com/api/v1/shelly/vibration?device_id={shelly_mac}&frequency={pulses_per_min}
```

Example: `?device_id=shellyuniplus-a1b2c3d4e5f6&frequency=15`

**Backend Processing**:
- Creates/updates Shelly device record (auto-registers on first webhook)
- Stores frequency reading in `shelly_snapshots` table
- Sets `is_moving = true` if frequency ≥ 10 pulses/min
- Combines with PowerMon voltage data to determine truck state:
  - `is_moving=true` + Engine On → **Driving**
  - `is_moving=false` + Engine On (V > 13.8V) → **Idling**
  - `is_moving=false` + Engine Off (V ≤ 13.8V) → **Parked**

**Shelly Device Setup (before deployment)**:
1. Connect to Shelly's AP WiFi (`ShellyPlusUni-XXXXXXXX`)
2. Open `192.168.33.1` in browser
3. Go to Settings → Device Name → Set to `{TruckName}-Vibration`
4. Go to Settings → Wi-Fi → Connect to truck's router WiFi
5. Configure input:2 as counter type for vibration frequency
6. Add script that monitors frequency and calls webhook on movement trigger

**Production Migration**:
```bash
# Via CloudShell:
psql $DATABASE_URL -f migrations/shelly_devices_production.sql
```

---

## Previous Updates (January 7, 2026)

### SendGrid Email Configuration for AWS Production (January 7, 2026)

**Issue**: Welcome emails were not being sent in production because the SENDGRID_API_KEY was not configured in AWS.

**Solution**: Added SendGrid API key to AWS Secrets Manager and updated ECS configuration:

1. **Created Secret in AWS Secrets Manager**:
   ```bash
   aws secretsmanager create-secret \
     --name "deecell-fleet-production/sendgrid-api-key" \
     --secret-string "$(cat /path/to/key.txt)" \
     --region us-east-2
   ```

2. **Updated IAM Policy**: Added the SendGrid secret ARN to the ECS execution role's allowed secrets:
   ```bash
   aws iam put-role-policy \
     --role-name deecell-fleet-production-ecs-execution-role \
     --policy-name deecell-fleet-production-ecs-execution-policy \
     --policy-document file:///tmp/updated-policy.json
   ```

3. **Created New Task Definition (revision 116)**: Added SENDGRID_API_KEY to the secrets array referencing the Secrets Manager ARN.

4. **Forced New Deployment**:
   ```bash
   aws ecs update-service --cluster deecell-fleet-production-cluster \
     --service deecell-fleet --task-definition deecell-fleet-production:116 \
     --force-new-deployment --region us-east-2
   ```

**Key AWS Resources**:
- Secret ARN: `arn:aws:secretsmanager:us-east-2:892213647605:secret:deecell-fleet-production/sendgrid-api-key-HRu3fw`
- ECS Cluster: `deecell-fleet-production-cluster`
- ECS Service: `deecell-fleet`
- Task Definition: `deecell-fleet-production:116`

**Verification**: Welcome emails now send successfully when creating new users with "Send welcome email" checked.

---

### Circuit Breaker Recovery Implementation (January 7, 2026)

**Issue**: Devices marked as "unstable" by the circuit breaker were stuck indefinitely - they would never automatically recover and attempt reconnection.

**Root Cause**: The circuit breaker correctly detected rapid disconnects and marked devices as unstable, but there was no scheduler to attempt recovery after the backoff period expired.

**Solution**: Implemented automatic recovery for unstable devices:

1. **New Schema Column**: Added `marked_unstable_at` timestamp to track when devices became unstable
2. **Database Functions**: 
   - `getUnstableDevicesReadyForRecovery(backoffMs)` - finds devices that have been unstable longer than the backoff period
   - `markDeviceUnstable(deviceId)` - sets timestamp when marking unstable
   - Updated `markDeviceConnected` to reset `marked_unstable_at` to NULL on successful reconnection
3. **Recovery Scheduler**: Runs every 5 minutes to:
   - Query for unstable devices past their 5-minute backoff
   - Attempt reconnection for each
   - If successful, device returns to normal polling
   - If failed, restarts the 5-minute backoff timer

**Files Changed**:
- `shared/schema.ts` - Added `markedUnstableAt` column
- `device-manager/app/database.js` - Added recovery functions
- `device-manager/app/connection-pool.js` - Added `recoverUnstableDevices()` method
- `device-manager/app/index.js` - Added periodic recovery scheduler

**Production Migration Required**:
```bash
psql "$DATABASE_URL" -c "ALTER TABLE power_mon_devices ADD COLUMN IF NOT EXISTS marked_unstable_at TIMESTAMP WITH TIME ZONE;"
```

### Production Database Migration Documentation (January 7, 2026)

**Added**: Comprehensive "Production Database Schema Migrations" section to `device-manager/DEPLOYMENT.md` covering:
- Step-by-step guide to run migrations on AWS RDS
- How to connect to EC2 via SSM
- How to install psql on Ubuntu
- How to export DATABASE_URL from Secrets Manager
- Example SQL commands for common operations
- Best practices table (do's and don'ts)
- Quick reference checklist

---

### Device Manager EC2 Manual Bootstrap (January 7, 2026)

**Context**: After AWS account suspension and recovery, the Device Manager EC2 instance was terminated. A new instance was launched but GitHub Actions deployment failed with "deploy.sh not found" because the fresh instance wasn't bootstrapped.

**Solution**: Documented and executed a manual bootstrap process via AWS CloudShell.

**Bootstrap Steps Summary**:
1. Connect via SSM Session Manager from CloudShell
2. Install Node.js 20, build-essential, AWS CLI v2
3. Install Bluetooth libraries (libbluetooth-dev, libdbus-1-dev)
4. Create `/opt/device-manager` directory
5. Create `deploy.sh` script (pulls from S3, uses `--ignore-scripts` for pre-built native addon)
6. Create `start.sh` script (fetches DATABASE_URL from Secrets Manager at runtime)
7. Download RDS CA certificate bundle
8. Create systemd service
9. Run initial deployment

**Key Learnings**:
- **Pre-built Native Addon**: The `powermon_addon.node` is included in the S3 deployment package. Use `npm ci --ignore-scripts` to skip rebuilding (avoids needing `libpowermon_bin` headers on EC2).
- **SSM Session Runs as ssm-user**: Must use `sudo -u ubuntu` to run deploy.sh or fix directory permissions.
- **/tmp Permission Issues**: Download to `/home/ubuntu/` instead of `/tmp` when running as ubuntu user.
- **Secrets at Runtime**: The `start.sh` fetches DATABASE_URL from AWS Secrets Manager using the EC2 instance's IAM role.

**Files Updated**:
- `device-manager/DEPLOYMENT.md` - Added comprehensive "Manual EC2 Bootstrap Guide (CloudShell)" section with all 15 steps

**Current State**:
- Device Manager running on instance `i-05443904f977d7301`
- Health endpoint: `http://localhost:3001/health` returning healthy
- 1 PowerMon device connected (serial: A93B7B8CC0D672FE)
- Polling at 10-second intervals with 100% success rate
- SIMPro disabled (credentials not configured)

**Future Deployments**: GitHub Actions will now work since `/opt/device-manager/deploy.sh` exists on the instance.

---

## Previous Updates (January 5, 2026)

### Mobile API for iOS Driver App (January 5, 2026)

**Feature**: Created a dedicated mobile API for truck drivers to monitor their assigned truck's real-time data from an iOS app.

**New Endpoints**:
- `GET /api/v1/mobile/my-truck` - Returns the driver's assigned truck with live data
- `GET /api/v1/mobile/my-truck/history?hours=24` - Returns measurement history for charts

**Response Format** (`/my-truck`):
```json
{
  "truck": {
    "id": 1,
    "truckNumber": "DCL-Carter",
    "make": "Peterbilt",
    "model": "579",
    "year": 2023,
    "status": "in-service"
  },
  "device": {
    "id": 1,
    "deviceName": "DCL-Carter",
    "serialNumber": "...",
    "connectionStatus": "online",
    "dataStatus": "reporting",
    "lastSeenAt": "2026-01-05T18:00:00Z",
    "lastReportedAt": "2026-01-05T18:00:00Z"
  },
  "liveData": {
    "voltage1": 27.5,
    "voltage2": 14.2,
    "soc": 85.3,
    "powerKw": 1.2,
    "energyKwh": 45.6,
    "temperatureC": 25.0,
    "temperatureF": 77.0,
    "current": 12.5,
    "isParked": false,
    "recordedAt": "2026-01-05T18:00:00Z"
  }
}
```

**Schema Changes**:
- Added `assigned_truck_id` column to `users` table
- Added index `user_assigned_truck_idx` for efficient lookups

**Driver Assignment**:
To assign a driver to a truck, update the user record:
```sql
UPDATE users SET assigned_truck_id = <truck_id> WHERE id = <user_id>;
```

**Authentication**: Uses existing session-based auth (same as web app login).

**iOS Integration Notes**:
- Temperature provided in both Celsius and Fahrenheit
- Power converted to kW for display
- All timestamps in ISO 8601 format
- History endpoint supports configurable time range (hours parameter)

**Files Changed**:
- `shared/schema.ts` - Added `assignedTruckId` column to users table
- `server/api/mobile-routes.ts` - New file with mobile API endpoints
- `server/routes.ts` - Registered mobile routes at `/api/v1/mobile`

**Production Deployment Required**:
1. Add column to production database:
   ```sql
   ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_truck_id integer;
   CREATE INDEX IF NOT EXISTS user_assigned_truck_idx ON users (assigned_truck_id);
   ```
2. Deploy new app version to ECS

---

## Previous Updates (December 30, 2025)

### Implemented Circuit Breaker for Unstable Devices (December 30, 2025)

**Goal**: Prevent one problematic device from crashing the entire Device Manager.

**Solution**: Multi-layer circuit breaker pattern:

1. **Database Query Filter** - `getActiveDevices()` now excludes devices with `connection_status = 'unstable'`
2. **Rapid Disconnect Detection** - Tracks disconnects within 5 seconds of connect
3. **In-Memory Circuit Breaker** - Opens after 5 rapid disconnects, 5-minute backoff
4. **Persistent Status** - When circuit breaker opens, immediately marks device as `unstable` in database via `markDeviceUnstable()`
5. **Auto-Marking** - Devices also marked `unstable` in database after 5 consecutive disconnects

**Key Constants** (connection-pool.js):
```javascript
const RAPID_DISCONNECT_THRESHOLD_MS = 5000;  // 5 seconds
const MAX_RAPID_DISCONNECTS = 5;              // Opens circuit after 5 rapid disconnects
const UNSTABLE_BACKOFF_MS = 5 * 60 * 1000;   // 5 minute cooldown
```

**Test Results**: 
- Circuit breaker correctly detects rapid disconnects (device connects for only 2ms before disconnecting)
- Logs "Circuit breaker OPEN" after 5 rapid disconnects
- Skips reconnection attempts while circuit is open
- **Limitation**: Native C++ library crashes so fast that async database call may not complete before process death
- **Workaround**: Keep problematic firmware 0.2 devices disabled (`is_active = false`) until firmware upgrade

**Long-term Fix Needed**:
- Upgrade DCL-Moeck-Shop firmware from 0.2 to 1.18+ to fix the rapid disconnect issue
- Consider adding a startup check that skips devices with recent crashes

**Files Changed**:
- `device-manager/app/database.js` - Added `markDeviceUnstable()`, unstable filter in query, off-by-one fix
- `device-manager/app/connection-pool.js` - Circuit breaker constants, detection logic, persistent status

---

### Fixed Device Manager Crash Loop (December 30, 2025)

**Issue**: Device Manager was crash-looping every ~19 seconds, preventing snapshot data from being saved. Several devices showed "No Data" despite being online.

**Root Cause**: DCL-Moeck-Shop (firmware 0.2) repeatedly failed to connect with "Not connected" errors. After multiple retries, the native PowerMon C++ library (`libpowermon_bin`) crashed with:
```
terminate called without an active exception
Main process exited, code=dumped, status=6/ABRT
```

**Solution**: Disabled the problematic device from polling:
```sql
UPDATE power_mon_devices SET is_active = false WHERE serial_number = '1982A3044D3599E2';
sudo systemctl restart device-manager
```

**Result**: Device Manager now runs stable. All 9 active devices show "Online + Reporting" with current timestamps.

**Long-term Fix Needed**: Upgrade DCL-Moeck-Shop firmware from 0.2 to 1.18+ to fix the connection issue. Then re-enable with `is_active = true`.

---

### Fixed Replit Git Authentication (December 30, 2025)

**Issue**: Git push from Replit failing with "Failed to authenticate with the remote" error.

**Root Cause**: The git remote URL had a stale GitHub PAT embedded directly in it:
```
https://deecell:ghp_OLDTOKEN...@github.com/deecell/Fleet-manager.git
```
When the PAT was regenerated, this embedded token became invalid.

**Solution**: Remove the embedded token from the remote URL:
```bash
git remote set-url origin https://github.com/deecell/Fleet-manager.git
git push origin main
```

Replit then used its OAuth connection (which was still "Active") to authenticate instead of the stale embedded token.

**Lesson Learned**: 
- Never embed tokens directly in git remote URLs
- Use Replit's OAuth connection for authentication (auto-refreshes)
- If git auth breaks, check `git remote -v` for embedded credentials

---

### Production Schema Migration Completed (December 30, 2025)

**Issue**: Production RDS schema was out of sync with the repo schema. Drizzle-kit push was blocked because:
1. Production had columns not in repo (`users.name`, `sims.carrier`, `sims.data_usage_bytes`, `sims.data_limit_bytes`, `schema_version` table)
2. Repo had new dual-status columns not in production

**Solution**: Direct SQL migration via EC2 → RDS (bypassing drizzle-kit's destructive changes)

**Key Learnings**:
- **CloudShell CANNOT reach RDS** - RDS is in private subnet, CloudShell runs outside VPC
- **Use EC2 via SSM** - Device Manager EC2 is in VPC and can reach RDS
- **Direct SQL is simpler** - For schema drift, `ALTER TABLE ADD COLUMN IF NOT EXISTS` is safer than drizzle-kit

**Migration Method**:
```bash
# From CloudShell - connect to EC2 via SSM
INSTANCE_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=*device-manager*" --query '...')
aws ssm start-session --target $INSTANCE_ID
# From EC2 - connect to RDS
psql "postgresql://deecell_admin:***@deecell-fleet-production-postgres.../deecell_fleet"
# Run ALTER TABLE statements with IF NOT EXISTS
```

**Columns Added to Production**:
- `power_mon_devices.last_reported_at` - When device last sent measurement data
- `power_mon_devices.connection_status` - online/offline/unstable
- `power_mon_devices.data_status` - reporting/stale/no_data
- `power_mon_devices.last_disconnect_reason` - Disconnect reason code
- `power_mon_devices.consecutive_disconnects` - Counter for unstable detection
- `savings_config.default_fuel_price_per_gallon`, `use_live_fuel_prices`

**Tables Created**:
- `data_migrations`, `polling_settings`, `sim_sync_settings`, `sim_usage_history`

**Schema Preserved** (already in production, now added to repo):
- `users.name`, `sims.carrier`, `sims.data_usage_bytes`, `sims.data_limit_bytes`, `schema_version` table

---

### Device State Tracking Improvements (December 30, 2025)

**Issue**: Device Manager couldn't distinguish between "device reachable" and "device sending data". A device like DCL-Moeck-Shop with firmware 0.2 would connect but immediately disconnect (reason:2), appearing as "online" because `last_seen_at` updated, but never recording measurement data.

**Solution**: Implemented dual-status tracking system:

1. **Connection Status** - Can we reach the device?
   - `online` - Device is connected
   - `offline` - Can't reach device (in transit, dead zone, powered off)
   - `unstable` - Rapid connect/disconnect loop (5+ consecutive disconnects)

2. **Data Status** - Is the device sending data?
   - `reporting` - Connected AND receiving measurement data
   - `stale` - Connected but NOT receiving data (like DCL-Moeck-Shop)
   - `no_data` - Offline, no data expected

**Schema Changes** (`power_mon_devices` table):
- Added `last_reported_at` - Timestamp when we last received actual measurement data
- Added `connection_status` - ONLINE, OFFLINE, UNSTABLE
- Added `data_status` - REPORTING, STALE, NO_DATA  
- Added `last_disconnect_reason` - Reason code from PowerMon (e.g., 2)
- Added `consecutive_disconnects` - Count to detect unstable connections

**Device Manager Changes**:
- `markDeviceConnected()` - Now resets `consecutive_disconnects` and sets `connection_status = 'online'`
- `markDeviceDisconnected()` - Now tracks disconnect reason, increments consecutive disconnects, marks as 'unstable' after 5+ rapid disconnects
- `markDeviceReporting()` - New function called when measurement data is successfully saved
- Updated `connection-pool.js` to pass disconnect reason code to database

**Admin UI Changes** (`DevicesPage.tsx`):
- Replaced single "Status" column with "Connection" and "Data Status" columns
- Added "Last Reported" column (when we last got data, vs "Last Seen" which is just connectivity)
- Color-coded badges: green (online/reporting), orange (unstable/stale), red/gray (offline/no_data)

**Benefits**:
- Fleet operators can now distinguish between "can't reach truck" vs "truck reachable but device not sending data"
- Unstable devices (firmware issues) are clearly flagged for investigation
- Last Reported vs Last Seen helps identify devices that connect but fail to send data

**Files Changed**:
- `shared/schema.ts` - Added new columns to `power_mon_devices`
- `device-manager/app/database.js` - Added `markDeviceReporting()`, `markDeviceStale()`, updated existing functions
- `device-manager/app/connection-pool.js` - Pass disconnect reason to database
- `device-manager/app/batch-writer.js` - Call `markDeviceReporting()` on successful data save
- `client/src/pages/admin/DevicesPage.tsx` - Updated UI with new status columns

---

## Previous Updates (December 29, 2025)

### Device Manager Snapshot Error Logging & Health Check (December 29, 2025)

**Issue**: Admin page showed device "last seen" as current, but fleet dashboard showed stale data from Dec 21.

**Root Cause Analysis**: 
- Device Manager updates `power_mon_devices.last_seen_at` on successful polls (Admin page uses this)
- Device Manager also should update `device_snapshots.updated_at` (Fleet dashboard uses this)
- If `upsertDeviceSnapshot()` was failing silently, only admin page would show current data

**Improvements Made**:

1. **Enhanced Error Logging in `upsertDeviceSnapshot()`**:
   - Added upfront validation for required fields (deviceId, organizationId)
   - Wrapped database query in try-catch with comprehensive error details
   - Logs PostgreSQL error code, detail, constraint, table, and column on failure
   - Added success logging with device/truck IDs

2. **Individual Snapshot Error Handling in Batch Writer**:
   - Previously, one failed snapshot would fail the entire batch
   - Now handles each snapshot individually - successful ones are removed from queue
   - Failed snapshots stay in queue for retry
   - Uses rolling window for failure tracking (resets on successful batch)

3. **New Health Check Endpoints**:
   - Added `/health/detailed` and `/health/snapshots` endpoints
   - Shows snapshot-specific stats: total written, recent failures, pending retry
   - Shows last write time and age in seconds
   - Detects issues: high failure rate or stale writes when devices connected

**Files Changed**:
- `device-manager/app/database.js` - Enhanced error logging
- `device-manager/app/batch-writer.js` - Individual snapshot handling, rolling window stats
- `device-manager/app/metrics.js` - New detailed health check endpoint

**To Debug the Issue**:
After deployment, check `https://<device-manager-ip>:3001/health/detailed` to see snapshot write status, or check CloudWatch logs for "upsertDeviceSnapshot" errors.

---

### IAM Security Improvements & CloudShell Setup (December 29, 2025)

**Changes**:
1. **Disabled automatic Terraform in GitHub Actions** - Terraform now runs manually via AWS CloudShell for better security (no admin-level permissions in CI/CD)
2. **Created SETUP-NOTES.md** - Comprehensive guide for running Terraform manually including:
   - One-time CloudShell setup commands
   - Step-by-step infrastructure change process
   - Secret retrieval commands
   - IAM cleanup instructions
   - AWS resources reference table
3. **Documented IAM cleanup steps** - Instructions to remove unused policies:
   - `DeecellGitHubActionsPolicy` (manually created, unused)
   - Terraform state permissions (optional, S3/DynamoDB for terraform state)

**Benefits**:
- GitHub Actions IAM user no longer needs admin access
- Least-privilege principle applied to CI/CD
- Infrastructure changes require explicit console login
- Audit trail through CloudShell history

**Files Changed**:
- `.github/workflows/terraform.yml` - Disabled automatic triggers
- `SETUP-NOTES.md` - New file with complete setup/cleanup guide

---

## Previous Updates (December 28, 2025)

### Device Manager Deployment Fixed (December 28, 2025)

**Issue**: Device Manager EC2 instance was running but application was never deployed. Native addon build was failing.

**Root Causes**:
1. GitHub Actions workflow wasn't generating `package-lock.json` for device-manager
2. EC2 instance missing `libdbus-1-dev` library required for PowerMon native addon

**Fixes Applied**:
1. Updated `deploy-device-manager.yml` and `deploy-all.yml` to generate `package-lock.json` with `--ignore-scripts` flag
2. Installed `libdbus-1-dev` on existing EC2 instance via SSM command
3. Updated `terraform/device-manager.tf` user_data to include `libdbus-1-dev` for future instances

**Deployment Verified**: Package `device-manager-94e1c311...` successfully deployed to EC2.

---

### RDS Password Security Update (December 28, 2025)

**Changes**:
- Changed RDS master password from temporary `DeecellFleet2024` to secure 32-character random password
- Updated Secrets Manager secret with new database URL
- Forced ECS redeployment to pick up new credentials
- Fixed GitHub Actions deploy workflow to handle ECS stability issues

**Deploy Workflow Fix**:
- Upgraded `amazon-ecs-deploy-task-definition` from v1 to v2
- Changed `wait-for-service-stability: false` to avoid timeout errors
- Added custom retry loop using `aws ecs wait services-stable` (5 attempts)
- This prevents "Resource is not in the state servicesStable" errors when multiple deployments overlap

---

## Previous Updates (December 27, 2025)

### AWS Redeployment & DNS Configuration (December 27, 2025)

**Changes**:
- Updated GitHub secrets with `deecell-terraform` IAM credentials
- Added `domain_name=app.deecell.com` to Terraform workflow for ACM certificate creation
- Restored RDS database from snapshot (`deecell-fleet-production-final-backup`)
- Updated Namecheap DNS to point to new ALB

**Certificate Validation**: ACM requires DNS CNAME records for validation. Added to Namecheap manually.

---

## Backlog / Roadmap

| Priority | Item | Description |
|----------|------|-------------|
| Medium | **Route 53 Migration** | Move DNS from Namecheap to AWS Route 53 for full Terraform automation of ACM certificate validation |
| Low | GitHub OIDC | Migrate from IAM access keys to OIDC for keyless GitHub Actions authentication |

---

## Previous Updates (December 23, 2025)

### SIM Polling Moved to Device Manager (December 23, 2025)

**Change**: Moved SIM location polling from web app to Device Manager for architectural consistency.

**Why**:
- Web app scaling (multiple ECS tasks) would cause duplicate API calls
- Device Manager runs as a singleton, ensuring single source of truth
- Consistent design pattern with PowerMon polling
- Better observability and lifecycle management

**Implementation**:
- New file: `device-manager/app/sim-poller.js`
- Added SIMPro config to `device-manager/app/config.js`
- Updated `device-manager/app/index.js` to start/stop SIM poller
- Removed `simLocationScheduler` from web app `server/index.ts`

**Device Manager Now Handles**:
| Device Type | Interval | Purpose |
|-------------|----------|---------|
| PowerMon | 10 seconds | Battery/solar data from physical devices |
| SIM Cards | 60 seconds | Network location from SIMPro API |

**Environment Variables for Device Manager**:
- `SIMPRO_API_CLIENT` - SIMPro API client ID
- `SIMPRO_API_KEY` - SIMPro API key

---

## Previous Updates (December 12-17, 2025)

### SIMPro Usage-Location API Working (December 12, 2025)

**Issue**: Previous location endpoint (`/sims/{iccid}/location`) returned authorization errors.

**Resolution**: Wireless Logic confirmed the correct endpoint: `/api/v3/sims/usage-location`

**API Details**:
- **Endpoint**: `GET /api/v3/sims/usage-location`
- **Parameter**: `identifiers` (required) - comma-separated ICCIDs, IMSIs, or MSISDNs
- **Note**: Only supports Conexa-LD SIMs

**Example Request**:
```bash
curl "https://simpro4.wirelesslogic.com/api/v3/sims/usage-location?identifiers=89444611503504517903,89444611503504616283" \
  -H "x-api-client: $SIMPRO_API_CLIENT" \
  -H "x-api-key: $SIMPRO_API_KEY"
```

**Example Response**:
```json
[
  {"id":11091927, "iccid":"89444611503504616283", "msisdn":"883190603400853", 
   "mnc":"260", "mcc":"310", "country":"United States", "network":"T-Mobile"},
  {"id":10546746, "iccid":"89444611503504517903", "msisdn":"883190603571827", 
   "mnc":"260", "mcc":"310", "country":"United States", "network":"T-Mobile"}
]
```

**Response Fields**:
- `country`: Country where SIM last connected
- `network`: Mobile network operator name
- `mcc`/`mnc`: Mobile Country Code / Mobile Network Code
- No lat/long coordinates (this is network-level location, not GPS)

**Files Updated**: `server/services/simpro-client.ts`

---

### Production Deployment: SIMPro Location Integration (December 17, 2025)

**Deployed to Production**:
1. Database schema migrated (15 new columns added to sims table, country added to trucks)
2. SIMPro API credentials added to AWS Secrets Manager
3. ECS task definition updated (version 72) with SIMPRO_API_CLIENT and SIMPRO_API_KEY
4. IAM policy added for secrets access
5. SIM records created for GTO Fast Racing and Carter Racing

**Production SIM Location Data**:
| SIM | Organization | Country | Network | MCC/MNC |
|-----|--------------|---------|---------|---------|
| DCL-Moeck | GTO Fast Racing | United States | AT&T Wireless | 310/410 |
| DCL-Carter | Carter Racing | United States | T-Mobile | 310/260 |

---

### SIMPro Location Sync Integrated (December 12, 2025)

**Feature**: Integrated the usage-location API into the location sync service.

**Changes Made**:
1. Updated `syncLocations()` method in `sim-sync-service.ts`:
   - Now uses batch `getUsageLocation()` call instead of individual SIM lookups
   - Stores country, network name, MCC, and MNC in sims table
   - Updates truck country field when linked

2. Added new schema fields:
   - `sims` table: `country`, `network_name`, `mcc`, `mnc`
   - `trucks` table: `country`

**Tested Successfully**:
```
POST /api/v1/admin/organizations/9/sims/sync-locations
→ {"simsProcessed":1, "locationsUpdated":1, "trucksUpdated":0}
```

**Database Verified**:
| Device | Country | Network | MCC | MNC |
|--------|---------|---------|-----|-----|
| DCL-Moeck | United States | T-Mobile | 310 | 260 |
| DCL-Carter | United States | T-Mobile | 310 | 260 |

**Note**: This endpoint returns country/network-level data, not GPS coordinates. For precise location tracking, you'd need GPS data from the PowerMon devices or a different location service.

---

## Previous Updates (December 11, 2025)

### Password Reset Tokens Table Migration (December 11, 2025)

**Issue**: Password reset emails were failing with "Server error" after SendGrid was configured.

**Root Cause**: The `password_reset_tokens` table was missing from the production RDS database. The table exists in the Drizzle schema but was never migrated to production.

**Initial Approach (Failed)**:
1. Created `db-migration` ECS task definition using `postgres:15-alpine` image
2. Configured to run `psql` with DATABASE_URL from Secrets Manager
3. Multiple attempts failed due to:
   - First attempt: Used default VPC subnets instead of production VPC
   - Second attempt: Private subnets couldn't reach Secrets Manager (no VPC endpoint)
   - Third attempt: IAM execution role lacked CloudWatch Logs permissions

**Successful Resolution**:
Used the existing migration API endpoint in the production app:
```bash
curl -X POST "https://app.deecell.com/api/v1/migrate/run-sql" \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -d '{"statements": [
    "CREATE TABLE IF NOT EXISTS password_reset_tokens (...)",
    "ALTER TABLE password_reset_tokens ADD CONSTRAINT ...",
    "CREATE INDEX IF NOT EXISTS ..."
  ]}'
```

**Table Created**:
```sql
CREATE TABLE password_reset_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE INDEX password_reset_token_idx ON password_reset_tokens (token);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);
CREATE INDEX password_reset_expires_idx ON password_reset_tokens (expires_at);
```

**Verification**: 
- Tested `POST /api/auth/forgot-password` - returns `{"success":true}`
- Password reset emails now sent successfully via SendGrid

**Lesson Learned**: For one-off database migrations, the built-in `/api/v1/migrate/run-sql` endpoint is simpler than ECS tasks, since the web app already has database connectivity.

---

### SendGrid Email Integration Fixed (December 11, 2025)

**Issue**: Password reset emails not working - API returned "Email not configured" error.

**Root Cause**: ECS execution role lacked permission to read the new SendGrid secret from AWS Secrets Manager.

**Resolution**:
1. Created SendGrid API key secret in Secrets Manager: `deecell-fleet-production/sendgrid-api-key`
2. Updated ECS task definition (revision 61) with `SENDGRID_API_KEY` environment variable referencing the secret
3. Added secret ARN to IAM execution role policy: `deecell-fleet-production-ecs-execution-policy`
4. Force redeployed ECS service to pick up new permissions

**Verification**: 
- Tested `POST /api/auth/forgot-password` - returns success response
- Email service now properly configured in production

**Note**: The sender email `hello@deecell.com` must be verified in SendGrid for emails to actually send.

---

### SIMPro Location API Update (December 11, 2025)

**Issue**: Location API endpoints were returning 404 errors.

**Root Cause**: The SIMPro API uses ICCID (not MSISDN) for location lookups. The correct endpoint is `/api/v3/sims/{iccid}/location` (not `/sim/{msisdn}/location`).

**Resolution**:
- Updated `simpro-client.ts` to use correct endpoint: `/sims/{iccid}/location`
- Updated `sim-sync-service.ts` to pass ICCID instead of MSISDN
- Added error handling for authorization errors (location feature not enabled)

**Authorization Issue Found**:
The location API returns `"You are not authorised to use this API Function"` - this means the Location API feature needs to be enabled on the SIMPro account by Wireless Logic.

**API Documentation**: https://simpro4.wirelesslogic.com/doc/restapi/v3#tag/Location

**SIMs Imported**:
| Device | ICCID | MSISDN | Organization |
|--------|-------|--------|--------------|
| DCL-Moeck | 89444611503504517903 | 883190603571827 | GTO Fast Racing |
| DCL-Carter | 89444611503504616283 | 883190603400853 | Carter Racing |

---

## Previous Updates (December 9, 2025)

### User Profile Picture Upload (December 9, 2025)

**Feature**: Users can now upload profile pictures from the user profile dialog.

**Implementation**:
- Added `profile_picture_url` column to users table
- Created API endpoints:
  - `POST /api/v1/auth/profile-picture` - Upload new profile picture (base64 encoded)
  - `DELETE /api/v1/auth/profile-picture` - Remove profile picture
  - `GET /api/v1/auth/profile` - Get current user profile including picture URL
- Updated UserProfileDialog component with avatar upload UI
- Profile pictures stored in AWS S3 (`deecell-fleet-files` bucket)

**Validation**:
- File types: JPEG, PNG, GIF, WebP only
- File size: 5MB maximum
- Client-side and server-side validation

**Database Migration Required**:
Run `npm run db:push` to add the new column to the users table.

---

### User Profile & Password Change (December 9, 2025)

**Feature**: Users can access their profile settings from the header dropdown menu.

**Implementation**:
- Added Profile Settings menu item to user dropdown
- Created UserProfileDialog component with two tabs:
  - Profile tab: Shows user info and avatar
  - Password tab: Allows changing password
- Added `POST /api/v1/auth/change-password` endpoint with proper validation

**Security**:
- Requires current password verification before change
- Minimum 8 character password requirement
- Checks user isActive status before allowing changes
- Sends email notification on password change

---

## Previous Updates (December 5, 2025)

### Production Database Migration Fix (December 5, 2025)

**Issue**: Device Manager was failing with `column "driving_since" does not exist` error.

**Root Cause**: Production database schema was out of sync with application code. The `device_snapshots` table was missing the `driving_since` column that was added in a recent code update. Database migrations are not automated in the CI/CD pipeline.

**Resolution**: Manually connected to production RDS via psql and ran:
```sql
ALTER TABLE device_snapshots 
ADD COLUMN IF NOT EXISTS driving_since TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_parked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS parked_since TIMESTAMP,
ADD COLUMN IF NOT EXISTS today_parked_minutes INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS parked_date DATE,
ADD COLUMN IF NOT EXISTS month_parked_minutes INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS parked_month VARCHAR(7);
```

**How to Access Production Database**:
1. Go to AWS Console → Secrets Manager
2. Find secret containing "database-url" 
3. Click "Retrieve secret value" to get the connection URL
4. From EC2 instance: `psql "postgresql://..."`

**Note**: Database migrations must be run manually before/after deployments when schema changes are made. Consider adding automated migrations to CI/CD in the future.

---

### Daily Slack Summary (December 5, 2025)

**Feature**: GitHub Actions workflow that sends daily development summaries to Slack.

**Workflow File**: `.github/workflows/daily-slack-summary.yml`

**Schedule**: Runs daily at 6 PM UTC (configurable via cron expression)

**Summary Includes**:
- Commit count from last 24 hours
- List of recent commits with descriptions
- Files changed count
- Contributors

**Setup Instructions**:

1. **Create Slack Incoming Webhook**:
   - Go to your Slack workspace → Apps → Incoming Webhooks
   - Or visit: https://api.slack.com/messaging/webhooks
   - Create a new webhook and select the channel for summaries
   - Copy the webhook URL

2. **Add GitHub Secret**:
   - Go to your GitHub repository → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `SLACK_WEBHOOK_URL`
   - Value: Your Slack webhook URL
   - Click "Add secret"

3. **Test the Workflow**:
   - Go to Actions tab in GitHub
   - Select "Daily Development Summary to Slack"
   - Click "Run workflow" to test manually

**Manual Trigger**: Can be triggered anytime via GitHub Actions UI (workflow_dispatch enabled)

---

### UI Fixes & Email Enhancements (December 5, 2025)

**Footer Overlap Fix**:
- Added `sidebarOffset` prop to Footer component (`client/src/components/Footer.tsx`)
- When `sidebarOffset={true}`, footer starts at `left-64` (after sidebar)
- AdminLayout sidebar now has `z-50` to ensure it stays above footer (`z-40`)
- Fleet Dashboard uses `pb-[66px]` padding to prevent content overlap

**Welcome Email Checkbox in Admin UI**:
- Added checkbox to user creation dialog in UsersPage.tsx
- Checkbox label: "Send welcome email with login credentials"
- Default: checked (true)
- Server now reads `sendWelcome` from query string OR request body
- Toast shows success/failure status after user creation

**Alert Notification Role Fix**:
- Updated `alert-notifications.ts` to use correct roles
- Now filters for: `org_admin`, `super_admin`, `manager` (was: `admin`, `manager`)
- Matches actual role values used throughout the application

---

### SendGrid Email Integration (December 5, 2025)

**Goal**: Add email functionality for password resets, welcome emails, and critical alert notifications.

**Email Service Implementation** (`server/services/email-service.ts`):
- Sender: `hello@deecell.com` (requires SendGrid domain authentication)
- Templates: Password reset, welcome with temp password, critical alerts
- Secret: `SENDGRID_API_KEY` required

**Password Reset Flow**:
1. User submits email on `/forgot-password`
2. Backend creates 24-hour token, stores in `password_reset_tokens` table
3. Email sent with reset link to `/reset-password?token=xxx`
4. User submits new password, token validated and marked as used
5. Password updated, user can login

**Database Schema** (added to `shared/schema.ts`):
```typescript
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Welcome Email Automation**:
- Triggered when admin creates new user via `/api/v1/admin/organizations/:orgId/users`
- Includes temporary password in email
- Can be disabled with `sendWelcome: false` in request body

**Alert Notification System** (`server/services/alert-notifications.ts`):
- Critical alerts trigger email to org admins/managers
- Alert types: `low_voltage`, `critical_voltage`, `soc_critical`, `device_offline`
- Includes truck/device context in email

**API Endpoints**:
- `POST /api/v1/auth/forgot-password` - Request password reset
- `POST /api/v1/auth/reset-password` - Complete password reset
- `GET /api/v1/auth/verify-reset-token` - Validate token before showing form

**Frontend Pages**:
- `/forgot-password` - Email input form
- `/reset-password` - New password form (with token validation)

**DNS Setup (Namecheap for SendGrid)**:
- Use subdomain prefix only (e.g., `em1234` not `em1234.deecell.com`)
- Add CNAME records for domain authentication

**Files Created/Modified**:
- `server/services/email-service.ts` - Core SendGrid integration
- `server/services/alert-notifications.ts` - Alert email dispatcher
- `server/api/auth-routes.ts` - Password reset endpoints
- `server/api/admin-routes.ts` - Added welcome email on user creation
- `server/db-storage.ts` - Token CRUD operations
- `client/src/pages/ForgotPassword.tsx` - Request reset form
- `client/src/pages/ResetPassword.tsx` - Set new password form
- `shared/schema.ts` - Added password_reset_tokens table

**Alert Notification Trigger** (Fix Applied):
- `sendAlertNotifications()` now called from `db-storage.ts` when alerts are created
- Only critical alerts trigger emails (filtered by `shouldNotifyForAlert()`)
- Non-blocking: email failures don't affect alert creation

**Status**: ✅ Complete (pending SendGrid domain authentication)

---

### Fleet Table Status Duration Display (December 5, 2025)

**Goal**: Show how long a truck has been in its current state (Driving, Parked, Idling) with format "Status | Xmin".

**Implementation**:
- Added `statusLabel`, `statusDurationMinutes`, `isIdling`, `parkedSince` fields to `LegacyTruckWithDevice` interface
- Status duration calculated from `parkedSince` timestamp in device snapshots
- Three status states with distinct colors:
  - **Driving**: Green (`#e8f5e9` bg, `#2e7d32` text)
  - **Parked**: Gray (`#f0f0f0` bg, `#6b7280` text)
  - **Idling**: Orange (`#fff3e0` bg, `#e65100` text) - parked with power draw > 100W

**Files Modified**:
- `client/src/lib/api.ts` - Added status calculation logic in `useLegacyTrucks`
- `client/src/components/FleetTable.tsx` - Updated badge display with duration

**Display Format**: `Parked | 25min`, `Driving | 15min`, `Idling | 10min`

**Database Changes**:
- Added `driving_since` timestamp column to `device_snapshots` table
- Device Manager tracks driving start time when truck transitions from parked to driving

**Device Manager Updates** (`device-manager/app/database.js`):
- Tracks `drivingSince` timestamp similar to `parkedSince`
- Sets `drivingSince = now` when truck starts driving
- Clears `drivingSince = null` when truck parks

**Status**: ✅ Complete

---

## Previous Updates (December 4, 2025)

### Custom Domain Setup (December 4, 2025 - 10:15 PM)

**Goal**: Set up https://app.deecell.com as the production URL.

**Configuration Completed**:

1. **AWS Certificate Manager (ACM)**:
   - Requested SSL certificate for `app.deecell.com`
   - Validated via DNS (CNAME record in Namecheap)
   - Status: ✅ Issued

2. **ALB HTTPS Listener**:
   - Added HTTPS listener on port 443
   - Attached ACM certificate
   - Forward to target group: `deecell-fleet-production-tg`

3. **Namecheap DNS Records**:
   - CNAME: `app` → `deecell-fleet-production-alb-1191388080.us-east-2.elb.amazonaws.com`
   - CNAME: AWS certificate validation record

4. **Security Group**:
   - HTTPS (port 443) already allowed on ALB security group

**Production URL**: https://app.deecell.com ✅

---

### Backend Savings Calculator Bug Fix (December 4, 2025 - 9:55 PM)

**Problem**: The backend savings calculator (`server/services/savings-calculator.ts`) was using an incorrect formula based on solar energy measurements that no longer exist in the data model.

**Root Cause**: The original implementation calculated savings from `solarWh` in device measurements, but the system was refactored to use parked-time-based idle reduction savings. The backend was never updated to match.

**Impact**: 
- `/api/v1/savings` endpoint returned $0 or incorrect values
- Fleet Assistant AI provided incorrect savings data
- Dashboard statistics were inconsistent between frontend (correct) and backend (wrong)

**Correct Formula** (now implemented):
```
savings = (parked_minutes / 60) × 1.2 gal/hr × diesel_price
CO₂ reduction = gallons_saved × 22.4 lbs/gallon
```

**Device Manager Semantics** (clarified):
- `month_parked_minutes` = completed days only (does NOT include today)
- `today_parked_minutes` = current day's parked time
- `MTD total = month_parked_minutes + today_parked_minutes`

**Files Modified**:
- `server/services/savings-calculator.ts` - Complete refactor to parked-time formula
- `server/services/fleet-assistant.ts` - Updated `get_fleet_statistics` function

**Verification**:
- Database query confirmed: GFR-70 with 8 parked minutes = $0.60 savings
- Formula: `(8/60) × 1.2 × $3.758 = $0.60` ✅
- Unique constraint on `device_snapshots.device_id` ensures one snapshot per device

**Status**: ✅ Backend now matches frontend calculations

---

### Device Manager SSL/TLS Connection Issue (December 4, 2025 - 7:30 PM)

**Problem**: Device Manager failed to connect to AWS RDS PostgreSQL with error:
```
"self-signed certificate in certificate chain"
```

**Root Cause**: Node.js `pg` driver requires explicit SSL configuration for AWS RDS connections. Unlike `psql` CLI which uses system certificates, Node.js doesn't automatically trust AWS RDS certificates.

**Quick Fix Applied (Temporary - for immediate recovery)**:
Added `NODE_TLS_REJECT_UNAUTHORIZED=0` to systemd service via SSM command.

**Proper Production Fix (Now Implemented)**:

1. **Terraform user data** (`terraform/device-manager.tf`):
   - Downloads RDS CA bundle during EC2 setup
   - Stores at `/opt/device-manager/certs/rds-ca-bundle.pem`
   - Sets `RDS_CA_BUNDLE` environment variable in systemd service

2. **Database.js** (`device-manager/app/database.js`):
   - Added `getSslConfig()` function
   - Uses AWS RDS CA bundle when `RDS_CA_BUNDLE` env var is set
   - Falls back to `rejectUnauthorized: false` if bundle not found (logs warning)
   - Full certificate verification when bundle is present

**Implementation**:
```javascript
function getSslConfig() {
  const rdsCaBundle = process.env.RDS_CA_BUNDLE;
  
  if (rdsCaBundle && fs.existsSync(rdsCaBundle)) {
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(rdsCaBundle).toString()
    };
  }
  
  // Fallback for development
  return { rejectUnauthorized: false };
}
```

**Files Modified**:
- `device-manager/app/database.js` - Added SSL config with CA bundle support
- `terraform/device-manager.tf` - Downloads RDS CA bundle, sets env var

**To Apply on Existing Instance** (if needed):
```bash
# SSH or SSM into EC2
mkdir -p /opt/device-manager/certs
curl -sS "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" \
  -o /opt/device-manager/certs/rds-ca-bundle.pem

# Update systemd service to include env var
sudo sed -i '/\[Service\]/a Environment=RDS_CA_BUNDLE=/opt/device-manager/certs/rds-ca-bundle.pem' \
  /etc/systemd/system/device-manager.service
  
# Remove the insecure NODE_TLS fix if present
sudo sed -i '/NODE_TLS_REJECT_UNAUTHORIZED/d' /etc/systemd/system/device-manager.service

sudo systemctl daemon-reload
sudo systemctl restart device-manager
```

**References**:
- AWS RDS SSL Docs: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html
- Certificate Bundle: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

**Status**: ✅ Proper SSL implementation deployed. New EC2 instances will automatically use certificate verification.

---

### Admin AI Assistant (December 4, 2025 - 5:15 PM)

**Goal**: Create a separate Ray Ray AI assistant for the admin dashboard with cross-organization data access.

**Implementation Complete**:

1. **Backend Service** (`server/services/admin-assistant.ts`):
   - Admin-specific system prompt for cross-org context
   - Function tools for admin queries:
     - `get_system_overview` - Total counts: orgs, fleets, trucks, devices, users, alerts
     - `list_organizations` - All organizations with fleet/truck/device/user counts
     - `get_organization_details` - Deep dive into specific organization
     - `get_all_devices_status` - Device health across all orgs (online/offline filter)
     - `get_cross_org_alerts` - Active alerts system-wide
     - `get_user_stats` - User counts by organization
     - `get_low_battery_devices` - Low SOC devices across all orgs
     - `get_fleet_summary` - All fleets with truck counts

2. **API Endpoint** (`server/api/admin-routes.ts`):
   - `POST /api/v1/admin/assistant/chat` - Protected by adminMiddleware
   - Separate from tenant-scoped fleet assistant

3. **Frontend Component** (`client/src/components/AdminAssistant.tsx`):
   - Dark header theme to distinguish from fleet assistant
   - Admin-specific suggested questions
   - Calls admin endpoint instead of fleet endpoint

**Status**: ✅ Live in admin dashboard

---

### EIA Diesel Price Integration (December 4, 2025 - 4:45 PM)

**Goal**: Use real-time diesel prices from the US Energy Information Administration instead of hardcoded $3.50.

**Implementation Complete**:

1. **Backend Endpoint** (`server/api/fleet-routes.ts`):
   - Added `GET /api/v1/fuel-price` endpoint
   - Fetches current US diesel price via `eiaClient.getCurrentFuelPrice()`
   - Returns `{ pricePerGallon, source, currency }`

2. **Frontend Hook** (`client/src/lib/api.ts`):
   - Added `useFuelPrice()` hook that queries `/api/v1/fuel-price`
   - Refetches every 5 minutes, considered fresh for 1 minute
   - Falls back to $3.50 if API unavailable

3. **Savings Calculations**:
   - `useLegacyTrucks()` now uses dynamic diesel price for fuelSavings and mtdFuelSavings
   - FleetStats Today's Savings automatically uses the dynamic price through truck data

**API Key**: `EIA_API_KEY` secret configured - fetches weekly diesel prices by PADD region.

**Status**: ✅ Connected and live

---

### Monthly Parked Time Tracking (December 4, 2025 - 4:30 PM)

**Goal**: Display Month-to-Date (MTD) fuel savings for individual trucks based on parked time.

**Implementation Complete**:

1. **Schema Changes** (`shared/schema.ts`):
   - Added `month_parked_minutes` (integer) - accumulated parked minutes from completed days in current month
   - Added `parked_month` (text) - "YYYY-MM" format for monthly reset tracking

2. **Device Manager Logic** (`device-manager/app/database.js`):
   - Monthly tracking: stores completed days' parked minutes in `monthParkedMinutes`
   - Monthly reset: clears `monthParkedMinutes` when month changes
   - MTD calculation: `monthParkedMinutes + todayParkedMinutes` (backend tracks completed days, frontend adds current day)

3. **Frontend Changes**:
   - **FleetTable.tsx**: Fuel Savings column now shows MTD savings (monthParkedMinutes + todayParkedMinutes)
   - **FleetStats.tsx**: Today's Savings shows aggregate of all trucks' daily parked time savings
   - **api.ts**: Added `monthParkedMinutes` field, updated fuelSavings calculation

4. **Production Deployment**:
   - Migration ran successfully: `ALTER TABLE device_snapshots ADD COLUMN IF NOT EXISTS month_parked_minutes INTEGER DEFAULT 0`
   - Device Manager deployed and running with monthly tracking

**Savings Formula**:
- `(parkedMinutes / 60) × 1.2 gal/hr × $3.50/gal`
- CO₂ reduction: `gallonsSaved × 22.4 lbs CO₂/gallon`

**Status**: ✅ Live and collecting data on 3 devices

---

### Device Manager Recovery (December 3, 2025 - 8:04 PM)

**Issue**: Device Manager stopped working after a deploy - native addon failed to compile.

**Root Cause**: 
1. `libpowermon_bin` library wasn't included in deployment package
2. EC2 was missing `libdbus-1-dev` system dependency
3. `todayParkedMinutes` was being inserted as decimal (0.17) into integer column

**Fixes Applied**:
1. Updated `binding.gyp` to look for libpowermon in package directory
2. Updated `deploy-to-aws.sh` to include libpowermon_bin in zip
3. Installed `libdbus-1-dev` on EC2: `sudo apt-get install -y libdbus-1-dev`
4. Fixed `database.js` - changed `Math.round(todayParkedMinutes * 100) / 100` to `Math.round(todayParkedMinutes)`

**Status**: All 3 devices connected and polling successfully!

---

### Deployment Preparation (December 3, 2025 - Evening)

**Changes Ready for Production**:
- Incremental database migrations now run on existing production database
- Uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (safe, idempotent)
- New columns added to `device_snapshots`: `is_parked`, `parked_since`, `today_parked_minutes`, `parked_date`
- Frontend calculates parked status from voltage2 immediately (no Device Manager dependency)

**To Deploy**: Commit and push to trigger GitHub Actions CI/CD pipeline.

---

### Parked Status & Fuel Savings Tracking (December 3, 2025)

**Goal**: Track when trucks are parked (idle reduction) and calculate fuel savings based on parked time.

**Implementation Complete**:

1. **Schema Changes** (`shared/schema.ts`):
   - Added `is_parked` (boolean) - current parked status based on chassis voltage
   - Added `parked_since` (timestamp) - when truck became parked
   - Added `today_parked_minutes` (integer) - accumulated parked time today
   - Added `today_parked_date` (varchar) - date for daily reset tracking

2. **Device Manager Logic** (`device-manager/app/database.js`):
   - Parked detection: chassis voltage (voltage2) < 13.8V = parked
   - Daily reset: clears `todayParkedMinutes` at midnight (based on stored date)
   - Accumulates parked time by tracking `parkedSince` transitions

3. **Frontend API** (`client/src/lib/api.ts`):
   - Added `isParked`, `todayParkedMinutes`, `fuelSavings` to LegacyTruckWithDevice
   - Fuel savings formula: `(parkedMinutes / 60) * 1.2 gal/hr * $3.50/gal`
   - Default diesel price: $3.50 (hardcoded for now)

4. **Dashboard UI** (`client/src/components/FleetTable.tsx`):
   - Added "Parked" column with green/orange badge (Parked/Moving)
   - Added "Fuel Savings" column showing dollar amount with 2 decimals
   - Positioned between Truck and Driver columns

**Future Enhancements**:
- Connect fuel price to regional diesel pricing API (EIA integration)
- Add timezone-aware daily resets per fleet
- Display parked duration (hours:minutes) alongside status

---

### 📋 BACKLOG: Centralize Parked Voltage Threshold (December 4, 2025)

**Issue**: The parked voltage threshold (13.0V) is duplicated in two places:
1. `client/src/lib/api.ts` (line 141) - Frontend calculation
2. `device-manager/app/database.js` (line 322) - Device Manager calculation

**Why**: These are separate applications deployed to different environments (Replit vs AWS EC2), so they can't share code at runtime.

**Proposed Solutions**:
1. **Database config** (recommended): Store threshold in `savings_config` or new `fleet_settings` table, Device Manager fetches on startup
2. **Environment variable**: Both apps read from `PARKED_VOLTAGE_THRESHOLD` env var
3. **API endpoint**: Device Manager calls Replit backend for configuration on startup

**Benefit**: Single source of truth, change once instead of twice, reduces risk of inconsistency.

---

### 📋 BACKLOG: Review Runtime Data Type (December 3, 2025)

**Issue**: PowerMon devices return `runtime` as a decimal (e.g., 0.17), but our database stores it as an integer.

**Current State**: Passing runtime value directly (no rounding) - may cause insert errors if PowerMon sends decimals.

**Options to Consider**:
1. Change `runtime` column from `integer` to `real` in both `device_snapshots` and `device_measurements` tables (recommended)
2. Confirm PowerMon documentation for runtime units (seconds? minutes? hours?)
3. Add rounding if integer precision is acceptable

**Files Affected**: 
- `device-manager/app/database.js` (lines 301 and 410)
- `shared/schema.ts` (lines 171 and 208)

**Note**: The "0.17" error we saw was actually from `todayParkedMinutes`, not runtime. Runtime may or may not cause issues depending on what PowerMon sends.

---

### 📋 TODO: Implement Password Reset Feature (December 4, 2025)

**Goal**: Allow fleet dashboard users to reset their password via email

---

## Password Reset - Development Plan

### Prerequisites (Before Starting)
- [ ] Set up AWS SES in us-east-2 (same region as your infrastructure)
- [ ] Verify a sender email address in SES (e.g., noreply@deecell.com or your domain)
- [ ] Get SES credentials (or use IAM role if running on EC2/ECS)
- [ ] Add secrets: `SES_FROM_EMAIL`, optionally `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`

---

### Step 1: Database Schema (5 min)
**File**: `shared/schema.ts`

Add `passwordResetTokens` table:
```typescript
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Run: `npm run db:push`

---

### Step 2: Install AWS SES Package (2 min)
```bash
npm install @aws-sdk/client-ses
```

---

### Step 3: Create Email Service (15 min)
**File**: `server/services/email-service.ts`

```typescript
// Functions needed:
// - sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>
// - Uses AWS SES client
// - HTML email template with reset link
// - Plain text fallback
```

---

### Step 4: Create Password Reset Service (20 min)
**File**: `server/services/password-reset.ts`

```typescript
// Functions needed:
// - generateResetToken(): string (crypto.randomBytes, 32 bytes hex)
// - createPasswordResetRequest(email: string): Promise<boolean>
//   - Look up user by email
//   - Generate token, store with 1-hour expiry
//   - Send email with reset link
//   - Return true (always, to prevent email enumeration)
// - validateResetToken(token: string): Promise<User | null>
//   - Check token exists, not expired, not used
//   - Return user if valid
// - resetPassword(token: string, newPassword: string): Promise<boolean>
//   - Validate token
//   - Hash new password with bcrypt
//   - Update user's password
//   - Mark token as used
//   - Invalidate all other tokens for this user
```

---

### Step 5: API Routes (15 min)
**File**: `server/api/customer-auth.ts`

Add two new endpoints:

```typescript
// POST /api/v1/auth/forgot-password
// Body: { email: string }
// Response: { success: true, message: "If an account exists..." }
// Always returns success to prevent email enumeration

// POST /api/v1/auth/reset-password
// Body: { token: string, password: string }
// Response: { success: true } or { error: "Invalid or expired token" }
```

---

### Step 6: Frontend - Forgot Password Page (20 min)
**File**: `client/src/pages/ForgotPassword.tsx`

- Simple form with email input
- Submit calls POST /api/v1/auth/forgot-password
- Show success message: "If an account exists, we've sent a reset link"
- Link back to login page

---

### Step 7: Frontend - Reset Password Page (20 min)
**File**: `client/src/pages/ResetPassword.tsx`

- Extract token from URL query param
- Form with new password + confirm password fields
- Password validation (min 8 chars, match confirmation)
- Submit calls POST /api/v1/auth/reset-password
- On success: redirect to login with success toast
- On error: show "Invalid or expired link" message

---

### Step 8: Update Login Page (5 min)
**File**: `client/src/pages/Login.tsx`

- Add "Forgot Password?" link below password field
- Link to /forgot-password

---

### Step 9: Add Routes to App.tsx (2 min)
**File**: `client/src/App.tsx`

```typescript
<Route path="/forgot-password" component={ForgotPassword} />
<Route path="/reset-password" component={ResetPassword} />
```

---

### Step 10: Test End-to-End (15 min)
1. Go to login page, click "Forgot Password?"
2. Enter valid email, submit
3. Check email arrives (check SES sandbox if in sandbox mode)
4. Click reset link
5. Enter new password
6. Verify can log in with new password
7. Verify old password no longer works
8. Verify reset link can't be reused

---

### Production Deployment
- Ensure SES is out of sandbox mode (or recipient is verified)
- Add SES credentials to AWS Secrets Manager
- Update ECS task definition with SES environment variables

---

### Security Considerations (Built Into Plan)
- ✅ Tokens expire after 1 hour
- ✅ Tokens are single-use
- ✅ No email enumeration (same response for valid/invalid emails)
- ✅ Secure random token generation (crypto.randomBytes)
- ✅ Password hashed with bcrypt
- ✅ All other reset tokens invalidated on password change

---

### 📋 TODO: Review Today's Savings Calculation (December 4, 2025)

**Reminder**: User wants to review/work on the Today's Savings calculation logic.

Current formula: `(Solar Wh ÷ 1000 ÷ 9.0 kWh/gallon) × Diesel Price`

Files involved:
- `server/services/savings-calculator.ts` - Main calculation logic
- `server/services/eia-client.ts` - EIA diesel price fetching
- `server/services/padd-regions.ts` - Regional pricing by truck location

---

### ✅ Fixed Today's Savings Decimal Display (December 3, 2025)

**Fixed trailing zero display in Today's Savings card**

- Before: `$10.1` (missing trailing zero)
- After: `$10.10` (correct 2 decimal places)

**Change**: Added `alwaysShowDecimals={true}` to the Today's Savings StatCard in `client/src/components/FleetStats.tsx`

---

### ✅ Fixed Device Info API Method Name (December 3, 2025)

**Fixed PowerMon method name in Device Manager**

- Changed `device.getDeviceInfo()` to `device.getInfo()` in connection-pool.js
- The wrapper exports `getInfo` not `getDeviceInfo`

---

### ✅ GitHub Issues Integration (December 3, 2025)

**Added ability to create and view GitHub Issues from the Admin panel**

- **Repository**: `deecell/Fleet-manager`
- **Admin Page**: `/admin/issues`
- **Features**:
  - List open issues from the repo
  - Create new issues with title, description, and labels
  - Quick templates for Bug Reports, Feature Requests, and Technical Debt
  - Labels fetched from repo and selectable
  - Issues open in GitHub when created

**Files Created/Modified**:
- `server/services/github-issues.ts` - GitHub API service (create, list, labels)
- `server/api/admin-routes.ts` - Added `/github/issues` and `/github/labels` endpoints
- `client/src/pages/admin/IssuesPage.tsx` - Admin UI for managing issues
- `client/src/components/AdminLayout.tsx` - Added Issues nav link
- `client/src/App.tsx` - Added Issues route

**Secret Required**: `GITHUB_TOKEN` with `repo` scope

---

### ✅ Auto-Populate Device Info from PowerMon (December 3, 2025)

**Added automatic device info population on first connection**

When the Device Manager connects to a PowerMon device for the first time, it now automatically fetches and stores:
- Serial Number
- Firmware Version
- Hardware Revision
- Host ID

**Changes**:
1. **`device-manager/app/database.js`**:
   - Added `updateDeviceInfo()` function to update device details in `power_mon_devices` table

2. **`device-manager/app/connection-pool.js`**:
   - Added `fetchAndUpdateDeviceInfo()` method to DeviceConnection class
   - Called automatically after successful connection via `getDeviceInfo()` API
   - Logs device info when fetched and updates database

3. **`client/src/pages/admin/DevicesPage.tsx`**:
   - Removed Hardware Revision and Firmware Version fields from Register Device dialog
   - These fields are now auto-populated, so users don't need to enter them
   - Updated dialog description to explain auto-population

**User Experience**: Users only need to enter Serial Number (placeholder) and Device Name when registering. All technical details are filled in automatically when the PowerMon connects.

---

### ✅ Thornwave Applink URL Support (December 3, 2025)

**Added support for Thornwave applink URL format in device credentials**

The system now accepts both URL formats:
1. Legacy: `powermon://accessKey@connectionKey`
2. Thornwave: `https://applinks.thornwave.com/?n=DeviceName&s=serial&h=41&c=connectionKey&k=accessKey`

**Changes to `server/api/admin-routes.ts`**:
- Updated POST `/devices/:id/credentials` to parse Thornwave URLs
- Updated PATCH `/devices/:id/credentials` to parse Thornwave URLs
- Extracts `c` parameter as connectionKey and `k` parameter as accessKey
- Stores full applink URL for Device Manager compatibility

**Example Thornwave URL**:
```
https://applinks.thornwave.com/?n=DCL-Moeck&s=a3a5b30ea9b3ff98&h=41&c=c1HOvvGTYe4HcxZ1AWUUVg%3D%3D&k=qN19gp1NyTIjTcKXIFUagek74WSxnF9446mW1lX0Ca4%3D
```

---

### ✅ Fixed Device-to-Truck Assignment Bug (December 3, 2025)

**Problem**: "Assign" button did nothing when clicked - devices couldn't be assigned to trucks.

**Root Cause**: The `handleAssign` function used `selectedOrgId` (the organization filter dropdown) instead of the device's own `organizationId`. When viewing "All organizations", `selectedOrgId` was undefined, causing the function to silently return.

**Changes to `client/src/pages/admin/DevicesPage.tsx`**:
1. `handleAssign` now uses `assigningDevice.organizationId` instead of `selectedOrgId`
2. `handleUnassign` now uses `device.organizationId` instead of `selectedOrgId`
3. Truck dropdown in assign dialog filters trucks by the device's organization
4. Assign button disable logic checks for available trucks in the device's organization

**Result**: Device assignment now works correctly regardless of which organization filter is selected in the admin panel.

---

### ✅ Fixed "Last Seen" Timestamp Not Updating (December 3, 2025)

**Problem**: The "Last Seen" timestamp on the admin Devices page wasn't updating - it only showed when the device first connected, not ongoing poll activity.

**Root Cause**: The `updateDevicePollStatus()` function in Device Manager only updated `last_successful_poll_at` in `device_sync_status` table, but didn't update `last_seen_at` in `power_mon_devices` table (which is what the admin UI displays).

**Fix in `device-manager/app/database.js`**:
- Added query to update `power_mon_devices.last_seen_at` on every successful poll
- Now the admin dashboard shows real-time "Last Seen" timestamps

**Deployment Required**: Push to GitHub and redeploy Device Manager on EC2.

---

## Previous Updates (December 2, 2025)

### ✅ AWS Deployment FULLY OPERATIONAL (December 2, 2025 - 11:40 PM)

**Complete production deployment with Device Manager polling 2 PowerMon devices!**

**Infrastructure Summary**:
| Component | Status | Details |
|-----------|--------|---------|
| **Web App URL** | ✅ LIVE | http://deecell-fleet-production-alb-1191388080.us-east-2.elb.amazonaws.com |
| **ECS Fargate** | ✅ 2 tasks running | 512 CPU, 1024 MB RAM per task |
| **RDS PostgreSQL** | ✅ Available | deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com |
| **Device Manager EC2** | ✅ Active | Ubuntu 24.04, i-086e55075cb2820b7 |
| **Device Manager Service** | ✅ Polling | **2 active devices registered** |

**Production Data (GTO Fast Racing)**:
| Resource | Details |
|----------|---------|
| Organization | GTO Fast Racing (ID: 2) |
| Fleet | GFR Racing Fleet |
| Trucks | GFR-69, GFR-70 |
| Devices | DCL-Moeck (10.9.1.190), GFR-70 PowerMon (10.9.1.191) |

**What was done**:
1. Deployed complete AWS infrastructure (VPC, ECS, RDS, EC2, ALB)
2. Ubuntu 24.04 for Device Manager (glibc 2.38 compatibility)
3. Database schema migrated with all tables
4. Seeded GTO Fast Racing organization, fleet, trucks
5. Configured power_mon_devices and device_credentials tables
6. Device Manager service running and finding both devices

**Login Credentials**:
- Admin: `admin@deecell.com` / Password from AWS Secrets Manager
- Customer: Configure user credentials for GTO Fast Racing org

**Database Tables (20 tables)**:
```
alerts, audit_logs, device_credentials, device_measurements,
device_snapshots, device_statistics, device_sync_status, devices,
fleets, fuel_prices, organizations, power_mon_devices, savings_config,
schema_version, sessions, sim_location_history, sims, snapshots,
trucks, users
```

**Note**: Devices are on GFR's local network (10.9.1.x). Device Manager will show connection errors until VPN or network routing is configured between AWS and GFR's facility.

---

### 📋 Pending Tasks / Technical Debt

| Task | Priority | Notes |
|------|----------|-------|
| **Add AWS RDS SSL Certificate Verification** | Medium | Currently using `sslmode=disable` for AWS RDS connection. Should add proper certificate verification using AWS `rds-combined-ca-bundle.pem` CA bundle. See [AWS RDS SSL documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html). Steps: 1) Download RDS CA bundle, 2) Add to `server/aws/` directory, 3) Configure `ssl: { ca: rdsCa, rejectUnauthorized: true }` in `server/db.ts`, 4) Update DATABASE_URL to use `sslmode=verify-full`. |

---

### 🐧 Ubuntu 24.04 for Device Manager (December 2, 2025)

**Changed Device Manager EC2 from Amazon Linux 2023 to Ubuntu 24.04 LTS**

**Problem**: PowerMon native addon (`powermon_addon.node`) was compiled on Replit which has glibc 2.38. Amazon Linux 2023 has an older glibc version, causing `GLIBC_2.38' not found` errors.

**Solution**: Switch to Ubuntu 24.04 LTS which includes glibc 2.38+ out of the box.

**Changes to `terraform/device-manager.tf`**:
1. New AMI data source: `aws_ami.ubuntu_2404` (Canonical owner: 099720109477)
2. Updated user data script:
   - Uses `apt-get` instead of `dnf`
   - Installs Node.js 20 via NodeSource
   - Installs AWS CLI v2 manually
   - Installs `libbluetooth-dev` for PowerMon Bluetooth support
   - Installs CloudWatch Agent from .deb package
3. Changed default user from `ec2-user` to `ubuntu`
4. Updated deploy.sh to use `npm ci --ignore-scripts` to preserve pre-built native addons

**Deployment Steps**:
1. Run `terraform apply` to create new launch template with Ubuntu AMI
2. Terminate existing Amazon Linux instance (Auto Scaling will launch Ubuntu instance)
3. SSH using `ubuntu@<ip>` instead of `ec2-user@<ip>`
4. Run `/opt/device-manager/deploy.sh` to deploy code

---

### 🚀 Device Manager AWS CI/CD Setup (December 2, 2025)

**Added automated deployment for Device Manager to AWS EC2**:

1. **GitHub Actions Workflow**: `.github/workflows/deploy-device-manager.yml`
   - Triggers on changes to `device-manager/` folder
   - Packages code, uploads to S3, deploys to EC2 via SSM
   - Can also be triggered manually via workflow_dispatch

2. **Manual Deployment Script**: `device-manager/scripts/deploy-to-aws.sh`
   - Packages device-manager code
   - Uploads to S3 bucket
   - Triggers deployment on EC2 instances via SSM
   - Supports `--dry-run` mode for testing

3. **New GitHub Secret Required**:
   - `DEVICE_MANAGER_BUCKET` - Get from `terraform output device_manager_deploy_bucket_name`

4. **Documentation Updated**:
   - `DEPLOYMENT_CHECKLIST.md` - Added Device Manager CI/CD instructions
   - Added verification commands and scaling instructions

**Device Poll Results** (live data from GTO Fast Racing):
- GFR-69 (A3A5B30EA9B3FF98): 29.03V, -2.05A, 98% SOC, charging at 59W
- GFR-70 (1982A3044D3599E2): 29.03V, -2.15A, 98% SOC, charging at 62W
- Both trucks at near full charge with healthy voltage

---

### 🔧 AWS Deployment Fixes (December 2, 2025)

**Issue 1: IAM Permissions for Secrets Manager**
- Error: GitHub Actions could not list secrets to find DATABASE_URL ARN
- Fix: Added `secretsmanager:ListSecrets` permission to GitHub Actions IAM policy
- File: `terraform/iam.tf` - Added new `SecretsList` statement

**Issue 2: Database Connection Configuration Mismatch**
- Root cause: `server/aws/rds.ts` used different env vars (RDS_HOST, RDS_PORT, etc.) than what ECS provides (DATABASE_URL)
- Fix: Updated `server/aws/rds.ts` to parse DATABASE_URL when available, with fallback to individual env vars
- This allows the health check endpoint `/api/health` to properly connect to the RDS database

**Issue 3: Vite Package Not Found in Production**
- Error: `Cannot find package 'vite' imported from /app/dist/index.js`
- Root cause: `server/index.ts` imported from `./vite` at top level, which loads vite (a dev dependency)
- Fix: 
  - Created new `server/static.ts` for production static file serving (no vite dependency)
  - Modified `server/index.ts` to use dynamic imports for vite (dev) vs static (prod)
  - Moved `log()` function directly into index.ts to avoid vite.ts import

**Issue 4: Vite Still Being Bundled Despite Dynamic Import**
- Symptom: ECS logs showed "Cannot find package 'vite'" even after dynamic import fix
- Root cause: esbuild statically analyzes `import("./vite")` and bundles vite.ts anyway
- Fix: Used `Function()` constructor to create truly dynamic import that esbuild can't trace:
  ```javascript
  const viteModule = "./vite" + "";
  const { setupVite } = await (Function('return import("' + viteModule + '")')());
  ```
- Result: Bundle size reduced from 188kb to 180kb, vite code no longer included
- Added debug logging to `server/static.ts` for future diagnostics

**Issue 5: OpenAI API Key Missing at Startup**
- Symptom: Container crashes with "Missing credentials. Please pass an `apiKey`"
- Root cause: OpenAI client initialized at module load time in `fleet-assistant.ts`
- Fix: Changed to lazy initialization - OpenAI client only created when actually used
- This allows server to start even without OpenAI key (AI assistant just won't work)

**Current Status**: ✅ DEPLOYED SUCCESSFULLY TO AWS!

**Production URL**: http://deecell-fleet-production-alb-5549888.us-east-2.elb.amazonaws.com

---

## Previous Updates (December 1, 2025)

### ✅ AWS Infrastructure LIVE! (December 1, 2025 - 11:30 PM)
- **Status**: Infrastructure successfully deployed to AWS!
- **Terraform Apply**: 92+ resources created successfully
- **Region**: us-east-2 (Ohio)
- **AWS Account**: 892213647605

**Live Resources**:
| Resource | Value |
|----------|-------|
| **Application URL** | http://deecell-fleet-production-alb-5549888.us-east-2.elb.amazonaws.com |
| **Database Endpoint** | deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432 |
| **Database Name** | deecell_fleet |
| **ECS Cluster** | deecell-fleet-production-cluster |
| **ECS Service** | deecell-fleet |
| **VPC ID** | vpc-05650bbf3842df593 |

**Current Status**: 503 (awaiting Docker image deployment)

**GitHub Secrets for CI/CD** (add to repo Settings → Secrets → Actions):
| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | (get from Terraform output) |
| `AWS_SECRET_ACCESS_KEY` | (get from Terraform output) |
| `AWS_REGION` | us-east-2 |
| `ECR_REPOSITORY` | deecell-fleet |

**Free Tier Configuration Applied**:
- EC2: t3.micro (free tier)
- RDS: db.t3.micro with 1-day backup (free tier)
- GuardDuty: Disabled (requires subscription)

**Next Step**: Push code to GitHub → GitHub Actions will build Docker image → Deploy to ECS

---

### Baby Steps Deployment Guide Created (December 1, 2025 - 9:00 PM)
- **New File**: `DEPLOYMENT_GUIDE.md` - Complete step-by-step guide for team
- **Target Audience**: Non-technical, explains everything from AWS account creation
- **Estimated Time**: ~1 hour to complete full deployment

### AWS Deployment Infrastructure Complete (December 1, 2025 - 8:30 PM)
- **Status**: Full Terraform infrastructure and GitHub Actions CI/CD created
- **Ready for Team**: Deployment scheduled with Mary & Elliot

**Infrastructure Created** (`terraform/` directory - 12 files):
| File | Purpose |
|------|---------|
| `main.tf` | Provider config, locals, random suffix |
| `variables.tf` | All configurable variables with defaults |
| `vpc.tf` | VPC, subnets, NAT gateway, route tables, flow logs |
| `rds.tf` | PostgreSQL RDS with encryption, backups, monitoring |
| `ecs.tf` | Fargate cluster, task definition, service, auto-scaling |
| `alb.tf` | Load balancer, target groups, HTTPS/ACM setup |
| `security-groups.tf` | ALB, ECS, RDS, Device Manager security groups |
| `iam.tf` | ECS roles, Device Manager role, GitHub Actions user |
| `secrets.tf` | Secrets Manager for DB URL, session, admin password |
| `device-manager.tf` | EC2 launch template, ASG, CloudWatch agent |
| `monitoring.tf` | CloudWatch dashboard, alarms, CloudTrail, GuardDuty |
| `outputs.tf` | All important resource IDs and URLs |

**GitHub Actions CI/CD** (`.github/workflows/`):
| Workflow | Triggers | Purpose |
|----------|----------|---------|
| `deploy.yml` | Push to main | Build Docker → ECR → Deploy ECS → Migrate DB |
| `terraform.yml` | Changes to terraform/ | Plan → Apply infrastructure changes |

**Production Dockerfile**:
- Multi-stage build (build → production)
- Node.js 20 Alpine base
- Non-root user for security
- Health check built-in
- Optimized for ~150MB image size

**Deployment Checklist Created**: `DEPLOYMENT_CHECKLIST.md`
- Step-by-step guide for team deployment
- AWS account setup instructions
- GitHub secrets configuration
- Terraform initialization steps
- Post-deployment verification
- Troubleshooting guide
- Cost estimates (~$153/month)

**GitHub Secrets Required**:
```
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_ACCOUNT_ID,
ECR_REPOSITORY, TF_VAR_DB_PASSWORD, TF_VAR_SESSION_SECRET, TF_VAR_ADMIN_PASSWORD
```

**AWS Resources Created by Terraform**:
- VPC with public/private/database subnets (Multi-AZ)
- RDS PostgreSQL 15.4 with encryption, backups
- ECS Fargate cluster with auto-scaling (1-4 tasks)
- Application Load Balancer with HTTPS support
- Device Manager EC2 Auto Scaling Group
- CloudWatch logs, dashboards, alarms
- CloudTrail for SOC2 compliance
- GuardDuty for threat detection
- Secrets Manager for secure credential storage

---

### Device Manager Running (December 1, 2025 - 7:12 PM)
- **Status**: Device Manager polling DCL-Moeck every 10 seconds
- **Data Flow**: voltage1=28.98V, SOC=99%, current=-1.7A, power=-49.5W, temp=22°C
- **Connection**: WiFi persistent connection to A3A5B30EA9B3FF98 (172.30.2.26:49262)
- **Note**: Device Manager runs as background process; restarts needed after Replit shutdown
- **Next Step**: AWS EC2 deployment planned later today with Mary & Elliot

### Bug Fix: Dashboard Voltage Display (December 1, 2025)
- **Issue**: Sleeper V column showing 0.00 instead of actual voltage (26.54V)
- **Root Cause**: FleetTable had voltage columns swapped. The PowerMon device reports:
  - `voltage1` = Sleeper battery (26.54V) - the main PowerMon battery
  - `voltage2` = Chassis battery (NaN → 0.00) - not connected/available
- **Fix**: Corrected voltage mapping in `client/src/components/FleetTable.tsx`:
  - Chassis V (line 154): Shows `truck.v2` → 0.00 (chassis battery, NaN when not connected)
  - Sleeper V (line 212): Shows `truck.v1` → 26.54V (PowerMon battery)
- **Note**: NaN values from the device are properly converted to 0.00 via JSON serialization (NaN → null → 0)

---

### Device Manager Deployment Prep (December 1, 2025)
- **Customer Credentials Updated**: am@gtofast.com / hello123!
- **Test Script Created**: `device-manager/test-local.js` - verifies all components before deployment
  - Checks native addon loaded
  - Validates database connection
  - Lists active devices and credentials
  - Tests live device connection
  - Validates all app modules
- **Package.json Updated**: Added start/test scripts
  - `npm start` - runs the Device Manager
  - `npm test` - runs local verification tests
  - `npm run build` - rebuilds native addon
- **EC2 Deployment Guide Created**: `device-manager/DEPLOYMENT.md`
  - EC2 instance requirements (t3.medium recommended)
  - Step-by-step deployment instructions
  - systemd service configuration
  - CloudWatch monitoring setup
  - Horizontal scaling guidance
  - Troubleshooting section
  - Cost estimates (~$43/month)

**Quick Start Commands**:
```bash
# Test locally
cd device-manager && npm test

# Run Device Manager
cd device-manager && npm start

# Or with custom settings
POLL_INTERVAL_MS=5000 LOG_LEVEL=debug npm start
```

---

### Production Database Setup - Live Device Ready (December 1, 2025)
- **Organization Created**: Deecell Power Systems (ID: 7)
- **User Created**: admin@deecell.com / Deecell2024! (bcrypt hashed, role: admin)
- **Fleet Created**: Test Fleet (ID: 5)
- **Truck Created**: DCL-001 (ID: 20) - San Francisco coordinates
- **Device Created**: DCL-Moeck (ID: 20) - Serial A3A5B30EA9B3FF98, PowerMon-W v1.32
- **Credentials Stored**: Connection key + access key from applink URL
- **Initial Snapshot**: 98% SOC, 28.75V, 22.9°C

**Login Credentials for Customer Dashboard**:
```
Email: am@gtofast.com
Password: hello123!
```

**Database Record Chain**:
```
Organization (7: Deecell Power Systems)
    └── User (2: admin@deecell.com)
    └── Fleet (5: Test Fleet)
        └── Truck (20: DCL-001)
            └── Device (20: DCL-Moeck)
                └── Credentials (applink URL + keys)
                └── Snapshot (initial readings)
                └── Sync Status (disconnected)
```

---

### Device Manager Application - Production Architecture (December 1, 2025)
- **Created**: Complete Device Manager application structure in `device-manager/app/`
- **Purpose**: Standalone application for AWS EC2 deployment, manages PowerMon device connections and data collection
- **Architecture**: Scales independently from web app, designed for tens of thousands of devices

**Core Modules Implemented**:

| Module | File | Purpose |
|--------|------|---------|
| Configuration | `config.js` | Environment variables, validation, all tunable parameters |
| Logger | `logger.js` | Structured JSON logging with log levels and child loggers |
| Database | `database.js` | PostgreSQL connection pool, all CRUD operations for sync |
| Connection Pool | `connection-pool.js` | Persistent device connections, cohort-based sharding |
| Polling Scheduler | `polling-scheduler.js` | Staggered 10-second polling with timing wheel |
| Batch Writer | `batch-writer.js` | Buffered bulk inserts (2s flush or 500 records) |
| Backfill Service | `backfill-service.js` | Gap detection and log-based recovery |
| Metrics | `metrics.js` | Prometheus metrics and health check HTTP server |
| Main Entry | `index.js` | Application lifecycle, graceful shutdown |

**Key Design Decisions**:

1. **Cohort-Based Sharding**:
   - Devices assigned to cohorts via `hash(serialNumber) % cohortCount`
   - Default 10 cohorts, each polled 1 second apart within 10-second interval
   - Prevents thundering herd, distributes load evenly

2. **Staggered Polling**:
   - 10-second poll interval (matches PowerMon log sample rate)
   - ±250ms jitter to avoid synchronization
   - Supports ~1,000 devices per instance at ~100 polls/second

3. **Batch Database Writes**:
   - Measurements buffered in memory
   - Flush triggers: 2-second timeout OR 500 records (whichever first)
   - Bulk INSERT with `ON CONFLICT DO NOTHING`
   - Snapshots updated with latest reading per device

4. **Automatic Gap Detection**:
   - 3 consecutive poll failures = device marked disconnected
   - `gap_start_at` recorded for backfill reference
   - Background service processes pending backfills using log sync
   - Max 5 concurrent backfill operations

5. **Observability**:
   - Prometheus-compatible metrics at `:3001/metrics`
   - Health check at `:3001/health`
   - Structured JSON logs with deviceId/orgId correlation
   - Stats for polls, writes, backfills, queue depths

**Configuration Environment Variables**:
```bash
DATABASE_URL=postgres://...
POLL_INTERVAL_MS=10000      # 10 seconds
COHORT_COUNT=10             # Number of polling cohorts
MAX_CONCURRENT_POLLS=100    # Polls per tick
POLL_JITTER_MS=250          # ±250ms jitter
BATCH_FLUSH_INTERVAL_MS=2000 # 2 second flush
MAX_BATCH_SIZE=500          # Records before forced flush
GAP_THRESHOLD_MS=30000      # 30 seconds = 3 missed polls
MAX_CONCURRENT_BACKFILLS=5  # Parallel backfill limit
DM_PORT=3001                # Metrics server port
LOG_LEVEL=info              # error/warn/info/debug
```

**Startup Sequence**:
1. Validate configuration
2. Initialize database pool
3. Load active devices from database
4. Assign devices to cohorts
5. Start metrics server
6. Start batch writer
7. Connect to all devices
8. Start polling scheduler
9. Start backfill service
10. Periodic device list refresh (every 5 minutes)

**Graceful Shutdown**:
- SIGTERM/SIGINT handlers
- Stop new polling
- Flush remaining measurements
- Wait for active backfills
- Disconnect all devices
- Close database pool

---

### Database Reset for Production Data (December 1, 2025)
- **Action**: Cleared all demo/simulated data from database
- **Reason**: Preparing for real PowerMon devices (DCL-Moeck + 10 more)
- **Tables Cleared**:
  - organizations, fleets, trucks, users
  - power_mon_devices, device_credentials
  - device_measurements, device_snapshots, device_statistics
  - alerts, sims, sim_location_history, sim_usage_history
  - fuel_prices, savings_config, polling_settings
- **Preserved**: Database schema (all tables exist but empty), admin authentication
- **Device Simulator**: Disabled in `server/index.ts` - no longer generating fake data
- **Next**: Add real organization, fleet, truck for DCL-Moeck device

---

## Previous Updates (November 30, 2025)

### Log Sync Service - Incremental Historical Data Sync (November 30, 2025)
- **New Feature**: `device-manager/lib/log-sync.js` - Service for syncing historical log data from PowerMon
- **Capabilities**:
  - List log files on device with metadata (ID, size, date)
  - Read raw log file data with offset/size control
  - Decode binary log data into structured samples
  - Incremental sync - tracks last sync state per device
  - Progress callbacks for UI feedback
- **Live Test Results** (DCL-Moeck device):
  - 41 log files on device (14 MB total, ~2M samples)
  - Date range: June 27 - November 30, 2025
  - Sample interval: 10 seconds
  - Successfully synced 18,467 samples from last 2 files
  - Incremental sync correctly detects "already up to date"
- **API Functions**:
  - `getLogFileList(device)` - Get list of log files
  - `estimateLogTimeRange(files)` - Get oldest/newest dates, total size
  - `syncDeviceLogs(device, serial, state, progressCb)` - Full incremental sync
  - `syncSince(device, serial, timestamp, progressCb)` - Sync from timestamp
  - `decodeLogData(buffer)` - Decode raw bytes to samples
- **Sync State Structure**:
  ```javascript
  {
    deviceSerial: "A3A5B30EA9B3FF98",
    lastSyncTime: 1764546714405,
    lastFileId: 1764378120,
    lastFileOffset: 123920,
    totalSamplesSynced: 18467
  }
  ```
- **Wrapper Fix**: `decodeLogData()` now returns `startTime` (file start timestamp) instead of error code
- **Documentation**: Updated `device-manager/README.md` with Log Sync Service section

### Step 8 Complete: Device Manager Documentation (November 30, 2025)
- **Created**: `device-manager/README.md` - comprehensive documentation
- **Contents**:
  - Architecture overview with diagram
  - Build instructions
  - Quick start example
  - Full API reference (all static and instance methods)
  - Data structure definitions (MonitorData, FuelgaugeStatistics)
  - Hardware support table
  - Error handling guide
  - Troubleshooting section
- **Also Updated**: Step 11 marked complete (live PowerMon connection verified!)

### Database Schema Update - Device Statistics Table (November 30, 2025)
- **New Table**: `device_statistics` - stores lifetime fuelgauge statistics from PowerMon
- **Fields Added**:
  - Lifetime energy: `totalCharge`, `totalChargeEnergy`, `totalDischarge`, `totalDischargeEnergy` (Ah/Wh)
  - Voltage range: `minVoltage`, `maxVoltage`
  - Current peaks: `maxChargeCurrent`, `maxDischargeCurrent`
  - Fuel gauge: `timeSinceLastFullCharge`, `fullChargeCapacity`, `deepestDischarge`, `lastDischarge`, `soc`
  - Session stats: `secondsSinceOn`, `voltage1Min/Max`, `voltage2Min/Max`, `peakChargeCurrent`, `peakDischargeCurrent`, `temperatureMin/Max`
- **Updated Tables**:
  - `device_snapshots` - added `powerStatus` (integer) and `powerStatusString` (text)
  - `device_measurements` - added `powerStatus` (integer) and `powerStatusString` (text)
- **Schema Types**: Added `DeviceStatistics`, `InsertDeviceStatistics`, `insertDeviceStatisticsSchema`
- **Impact**: Full PowerMon data storage capability now available

### 🎉 MILESTONE: First Live PowerMon Connection from Cloud! (November 30, 2025)
- **Achievement**: Successfully connected to live PowerMon device "DCL-Moeck" via WiFi from cloud server
- **Connection URL**: `https://applinks.thornwave.com/?n=DCL-Moeck&s=a3a5b30ea9b3ff98&h=41&c=...`
- **Device Details**:
  - Name: DCL-Moeck
  - Hardware: PowerMon-W (WiFi)
  - Firmware: v1.32
  - Serial: A3A5B30EA9B3FF98
- **Live Data Retrieved**:
  - Voltage: 28.75 V
  - Current: -0.36 A (discharging)
  - Power: -10.4 W
  - Temperature: 22.9 °C
  - SOC: 98%
  - Runtime: 63,238 minutes (~44 days)
- **Lifetime Statistics**:
  - Total Charge: 7,990 Ah (222.7 kWh)
  - Total Discharge: 8,468 Ah (234.6 kWh)
  - Voltage Range: 23.26V - 30.95V
  - Max Current: 1,092 A
- **Bug Fix**: Removed BLE check from `Connect()` method - WiFi connections don't require BLE
- **Validation**: End-to-end data pipeline confirmed working!

### Thornwave libpowermon v1.17 Update - BLE Dependency Removed! (November 30, 2025)
- **Breakthrough**: Thornwave updated the library to separate BLE initialization from object creation
- **Key Change**: New `initBle()` method - BLE is now optional, called separately after `createInstance()`
- **Before (v1.16)**: `createInstance()` required Bluetooth adapter, failed on servers without BLE
- **After (v1.17)**: `createInstance()` works on any system, WiFi connections work without BLE
- **Updated Files**:
  - `libpowermon_bin/` - Pulled latest from `git.thornwave.com`
  - `device-manager/src/powermon_wrapper.cpp` - Updated constructor to use new pattern
- **Test Results**:
  - Library version: 1.17 ✅
  - Device instance creation: Success ✅
  - BLE available: false (expected on server without Bluetooth)
  - WiFi connections: Ready to use!
- **Build Command**: `cd device-manager && npx node-gyp rebuild`
- **Impact**: Device Manager can now connect to PowerMon devices via WiFi on cloud servers

### Regional Diesel Pricing by Truck Location (November 30, 2025)
- **Feature**: Diesel prices now vary by truck location using EIA PADD regions
- **PADD Regions**: Petroleum Administration for Defense Districts
  - PADD 1A: New England
  - PADD 1B: Central Atlantic
  - PADD 1C: Lower Atlantic
  - PADD 2: Midwest
  - PADD 3: Gulf Coast (Texas, Louisiana)
  - PADD 4: Rocky Mountain
  - PADD 5: West Coast (California, Oregon, Washington)
- **Implementation Files**:
  - `server/services/padd-regions.ts` - State-to-PADD mapping + coordinate lookup
  - `server/services/eia-client.ts` - Updated to fetch regional prices by PADD code
  - `server/services/savings-calculator.ts` - Uses truck coordinates for local pricing
- **EIA API facets**: Uses `duoarea` parameter (R1X, R1Y, R1Z, R20, R30, R40, R50, R00)
- **Fallback behavior**: Uses US national average if truck has no coordinates
- **Benefit**: More accurate savings calculations - e.g., California diesel ($5.20) vs Gulf Coast ($3.40)

### AI Assistant Visual Updates (November 30, 2025)
- Changed all Bot/MessageCircle icons to sun.png with #EBEFFA background
- Updated: header icon, message avatars, loading state, floating button
- User bubble background: #92a6b3
- Send button: #303030

### AI Fleet Assistant (November 30, 2025)
- **Feature**: Natural language chat assistant for fleet management queries
- **Backend**: `server/services/fleet-assistant.ts` - OpenAI GPT-4o-mini with function calling
- **API endpoint**: `POST /api/v1/assistant/chat` - handles conversation with context
- **Function tools defined**:
  - `get_all_trucks` - list trucks with optional status filter
  - `get_truck_details` - detailed info for specific truck by number
  - `get_fleet_statistics` - savings, SOC, maintenance metrics
  - `get_active_alerts` - unresolved alerts across fleet
  - `get_low_battery_trucks` - trucks below SOC threshold
  - `get_fleet_summary` - quick fleet health overview
- **Frontend**: `client/src/components/FleetAssistant.tsx` - slide-out chat drawer
- **UI location**: Header bar next to notifications
- **Integration**: Uses Replit AI Integrations for OpenAI API key management

### Fleet Stats with 7-Day Trends (All 4 Cards)
- **Fleet stats calculator**: `server/services/fleet-stats-calculator.ts` calculates all metrics
- **API endpoint**: `GET /api/v1/fleet-stats` returns SOC, maintenance, runtime metrics with 7-day trends
- **Today's Savings**: Real calculation from solar energy (solar_Wh / 1000 / 9 kWh/gal × fuel price)
- **Avg SOC**: Current average from snapshots, compared to 7-day historical average
- **Tractor maintenance interval**: Derived from runtime reduction (less engine use = extended intervals)
- **Tractor hours offset**: Fleet-level total hours saved (baseline × device count - actual runtime)
- **Trend labels**: All cards now show "vs 7d" to indicate 7-day comparison
- **EIA_API_KEY**: Configured and active - fetches live weekly diesel prices

### Fleet Stats Calculation Fix (November 30, 2025)
- **Issue**: Hours offset was inflated when some devices were offline or not reporting
- **Root cause**: Used total registered device count instead of devices that actually reported data
- **Fix applied**: Baseline now calculated only from devices with measurements
  - `deviceCountToday = todayData.deviceCount` (from actual measurements)
  - `deviceCount7Day = sevenDayData.avgDeviceCount` (average across 7 days)
- **Result**: Accurate fleet-level metrics that reflect only active reporting devices

### Fleet Overview Filter Update (November 30, 2025)
- **Updated**: Filter buttons now show truck counts like Figma design
  - "All (09)" - total truck count
  - "In Service (07)" - with green dot indicator
  - "Not In Service (3)" - with red dot indicator
- **Removed**: "Active Trucks XX / XX" text next to Fleet Overview title
- **Matches**: Figma node 2580-9784 design specification

### UI Polish (November 30, 2025)
- **FleetStats cards**: Trend indicators now vertically centered with stat icons
- **Fleet Overview title**: Bottom-aligned with buttons, no bottom padding
- **Export CSV button**: Simplified to plain text + icon (no border/hover), 4px right margin
- **Historical Data cards**: Background changed to #FAFBFC
- **Table headers**: Chassis and Sleeper headers updated to orange theme
  - Background: #FFD7C0
  - Text: #FA4B1E

### Savings Calculation Feature
- **Database tables added**: `fuel_prices` (stores EIA diesel prices), `savings_config` (per-org calculation settings)
- **EIA API client**: `server/services/eia-client.ts` fetches weekly diesel prices from U.S. Energy Information Administration
- **Savings calculator**: `server/services/savings-calculator.ts` computes fuel savings from solar energy

### Font Consistency Update
- Changed application font from Inter to DM Sans for consistent typography
- Updated Google Fonts import in `client/index.html`
- Updated CSS variable `--font-sans` in `client/src/index.css`

### Export Button Positioning
- Finalized Export button position: 2px gap from status badge
- Button height: 27px (matches status badge)

---

## Project Overview

**Goal**: Build a multi-tenant Fleet Management Dashboard for Deecell Power Systems displaying truck fleet data with real-time PowerMon metrics, status tracking, and historical information.

**Architecture**:
- Organizations (customers) → Fleets (1-N per org) → Trucks → PowerMon Devices
- Device Manager polls PowerMon devices for real-time data and log file sync
- Fleet Viewer dashboard displays truck locations, metrics, status
- Deecell Operations dashboard for provisioning

---

## Development Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Step 1 | Database Schema | ✅ Complete |
| Step 2 | Storage Layer | ✅ Complete |
| Step 3 | API Routes | ✅ Complete |
| Step 4 | Test Data Hydration | ✅ Complete |
| Step 5 | Connect Dashboard | ✅ Complete |
| Step 6 | Device Manager Simulation | ✅ Complete |
| Step 7 | Alerts System | ✅ Complete |
| Step 8 | Device Manager Docs | ✅ Complete |
| Step 9 | Admin Dashboard | ✅ Complete |
| Step 10 | Customer Authentication | ✅ Complete |
| Step 11 | Device Manager (libpowermon) | ✅ Complete |
| Step 12 | In-App Notifications | ✅ Complete |
| Step 13 | SIMPro Integration | 🔄 In Progress |
| Step 14 | CSV Export Feature | ✅ Complete |
| Step 15 | Savings Calculation | ✅ Complete |

---

## Step 1: Database Schema

**Date Started**: November 28, 2025
**Date Completed**: November 28, 2025

### What We're Building

Multi-tenant PostgreSQL schema with the following tables:

| Table | Purpose |
|-------|---------|
| `organizations` | Customer accounts (tenants) |
| `users` | Login accounts scoped to organizations |
| `fleets` | Named truck groups (1-N per organization) |
| `trucks` | Vehicles with metadata (number, driver, location) |
| `power_mon_devices` | PowerMon hardware info (serial, firmware, etc.) |
| `device_credentials` | Encrypted WifiAccessKey for remote connection |
| `device_snapshots` | Latest readings for fast dashboard queries |
| `device_measurements` | Time-series data (partitioned by month) |
| `device_sync_status` | Tracks log file offset for backfill |
| `alerts` | OFFLINE and Low Voltage notifications |
| `audit_logs` | SOC2 compliance tracking |
| `sessions` | User session storage |

### Key Design Decisions

1. **Multi-tenancy Model**: Shared database with row-level security
   - All tables include `organization_id` foreign key
   - Middleware enforces tenant scoping on all queries
   - Cost-efficient while maintaining data isolation

2. **Fleet Structure**: 1-N fleets per customer
   - Each fleet has custom name (e.g., "Flatbed Fleet", "Van-Trailer Fleet")
   - Trucks belong to exactly one fleet

3. **Truck-to-PowerMon Relationship**: 1:1 for lifetime
   - One PowerMon device per truck
   - Device stays with truck unless replaced/repaired
   - Track historical assignments via `assigned_at` / `unassigned_at`

4. **Data Storage Strategy**: Store ALL raw PowerMon data
   - `device_measurements` table partitioned by month
   - `device_snapshots` table for latest readings (fast dashboard queries)
   - Full data retention for future analysis flexibility

5. **Scaling for 500,000 trucks per fleet**:
   - Composite indexes on `(organization_id, fleet_id, status)`
   - Pagination on all list endpoints
   - Monthly partitioning on measurements table
   - Snapshots table avoids scanning large measurements table

6. **Device Connection Tracking**:
   - `device_sync_status` tracks last log file offset
   - Enables efficient backfill when devices come back online
   - Supports both real-time polling and log file sync modes

7. **Initial Alerts** (V1):
   - Device OFFLINE (can't connect)
   - Low Voltage (V1 below threshold)
   - More alert types planned for future

### PowerMon Data Fields

From the Thornwave PowerMon library:
- `voltage1`, `voltage2` - Battery voltages (V)
- `current` - Current draw (A)
- `power` - Power consumption (W)
- `temperature` - Device temperature (°C)
- `soc` - State of Charge (%)
- `energy` - Energy consumed (Wh)
- `charge` - Charge consumed (Ah)
- `runtime` - Estimated runtime (minutes)
- `rssi` - WiFi signal strength

### How to Verify

After schema is implemented:
1. Run `npm run db:push` to apply schema to database
2. Check tables exist in PostgreSQL
3. Test sample queries with EXPLAIN ANALYZE to verify indexes

### Verification Results ✅

**Tables Created** (13 total):
- `organizations`, `users`, `fleets`, `trucks`
- `power_mon_devices`, `device_credentials`, `device_snapshots`
- `device_measurements`, `device_sync_status`
- `alerts`, `audit_logs`, `sessions`, `polling_settings`

**Indexes Created** (30+ total):
- Composite indexes for tenant-scoped queries (e.g., `truck_org_fleet_status_idx`)
- Time-series indexes for measurements (e.g., `measurement_org_device_time_idx`)
- Unique constraints for business rules (e.g., `fleet_org_name_idx`)

**Multi-tenancy Verification**:
- All business tables have `organization_id` column for tenant scoping
- Row-level security can operate without indirect joins
- Fixed: Added `organization_id` to `device_credentials` and `device_sync_status` (caught in review)

**Key File**: `shared/schema.ts`
- All Drizzle ORM table definitions
- Zod insert schemas for validation
- TypeScript types for both insert and select operations
- Legacy schemas preserved for backward compatibility with existing dashboard
- Constants for alert types, device status, truck status

---

## Step 2: Storage Layer (Completed)

### Implementation Date
November 28, 2025

### What Was Built

**Database Connection Module** (`server/db.ts`):
- Drizzle ORM client with connection pooling (max 20 connections)
- Environment-based configuration via DATABASE_URL

**DbStorage Class** (`server/db-storage.ts`):
- Complete tenant-scoped CRUD for all 13 tables
- Every query filters by `organizationId` for multi-tenancy isolation
- Optimized dashboard queries with batch loading

### Key Functions

| Entity | Functions |
|--------|-----------|
| Organizations | create, get, getBySlug, list, update |
| Users | create, get, getByEmail, list, update, updateLastLogin |
| Fleets | create, get, getByName, list, update, delete |
| Trucks | create, get, getByNumber, list, countByStatus, update, updateLocation, delete |
| Devices | create, get, getBySerial, getByTruck, list, countByStatus, update, assign, unassign, updateStatus |
| Credentials | create, get, update, delete |
| Snapshots | upsert, get, getByTruck, list, getFleetStats |
| Measurements | insert, insertBatch, getMeasurements, getMeasurementsByTruck, getLatest |
| Sync Status | upsert, get, updateProgress, updateError, updateLastPoll |
| Alerts | create, get, list, listByTruck, countActive, acknowledge, resolve, resolveByDevice |
| Audit Logs | create, list |
| Polling Settings | getOrCreate, update |
| Dashboard | getDashboardData (optimized aggregation) |

### Security Fixes

**Issue Found**: `getDeviceBySerial` initially didn't filter by organization
**Fix Applied**: Added `organizationId` parameter, created separate `checkSerialExists` for provisioning

### Test Results

```
Multi-tenancy Isolation Test:
  Org2 trucks (should be 0): 0
  Cross-org truck access (should be undefined): undefined
```

### Key Files
- `server/db.ts` - Database connection
- `server/db-storage.ts` - Full storage implementation
- `server/storage.ts` - Interface definition
- `server/test-storage.ts` - Integration tests

---

## Step 3: API Routes (Completed)

### Implementation Date
November 28, 2025

### What Was Built

**Tenant Middleware** (`server/middleware/tenant.ts`):
- Extracts `organizationId` from `X-Organization-Id` header
- Also supports `X-Organization-Slug` for organization lookup
- Adds `organizationId` to Express Request object
- Returns 400 if no tenant context provided

**Fleet Routes** (`server/api/fleet-routes.ts`):
- RESTful API structure at `/api/v1/*`
- All routes use tenant middleware for multi-tenancy isolation
- Zod validation on all POST/PATCH endpoints

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Organizations** | | |
| GET | /api/v1/organizations | List all organizations (admin) |
| GET | /api/v1/organizations/:id | Get organization details |
| POST | /api/v1/organizations | Create organization |
| PATCH | /api/v1/organizations/:id | Update organization |
| **Fleets** | | (tenant-scoped) |
| GET | /api/v1/fleets | List fleets |
| GET | /api/v1/fleets/:id | Get fleet details |
| POST | /api/v1/fleets | Create fleet |
| PATCH | /api/v1/fleets/:id | Update fleet |
| DELETE | /api/v1/fleets/:id | Delete fleet |
| **Trucks** | | (tenant-scoped) |
| GET | /api/v1/trucks | List trucks with filtering/pagination |
| GET | /api/v1/trucks/:id | Get truck details with snapshot |
| POST | /api/v1/trucks | Create truck |
| PATCH | /api/v1/trucks/:id | Update truck |
| PATCH | /api/v1/trucks/:id/location | Update truck GPS location |
| DELETE | /api/v1/trucks/:id | Delete truck |
| **Devices** | | (tenant-scoped) |
| GET | /api/v1/devices | List PowerMon devices |
| GET | /api/v1/devices/:id | Get device details |
| POST | /api/v1/devices | Create device |
| PATCH | /api/v1/devices/:id | Update device |
| POST | /api/v1/devices/:id/assign | Assign device to truck |
| POST | /api/v1/devices/:id/unassign | Unassign device from truck |
| PATCH | /api/v1/devices/:id/status | Update device online status |
| **Dashboard** | | (tenant-scoped) |
| GET | /api/v1/dashboard | Aggregated fleet stats |
| GET | /api/v1/fleets/:id/stats | Fleet-specific stats |
| GET | /api/v1/dashboard/active-trucks | Trucks with latest snapshots |
| **Alerts** | | (tenant-scoped) |
| GET | /api/v1/alerts | List alerts with pagination |
| POST | /api/v1/alerts | Create new alert |
| POST | /api/v1/alerts/:id/acknowledge | Acknowledge alert |
| POST | /api/v1/alerts/:id/resolve | Resolve alert |
| **Measurements** | | (tenant-scoped) |
| GET | /api/v1/measurements | Time-series data (date range, limit, offset) |
| GET | /api/v1/trucks/:id/measurements | Truck-specific measurements |
| GET | /api/v1/devices/:id/measurements | Device-specific measurements |
| **Polling Settings** | | (tenant-scoped) |
| GET | /api/v1/polling-settings | Get polling configuration |
| PATCH | /api/v1/polling-settings | Update polling frequency |

### Query Parameters

**Trucks List** (`GET /api/v1/trucks`):
- `fleetId` - Filter by fleet
- `status` - Filter by status (in-service, not-in-service, maintenance)
- `limit` - Pagination limit (default: 50)
- `offset` - Pagination offset

**Measurements** (`GET /api/v1/measurements`):
- `deviceId` - Filter by device
- `startDate` - Start of date range (ISO 8601)
- `endDate` - End of date range (ISO 8601)
- `limit` - Pagination limit (default: 1000)
- `offset` - Pagination offset

### Validation Schemas

All POST/PATCH endpoints validate request body with Zod:
- `updateLocationSchema` - lat/lng as numbers
- `assignDeviceSchema` - truckId as number
- `updateDeviceStatusSchema` - status enum (online/offline/unknown)
- `acknowledgeAlertSchema` - userId as number

### Test Results

All endpoints tested successfully:
```
Organizations API: ✓
Fleets API (tenant-scoped): ✓
Trucks API (with filtering): ✓
Devices API (assign/unassign): ✓
Dashboard API (aggregations): ✓
Alerts API (acknowledge/resolve): ✓
Measurements API (pagination): ✓
Polling Settings API: ✓
Zod Validation: ✓
```

### Key Files
- `server/middleware/tenant.ts` - Tenant extraction middleware
- `server/api/fleet-routes.ts` - All API route handlers
- `server/routes.ts` - Route registration

---

## Step 4: Test Data Hydration (Completed)

### Implementation Date
November 28, 2025

### What Was Built

**Seed Script** (`server/seed-data.ts`):
- Creates realistic demo data for dashboard testing
- Run with: `npx tsx server/seed-data.ts`

### Demo Data Created

**Organization**: Acme Transport (ID: 6)
- Contact: fleet@acmetransport.com
- Timezone: America/Los_Angeles

**Fleets**: 2
- Flatbed Fleet (8 trucks) - Heavy haul for construction/industrial
- Van-Trailer Fleet (7 trucks) - Enclosed for freight/deliveries

**Trucks**: 15 with realistic US locations
| Fleet | Truck | Driver | Location |
|-------|-------|--------|----------|
| Flatbed | FLT-001 | John Martinez | Los Angeles, CA |
| Flatbed | FLT-002 | Mike Johnson | Phoenix, AZ |
| Flatbed | FLT-003 | Carlos Rivera | Houston, TX |
| Flatbed | FLT-004 | James Wilson | San Diego, CA |
| Flatbed | FLT-005 | Robert Brown | Las Vegas, NV |
| Flatbed | FLT-006 | David Lee | San Francisco, CA |
| Flatbed | FLT-007 | William Chen | Dallas, TX |
| Flatbed | FLT-008 | Thomas Garcia | Atlanta, GA |
| Van-Trailer | VAN-001 | Sarah Thompson | Santa Monica, CA |
| Van-Trailer | VAN-002 | Jennifer Adams | San Jose, CA |
| Van-Trailer | VAN-003 | Emily Davis | Denver, CO |
| Van-Trailer | VAN-004 | Amanda White | Seattle, WA |
| Van-Trailer | VAN-005 | Michelle Taylor | Portland, OR |
| Van-Trailer | VAN-006 | Lisa Anderson | Salt Lake City, UT |
| Van-Trailer | VAN-007 | Karen Martin | Oklahoma City, OK |

**PowerMon Devices**: 15 (1:1 with trucks)
- Serial format: PWM-1000 to PWM-1007 (Flatbed), PWM-2000 to PWM-2006 (Van-Trailer)
- Firmware: 1.10.2, Model: PowerMon Pro

**Device Snapshots**: 15 with varied readings
- SOC: 65-98%
- Voltage: 12.0-14.4V
- Current: 5-30A
- Temperature: 20-45°C

**Measurements**: 960 records (48 hours for first 5 trucks)
- 15-minute intervals
- Simulates day/night SOC patterns (discharge during day, charge at night)

**Alerts**: 4
| Type | Truck | Status | Severity |
|------|-------|--------|----------|
| Low Voltage | FLT-005 | Active | Warning |
| Device Offline | FLT-003 | Active | Critical |
| Low Voltage | FLT-001 | Resolved | Warning |
| Low Voltage | FLT-008 | Acknowledged | Warning |

### API Verification

```
GET /api/v1/trucks → 15 trucks ✓
GET /api/v1/fleets → 2 fleets ✓
GET /api/v1/alerts → 4 alerts ✓
GET /api/v1/dashboard/stats → Aggregated stats ✓
GET /api/v1/devices/5/measurements → Historical data ✓
```

### Key Files
- `server/seed-data.ts` - Seed script

---

## Architecture Notes

### Remote Device Connection

PowerMon devices connect via 4G routers on trucks. Connection uses:
- WifiAccessKey structure containing encrypted credentials
- Applinks URL format: `https://applinks.thornwave.com/powermon?...`
- Base64-encoded device name, serial, host ID, connection key, access key

### Data Collection Modes

1. **Real-time Polling**: Get current sample data when device is online
2. **Log File Sync**: Download historical data from device storage
   - Track offset to avoid re-downloading
   - Backfill gaps when device reconnects after being offline

### Future: Node.js Native Addon

Device Manager will use Node.js native addon (node-addon-api) to wrap the C++ libpowermon library:
- Pre-built binaries for AWS Linux deployment
- N-API for ABI stability across Node.js versions
- Async workers for non-blocking device communication

---

## Step 9: Admin Dashboard (Completed)

### Implementation Date
November 28-29, 2025

### What Was Built

**Admin Dashboard UI** - 6 fully functional admin pages for Deecell Operations:

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/admin` | System-wide statistics (orgs, fleets, trucks, devices, users) |
| Organizations | `/admin/organizations` | CRUD for customer organizations |
| Fleets | `/admin/fleets` | Fleet management across all organizations |
| Trucks | `/admin/trucks` | Truck provisioning and management |
| Devices | `/admin/devices` | PowerMon device management and assignment |
| Users | `/admin/users` | User account management with role assignment |

### Backend Implementation

**Admin API Routes** (`server/api/admin-routes.ts`):
- Complete CRUD endpoints at `/api/v1/admin/*`
- Cross-organizational access (bypasses tenant middleware)
- Session-based authentication with middleware

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/admin/login` | POST | Admin login with password |
| `/api/v1/admin/logout` | POST | Session logout |
| `/api/v1/admin/session` | GET | Check authentication status |
| `/api/v1/admin/stats` | GET | System-wide statistics |
| `/api/v1/admin/organizations` | GET/POST | List/create organizations |
| `/api/v1/admin/organizations/:id` | GET/PATCH/DELETE | Manage organization |
| `/api/v1/admin/fleets` | GET/POST | List/create fleets |
| `/api/v1/admin/fleets/:id` | GET/PATCH/DELETE | Manage fleet |
| `/api/v1/admin/trucks` | GET/POST | List/create trucks |
| `/api/v1/admin/trucks/:id` | GET/PATCH/DELETE | Manage truck |
| `/api/v1/admin/devices` | GET/POST | List/create devices |
| `/api/v1/admin/devices/:id` | GET/PATCH/DELETE | Manage device |
| `/api/v1/admin/users` | GET/POST | List/create users |
| `/api/v1/admin/users/:id` | GET/PATCH/DELETE | Manage user |

**New Storage Methods** (`server/db-storage.ts`):
- `deleteOrganization(id)` - Remove organization
- `listAllDevices()` - Get all devices across orgs
- `listAllUsers()` - Get all users across orgs
- `deleteUser(id)` - Remove user
- `getAdminStats()` - Aggregate counts for dashboard

### Authentication Implementation

**Session Middleware** (`server/routes.ts`):
- Express session with MemoryStore
- 24-hour session expiry
- Secure cookies in production

**Authentication Flow**:
1. User navigates to `/admin/*`
2. `AdminLayout` checks session via `/api/v1/admin/session`
3. If not authenticated, redirects to `/admin/login`
4. User enters credentials (username: "admin", password: from ADMIN_PASSWORD secret)
5. On success, session cookie is set and user is redirected to `/admin`
6. All subsequent admin API calls include session cookie for authentication

**Security**:
- Password stored as environment secret (`ADMIN_PASSWORD`)
- Server-side session storage (never exposed to frontend)
- Automatic redirect on session expiry

### Frontend Components

**AdminLayout** (`client/src/components/AdminLayout.tsx`):
- Sidebar navigation with 6 menu items
- Session check on mount with loading state
- Logout functionality
- Orange branding color (#FA4B1E) for active/hover states

**AdminLogin** (`client/src/pages/admin/AdminLogin.tsx`):
- Login form with username/password fields
- Deecell logo branding
- Orange submit button (#FA4B1E)
- Clean input styling (no focus rings)

**Admin API Hooks** (`client/src/lib/admin-api.ts`):
- `useAdminSession()` - Check authentication status
- `useAdminLogin()` - Login mutation
- `useAdminLogout()` - Logout mutation
- `useAdminStats()` - Dashboard statistics
- CRUD hooks for all entities (organizations, fleets, trucks, devices, users)

### UI Styling

**Admin Branding**:
- Orange accent color: `#FA4B1E`
- Used for buttons, active nav items, hover states
- Custom CSS class `.admin-nav-item` in `index.css`

**Custom Styles** (`client/src/index.css`):
```css
.admin-nav-item:hover {
  background-color: rgba(250, 75, 30, 0.1) !important;
  color: #FA4B1E !important;
}

.admin-nav-item.active {
  background-color: rgba(250, 75, 30, 0.1);
  color: #FA4B1E;
  border-left: 4px solid #FA4B1E;
}
```

### Key Files

| File | Purpose |
|------|---------|
| `server/api/admin-routes.ts` | Admin API routes with session auth |
| `server/routes.ts` | Session middleware setup |
| `client/src/pages/admin/AdminLogin.tsx` | Login page with logo |
| `client/src/pages/admin/AdminDashboard.tsx` | Stats dashboard |
| `client/src/pages/admin/OrganizationsPage.tsx` | Organization management |
| `client/src/pages/admin/FleetsPage.tsx` | Fleet management |
| `client/src/pages/admin/TrucksPage.tsx` | Truck management |
| `client/src/pages/admin/DevicesPage.tsx` | Device management |
| `client/src/pages/admin/UsersPage.tsx` | User management |
| `client/src/components/AdminLayout.tsx` | Admin layout with sidebar |
| `client/src/lib/admin-api.ts` | Admin API hooks and utilities |
| `client/src/index.css` | Custom admin navigation styles |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `ADMIN_PASSWORD` | Admin login password (stored as secret) |

---

## Step 10: Customer Authentication (Completed)

### Implementation Date
November 29, 2025

### What Was Built

**Customer Login System** - Secure session-based authentication for fleet customers:

| Component | Description |
|-----------|-------------|
| Login Page | Email/password form at `/login` route |
| Session Management | Secure cookie-based sessions with regeneration |
| Protected Routes | All fleet API routes require authentication |
| Logout | Proper session destruction with cache clearing |

### Backend Implementation

**Customer Auth API Routes** (`server/api/auth-routes.ts`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/auth/login` | POST | Authenticate customer with email/password |
| `/api/v1/auth/logout` | POST | Destroy session and clear cookie |
| `/api/v1/auth/session` | GET | Check authentication status |

**Tenant Middleware Updates** (`server/middleware/tenant.ts`):
- Session-based authentication only (no header bypass)
- Validates user exists and is active
- Validates organization exists and is active
- Auto-destroys session if user/org becomes inactive

### Security Implementation

| Control | Implementation |
|---------|----------------|
| **Password Hashing** | bcrypt with 10 salt rounds |
| **Session Fixation Prevention** | `session.regenerate()` on login |
| **Secure Cookies** | HttpOnly, Secure (prod), SameSite=Lax |
| **Session Destruction** | `session.destroy()` + cookie clear on logout |
| **Account Status Checks** | Verify user and org are active on every request |
| **Cache Clearing** | React Query cache cleared on logout |
| **Password Validation** | 6 character minimum (server-side) |

### Authentication Flow

1. User navigates to `/login`
2. Enters email and password
3. Server validates credentials with bcrypt
4. Server checks user and organization are active
5. Session regenerated to prevent fixation attacks
6. User redirected to dashboard
7. All fleet API calls use session cookie for tenant context
8. Logout destroys session and clears browser cache

### Frontend Components

**Login Page** (`client/src/pages/Login.tsx`):
- Email/password form with validation
- Error message display
- Redirect to dashboard on success
- Deecell branding

**Auth Hooks** (`client/src/lib/auth-api.ts`):
- `useAuthSession()` - Check authentication status
- `useLogin()` - Login mutation
- `useLogout()` - Logout mutation with cache clear

**Dashboard Updates** (`client/src/pages/Dashboard.tsx`):
- Auth check on mount
- Redirect to `/login` if unauthenticated
- Logout button in header

### SOC2 Compliance Status

**Currently Implemented** (Ready for basic compliance):
- ✅ Password hashing (bcrypt)
- ✅ Session fixation prevention
- ✅ Secure cookie configuration
- ✅ Account status verification
- ✅ Multi-tenant isolation

**Future SOC2 Enhancements** (Not yet implemented):
- ❌ Rate limiting on login endpoints
- ❌ Audit logging for auth events
- ❌ Account lockout after failed attempts
- ❌ Password complexity requirements
- ❌ Multi-factor authentication (MFA)
- ❌ Session idle timeout
- ❌ Password expiration policy

### Key Files

| File | Purpose |
|------|---------|
| `server/api/auth-routes.ts` | Customer auth API with session management |
| `server/middleware/tenant.ts` | Session-based tenant isolation |
| `client/src/pages/Login.tsx` | Customer login page |
| `client/src/lib/auth-api.ts` | Auth hooks and utilities |
| `client/src/pages/Dashboard.tsx` | Protected dashboard with auth checks |

### Security Fixes Applied

1. **Removed header-based org bypass**: `tenantMiddleware` now only accepts session-based authentication
2. **Session regeneration**: Both admin and customer login regenerate sessions to prevent fixation
3. **Proper logout**: Both systems use `session.destroy()` with cookie clearing
4. **Active status checks**: Login and middleware verify user/org are active
5. **Cache clearing**: Frontend clears React Query cache on logout to prevent cross-tenant data leakage

---

## Step 11: Device Manager - libpowermon Integration (In Progress)

### Implementation Date
November 29, 2025

### What's Being Built

**Device Manager** - Node.js service that communicates with PowerMon devices:

| Component | Description |
|-----------|-------------|
| libpowermon | Thornwave's C++ library for PowerMon communication |
| powermon-bridge | C++ executable that wraps libpowermon |
| BridgeClient | Node.js module that spawns and manages the bridge |
| TypeScript Types | Full type definitions for all PowerMon data structures |

### Architecture Decision

**Problem**: libpowermon C++ static library (`powermon_lib.a`) wasn't compiled with `-fPIC`, which is required for Node.js native addons (shared libraries) on Linux x64.

**Solution**: Bridge executable architecture:
1. Build `powermon-bridge` as standalone executable (static linking works)
2. Node.js spawns bridge as subprocess
3. Communication via stdin/stdout with NDJSON protocol
4. This approach works with the unmodified library

### Repository Cloned

```bash
git clone https://git.thornwave.com/git/thornwave/libpowermon_bin.git
```

**Contents**:
- `powermon_lib.a` - Linux x64 static library
- `powermon_lib_rpi64.a` - Raspberry Pi 64-bit version
- `inc/` - Header files (powermon.h, powermon_log.h, etc.)
- `examples/` - Connect and scan examples

### libpowermon API Summary

| Function | Purpose |
|----------|---------|
| `DeviceIdentifier::fromURL(url)` | Parse access URL to extract encryption keys |
| `connectWifi(WifiAccessKey)` | Connect to remote device via cloud relay |
| `requestGetInfo()` | Device name, firmware, serial number |
| `requestGetMonitorData()` | Real-time V1, V2, current, power, temp, SOC |
| `requestGetStatistics()` | Power meter statistics |
| `requestGetFgStatistics()` | Fuelgauge/battery statistics |
| `requestGetLogFileList()` | List available log files |
| `requestReadLogFile()` | Download log file data |
| `PowermonLogFile::decode()` | Parse log data into samples |

### MonitorData Fields

From real-time polling:
- `voltage1`, `voltage2` - Battery voltages (V)
- `current` - Current draw (A)
- `power` - Power consumption (W)
- `temperature` - Device temperature (°C)
- `coulombMeter` - Charge consumed (Ah)
- `energyMeter` - Energy consumed (Wh)
- `powerStatus` - PS_OFF, PS_ON, PS_LVD, PS_OCD, etc.
- `soc` - State of Charge (%)
- `runtime` - Estimated runtime (minutes)
- `rssi` - WiFi signal strength (dBm)

### Bridge Commands

The `powermon-bridge` executable accepts these commands on stdin:

| Command | Parameters | Response |
|---------|------------|----------|
| `version` | - | Library version info |
| `parse <url>` | Access URL | Parsed device identifier |
| `connect <url>` | Access URL | Connection status |
| `disconnect` | - | Disconnection acknowledgment |
| `status` | - | Connected/connecting state |
| `info` | - | Device information |
| `monitor` | - | Current monitor data |
| `statistics` | - | Power meter statistics |
| `fgstatistics` | - | Battery statistics |
| `logfiles` | - | List of log files |
| `readlog <id> <offset> <size>` | File params | Log data (hex) |
| `stream <interval_ms> [count]` | Polling params | Continuous monitor events |
| `quit` | - | Exit the bridge |

### Known Limitation

**Bluetooth Hardware Requirement**: The libpowermon library initializes Bluetooth subsystem on startup, even for WiFi-only connections. This requires Bluetooth hardware (HCI socket) to be available.

**Impact**:
- Development/testing environments without Bluetooth will fail to start the bridge
- AWS deployment must include Bluetooth support (or use a Bluetooth-capable AMI)
- WiFi remote connections work once bridge starts successfully

### Test Device Provided

Access URL for testing:
```
https://applinks.thornwave.com/?n=DCL-Moeck&s=a3a5b30ea9b3ff98&h=41&c=c1HOvvGTYe4HcxZ1AWUUVg%3D%3D&k=qN19gp1NyTIjTcKXIFUagek74WSxnF9446mW1lX0Ca4%3D
```

### Files Created

| File | Purpose |
|------|---------|
| `device-manager/src/powermon_bridge.cpp` | C++ bridge executable source |
| `device-manager/Makefile` | Build configuration |
| `device-manager/lib/bridge-client.js` | Node.js bridge manager |
| `device-manager/lib/bridge-client.d.ts` | TypeScript type definitions |
| `device-manager/lib/index.js` | Package entry point |
| `device-manager/lib/index.d.ts` | Package type definitions |
| `device-manager/package.json` | Package configuration |

### Build Status

✅ Bridge executable compiles successfully:
```bash
cd device-manager && make
# Output: powermon-bridge (264KB executable)
```

### Protocol Robustness (Fixed)

**Issue Identified**: Original protocol used FIFO queue for command/response matching, which broke when async events arrived before results.

**Fix Applied**: Command ID tagging system:
- Commands sent as: `<cmd_id> <command> [args]`
- Results include ID: `{"type":"result","id":"cmd_xxx","success":true,...}`
- Errors include ID: `{"type":"error","id":"cmd_xxx","message":"..."}`
- Fatal startup errors: `{"type":"fatal","message":"..."}`
- Events remain untagged (not responses to commands)

**Node.js Client Changes**:
- Changed from FIFO `pendingCallbacks` array to Map-based tracking by command ID
- Added proper cleanup of `connecting` state on connect failures
- Added immediate failure detection for fatal bridge startup errors

### Native Addon Build Success (November 29, 2025)

**Thornwave PIC Library Update Completed!**

Thornwave fixed their library with the commit "Fixed PIC library" - all object files now compiled with `-fPIC` flag.

**Build Success:**
```bash
cd device-manager && npx node-gyp rebuild
# Result: gyp info ok
# Created: build/Release/powermon_addon.node (413KB)
```

**Library Version:** 1.16 (upgraded from v1.10)

**Native Addon Test Results:**
```javascript
const addon = require('./build/Release/powermon_addon.node');

// Static methods work without Bluetooth:
addon.PowermonDevice.getLibraryVersion()  // { major: 1, minor: 16, string: '1.16' }
addon.PowermonDevice.getPowerStatusString(0) // 'OFF'
addon.PowermonDevice.getPowerStatusString(1) // 'ON'
addon.PowermonDevice.getPowerStatusString(2) // 'LVD'
addon.PowermonDevice.getPowerStatusString(3) // 'OCD'
addon.PowermonDevice.getPowerStatusString(4) // 'HVD'
addon.PowermonDevice.getPowerStatusString(5) // 'FGD'
```

**Files Created:**

| File | Purpose |
|------|---------|
| `device-manager/binding.gyp` | Node-gyp build configuration |
| `device-manager/src/addon.cpp` | N-API addon entry point |
| `device-manager/src/powermon_wrapper.cpp` | PowerMon C++ wrapper |
| `device-manager/src/powermon_wrapper.h` | Wrapper header file |
| `device-manager/lib/index.ts` | TypeScript wrapper with types |
| `device-manager/lib/index.js` | Compiled JavaScript |
| `device-manager/build/Release/powermon_addon.node` | Compiled native addon |

**TypeScript Interface:**
```typescript
import { PowermonDevice, getLibraryVersion } from './device-manager/lib/index';

// Static methods (work without Bluetooth)
const version = getLibraryVersion();
const parsed = PowermonDevice.parseAccessURL(url);
const hwString = PowermonDevice.getHardwareString(0x0100);
const psString = PowermonDevice.getPowerStatusString(1);

// Instance methods (require Bluetooth for initialization)
const device = new PowermonDevice();
device.connect({ url: accessUrl, onConnect: () => {}, onDisconnect: () => {} });
device.getMonitorData((response) => { console.log(response.data); });
device.disconnect();
```

### Bluetooth Error Handling (Fixed)

**Problem Solved:** The library's `Powermon::createInstance()` threw an exception when no Bluetooth hardware was available, causing the Node.js process to crash.

**Solution Applied:** Modified the C++ wrapper to catch the BLE initialization exception gracefully:
```cpp
PowermonWrapper::PowermonWrapper(const Napi::CallbackInfo& info) {
    try {
        powermon_ = Powermon::createInstance();
        if (powermon_ != nullptr) {
            ble_available_ = true;
            SetupCallbacks();
        }
    } catch (const std::exception& e) {
        // BLE init failed - expected on servers without Bluetooth
        powermon_ = nullptr;
        ble_available_ = false;
    }
}
```

**Result:** The addon now works on ANY server:
- Instance creation succeeds (no crash)
- `device.isBleAvailable()` returns `false` when no BLE hardware
- Static methods work perfectly (`getLibraryVersion`, `parseAccessURL`, etc.)
- Attempting to connect gives a clear error message instead of crashing

**Test Output:**
```
Device initialized: true
BLE available: false
Library Version: { major: 1, minor: 16, string: '1.16' }
```

### Next Steps

**Awaiting Thornwave Update (ETA: Monday)**

Thornwave (Raz) is updating `createInstance()` to work without Bluetooth hardware for WiFi-only connections. Once pushed:
1. Pull updated library from `git.thornwave.com`
2. Rebuild native addon
3. Connect to live test device (DCL-Moeck in Southern California)
4. Test real-time data retrieval

**After Thornwave Update:**
1. **Connect to test device** using provided access URL
2. **Implement Device Manager service** that:
   - Polls devices based on polling settings
   - Stores snapshots and measurements in database
   - Syncs log files for historical data
   - Generates alerts for offline/low voltage conditions
4. **Create WebSocket integration** for real-time dashboard updates

**Current Implementation Status:**
- ✅ Native addon built and working (libpowermon v1.16)
- ✅ TypeScript wrapper with full type definitions
- ✅ Static methods operational (version, URL parsing, status strings)
- ✅ Subprocess bridge available as fallback
- ⏳ Instance methods require Bluetooth for testing

---

## Step 12: In-App Notification System (Completed)

### Implementation Date
November 29, 2025

### What Was Built

**In-App Notification System** - Real-time alerts displayed via bell icon in dashboard header:

| Component | Description |
|-----------|-------------|
| Notification UI | Bell icon with badge count, dropdown panel with alert list |
| Alert Types | Offline (critical), SoC (warning), Temperature (warning) |
| Alert Actions | Mark as read (acknowledge), Dismiss (resolve), Mark all as read |
| API Integration | Real-time polling every 10s with cache invalidation |

### Alert Priority Order

Alerts are displayed by priority (most important first):
1. **Offline** - Device unreachable (critical severity)
2. **SoC** - State of Charge below threshold (warning severity)
3. **Temperature** - Device temperature above threshold (warning severity)

### Backend Implementation

**Alert API Endpoints** (`server/api/fleet-routes.ts`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/alerts` | GET | List active alerts for organization |
| `/api/v1/alerts/:id/acknowledge` | POST | Mark alert as acknowledged (requires userId) |
| `/api/v1/alerts/:id/resolve` | POST | Resolve/dismiss alert |

**Storage Methods** (`server/db-storage.ts`):
- `listAlerts(organizationId)` - Get all active alerts
- `acknowledgeAlert(alertId, userId)` - Record who acknowledged and when
- `resolveAlert(alertId)` - Mark alert as resolved with timestamp

### Frontend Implementation

**Notification Component** (`client/src/components/Notifications.tsx`):
- Bell icon with unread count badge (gray when no notifications, green when unread)
- Dropdown panel with notification list
- Each notification shows: severity icon, message, truck name, timestamp
- Action buttons: Mark as read, Dismiss
- "Mark all as read" button in header

**API Hooks** (`client/src/lib/api.ts`):
- `useLegacyNotifications()` - Polls alerts every 10s
- `useAcknowledgeAlert()` - Mutation to acknowledge alert
- `useResolveAlert()` - Mutation to resolve/dismiss alert

**Dashboard Integration** (`client/src/pages/Dashboard.tsx`):
- Notifications passed session user ID for acknowledgement
- Optimistic UI update with local state
- Cache invalidation after mutations

### Notification Display Mapping

| Alert Type | Icon | Color | Example Message |
|------------|------|-------|-----------------|
| Offline | AlertTriangle | Red | "Device PWM-1003 offline for 2+ hours" |
| SoC | Battery | Orange | "Battery at 22% on FLT-003" |
| Temperature | ThermometerSun | Yellow | "High temperature: 58°C on FLT-005" |

### Key Files

| File | Purpose |
|------|---------|
| `client/src/components/Notifications.tsx` | Notification UI with bell icon and dropdown |
| `client/src/lib/api.ts` | Alert hooks (fetch, acknowledge, resolve) |
| `client/src/pages/Dashboard.tsx` | Dashboard integration with mutation calls |
| `server/api/fleet-routes.ts` | Alert API endpoints |
| `server/db-storage.ts` | Alert storage methods |

### Testing

Sample alerts created for testing:
- "Device PWM-1003 offline for 2+ hours" (Offline - Critical)
- "Battery at 22% on FLT-003" (Low SoC - Warning)
- "High temperature: 58°C on FLT-005" (Temperature - Warning)

### Simulator Alert Generation

The Device Manager simulator (`server/services/device-simulator.ts`) automatically generates alerts based on simulated conditions:

| Alert Type | Trigger Condition | Severity | Probability |
|------------|-------------------|----------|-------------|
| `offline` | Device goes offline | Critical | 8% per cycle |
| `low_voltage` | Voltage < 11.5V | Critical | Based on SoC |
| `low_soc` | SoC < 20% | Warning | 10% rapid discharge |
| `high_temp` | Temperature > 50°C | Warning | 8% spike chance |
| `low_temp` | Temperature < 5°C | Warning | 8% spike chance |

**Thresholds** (`ALERT_THRESHOLDS` constant):
- `LOW_VOLTAGE`: 11.5V
- `LOW_SOC`: 20%
- `HIGH_TEMP`: 50°C
- `LOW_TEMP`: 5°C
- `OFFLINE_CHANCE`: 8% per poll cycle
- `RECOVERY_CHANCE`: 40% per poll cycle

Alerts are automatically resolved when conditions return to normal (e.g., device comes back online, temperature drops below threshold).

### Bug Fixes Applied

1. **Login React Hooks Error**: Fixed by moving `setLocation` redirect into `useEffect` hook
2. **API Hook Imports**: Added `useMutation` import for alert acknowledge/resolve hooks

---

## Step 14: CSV Export Feature

### Implementation Date
November 30, 2025

### What Was Built

**CSV Export Functionality** - Allows users to export fleet and truck data to CSV files:

| Feature | Description |
|---------|-------------|
| Export All Trucks | Downloads a summary of all trucks with current status, battery, location |
| Export Truck History | Downloads detailed measurement history for a single truck with date range selection |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/export/trucks` | GET | Export all trucks summary to CSV |
| `/api/v1/export/trucks/:id` | GET | Export single truck history (params: startTime, endTime) |

### CSV Data Fields

**All Trucks Export:**
- Truck Number, Fleet, Status, Voltage 1/2, Current, SOC, Power, Temperature, Latitude, Longitude, Last Updated

**Single Truck History:**
- Timestamp, Truck Number, Fleet, Voltage 1/2, Current, SOC, Power, Temperature, Energy, Charge, Runtime

### Frontend Components

| Location | Feature |
|----------|---------|
| Dashboard.tsx | "Export CSV" button in Fleet Overview section |
| TruckDetail.tsx | "Export" button with date range picker popover |

### Key Files

| File | Changes |
|------|---------|
| `server/api/fleet-routes.ts` | Added export endpoints with CSV generation |
| `client/src/pages/Dashboard.tsx` | Added export all trucks button |
| `client/src/components/TruckDetail.tsx` | Added export history with date range picker |

### Features

- Proper CSV escaping for special characters (commas, quotes, newlines)
- Date range validation (start must be before end)
- File naming with dates for easy identification
- Loading states and toast notifications for user feedback
- Up to 10,000 measurement records per export

### Status

- ✅ Backend export endpoints
- ✅ Frontend export buttons with date picker
- ✅ Date range validation
- ✅ Proper CSV formatting

---

## Step 13: SIMPro Integration (In Progress)

### Implementation Date
November 29, 2025

### What Was Built

**SIMPro API Integration** - Connects to Wireless Logic's SIMPro platform for SIM management and truck location tracking:

| Component | Description |
|-----------|-------------|
| Database Schema | `sims`, `sim_location_history`, `sim_usage_history`, `sim_sync_settings` tables |
| SIMPro Client | TypeScript API client with authentication and key endpoints |
| Sync Service | Fetches SIMs, matches to devices by name, updates truck locations |
| Admin API | Endpoints for SIM sync, location sync, usage sync, and status check |

### Data Model

**SIM ↔ Device Linking:**
```
SIMPro Router (SIM)              PowerMon Device
      ↓                                ↓
custom_field1 = "DCL-Moeck"     device_name = "DCL-Moeck"
      ↓                                ↓
   Location                    Voltage/Current/SOC
      ↓                                ↓
         → Unified Truck View ←
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `sims` | SIM cards with ICCID, MSISDN, status, location, linked device/truck |
| `sim_location_history` | Historical location data for tracking movement |
| `sim_usage_history` | Data consumption records for alerting |
| `sim_sync_settings` | Per-organization sync intervals and thresholds |

### SIMPro API Client

**Key Endpoints Used:**
- `GET /api/v3/sims` - List all SIMs
- `GET /api/v3/sim/{msisdn}/details` - Detailed SIM info including custom fields
- `GET /api/v3/sim/{msisdn}/location` - SIM location via cell tower triangulation
- `GET /api/v3/sim/{msisdn}/usage` - Current data usage

**Authentication:**
```typescript
headers: {
  'x-api-client': process.env.SIMPRO_API_CLIENT,
  'x-api-key': process.env.SIMPRO_API_KEY
}
```

### Admin API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/admin/simpro/status` | GET | Check SIMPro connection status |
| `/api/v1/admin/organizations/:orgId/sims` | GET | List SIMs for organization |
| `/api/v1/admin/organizations/:orgId/sims/sync` | POST | Sync SIMs from SIMPro |
| `/api/v1/admin/organizations/:orgId/sims/sync-locations` | POST | Update truck locations from SIM |
| `/api/v1/admin/organizations/:orgId/sims/sync-usage` | POST | Sync data usage and generate alerts |
| `/api/v1/admin/sims/:simId/location-history` | GET | Get location history for a SIM |

### Key Files

| File | Purpose |
|------|---------|
| `shared/schema.ts` | SIM database tables and types |
| `server/services/simpro-client.ts` | SIMPro API client |
| `server/services/sim-sync-service.ts` | Sync service for SIMs, locations, usage |
| `server/api/admin-routes.ts` | Admin API endpoints for SIM management |

### Configuration Required

**Environment Variables:**
- `SIMPRO_API_CLIENT` - API client ID from SIMPro
- `SIMPRO_API_KEY` - API key from SIMPro

### Data Flow

1. **Initial Sync:** Fetch all SIMs from SIMPro, match to PowerMon devices by name (custom_field1)
2. **Location Polling:** Every 5 minutes, get location for each SIM and update truck position
3. **Usage Tracking:** Hourly usage sync, generate alerts if data threshold exceeded

### Status

- ✅ Database schema created and pushed
- ✅ SIMPro API client with full TypeScript types
- ✅ Sync service for SIMs, locations, and usage
- ✅ Admin API endpoints
- ⏳ Awaiting SIMPro API credentials to test

---

## 2026-02-12: InHand Networks GPS Integration - Authentication Fixed & SIM Sync

### What Was Done

**InHand API Authentication Fixed:**
- Corrected auth endpoint from `/oauth/token` to `POST /oauth2/access_token` (per official API docs)
- Added MD5 password hashing (password_type=2, the InHand default)
- Added required fixed client credentials: `client_id=000017953450251798098136`, `client_secret=08E9EC6793345759456CB8BAE52615F3`
- Updated base URL default to `https://iot.inhandnetworks.com`
- Authentication now working — successfully fetching 43 devices from InHand API

**Device Matching Strategy Updated:**
- Discovered `mobileNumber` field on InHand devices (available at verbose=100)
- Every InHand router has `mobileNumber` = MSISDN of the SIM card inserted
- Updated poller to use `mobileNumber` as primary matching identifier (matches `sims.msisdn`)
- Fallback matching via `info.iccid` and `info.imsi` (only populated when SIM is active)
- Changed API request from verbose=50 to verbose=100 to get `mobileNumber` field

**SIM Inventory Sync:**
- Fetched all 46 SIMs from SIMPro API — confirmed every InHand router's MSISDN matches a SIMPro SIM
- Production database only had 2 SIMs — created migration script to upsert all 46
- Migration script: `scripts/migrations/2026-02-12_sync_simpro_sims.sh`

### Current Status (4 InHand routers online with GPS)

| InHand Device | MSISDN | ICCID | Location | Online |
|---|---|---|---|---|
| IR302_21 | 883190603657503 | 89444611503507318085 | 33.70, -116.25 | YES |
| IR302_32 | 883190603659432 | 89444611503507317871 | 33.84, -118.26 | ONLINE |
| IR302_40 | 883190603571828 | 89444611503504517861 | 42.23, -83.63 | ONLINE |
| IR302_44 | 883190603571827 | 89444611503504517903 | 33.95, -118.18 | ONLINE |

### Next Steps

1. Run `scripts/migrations/2026-02-12_sync_simpro_sims.sh` on MacBook to sync all 46 SIMs
2. Push updated code (inhand-client.js, inhand-poller.js) via GitHub → ECS deploy
3. Link SIMs to trucks (need to determine which router is on which truck)
4. Verify GPS locations updating on truck records

### Key Files Modified

| File | Change |
|------|--------|
| `device-manager/app/inhand-client.js` | Fixed auth endpoint, MD5 hashing, client credentials, verbose=100 |
| `device-manager/app/inhand-poller.js` | Use `mobileNumber` field, updated matching strategy |
| `device-manager/app/config.js` | Default base URL to `iot.inhandnetworks.com` |
| `scripts/migrations/2026-02-12_sync_simpro_sims.sh` | Sync all 46 SIMPro SIMs to production DB |

---

---

## February 12, 2026 - Reverse Geocoding for Truck Locations

### Summary
Added reverse geocoding to convert raw GPS coordinates (e.g., "33.9500° N, 118.1800° W") into human-readable location descriptions (e.g., "South Gate, CA"). Uses OpenStreetMap's free Nominatim API.

### What Changed

**Schema**: Added `location_description` column to `trucks` table.

**Backend** (`server/services/geocoding.ts`):
- Reverse geocoding service with in-memory cache (24h TTL, 500 entries)
- Built-in rate limiting (1 request/sec to respect Nominatim terms)
- US state abbreviation mapping (California → CA)
- Coordinate change detection (1km threshold) to avoid redundant API calls

**Fleet API** (`server/api/fleet-routes.ts`):
- `PATCH /trucks/:id/location` now geocodes and stores location description
- `POST /trucks/geocode` bulk endpoint to geocode all trucks missing descriptions
- Only re-geocodes when truck has moved >1km from last known position

**Device Manager** (`device-manager/app/inhand-poller.js`):
- InHand GPS poller now geocodes when updating truck coordinates
- Checks if coordinates have actually changed before making API call
- Rate-limited and cached to prevent Nominatim abuse

**Frontend** (`client/src/lib/api.ts`):
- `formatLocation()` now prefers `locationDescription` from DB over raw coordinates
- FleetMap tooltip and FleetTable automatically display city names

### Production Migration

Run `scripts/migrations/2026-02-12_add_location_description.sh` to add the column to production.

After deploying the updated InHand poller, truck locations will automatically get geocoded on next GPS update. Use the `POST /trucks/geocode` endpoint to backfill existing trucks.

### Key Files Modified

| File | Change |
|------|--------|
| `shared/schema.ts` | Added `locationDescription` to trucks table |
| `server/services/geocoding.ts` | New reverse geocoding service with cache & rate limiting |
| `server/storage.ts` | Updated `updateTruckLocation` interface |
| `server/db-storage.ts` | Updated `updateTruckLocation` implementation |
| `server/api/fleet-routes.ts` | Geocode on location update + bulk geocode endpoint |
| `device-manager/app/inhand-poller.js` | Geocode on GPS update with change detection |
| `client/src/lib/api.ts` | Display location descriptions |
| `scripts/migrations/2026-02-12_add_location_description.sh` | Production migration |

---

---

## May 4, 2026 — Device Manager Redeployment Complete

### Summary
Completed the full Device Manager recovery after 5 days of polling downtime (EC2 rebuilt Apr 29 but deploy never ran). All fixes are now live and the service is running with 13 workers polling.

### What Was Done

1. **Fixed deployment workflow** (`deploy-device-manager.yml`): Added `libpowermon_bin/` directory to the deploy zip so the native PowerMon SDK ships with the package.

2. **Fixed PowerMon C++ wrapper** (`powermon_wrapper.cpp`): Updated to match the new Thornwave SDK — `info.address` instead of `info.mac`, 3-argument `decode()` signature, `vector<uint8_t>` types.

3. **Fixed `lastConnectedAt` crash** (`connection-pool.js` line 1547): `lastConnectedAt` is stored as a number from `Date.now()`, not a Date object, so calling `.getTime()` on it was crashing. Removed the `.getTime()` call. This was causing 4 devices to fail their probe cycles.

4. **Resolved Git merge conflicts**: The deploy workflow file had conflicts between Replit and GitHub (pushed via API). Resolved via Shell commands after the Git pane hit INVALID_STATE errors.

### Current State
- Device Manager: **active (running)** on EC2 `i-0a435441556fc5ab1` (us-east-2)
- 13 workers polling devices
- All changes pushed to GitHub and deployed via GitHub Actions
- Replit and GitHub repos are fully in sync

### Key Files Modified

| File | Change |
|------|--------|
| `.github/workflows/deploy-device-manager.yml` | Include `libpowermon_bin/` in deploy zip |
| `device-manager/src/powermon_wrapper.cpp` | SDK API updates (address, decode signature) |
| `device-manager/app/connection-pool.js` | Fix `lastConnectedAt.getTime()` crash |

---

## Team Notes

### InHand Signal Strength — Object-Form Extraction Fix (May 14, 2026)

**Symptom**: After Task #21 deployed, ~10 of 19 PowerMon rows showed "—" in the new Router Sig column.

**Diagnosis** (via SSM into EC2 + direct InHand API dumps):
1. Confirmed all 19 SIMs were correctly linked to devices (`min_old=2` on every row → poller IS reaching them).
2. Dumped raw InHand JSON for one of the missing-signal devices (DCL-Thibert / msisdn 883190603571831 → IR302_38). Result: `online: 0` with **no `signalStrength`, no `info`, no `location`** at all. InHand simply doesn't return signal data for offline routers.
3. Dumped JSON for an online device (IR302_3): `signalStrength` is now an **object** `{radio, level, asu:28, rssi:-81, rsrp, rsrq, sinr, band, ts}` instead of the flat scalar older firmware returned.

**Bug**: `_extractRssi` in `device-manager/app/inhand-poller.js` did `parseFloat(device.signalStrength)` against the object → NaN, then fell through to the CSQ fallback. Online devices got an approximation (`-113 + 2*info.rssi`) instead of the real dBm. Worse, the writer at line 284 always wrote `device.rssi` (null included), so devices without an extractable signal had their previously-good values overwritten with NULL on every poll.

**Fix**: Updated `_extractRssi` to handle both shapes — if `signalStrength` is an object, prefer `.rssi` (already-dBm); otherwise accept the scalar. Also added `.asu` fallback within the nested object. Deployed via GitHub Actions (path-filtered `device-manager/**` workflow).

**Result after deploy**:
- 9 online routers now show accurate RSSI (-75 to -91 dBm) sourced from `signalStrength.rssi` instead of CSQ approximation.
- 10 offline routers correctly show "—" (InHand returns no signal payload for them; not a bug).

**Files changed**: `device-manager/app/inhand-poller.js` (L370-405).

---

### Thornwave SDK Updated to v1.20 (May 4, 2026)
- Razvan (Thornwave Labs) identified and fixed a Linux socket reuse bug causing instant disconnects.
- Pulled **Git tag v1.20** from `git.thornwave.com` and updated wrapper files:
  - `connectWifi` → `connectIp` (in `powermon_wrapper.cpp` and `powermon_bridge.cpp`)
  - `WifiAccessKey` → `RemoteAccessKey` (in `powermon_wrapper.h`)
  - Updated `libpowermon_bin/` headers and static libraries
- Pushed and deployed via GitHub Actions.

