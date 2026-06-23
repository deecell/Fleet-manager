---
name: SIM link swap recovery
description: How to repair two SIMs that got cross-linked to each other's PowerMon device (Wireless Logic Custom Field 1 backwards)
---

# SIM link swap recovery

When two SIMs end up linked to each other's PowerMon device (typically because
Wireless Logic **Custom Field 1** was set backwards), neither automatic path
repairs it:

- The periodic SIMPro sync **never re-links from Custom Field 1** (its UPDATE
  branch preserves the row's current `device_id`/`truck_id`), so it won't undo a
  swap.
- The per-device **"Refresh SIM from Wireless Logic"** button refuses to steal a
  SIM that's currently linked to a *different* device — it returns
  `409 SIM_ALREADY_LINKED` (the "no silent steal" guard in
  `server/api/admin-routes.ts`). In a swap each correct SIM is held by the other
  device, so **both refreshes deadlock**.
- There is **no SIM-detach UI** — assign/unassign act on the device's truck, not
  on the SIM↔device link.

## Recovery procedure (detach, then Refresh)
1. Correct Custom Field 1 in Wireless Logic first (it's the source of truth).
2. Run a tiny SQL detach: NULL `device_id`/`truck_id` (and clear
   `router_rssi`/`router_signal_updated_at`) on the `sims` rows currently linked
   to the two devices. See `scripts/migrations/2026-06-23_detach_moeck_sims.*`
   for the template (SSM send-command → EC2 → psql).
3. In `/admin/devices`, click "Refresh SIM from Wireless Logic" on each device.
   With the rows unlinked the 409 guard passes and each device re-links from its
   now-correct Custom Field 1 via `getSimByDeviceName()`.

**Why this over a hand-rolled relative-swap SQL:** the corrected mapping lives in
Wireless Logic, not the DB. A relative swap is a run-once footgun (re-running
swaps back) and assumes the exact cross-linked state. Detach-then-Refresh is
idempotent, self-validating (Refresh errors if WL is still wrong), and reuses the
authoritative tested link path. Detached rows are safe from the sync re-linking
them before you click Refresh.
