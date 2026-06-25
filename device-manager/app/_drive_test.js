// Read-only InHand drive-test logger for DCL-Moeck-Fleet (truck GFR-69).
// Polls every INTERVAL_MS, appends a CSV row, flags tower handoffs + location moves.
const fs = require('fs');
const { inhandClient } = require('./inhand-client');

const TARGET = process.env.DT_TARGET || 'DCL-Moeck-Fleet';
const INTERVAL_MS = parseInt(process.env.DT_INTERVAL_MS || '30000', 10);
const CSV = process.env.DT_CSV || '/tmp/gfr69_drive_test.csv';
const ONCE = process.argv.includes('--once');

const HEADER = [
  'poll_utc','online','loc_lat','loc_lng','loc_source','loc_time','loc_changed',
  'sig_cid','info_cid','info_lac','info_mcc','info_mnc','cell_changed',
  'sig_pci','sig_band','sig_rssi','sig_rsrp','sig_rsrq','sig_sinr','sig_level','sig_ts','radio'
].join(',');

function haversineMi(a, b, c, d) {
  if ([a,b,c,d].some(v => v == null)) return null;
  const R=3958.8, toR=x=>x*Math.PI/180;
  const dLat=toR(c-a), dLng=toR(d-b);
  const h=Math.sin(dLat/2)**2 + Math.cos(toR(a))*Math.cos(toR(c))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

let prev = null;
async function poll() {
  const now = new Date().toISOString();
  try {
    const devices = await inhandClient.getDevicesWithLocation();
    const d = devices.find(x => (x.name||'') === TARGET);
    if (!d) { console.log(`${now}  NOT FOUND: ${TARGET}`); return; }
    const ss = d.signalStrength || {};
    const inf = d.info || {};
    const lat = d.location?.latitude ?? null, lng = d.location?.longitude ?? null;
    const cid = ss.cid ?? inf.cid ?? null;
    let locChanged = '', cellChanged = '', jumpMi = '';
    if (prev) {
      if (lat !== prev.lat || lng !== prev.lng) { locChanged='LOC_MOVE'; jumpMi=(haversineMi(prev.lat,prev.lng,lat,lng)||0).toFixed(2); }
      if (cid !== prev.cid || (inf.lac??null) !== prev.lac) cellChanged='HANDOFF';
    }
    const row = [now, d.online, lat, lng, d.location?.source||'', d.location?.time||'', locChanged,
      ss.cid??'', inf.cid??'', inf.lac??'', inf.mcc??'', inf.mnc??'', cellChanged,
      ss.pci??'', ss.band??'', ss.rssi??'', ss.rsrp??'', ss.rsrq??'', ss.sinr??'', ss.level??'', ss.ts??'', ss.radio??''
    ].join(',');
    if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, HEADER + '\n');
    fs.appendFileSync(CSV, row + '\n');
    console.log(`${now} | cid=${cid} lac=${inf.lac??'?'} ${cellChanged} | loc=${lat},${lng} src=${d.location?.source} ${locChanged}${jumpMi?(' '+jumpMi+'mi'):''} | rssi=${ss.rssi??inf.rssi} rsrp=${ss.rsrp??'?'} sinr=${ss.sinr??'?'} sig_ts=${ss.ts??'?'}`);
    prev = { lat, lng, cid, lac: inf.lac??null };
  } catch (e) { console.log(`${now}  ERR ${e.message}`); }
}

(async () => {
  await poll();
  if (ONCE) { process.exit(0); }
  setInterval(poll, INTERVAL_MS);
})();
