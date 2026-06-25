---
name: InHand location is cell-tower, not GPS
description: Why InHand router positions "teleport" and what fresher cell data is available but discarded
---

The InHand router location we store is **cell-tower geolocation, not GPS**. Confirmed from the live API (`GET /api/devices?verbose=100`): `device.location.source === "cellTower"` on every device that reports a location; **0 of 48 devices ever report `source:"gps"`**. The lat/lng is the geolocated position of the serving cell tower, so it "teleports" — it only changes when the truck hands off to a different tower AND InHand re-geolocates. `location.time` is typically days stale (fleet median ~109h).

**Why:** users (Andy) noticed positions jump between two points with no route in between; this is the root cause, not a poller bug or router GPS failure.

**Misnomer to remember:** the poller hardcodes `source='router_gps'` when inserting into `sim_location_history`. That label is wrong — these are cell-tower fixes. `getTruckMovementMiles` sums these coarse hops (so its mileage is straight-line-ish between tower changes, not a real path).

**Fresher cell data we currently fetch but discard** (in the same bulk response, per device):
- `signalStrength { radio, level, asu, rssi, rsrp, rsrq, sinr, band, pci, cid, ts }` — `ts` median age ~0.4h, far fresher than location.
- `info { cid, lac, mnc, mcc, rssi, imsi, iccid, imei }` — serving cell identity.
The serving **cell ID (`cid`/`lac`) changes on every tower handoff**, so logging it each poll is a much more granular "truck moved" signal than the geolocated lat/lng — even without coordinates.

**How to apply:** when asked for more real-time location/movement: (A) capture `cid/lac/mcc/mnc` + `signalStrength.*` each 2-min poll, detect movement from handoffs, optionally resolve `cid→lat/lng` via a cell-location DB (OpenCelliD/paid geolocation); (B) for a true continuous route, GNSS must be enabled/connected on the IR300/IR302 routers (hardware/config) so `source` becomes `gps`. Don't describe the current feed as "GPS."
