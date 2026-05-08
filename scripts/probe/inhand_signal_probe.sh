#!/bin/bash
#
# InHand Signal Strength Probe
# Created: 2026-05-08
#
# Standalone diagnostic — proves whether InHand Networks' Device Manager API
# returns cellular signal data for our routers. Mirrors the exact auth flow
# and signal-extraction logic used by the production poller
# (device-manager/app/inhand-client.js + inhand-poller.js::_extractRssi)
# so a successful run here means the production column WILL populate as
# soon as the device-manager picks up the same credentials.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/probe/inhand_signal_probe.sh
#
# It will prompt for the InHand username and password (password is hidden),
# then dump one tab-separated row per device. Pipe through `column -t -s$'\t'`
# for a pretty table:
#   ./scripts/probe/inhand_signal_probe.sh | column -t -s$'\t'
#
# Zero side effects: does not write to disk, does not touch the database,
# does not touch AWS. Pure local probe.
#
# Required tools (all default on macOS): bash, curl, jq, plus standard
# POSIX utilities (awk, sed, head). Password hashing uses any one of
# md5 / md5sum / python3.
#

set -u
set -o pipefail

# ---- Constants lifted from device-manager/app/inhand-client.js ------------
INHAND_CLIENT_ID="000017953450251798098136"
INHAND_CLIENT_SECRET="08E9EC6793345759456CB8BAE52615F3"

# Canonical North America base URL — matches the production migration
# scripts (2026-02-10_add_inhand_gps_poller.sh and
# 2026-05-08_wire_inhand_creds_into_device_manager.sh). The dev default
# in config.js (https://iot.inhandnetworks.com) is intentionally NOT
# offered here as the primary; we already know prod uses NA.
DEFAULT_BASE_URL="https://na.inhandcloud.com"

# ---- Dependency check -----------------------------------------------------
need() {
    command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' not found in PATH" >&2; exit 1; }
}
need curl
need jq

# ---- MD5 helper (macOS uses 'md5 -q -s', Linux uses 'md5sum'; fall back to python3) -------
md5_hex() {
    local s="$1"
    if command -v md5 >/dev/null 2>&1; then
        md5 -q -s "$s"
    elif command -v md5sum >/dev/null 2>&1; then
        printf '%s' "$s" | md5sum | awk '{print $1}'
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c 'import hashlib,sys;print(hashlib.md5(sys.argv[1].encode()).hexdigest())' "$s"
    else
        echo "ERROR: need one of md5, md5sum, or python3 for password hashing" >&2
        exit 1
    fi
}

# ---- Prompts --------------------------------------------------------------
echo "=== InHand Signal Strength Probe ===" >&2
echo "" >&2
printf "InHand username (email): " >&2
read -r USERNAME
if [ -z "${USERNAME}" ]; then echo "ERROR: username is required" >&2; exit 1; fi

printf "InHand password (hidden): " >&2
stty -echo 2>/dev/null || true
read -r PASSWORD
stty echo 2>/dev/null || true
echo "" >&2
if [ -z "${PASSWORD}" ]; then echo "ERROR: password is required" >&2; exit 1; fi

printf "Base URL [%s]: " "${DEFAULT_BASE_URL}" >&2
read -r BASE_URL_INPUT
BASE_URL="${BASE_URL_INPUT:-$DEFAULT_BASE_URL}"
BASE_URL="${BASE_URL%/}"
echo "" >&2

# ---- Helper: print a standardized failure (status + body snippet) ---------
fail_with_response() {
    local context="$1" status="$2" body="$3"
    echo "ERROR: ${context} (HTTP ${status:-unknown})" >&2
    echo "Response (first 500 chars):" >&2
    printf '%s' "${body}" | head -c 500 >&2
    echo "" >&2
}

# ---- Authenticate (returns 0 + sets ACCESS_TOKEN, or non-zero on failure) -
# Tries one base URL; caller decides whether to retry against a fallback.
ACCESS_TOKEN=""
try_authenticate() {
    local base_url="$1"
    local md5_pw
    md5_pw="$(md5_hex "${PASSWORD}")"

    local body="grant_type=password"
    body+="&username=$(jq -rn --arg v "${USERNAME}" '$v|@uri')"
    body+="&password=${md5_pw}"
    body+="&password_type=2"
    body+="&client_id=${INHAND_CLIENT_ID}"
    body+="&client_secret=${INHAND_CLIENT_SECRET}"

    local raw
    if ! raw="$(curl -sS -w '\n__HTTP_STATUS__:%{http_code}' \
        -X POST "${base_url%/}/oauth2/access_token" \
        -H 'Accept: application/json' \
        -H 'Content-Type: application/x-www-form-urlencoded; charset=utf-8' \
        --data "${body}")"; then
        fail_with_response "curl failed talking to ${base_url}" "n/a" ""
        return 1
    fi

    local status resp
    status="$(printf '%s' "${raw}" | awk -F: '/^__HTTP_STATUS__:/ {print $2}')"
    resp="$(printf '%s' "${raw}" | sed '$d')"

    if [ "${status}" != "200" ]; then
        fail_with_response "authentication failed against ${base_url}" "${status}" "${resp}"
        return 1
    fi

    local token
    if ! token="$(printf '%s' "${resp}" | jq -r '.access_token // empty' 2>/dev/null)" || [ -z "${token}" ]; then
        fail_with_response "no access_token in response from ${base_url}" "${status}" "${resp}"
        return 1
    fi

    ACCESS_TOKEN="${token}"
    echo "    authenticated against ${base_url}, token length: ${#ACCESS_TOKEN}" >&2
    return 0
}

echo "[1/3] Authenticating against ${BASE_URL} ..." >&2
if ! try_authenticate "${BASE_URL}"; then
    # Per the task spec, offer the alternate region (https://iot.inhandnetworks.com)
    # as a one-shot fallback when the NA endpoint rejects the credentials.
    FALLBACK_URL="https://iot.inhandnetworks.com"
    if [ "${BASE_URL}" != "${FALLBACK_URL}" ]; then
        echo "" >&2
        printf "Retry against fallback %s ? [y/N]: " "${FALLBACK_URL}" >&2
        read -r RETRY_REPLY
        case "${RETRY_REPLY}" in
            y|Y|yes|YES)
                BASE_URL="${FALLBACK_URL}"
                echo "    retrying against ${BASE_URL} ..." >&2
                if ! try_authenticate "${BASE_URL}"; then
                    exit 1
                fi
                ;;
            *)
                exit 1
                ;;
        esac
    else
        exit 1
    fi
fi

# ---- Paginated fetch of /api/devices?verbose=100 (in-memory) --------------
# Aggregate every page's `.result` array into one bash variable holding a
# JSON array string. Avoids any disk writes.
echo "[2/3] Fetching devices (verbose=100) ..." >&2
ALL_DEVICES_JSON="[]"

CURSOR=0
LIMIT=100
TOTAL_REPORTED=0
PAGES=0

while : ; do
    if ! DEV_RAW="$(curl -sS -w '\n__HTTP_STATUS__:%{http_code}' \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H 'Accept: application/json' \
        "${BASE_URL}/api/devices?verbose=100&cursor=${CURSOR}&limit=${LIMIT}")"; then
        fail_with_response "curl failed fetching devices (cursor=${CURSOR})" "n/a" ""
        exit 1
    fi

    DEV_STATUS="$(printf '%s' "${DEV_RAW}" | awk -F: '/^__HTTP_STATUS__:/ {print $2}')"
    DEV_BODY="$(printf '%s' "${DEV_RAW}" | sed '$d')"

    if [ "${DEV_STATUS}" != "200" ]; then
        fail_with_response "/api/devices request failed (cursor=${CURSOR})" "${DEV_STATUS}" "${DEV_BODY}"
        exit 1
    fi

    if ! PAGE_RESULT_JSON="$(printf '%s' "${DEV_BODY}" | jq -c '.result // []' 2>/dev/null)"; then
        fail_with_response "failed to parse devices response as JSON (cursor=${CURSOR})" "${DEV_STATUS}" "${DEV_BODY}"
        exit 1
    fi

    TOTAL_REPORTED="$(printf '%s' "${DEV_BODY}" | jq -r '.total // 0' 2>/dev/null || echo 0)"
    PAGE_LIMIT="$(printf '%s' "${DEV_BODY}" | jq -r '.limit // 100' 2>/dev/null || echo 100)"
    PAGE_COUNT="$(printf '%s' "${PAGE_RESULT_JSON}" | jq 'length')"
    # Validate each is a non-negative integer; default if not (defensive — if
    # the API returns garbage here, fall back to safe values rather than
    # blowing up the arithmetic below).
    case "${TOTAL_REPORTED}" in ''|*[!0-9]*) TOTAL_REPORTED=0 ;; esac
    case "${PAGE_LIMIT}"      in ''|*[!0-9]*) PAGE_LIMIT=100 ;; esac
    case "${PAGE_COUNT}"      in ''|*[!0-9]*) PAGE_COUNT=0 ;; esac

    # Concatenate the running array with this page in-memory.
    ALL_DEVICES_JSON="$(jq -cn --argjson a "${ALL_DEVICES_JSON}" --argjson b "${PAGE_RESULT_JSON}" '$a + $b')"

    PAGES=$((PAGES + 1))
    CURSOR=$((CURSOR + PAGE_LIMIT))

    if [ "${PAGE_COUNT}" -eq 0 ] || [ "${CURSOR}" -ge "${TOTAL_REPORTED}" ]; then
        break
    fi
    # Defensive infinite-loop guard only — production poller has no cap and
    # 1000 pages * 100/page = 100k devices, far above any real fleet size.
    if [ "${PAGES}" -gt 1000 ]; then
        echo "WARN: hit 1000-page safety cap, stopping pagination" >&2
        break
    fi
done

DEVICE_COUNT="$(printf '%s' "${ALL_DEVICES_JSON}" | jq 'length')"
echo "    fetched ${DEVICE_COUNT} devices in ${PAGES} page(s) (API total=${TOTAL_REPORTED})" >&2
echo "" >&2

# ---- Per-device extraction (mirrors inhand-poller.js::_extractRssi) -------
# Header line on stdout, tab-separated.
echo "[3/3] Extracting signal data ..." >&2
echo "" >&2
printf "name\tserialNumber\tonline\tmsisdn\ticcid\tlat\tlng\trawSignal\tnormalizedDbm\n"

# jq program:
#  - emit one row per device, tab-separated.
#  - first try dBm fields (device.rssi, info.rssi, info.signalStrength,
#    device.signalStrength) — accept negative numeric in (-200, 0).
#  - then CSQ candidates (info.signalLevel, info.csq, device.signalLevel,
#    info.signal) — accept integer in [0, 31], skip 99, convert via
#    dBm = -113 + 2 * csq.
#  - emit the field name + raw value that matched (or "—" / null) so we can
#    see which fields these specific routers actually populate.
jq -r '
  # Mirror JS parseFloat: accept a leading numeric prefix even when followed
  # by trailing junk like "-83 dBm". jq tonumber alone is strict and would
  # reject such values, diverging from inhand-poller.js::_extractRssi.
  def parse_float:
    if . == null then null
    elif type == "number" then .
    elif type == "string" then
      ( (capture("^\\s*(?<n>-?[0-9]+(?:\\.[0-9]+)?)") // null)
        | if . == null then null else (.n | tonumber) end )
    else null
    end;
  # Mirror JS parseInt(_, 10): leading integer prefix only.
  def parse_int:
    if . == null then null
    elif type == "number" then (. | floor)
    elif type == "string" then
      ( (capture("^\\s*(?<n>-?[0-9]+)") // null)
        | if . == null then null else (.n | tonumber) end )
    else null
    end;
  def is_dbm($n): ($n != null) and ($n < 0) and ($n > -200);
  def is_csq($n): ($n != null) and ($n >= 0) and ($n <= 31);

  def first_dbm($pairs):
    ($pairs | map(select(.value != null and .value != "")
                  | .value |= parse_float)
            | map(select(is_dbm(.value)))
            | first) // null;

  def first_csq($pairs):
    ($pairs | map(select(.value != null and .value != "")
                  | .value |= parse_int)
            | map(select(is_csq(.value)))
            | first) // null;

  .[]
  | . as $d
  | ($d.info // {}) as $info
  | (
      first_dbm([
        {name: "device.rssi",            value: $d.rssi},
        {name: "info.rssi",              value: $info.rssi},
        {name: "info.signalStrength",    value: $info.signalStrength},
        {name: "device.signalStrength",  value: $d.signalStrength}
      ])
    ) as $dbm
  | (
      if $dbm != null then
        { raw: "\($dbm.name)=\($dbm.value)", dbm: ($dbm.value | round) }
      else
        ( first_csq([
            {name: "info.signalLevel",   value: $info.signalLevel},
            {name: "info.csq",           value: $info.csq},
            {name: "device.signalLevel", value: $d.signalLevel},
            {name: "info.signal",        value: $info.signal}
          ])
        ) as $csq
        | if $csq != null then
            { raw: "\($csq.name)=\($csq.value)", dbm: (-113 + 2 * $csq.value) }
          else
            { raw: "—", dbm: null }
          end
      end
    ) as $sig
  | ($d.location // {}) as $loc
  | [
      ($d.name // "—"),
      ($d.serialNumber // "—"),
      (if $d.online == null then "—" else ($d.online | tostring) end),
      ($d.mobileNumber // "—"),
      ($info.iccid // "—"),
      ($loc.latitude  // "—" | tostring),
      ($loc.longitude // "—" | tostring),
      $sig.raw,
      ($sig.dbm // "—" | tostring)
    ]
  | @tsv
' <<<"${ALL_DEVICES_JSON}"

# ---- Summary --------------------------------------------------------------
SUMMARY="$(jq -r '
  def parse_float:
    if . == null then null
    elif type == "number" then .
    elif type == "string" then
      ( (capture("^\\s*(?<n>-?[0-9]+(?:\\.[0-9]+)?)") // null)
        | if . == null then null else (.n | tonumber) end )
    else null
    end;
  def parse_int:
    if . == null then null
    elif type == "number" then (. | floor)
    elif type == "string" then
      ( (capture("^\\s*(?<n>-?[0-9]+)") // null)
        | if . == null then null else (.n | tonumber) end )
    else null
    end;
  def is_dbm($n): ($n != null) and ($n < 0) and ($n > -200);
  def is_csq($n): ($n != null) and ($n >= 0) and ($n <= 31);

  # Mirror the per-row two-phase extraction EXACTLY: try the dBm-only fields
  # first (rejecting positive values via is_dbm), then the CSQ-only fields
  # (rejecting out-of-range values via is_csq). Mixing them in a single pass
  # would let a positive `device.signalStrength` value get falsely counted
  # as CSQ, diverging from inhand-poller.js::_extractRssi.
  def first_dbm($pairs):
    ($pairs | map(select(.value != null and .value != "") | .value |= parse_float)
            | map(select(is_dbm(.value))) | first) // null;
  def first_csq($pairs):
    ($pairs | map(select(.value != null and .value != "") | .value |= parse_int)
            | map(select(is_csq(.value))) | first) // null;

  map(
    . as $d
    | ($d.info // {}) as $info
    | ( first_dbm([
          {name: "device.rssi",            value: $d.rssi},
          {name: "info.rssi",              value: $info.rssi},
          {name: "info.signalStrength",    value: $info.signalStrength},
          {name: "device.signalStrength",  value: $d.signalStrength}
        ])
        // first_csq([
          {name: "info.signalLevel",       value: $info.signalLevel},
          {name: "info.csq",               value: $info.csq},
          {name: "device.signalLevel",     value: $d.signalLevel},
          {name: "info.signal",            value: $info.signal}
        ])
      )
  )
  | { total: length,
      withSignal: (map(select(. != null)) | length),
      fields: (map(select(. != null) | .name) | unique)
    }
  | "\(.total) devices total, \(.withSignal) with signal data, signal data found in field(s): \(.fields | join(", "))"
' <<<"${ALL_DEVICES_JSON}")"

echo "" >&2
echo "=== Summary ===" >&2
echo "${SUMMARY}" >&2
echo "" >&2
echo "Tip: pipe to 'column -t -s$'\''\\\\t'\''' for a prettier table." >&2
