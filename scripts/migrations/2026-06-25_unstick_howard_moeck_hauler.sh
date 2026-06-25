#!/bin/bash
#
# Production Recovery: Surgically un-stick DCL-Howard + DCL-Moeck-Hauler
# Created: 2026-06-25
#
# WHY (root cause, confirmed from /var/log/syslog on the DM host):
#   At 00:02:08 UTC during the midnight firmware mass-close reconnect storm,
#   BOTH devices tripped the circuit breaker:
#     "Circuit breaker OPEN - flapping (>=3 instant disconnects)"
#     "Marking device as flapping in database"
#   So in-memory the connection got `isCircuitOpen = true`. But a racing
#   connect-success DB write then flipped power_mon_devices.connection_status
#   back to 'online' (clobbering the just-written 'flapping' mark) WITHOUT
#   clearing the in-memory isCircuitOpen flag. Result = a dead-zone:
#     - DB says   : connection_status='online'  (looks healthy)
#     - Memory says: isCircuitOpen=true          (hands off, don't poll)
#   Neither recovery path can reach them:
#     - worker re-arm  : `if (conn.isCircuitOpen) continue;`  -> skips them
#     - supervisor probe: only probes DB connection_status='flapping' -> skips them
#   So they sat at "online / no_data" for 12h with battery data frozen, while
#   their GPS routers kept reporting fine.
#
# WHY A DB NUDGE WON'T WORK:
#   Setting connection_status='flapping' would let the supervisor solo-probe
#   prove reachability, but on success the worker's checkForNewDevicesInCohort
#   SKIPS re-adoption because the poisoned connection object is still in the
#   worker's in-memory `connections` map (the breaker never evicted it). Only
#   discarding that in-memory object recovers polling.
#
# WHAT THIS DOES (surgical, does NOT restart the Device Manager service):
#   Sends SIGTERM to ONLY the two cohort-worker child processes that own these
#   devices  -- cohort 2 (Moeck-Hauler) and cohort 3 (Howard). The supervisor's
#   own exit handler auto-respawns each worker within a few seconds; on respawn
#   they reload their cohort fresh from the DB (status 'online' qualifies),
#   build BRAND-NEW connection objects (isCircuitOpen=false) and resume polling.
#
# BLAST RADIUS:
#   Only the devices in cohorts 2 and 3 get a brief (~few second) reconnect.
#   The supervisor, the other 8 cohort workers, the InHand GPS poller and the
#   web app are all untouched. Worker PIDs are looked up live by their
#   WORKER_COHORT_ID env var, so this stays correct even after a respawn.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-06-25_unstick_howard_moeck_hauler.sh
#
# Requires: aws cli configured for the deecell prod account (no ssm plugin needed).

set -euo pipefail

REGION="us-east-2"
DM_INSTANCE_ID="i-0a435441556fc5ab1"          # host running device-manager.service
SECRET_ID="deecell-fleet-production/database-url"
TARGET_COHORTS="2 3"                            # cohort 2 = Moeck-Hauler, cohort 3 = Howard
DEVICES="DCL-Howard DCL-Moeck-Hauler"

# --- helper: run a shell snippet on the DM host via SSM, print its output ----
run_ssm() {
  local comment="$1" script="$2"
  local params cid status
  params=$(SCRIPT="$script" python3 - <<'PY'
import json, os
print(json.dumps({"commands": [os.environ["SCRIPT"]]}))
PY
)
  cid=$(aws ssm send-command \
    --instance-ids "$DM_INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --comment "$comment" \
    --parameters "$params" \
    --query 'Command.CommandId' --output text --region "$REGION")
  for _ in $(seq 1 40); do
    status=$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$DM_INSTANCE_ID" \
      --region "$REGION" --query 'Status' --output text 2>/dev/null || echo Pending)
    case "$status" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 2 ;; esac
  done
  echo "[ssm: $status]"
  aws ssm get-command-invocation --command-id "$cid" --instance-id "$DM_INSTANCE_ID" \
    --region "$REGION" --query 'StandardOutputContent' --output text
  local err
  err=$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$DM_INSTANCE_ID" \
    --region "$REGION" --query 'StandardErrorContent' --output text)
  [ -n "$err" ] && { echo "--- stderr ---"; echo "$err"; }
}

# --- remote snippet: list current cohort workers + the two devices' freshness -
PREVIEW_SNIPPET=$(cat <<REMOTE
SUP=\$(systemctl show -p MainPID --value device-manager.service)
echo "Supervisor MainPID: \$SUP"
echo "Current cohort workers (pid -> cohort):"
for p in \$(pgrep -P "\$SUP"); do
  cid=\$(tr '\0' '\n' < /proc/\$p/environ 2>/dev/null | sed -n 's/^WORKER_COHORT_ID=//p')
  solo=\$(tr '\0' '\n' < /proc/\$p/environ 2>/dev/null | sed -n 's/^WORKER_SOLO_SERIAL=//p')
  [ -n "\$solo" ] && continue
  mark=""
  for t in $TARGET_COHORTS; do [ "\$cid" = "\$t" ] && mark="  <== TARGET"; done
  echo "  pid=\$p cohort=\${cid:-?}\$mark"
done
echo ""
echo "Device freshness (minutes since last battery poll):"
export DATABASE_URL=\$(aws secretsmanager get-secret-value --secret-id $SECRET_ID --query SecretString --output text --region $REGION)
PSQL=\$(command -v psql || ls /usr/bin/psql /usr/lib/postgresql/*/bin/psql 2>/dev/null | head -1)
"\$PSQL" "\$DATABASE_URL" -c "SELECT device_name, connection_status, data_status, ROUND(EXTRACT(EPOCH FROM (NOW()-last_seen_at))/60) AS mins_ago FROM power_mon_devices WHERE device_name IN ('DCL-Howard','DCL-Moeck-Hauler') ORDER BY device_name;"
REMOTE
)

# --- remote snippet: SIGTERM the target cohort workers --------------------------
KILL_SNIPPET=$(cat <<REMOTE
SUP=\$(systemctl show -p MainPID --value device-manager.service)
echo "Supervisor MainPID: \$SUP (left running)"
killed=0
for p in \$(pgrep -P "\$SUP"); do
  cid=\$(tr '\0' '\n' < /proc/\$p/environ 2>/dev/null | sed -n 's/^WORKER_COHORT_ID=//p')
  solo=\$(tr '\0' '\n' < /proc/\$p/environ 2>/dev/null | sed -n 's/^WORKER_SOLO_SERIAL=//p')
  [ -n "\$solo" ] && continue
  for t in $TARGET_COHORTS; do
    if [ "\$cid" = "\$t" ]; then
      echo "SIGTERM worker pid=\$p (cohort \$cid)"
      kill -TERM "\$p" && killed=\$((killed+1))
    fi
  done
done
echo "Sent SIGTERM to \$killed worker(s). Waiting 12s for supervisor respawn..."
sleep 12
echo "Cohort workers after respawn (pid -> cohort):"
for p in \$(pgrep -P "\$SUP"); do
  cid=\$(tr '\0' '\n' < /proc/\$p/environ 2>/dev/null | sed -n 's/^WORKER_COHORT_ID=//p')
  solo=\$(tr '\0' '\n' < /proc/\$p/environ 2>/dev/null | sed -n 's/^WORKER_SOLO_SERIAL=//p')
  [ -n "\$solo" ] && continue
  echo "  pid=\$p cohort=\${cid:-?}"
done
REMOTE
)

# --- remote snippet: re-check device freshness ---------------------------------
VERIFY_SNIPPET=$(cat <<REMOTE
export DATABASE_URL=\$(aws secretsmanager get-secret-value --secret-id $SECRET_ID --query SecretString --output text --region $REGION)
PSQL=\$(command -v psql || ls /usr/bin/psql /usr/lib/postgresql/*/bin/psql 2>/dev/null | head -1)
"\$PSQL" "\$DATABASE_URL" -c "SELECT device_name, connection_status, data_status, ROUND(EXTRACT(EPOCH FROM (NOW()-last_seen_at))/60) AS mins_ago FROM power_mon_devices WHERE device_name IN ('DCL-Howard','DCL-Moeck-Hauler') ORDER BY device_name;"
REMOTE
)

echo "=== Deecell Production Recovery: un-stick DCL-Howard + DCL-Moeck-Hauler ==="
echo "Target host : $DM_INSTANCE_ID  (device-manager.service)"
echo "Target cohorts: $TARGET_COHORTS   (2=Moeck-Hauler, 3=Howard)"
echo ""
echo "--- BEFORE ------------------------------------------------------------"
run_ssm "preview howard/moeck workers" "$PREVIEW_SNIPPET"
echo "-----------------------------------------------------------------------"
echo ""
read -p "Bounce ONLY the cohort 2 & 3 workers (supervisor stays up)? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelled. Nothing was changed."
  exit 0
fi

echo ""
echo "--- BOUNCING ----------------------------------------------------------"
run_ssm "bounce cohort 2 and 3 workers" "$KILL_SNIPPET"
echo "-----------------------------------------------------------------------"
echo ""
echo "Waiting 45s for the respawned workers to connect and complete a poll..."
sleep 45
echo ""
echo "--- AFTER (expect mins_ago to drop to 0-2 and data_status='reporting') -"
run_ssm "verify howard/moeck freshness" "$VERIFY_SNIPPET"
echo "-----------------------------------------------------------------------"
echo ""
echo "If mins_ago is still large after a minute, re-run this script (safe to"
echo "repeat) or check: ssm syslog grep for 'DCL-Howard' / 'DCL-Moeck-Hauler'."
