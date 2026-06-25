---
name: GPS movement thresholds (parked jitter calibration)
description: Measured parked-truck GPS jitter and the two-tier thresholds any movement/geofence feature on sim_location_history should use.
---

# Parked GPS jitter — measured noise floor

Real-world calibration from the InHand router `router_gps` feed: two trucks (GFR-70, GFR-69) parked side-by-side in the same shop reported **0.17 mi vs 0.00 mi** of position spread over 24h. So a *stationary* truck's GPS can drift up to ~0.2 mi.

**Two-tier thresholds for "did it move / how far" features over `sim_location_history`:**
- **Per-segment floor ~0.03 mi (~50 m):** when summing haversine distance between consecutive ~2-min fixes, drop hops below this so jitter between samples never accumulates into phantom mileage.
- **Total-window floor ~0.2 mi:** below this total, treat the truck as "Parked" (guards against occasional single jitter spikes that exceed the per-segment floor).

**Why total path distance, not straight-line spread:** a round trip has ~0 straight-line spread but real miles driven (MHR-01's pre-SIM-link Norwalk drive was the case that exposed this). Always sum consecutive segments.

**Math gotcha:** `acos` for the haversine NaNs on identical points (argument drifts just past 1.0). Clamp with `LEAST(1, GREATEST(-1, …))`.

**Why:** these are empirical, not derivable from code — they came from observing the live fleet, and any future geofencing / driving-vs-idle / odometer feature should reuse them instead of re-deriving.

**How to apply:** first consumer is `getTruckMovementMiles` in `server/db-storage.ts` (the `/admin/devices` "Moved (24h)" column). Reuse the same floors for consistency across surfaces.
