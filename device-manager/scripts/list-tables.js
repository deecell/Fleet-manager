const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://deecell_admin:yDuUAs2pv4y12kS3@deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432/deecell_fleet',
  ssl: { rejectUnauthorized: false }
});

async function listTables() {
  const client = await pool.connect();
  try {
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
    console.log('Tables in database:');
    tables.rows.forEach(r => console.log('  -', r.table_name));
    
    // Check if power_mon_devices table exists
    const powerMonDevices = await client.query(`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'power_mon_devices'`);
    console.log('\npower_mon_devices exists:', powerMonDevices.rows[0].count > 0);
    
    // Check device_credentials table
    const deviceCredentials = await client.query(`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'device_credentials'`);
    console.log('device_credentials exists:', deviceCredentials.rows[0].count > 0);
    
    // Check device_sync_status table
    const deviceSyncStatus = await client.query(`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'device_sync_status'`);
    console.log('device_sync_status exists:', deviceSyncStatus.rows[0].count > 0);
    
  } finally {
    client.release();
    await pool.end();
  }
}

listTables();
