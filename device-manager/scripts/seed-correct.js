const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://deecell_admin:yDuUAs2pv4y12kS3@deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432/deecell_fleet',
  ssl: { rejectUnauthorized: false }
});

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding power_mon_devices and device_credentials...');
    
    // First get the organization and truck IDs
    const org = await client.query(`SELECT id FROM organizations WHERE name = 'GTO Fast Racing'`);
    if (org.rows.length === 0) {
      throw new Error('GTO Fast Racing organization not found');
    }
    const orgId = org.rows[0].id;
    console.log('Found organization id:', orgId);
    
    const trucks = await client.query(`SELECT id, truck_number FROM trucks WHERE organization_id = $1`, [orgId]);
    console.log('Found trucks:', trucks.rows);
    
    // Insert into power_mon_devices
    for (const truck of trucks.rows) {
      const serialNumber = truck.truck_number === 'GFR-69' ? 'A3A5B30EA9B3FF98' : '1982A3044D3599E2';
      const wifiHost = truck.truck_number === 'GFR-69' ? '10.9.1.190' : '10.9.1.191';
      const deviceName = truck.truck_number === 'GFR-69' ? 'DCL-Moeck' : 'GFR-70 PowerMon';
      
      // Insert into power_mon_devices
      await client.query(`
        INSERT INTO power_mon_devices 
          (organization_id, serial_number, device_name, truck_id, is_active, status, created_at, updated_at)
        VALUES 
          ($1, $2, $3, $4, true, 'offline', NOW(), NOW())
        ON CONFLICT (serial_number) 
        DO UPDATE SET truck_id = $4, is_active = true, updated_at = NOW()
        RETURNING id
      `, [orgId, serialNumber, deviceName, truck.id]);
      
      const device = await client.query(`SELECT id FROM power_mon_devices WHERE serial_number = $1`, [serialNumber]);
      const deviceId = device.rows[0].id;
      
      console.log(`Created/updated power_mon_device: ${deviceName} (${serialNumber}) -> device_id: ${deviceId}`);
      
      // Insert into device_credentials with WiFi credentials
      // PowerMon WiFi uses AppLink URL format
      const applinkUrl = `http://${wifiHost}`;
      
      await client.query(`
        INSERT INTO device_credentials 
          (device_id, organization_id, applink_url, connection_key, access_key, is_active, created_at, updated_at)
        VALUES 
          ($1, $2, $3, 'wifi', 'wifi', true, NOW(), NOW())
        ON CONFLICT (device_id) 
        DO UPDATE SET applink_url = $3, is_active = true, updated_at = NOW()
      `, [deviceId, orgId, applinkUrl]);
      
      console.log(`Created/updated credentials for device ${deviceId}: ${applinkUrl}`);
      
      // Initialize device_sync_status
      const cohortId = deviceId % 10; // Simple cohort assignment
      await client.query(`
        INSERT INTO device_sync_status 
          (device_id, organization_id, cohort_id, connection_status, updated_at)
        VALUES 
          ($1, $2, $3, 'disconnected', NOW())
        ON CONFLICT (device_id) 
        DO UPDATE SET cohort_id = $3, updated_at = NOW()
      `, [deviceId, orgId, cohortId]);
      
      console.log(`Initialized sync status for device ${deviceId} in cohort ${cohortId}`);
    }
    
    // Verify the data
    const result = await client.query(`
      SELECT 
        d.id as device_id,
        d.serial_number,
        d.device_name,
        d.is_active,
        c.applink_url,
        c.is_active as cred_active
      FROM power_mon_devices d
      LEFT JOIN device_credentials c ON c.device_id = d.id
      WHERE d.organization_id = $1
    `, [orgId]);
    
    console.log('\nVerification - Power Mon Devices with Credentials:');
    console.log(JSON.stringify(result.rows, null, 2));
    
    console.log('\nSeed complete!');
    
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
