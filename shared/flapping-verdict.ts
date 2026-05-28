/**
 * Shared flapping-device verdict classifier.
 *
 * Mirrors the runtime logic in device-manager/app/connection-pool.js
 * (classifyFlappingVerdict + getDeviceLivenessSnapshot) so that both
 * the device-manager logs and the dashboard surfaces (admin /admin/devices
 * column, customer FleetTable icon/tooltip) speak the same language.
 *
 * The verdict matrix (router-signal freshness × PowerMon report freshness):
 *
 *   router fresh? | PowerMon recent? | verdict
 *   --------------|------------------|------------------------------------
 *   yes           | yes              | PowerMon-side flap
 *   yes           | no               | PowerMon offline (powered off OR wedged)
 *   no            | any              | Router/cellular outage
 *
 * Inputs are wall-clock timestamps (Date | string | null). Missing values
 * are treated as "stale" — i.e. equivalent to "not fresh / not recent".
 */

export const FLAPPING_ROUTER_FRESH_THRESHOLD_MINUTES = 10;
export const FLAPPING_POWERMON_RECENT_THRESHOLD_MINUTES = 360; // 6 hours

export type FlappingVerdictBucket = "outage" | "powermon_offline" | "powermon_flap";

export interface FlappingVerdict {
  bucket: FlappingVerdictBucket;
  label: string;
  tooltip: string;
}

const VERDICTS: Record<FlappingVerdictBucket, FlappingVerdict> = {
  outage: {
    bucket: "outage",
    label: "Router/cellular outage",
    tooltip:
      "Router signal has gone stale — truck is unreachable (could be power loss, cellular outage, or dead router).",
  },
  powermon_offline: {
    bucket: "powermon_offline",
    label: "PowerMon offline",
    tooltip:
      "Router is online but PowerMon hasn't reported in hours — device is powered off OR firmware-wedged. Verify physically.",
  },
  powermon_flap: {
    bucket: "powermon_flap",
    label: "PowerMon-side flap",
    tooltip:
      "Router and PowerMon are both alive but the PowerMon connection keeps dropping (likely firmware/RF/USB).",
  },
};

function minutesAgo(ts: Date | string | null | undefined, now: number): number | null {
  if (ts == null) return null;
  const t = typeof ts === "string" ? new Date(ts).getTime() : ts.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / 60000);
}

/**
 * Classify a flapping/unstable device into one of three honest verdicts.
 *
 * @param routerSignalUpdatedAt - sims.router_signal_updated_at for the truck's SIM
 * @param powerMonLastReportedAt - power_mon_devices.last_reported_at for the device
 * @param now - optional Date.now() override (for tests)
 * @returns the verdict bucket. Missing/stale router signal collapses to
 *          "Router/cellular outage" — matching the device-manager runtime
 *          (a device whose router signal we've never seen is, for the
 *          operator's purposes, unreachable).
 */
export function classifyFlappingVerdict(
  routerSignalUpdatedAt: Date | string | null | undefined,
  powerMonLastReportedAt: Date | string | null | undefined,
  now: number = Date.now(),
): FlappingVerdict {
  const routerMins = minutesAgo(routerSignalUpdatedAt, now);
  const powerMonMins = minutesAgo(powerMonLastReportedAt, now);

  const routerFresh =
    routerMins != null && routerMins < FLAPPING_ROUTER_FRESH_THRESHOLD_MINUTES;

  if (!routerFresh) return VERDICTS.outage;

  const powerMonRecent =
    powerMonMins != null && powerMonMins < FLAPPING_POWERMON_RECENT_THRESHOLD_MINUTES;

  return powerMonRecent ? VERDICTS.powermon_flap : VERDICTS.powermon_offline;
}
