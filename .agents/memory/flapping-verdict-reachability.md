---
name: Flapping verdict reachability
description: The flapping-diagnostic verdict misclassifies firmware-wedged devices as router/cellular outages.
---

# Flapping verdict must trust a live PowerMon connect over stale GPS/signal age

The FLAPPING DIAGNOSTIC verdict keys off `gpsLastUpdate` / router-signal
timestamps to decide between "PowerMon-side flap" and "Router/cellular outage —
truck unreachable". That is wrong when the device just connected: if the
device-manager completed a PowerMon **TCP connect** (even one that instant-drops),
the truck's router/cellular path is provably up, regardless of how stale the GPS
or router-signal data is.

**Observed:** in the same 00:00 UTC firmware mass-close, devices with fresh GPS
got the correct "PowerMon-side flap" verdict, while siblings with stale GPS
(months old) got "Router/cellular outage — truck unreachable" — even though their
TCP connect had just succeeded. Same root event, contradictory verdicts.

**Why it matters:** a "router outage" verdict likely drives longer/deprioritized
probe backoff, so misclassified devices stay wedged far longer than correctly
classified ones.

**How to apply:** treat a successful PowerMon connect within the flap window as
proof of reachability and force the "PowerMon-side flap" branch; only fall back to
"router/cellular outage" when the connect itself is failing (TCP refused/timeout).
