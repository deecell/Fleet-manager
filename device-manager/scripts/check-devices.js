const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://deecell_admin:yDuUAs2pv4y12kS3@deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432/deecell_fleet',
  ssl: { rejectUnauthorized: false }
});

async function check() {
  const client = await pool.connect();
  try {
    const devices = await client.query('SELECT id, name, serial_number, powermon_mode, wifi_host, is_active FROM devices');
    console.log('All devices:', JSON.stringify(devices.rows, null, 2));
    
    // Check what the Device Manager query looks for
    const activeDevices = await client.query(`
      SELECT d.id, d.serial_number, d.wifi_host, d.powermon_mode
      FROM devices d
      WHERE d.is_active = true 
        AND d.powermon_mode = 'wifi'
        AND d.wifi_host IS NOT NULL
    `);
    console.log('WiFi devices for polling:', JSON.stringify(activeDevices.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

check();
