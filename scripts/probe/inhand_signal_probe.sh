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

# ---- Authenticate ---------------------------------------------------------
echo "[1/3] Authenticating against ${BASE_URL} ..." >&2
MD5_PW="$(md5_hex "${PASSWORD}")"

AUTH_BODY="grant_type=password"
AUTH_BODY+="&username=$(jq -rn --arg v "${USERNAME}" '$v|@uri')"
AUTH_BODY+="&password=${MD5_PW}"
AUTH_BODY+="&password_type=2"
AUTH_BODY+="&client_id=${INHAND_CLIENT_ID}"
AUTH_BODY+="&client_secret=${INHAND_CLIENT_SECRET}"

AUTH_RAW="$(curl -sS -w '\n__HTTP_STATUS__:%{http_code}' \
    -X POST "${BASE_URL}/oauth2/access_token" \
    -H 'Accept: application/json' \
    -H 'Content-Type: application/x-www-form-urlencoded; charset=utf-8' \
    --data "${AUTH_BODY}")" || { echo "ERROR: curl failed talking to ${BASE_URL}" >&2; exit 1; }

AUTH_STATUS="$(printf '%s' "${AUTH_RAW}" | awk -F: '/^__HTTP_STATUS__:/ {print $2}')"
AUTH_BODY_RESP="$(printf '%s' "${AUTH_RAW}" | sed '$d')"

if [ "${AUTH_STATUS}" != "200" ]; then
    echo "ERROR: authentication failed (HTTP ${AUTH_STATUS})" >&2
    echo "Response (first 500 chars):" >&2
    echo "${AUTH_BODY_RESP}" | head -c 500 >&2
    echo "" >&2
    exit 1
fi

ACCESS_TOKEN="$(printf '%s' "${AUTH_BODY_RESP}" | jq -r '.access_token // empty')"
if [ -z "${ACCESS_TOKEN}" ]; then
    echo "ERROR: no access_token in response" >&2
    echo "Response (first 500 chars):" >&2
    echo "${AUTH_BODY_RESP}" | head -c 500 >&2
    echo "" >&2
    exit 1
fi
echo "    authenticated, token length: ${#ACCESS_TOKEN}" >&2

# ---- Paginated fetch of /api/devices?verbose=100 --------------------------
echo "[2/3] Fetching devices (verbose=100) ..." >&2
ALL_DEVICES_FILE="$(mktemp -t inhand_devices.XXXXXX)"
trap 'rm -f "${ALL_DEVICES_FILE}"' EXIT
echo "[]" > "${ALL_DEVICES_FILE}"

CURSOR=0
LIMIT=100
TOTAL_REPORTED=0
PAGES=0

while : ; do
    DEV_RAW="$(curl -sS -w '\n__HTTP_STATUS__:%{http_code}' \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H 'Accept: application/json' \
        "${BASE_URL}/api/devices?verbose=100&cursor=${CURSOR}&limit=${LIMIT}")" \
        || { echo "ERROR: curl failed fetching devices (cursor=${CURSOR})" >&2; exit 1; }

    DEV_STATUS="$(printf '%s' "${DEV_RAW}" | awk -F: '/^__HTTP_STATUS__:/ {print $2}')"
    DEV_BODY="$(printf '%s' "${DEV_RAW}" | sed '$d')"

    if [ "${DEV_STATUS}" != "200" ]; then
        echo "ERROR: /api/devices returned HTTP ${DEV_STATUS}" >&2
        echo "Response (first 500 chars):" >&2
        echo "${DEV_BODY}" | head -c 500 >&2
        echo "" >&2
        exit 1
    fi

    PAGE_DEVICES_FILE="$(mktemp -t inhand_page.XXXXXX)"
    if ! printf '%s' "${DEV_BODY}" | jq '.result // []' > "${PAGE_DEVICES_FILE}" 2>/dev/null; then
        echo "ERROR: failed to parse devices response as JSON" >&2
        echo "Response (first 500 chars):" >&2
        echo "${DEV_BODY}" | head -c 500 >&2
        echo "" >&2
        rm -f "${PAGE_DEVICES_FILE}"
        exit 1
    fi

    PAGE_COUNT="$(jq 'length' < "${PAGE_DEVICES_FILE}")"
    TOTAL_REPORTED="$(printf '%s' "${DEV_BODY}" | jq -r '.total // 0')"
    PAGE_LIMIT="$(printf '%s' "${DEV_BODY}" | jq -r '.limit // 100')"

    # Append this page's devices to the running list.
    NEXT_FILE="$(mktemp -t inhand_combined.XXXXXX)"
    jq -s 'add' "${ALL_DEVICES_FILE}" "${PAGE_DEVICES_FILE}" > "${NEXT_FILE}"
    mv "${NEXT_FILE}" "${ALL_DEVICES_FILE}"
    rm -f "${PAGE_DEVICES_FILE}"

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

DEVICE_COUNT="$(jq 'length' < "${ALL_DEVICES_FILE}")"
echo "    fetched ${DEVICE_COUNT} devices in ${PAGES} page(s) (API total=${TOTAL_REPORTED})" >&2
echo "" >&2

# ---- Per-device extraction (mirrors inhand-poller.js::_extractRssi) -------
# Header line on stdout, tab-separated.
echo "[3/3] Extracting signal data ..." >&2
echo "" >&2
printf "name\tserialNumber\tonline\tmsisdn\ticcid\tlat\tlng\trawSignalField\trawSignalValue\tnormalizedDbm\n"

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
        { field: $dbm.name, raw: ($dbm.value|tostring), dbm: ($dbm.value | round) }
      else
        ( first_csq([
            {name: "info.signalLevel",   value: $info.signalLevel},
            {name: "info.csq",           value: $info.csq},
            {name: "device.signalLevel", value: $d.signalLevel},
            {name: "info.signal",        value: $info.signal}
          ])
        ) as $csq
        | if $csq != null then
            { field: $csq.name, raw: ($csq.value|tostring), dbm: (-113 + 2 * $csq.value) }
          else
            { field: "—", raw: "—", dbm: null }
          end
      end
    ) as $sig
  | ($d.location // {}) as $loc
  | [
      ($d.name // "—"),
      ($d.serialNumber // "—"),
      ($d.online | tostring),
      ($d.mobileNumber // "—"),
      ($info.iccid // "—"),
      ($loc.latitude  // "—" | tostring),
      ($loc.longitude // "—" | tostring),
      $sig.field,
      $sig.raw,
      ($sig.dbm // "—" | tostring)
    ]
  | @tsv
' "${ALL_DEVICES_FILE}"

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

  def first_match($pairs):
    ( $pairs | map(select(.value != null and .value != "")) ) as $raw
    | (
        ( $raw | map(.value |= parse_float) | map(select(is_dbm(.value))) | first )
        // ( $raw | map(.value |= parse_int)   | map(select(is_csq(.value))) | first )
        // null
      );

  map(
    . as $d
    | ($d.info // {}) as $info
    | first_match([
        {name: "device.rssi",            value: $d.rssi},
        {name: "info.rssi",              value: $info.rssi},
        {name: "info.signalStrength",    value: $info.signalStrength},
        {name: "device.signalStrength",  value: $d.signalStrength},
        {name: "info.signalLevel",       value: $info.signalLevel},
        {name: "info.csq",               value: $info.csq},
        {name: "device.signalLevel",     value: $d.signalLevel},
        {name: "info.signal",            value: $info.signal}
      ])
  )
  | { total: length,
      withSignal: (map(select(. != null)) | length),
      fields: (map(select(. != null) | .name) | unique)
    }
  | "\(.total) devices total, \(.withSignal) with signal data, signal data found in field(s): \(.fields | join(", "))"
' < "${ALL_DEVICES_FILE}")"

echo "" >&2
echo "=== Summary ===" >&2
echo "${SUMMARY}" >&2
echo "" >&2
echo "Tip: pipe to 'column -t -s$'\''\\\\t'\''' for a prettier table." >&2
