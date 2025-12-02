const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 
  'postgresql://deecell_admin:yDuUAs2pv4y12kS3@deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432/deecell_fleet';

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function seedData() {
  const client = await pool.connect();
  try {
    console.log('Seeding GTO Fast Racing data...');

    // Create GTO Fast Racing organization
    const orgResult = await client.query(`
      INSERT INTO organizations (name, slug) 
      VALUES ('GTO Fast Racing', 'gto-fast-racing')
      ON CONFLICT (slug) DO UPDATE SET name = 'GTO Fast Racing'
      RETURNING id
    `);
    const orgId = orgResult.rows[0].id;
    console.log('Created organization: GTO Fast Racing (id: ' + orgId + ')');

    // Create GFR Fleet
    const fleetResult = await client.query(`
      INSERT INTO fleets (organization_id, name, description)
      VALUES ($1, 'GFR Racing Fleet', 'Clean energy racing trucks')
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [orgId]);
    
    let fleetId;
    if (fleetResult.rows.length > 0) {
      fleetId = fleetResult.rows[0].id;
    } else {
      const existingFleet = await client.query(`
        SELECT id FROM fleets WHERE organization_id = $1 AND name = 'GFR Racing Fleet'
      `, [orgId]);
      fleetId = existingFleet.rows[0]?.id || 1;
    }
    console.log('Created fleet: GFR Racing Fleet (id: ' + fleetId + ')');

    // Create GFR-69 truck
    const truck69Result = await client.query(`
      INSERT INTO trucks (organization_id, fleet_id, truck_number, make, model, status)
      VALUES ($1, $2, 'GFR-69', 'Tesla', 'Semi', 'active')
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [orgId, fleetId]);
    
    let truck69Id;
    if (truck69Result.rows.length > 0) {
      truck69Id = truck69Result.rows[0].id;
    } else {
      const existingTruck = await client.query(`
        SELECT id FROM trucks WHERE truck_number = 'GFR-69'
      `);
      truck69Id = existingTruck.rows[0]?.id;
    }
    console.log('Created truck: GFR-69 (id: ' + truck69Id + ')');

    // Create GFR-70 truck
    const truck70Result = await client.query(`
      INSERT INTO trucks (organization_id, fleet_id, truck_number, make, model, status)
      VALUES ($1, $2, 'GFR-70', 'Tesla', 'Semi', 'active')
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [orgId, fleetId]);
    
    let truck70Id;
    if (truck70Result.rows.length > 0) {
      truck70Id = truck70Result.rows[0].id;
    } else {
      const existingTruck = await client.query(`
        SELECT id FROM trucks WHERE truck_number = 'GFR-70'
      `);
      truck70Id = existingTruck.rows[0]?.id;
    }
    console.log('Created truck: GFR-70 (id: ' + truck70Id + ')');

    // Create GFR-69 PowerMon device (DCL-Moeck)
    await client.query(`
      INSERT INTO devices (organization_id, truck_id, serial_number, name, powermon_mode, wifi_host, status, is_active)
      VALUES ($1, $2, 'A3A5B30EA9B3FF98', 'DCL-Moeck', 'wifi', '10.9.1.190', 'online', true)
      ON CONFLICT (serial_number) DO UPDATE SET
        truck_id = $2,
        wifi_host = '10.9.1.190',
        powermon_mode = 'wifi',
        is_active = true
    `, [orgId, truck69Id]);
    console.log('Created device: DCL-Moeck (A3A5B30EA9B3FF98) for GFR-69');

    // Create GFR-70 PowerMon device
    await client.query(`
      INSERT INTO devices (organization_id, truck_id, serial_number, name, powermon_mode, wifi_host, status, is_active)
      VALUES ($1, $2, '1982A3044D3599E2', 'GFR-70 PowerMon', 'wifi', '10.9.1.191', 'online', true)
      ON CONFLICT (serial_number) DO UPDATE SET
        truck_id = $2,
        wifi_host = '10.9.1.191',
        powermon_mode = 'wifi',
        is_active = true
    `, [orgId, truck70Id]);
    console.log('Created device: GFR-70 PowerMon (1982A3044D3599E2) for GFR-70');

    // Verify the data
    const devices = await client.query(`
      SELECT d.serial_number, d.name, d.wifi_host, t.truck_number 
      FROM devices d 
      LEFT JOIN trucks t ON d.truck_id = t.id 
      WHERE d.is_active = true
    `);
    console.log('Active devices:', JSON.stringify(devices.rows, null, 2));

    console.log('Seed complete!');
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedData();
