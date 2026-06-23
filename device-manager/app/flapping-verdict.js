/**
 * FLAPPING DIAGNOSTIC verdict matrix (Task #25).
 *
 * Single source of truth for the three-bucket flapping verdict so every surface
 * — the structured FLAPPING DIAGNOSTIC log, the single-process recovery CLI, and
 * the supervisor-mode solo-probe CLI — prints identical wording.
 *
 * Inputs are minutes-since values (null = unknown), produced from
 * db.getDeviceLivenessSnapshot. The truthiness of each input maps to the
 * three-bucket verdict below.
 *
 *   | Router signal fresh (<10 min)? | PowerMon reported recently (<6 h)? | Verdict                    |
 *   | Yes                            | Yes                                 | PowerMon-side flap         |
 *   | Yes                            | No                                  | PowerMon offline — verify  |
 *   | No                             | (any)                               | Router/cellular outage     |
 *
 * Router signal freshness is now trustworthy (Task #24 gated those writes on
 * InHand's online flag), so "router fresh" honestly means "the router was online
 * within the last 10 min." When router is fresh but PowerMon has been silent for
 * >6 h, the device is either powered off or firmware-wedged — the operator needs
 * to physically verify (the DCL-Epler / DCL-Moeck-Shop case the previous verdict
 * misclassified as "PowerMon-side firmware issue").
 */
const FLAPPING_ROUTER_FRESH_THRESHOLD_MINUTES = 10;
const FLAPPING_POWERMON_RECENT_THRESHOLD_MINUTES = 6 * 60;

function classifyFlappingVerdict(routerSignalMinutesAgo, lastReportedMinutesAgo) {
  const routerFresh = routerSignalMinutesAgo != null
    && routerSignalMinutesAgo < FLAPPING_ROUTER_FRESH_THRESHOLD_MINUTES;
  const powerMonRecent = lastReportedMinutesAgo != null
    && lastReportedMinutesAgo < FLAPPING_POWERMON_RECENT_THRESHOLD_MINUTES;
  if (!routerFresh) return 'Router/cellular outage — truck unreachable';
  if (powerMonRecent) return 'PowerMon-side flap — actively connecting + failing (likely firmware/RF/USB)';
  return 'PowerMon offline — verify physically (powered off OR firmware-wedged)';
}

// Convert a timestamp (Date|string|null) to whole minutes elapsed, using
// Math.floor so the strict-less-than threshold boundaries in
// classifyFlappingVerdict behave consistently. Returns null for missing input.
function minutesAgo(timestamp) {
  if (!timestamp) return null;
  return Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
}

module.exports = {
  classifyFlappingVerdict,
  minutesAgo,
  FLAPPING_ROUTER_FRESH_THRESHOLD_MINUTES,
  FLAPPING_POWERMON_RECENT_THRESHOLD_MINUTES,
};
