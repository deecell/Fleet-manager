---
name: Midnight UTC fleet disconnect
description: Why many devices go "No data" right at 00:00 UTC — daily PowerMon firmware behavior plus a recovery-machinery interaction.
---

# Midnight UTC fleet disconnect ("No data" cluster)

At exactly 00:00 UTC every connected PowerMon-W device closes its TCP session at
once (disconnect `reason=2`, firmware-initiated) after multi-hour healthy
sessions. This is **device firmware behavior**, not a device-manager bug and not
an infra/restart event (confirmed: service `NRestarts=0`, no systemd timer or
cron touches it; logrotate has no device-manager rule).

**Why a subset gets wedged:** on the immediate reconnect the firmware isn't ready
yet, so the connect succeeds then instant-drops in 0–5ms with
`hadSuccessfulPoll=false`. Three instant drops within ~2s trips the circuit
breaker → device marked `flapping`. Whether a given device trips is timing-
dependent (some hit `Poll failed code=8` / poll-timeout instead and recover on
the next tick). Devices that trip then enter the solo-probe quarantine; recovery
is unreliable, so hours later they still read `online`+`no_data` or `flapping` or
orphaned `probing`.

**Why recovery is unreliable (the real, fixable part):**
- The post-firmware-close reconnect backoff is too short (2s then 1s), so we
  hammer the device before its midnight firmware reset finishes and trip the
  breaker on what is actually a healthy device.
- The flapping verdict misclassifies (see flapping-verdict-reachability.md).
- Orphaned `probing` rows never reset (see orphaned-probing-state.md).
- **isCircuitOpen / DB-status desync dead-zone:** when the breaker opens it sets
  in-memory `isCircuitOpen=true` AND marks the row `flapping`, but a *racing
  connect-success DB write* can flip `connection_status` back to `online`
  (clobbering the flapping mark) without clearing `isCircuitOpen`. Result: DB
  says `online` so the supervisor solo-probe (only adopts `flapping`) ignores it,
  while the worker re-arm does `if (conn.isCircuitOpen) continue;` and skips it
  too. The device sits `online`+`no_data` forever with NO log lines after the
  breaker-open instant — a true dead-zone. A DB nudge back to `flapping` does NOT
  fix it: the poisoned connection object is still in the worker's in-memory
  `connections` map, so `checkForNewDevicesInCohort` skips re-adoption
  (`if (this.connections.has(deviceId)) continue;`). **Only bouncing that cohort
  worker** (SIGTERM the child; supervisor auto-respawns) clears the in-memory
  circuit and rebuilds the connection. Surgical recovery script:
  `scripts/migrations/2026-06-25_unstick_*.sh` (kills only the owning cohort
  workers, looked up live by `WORKER_COHORT_ID`).

**Where to read the logs:** unit is `StandardOutput=journal` but journald is
rate-limited to ~0 lines under poll volume — the real logs are in
`/var/log/syslog` (rsyslog), ISO timestamps, ANSI-coded. DM host is
`i-0a435441556fc5ab1` (us-east-2), which is NOT the psql box in older migration
scripts.

**How to apply:** if devices report "No data" clustered at 00:00 UTC, this is the
cause. Don't chase restarts/timers. Lengthen the reason=2 reconnect backoff
and/or don't count firmware-close-induced instant disconnects toward the flapping
threshold so the firmware has time to come back before we declare it flapping.
