---
name: Orphaned probing rows
description: connection_status='probing' can strand a device forever because the state lives only in memory.
---

# Orphaned 'probing' state strands devices permanently

When a solo probe launches, `connection_status` is set to `'probing'` in the DB,
but the probe process is tracked only in the supervisor's in-memory
`probeWorkers` map. If the supervisor restarts mid-probe, or a probe worker dies
without its exit handler firing (e.g. SIGKILL), the in-memory record is lost while
the DB row stays `'probing'`.

Nothing reclaims it:
- the startup recovery sweep resets only `'unstable'` (deliberately skips
  `'flapping'`, and never considers `'probing'`);
- the recovery probe loop queries only `'flapping'` devices.

So an orphaned `'probing'` row is never reset and never re-probed — the device is
frozen out of normal polling indefinitely (observed: devices stuck for weeks to
months).

**How to apply:** include `'probing'` in the startup recovery reset (at boot no
probe is running, so any `probing` row is by definition orphaned), AND add a
periodic supervisor reconciliation that resets any `'probing'` device with no live
`probeWorkers` entry back to `'flapping'` so it re-enters the quarantine/probe
cycle. The latter is required because orphaning can happen mid-run, not only at
startup. An immediate prod unstick is a one-off UPDATE of the stranded rows.
