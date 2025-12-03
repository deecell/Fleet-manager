import { pool } from "./db";

// Incremental migrations for adding new columns to existing tables
// These run safely on existing databases without dropping/recreating tables
// Last updated: December 3, 2025 - Added parked status columns
async function runIncrementalMigrations(): Promise<void> {
  console.log("[Migrations] Running incremental migrations...");
  
  // Migration: Add parked status columns to device_snapshots (Dec 2025)
  try {
    await pool.query(`
      ALTER TABLE device_snapshots 
      ADD COLUMN IF NOT EXISTS is_parked BOOLEAN DEFAULT FALSE;
    `);
    await pool.query(`
      ALTER TABLE device_snapshots 
      ADD COLUMN IF NOT EXISTS parked_since TIMESTAMP;
    `);
    await pool.query(`
      ALTER TABLE device_snapshots 
      ADD COLUMN IF NOT EXISTS today_parked_minutes INTEGER DEFAULT 0;
    `);
    await pool.query(`
      ALTER TABLE device_snapshots 
      ADD COLUMN IF NOT EXISTS parked_date TEXT;
    `);
    console.log("[Migrations] Added parked status columns to device_snapshots");
  } catch (error) {
    // Columns may already exist, that's fine
    console.log("[Migrations] Parked columns already exist or error:", error);
  }
}

export async function runStartupMigrations(): Promise<boolean> {
  const isProduction = process.env.NODE_ENV === "production";
  
  if (!isProduction) {
    console.log("[Migrations] Skipping startup migrations in development mode");
    return true;
  }

  console.log("[Migrations] Running startup migrations...");

  try {
    console.log("[Migrations] Testing database connection...");
    await pool.query("SELECT 1");
    console.log("[Migrations] Database connection successful!");

    // Check schema version - we track this with a simple marker
    const schemaVersion = "v2"; // Increment this when schema changes
    const checkVersion = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'schema_version'
      ) as exists
    `);
    
    let needsRebuild = false;
    
    if (checkVersion.rows[0].exists) {
      const versionResult = await pool.query(`SELECT version FROM schema_version LIMIT 1`);
      if (versionResult.rows.length === 0 || versionResult.rows[0].version !== schemaVersion) {
        needsRebuild = true;
        console.log(`[Migrations] Schema version mismatch (expected ${schemaVersion})`);
      }
    } else {
      // No version table - check if tables exist at all
      const tablesExist = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'organizations'
        ) as exists
      `);
      if (tablesExist.rows[0].exists) {
        needsRebuild = true;
        console.log("[Migrations] Tables exist but no version tracking - rebuilding");
      }
    }
    
    if (needsRebuild) {
      console.log("[Migrations] Dropping and recreating all tables...");
      
      // Drop tables in reverse dependency order
      await pool.query(`DROP TABLE IF EXISTS sim_location_history CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS sims CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS fuel_prices CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS savings_config CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS audit_logs CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS alerts CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS device_sync_status CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS device_statistics CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS device_measurements CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS device_snapshots CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS device_credentials CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS power_mon_devices CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS devices CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS trucks CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS fleets CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS users CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS organizations CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS sessions CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS session CASCADE;`);
      await pool.query(`DROP TABLE IF EXISTS schema_version CASCADE;`);
      
      console.log("[Migrations] Old tables dropped successfully");
    } else {
      const existsCheck = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'organizations'
        ) as exists
      `);
      if (existsCheck.rows[0].exists) {
        console.log("[Migrations] Schema is current, running incremental migrations only");
        await runIncrementalMigrations();
        return true;
      }
    }

    console.log("[Migrations] Creating tables (matching shared/schema.ts)...");

    // Organizations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        plan TEXT DEFAULT 'standard',
        is_active BOOLEAN DEFAULT TRUE,
        settings TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS org_slug_idx ON organizations(slug);
    `);
    console.log("[Migrations] Created organizations");

    // Users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        password_hash TEXT,
        first_name TEXT,
        last_name TEXT,
        role TEXT DEFAULT 'user',
        is_active BOOLEAN DEFAULT TRUE,
        last_login_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_email_org_idx ON users(email, organization_id);
      CREATE INDEX IF NOT EXISTS user_org_idx ON users(organization_id);
    `);
    console.log("[Migrations] Created users");

    // Fleets
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fleets (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        timezone TEXT DEFAULT 'America/Los_Angeles',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fleet_org_idx ON fleets(organization_id);
      CREATE UNIQUE INDEX IF NOT EXISTS fleet_org_name_idx ON fleets(organization_id, name);
    `);
    console.log("[Migrations] Created fleets");

    // Trucks
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trucks (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        fleet_id INTEGER NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
        truck_number TEXT NOT NULL,
        driver_name TEXT,
        make TEXT,
        model TEXT,
        year INTEGER,
        vin_number TEXT,
        license_plate TEXT,
        status TEXT DEFAULT 'in-service',
        latitude REAL,
        longitude REAL,
        last_location_update TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS truck_org_idx ON trucks(organization_id);
      CREATE INDEX IF NOT EXISTS truck_fleet_idx ON trucks(fleet_id);
      CREATE INDEX IF NOT EXISTS truck_org_fleet_status_idx ON trucks(organization_id, fleet_id, status);
      CREATE INDEX IF NOT EXISTS truck_number_idx ON trucks(organization_id, truck_number);
    `);
    console.log("[Migrations] Created trucks");

    // Power Mon Devices
    await pool.query(`
      CREATE TABLE IF NOT EXISTS power_mon_devices (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
        serial_number TEXT NOT NULL UNIQUE,
        device_name TEXT,
        hardware_revision TEXT,
        firmware_version TEXT,
        host_id TEXT,
        status TEXT DEFAULT 'offline',
        last_seen_at TIMESTAMP,
        assigned_at TIMESTAMP,
        unassigned_at TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS device_org_idx ON power_mon_devices(organization_id);
      CREATE INDEX IF NOT EXISTS device_truck_idx ON power_mon_devices(truck_id);
      CREATE INDEX IF NOT EXISTS device_serial_idx ON power_mon_devices(serial_number);
      CREATE INDEX IF NOT EXISTS device_status_idx ON power_mon_devices(organization_id, status);
    `);
    console.log("[Migrations] Created power_mon_devices");

    // Device Credentials
    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_credentials (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        device_id INTEGER NOT NULL REFERENCES power_mon_devices(id) ON DELETE CASCADE,
        connection_key TEXT NOT NULL,
        access_key TEXT NOT NULL,
        applink_url TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS credential_org_idx ON device_credentials(organization_id);
      CREATE UNIQUE INDEX IF NOT EXISTS credential_device_idx ON device_credentials(device_id);
    `);
    console.log("[Migrations] Created device_credentials");

    // Device Snapshots
    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_snapshots (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        device_id INTEGER NOT NULL REFERENCES power_mon_devices(id) ON DELETE CASCADE,
        truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
        fleet_id INTEGER REFERENCES fleets(id) ON DELETE SET NULL,
        voltage1 REAL,
        voltage2 REAL,
        current REAL,
        power REAL,
        temperature REAL,
        soc REAL,
        energy REAL,
        charge REAL,
        runtime INTEGER,
        rssi INTEGER,
        power_status INTEGER,
        power_status_string TEXT,
        recorded_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS snapshot_device_idx ON device_snapshots(device_id);
      CREATE INDEX IF NOT EXISTS snapshot_org_idx ON device_snapshots(organization_id);
      CREATE INDEX IF NOT EXISTS snapshot_org_fleet_idx ON device_snapshots(organization_id, fleet_id);
    `);
    console.log("[Migrations] Created device_snapshots");

    // Device Measurements
    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_measurements (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        device_id INTEGER NOT NULL REFERENCES power_mon_devices(id) ON DELETE CASCADE,
        truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
        voltage1 REAL,
        voltage2 REAL,
        current REAL,
        power REAL,
        temperature REAL,
        soc REAL,
        energy REAL,
        charge REAL,
        runtime INTEGER,
        rssi INTEGER,
        power_status INTEGER,
        power_status_string TEXT,
        source TEXT DEFAULT 'poll',
        recorded_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS measurement_org_device_time_idx ON device_measurements(organization_id, device_id, recorded_at);
      CREATE INDEX IF NOT EXISTS measurement_recorded_at_idx ON device_measurements(recorded_at);
      CREATE INDEX IF NOT EXISTS measurement_device_time_idx ON device_measurements(device_id, recorded_at);
    `);
    console.log("[Migrations] Created device_measurements");

    // Device Statistics
    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_statistics (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        device_id INTEGER NOT NULL REFERENCES power_mon_devices(id) ON DELETE CASCADE,
        truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
        total_charge REAL,
        total_charge_energy REAL,
        total_discharge REAL,
        total_discharge_energy REAL,
        min_voltage REAL,
        max_voltage REAL,
        max_charge_current REAL,
        max_discharge_current REAL,
        time_since_last_full_charge INTEGER,
        full_charge_capacity REAL,
        deepest_discharge REAL,
        last_discharge REAL,
        soc REAL,
        seconds_since_on INTEGER,
        voltage1_min REAL,
        voltage1_max REAL,
        voltage2_min REAL,
        voltage2_max REAL,
        peak_charge_current REAL,
        peak_discharge_current REAL,
        temperature_min REAL,
        temperature_max REAL,
        recorded_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS statistics_device_idx ON device_statistics(device_id);
      CREATE INDEX IF NOT EXISTS statistics_org_idx ON device_statistics(organization_id);
    `);
    console.log("[Migrations] Created device_statistics");

    // Device Sync Status
    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_sync_status (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        device_id INTEGER NOT NULL REFERENCES power_mon_devices(id) ON DELETE CASCADE,
        connection_status TEXT DEFAULT 'disconnected',
        cohort_id INTEGER DEFAULT 0,
        last_connected_at TIMESTAMP,
        last_disconnected_at TIMESTAMP,
        last_poll_at TIMESTAMP,
        last_successful_poll_at TIMESTAMP,
        consecutive_poll_failures INTEGER DEFAULT 0,
        last_log_file_id TEXT,
        last_log_offset BIGINT DEFAULT 0,
        last_log_sync_at TIMESTAMP,
        total_samples_synced BIGINT DEFAULT 0,
        backfill_status TEXT DEFAULT 'idle',
        gap_start_at TIMESTAMP,
        gap_end_at TIMESTAMP,
        sync_status TEXT DEFAULT 'idle',
        error_message TEXT,
        consecutive_failures INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS sync_status_org_idx ON device_sync_status(organization_id);
      CREATE UNIQUE INDEX IF NOT EXISTS sync_status_device_idx ON device_sync_status(device_id);
      CREATE INDEX IF NOT EXISTS sync_status_connection_idx ON device_sync_status(connection_status);
      CREATE INDEX IF NOT EXISTS sync_status_cohort_idx ON device_sync_status(cohort_id);
    `);
    console.log("[Migrations] Created device_sync_status");

    // Alerts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        device_id INTEGER REFERENCES power_mon_devices(id) ON DELETE CASCADE,
        truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
        fleet_id INTEGER REFERENCES fleets(id) ON DELETE SET NULL,
        alert_type TEXT NOT NULL,
        severity TEXT DEFAULT 'warning',
        title TEXT NOT NULL,
        message TEXT,
        threshold REAL,
        actual_value REAL,
        status TEXT DEFAULT 'active',
        acknowledged_by INTEGER REFERENCES users(id),
        acknowledged_at TIMESTAMP,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS alert_org_idx ON alerts(organization_id);
      CREATE INDEX IF NOT EXISTS alert_org_status_idx ON alerts(organization_id, status);
      CREATE INDEX IF NOT EXISTS alert_device_idx ON alerts(device_id);
      CREATE INDEX IF NOT EXISTS alert_type_idx ON alerts(alert_type);
      CREATE INDEX IF NOT EXISTS alert_created_at_idx ON alerts(created_at);
    `);
    console.log("[Migrations] Created alerts");

    // Audit Logs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS audit_org_idx ON audit_logs(organization_id);
      CREATE INDEX IF NOT EXISTS audit_created_at_idx ON audit_logs(created_at);
    `);
    console.log("[Migrations] Created audit_logs");

    // Sessions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR(255) PRIMARY KEY,
        sess TEXT NOT NULL,
        expire TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS session_expire_idx ON sessions(expire);
    `);
    console.log("[Migrations] Created sessions");

    // SIMs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sims (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        device_id INTEGER REFERENCES power_mon_devices(id) ON DELETE SET NULL,
        truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
        iccid TEXT NOT NULL UNIQUE,
        msisdn TEXT,
        imsi TEXT,
        simpro_id TEXT,
        status TEXT DEFAULT 'active',
        carrier TEXT,
        latitude REAL,
        longitude REAL,
        location_accuracy INTEGER,
        last_location_update TIMESTAMP,
        data_usage_bytes BIGINT DEFAULT 0,
        data_limit_bytes BIGINT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS sim_org_idx ON sims(organization_id);
      CREATE INDEX IF NOT EXISTS sim_device_idx ON sims(device_id);
      CREATE INDEX IF NOT EXISTS sim_iccid_idx ON sims(iccid);
    `);
    console.log("[Migrations] Created sims");

    // SIM Location History
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sim_location_history (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        sim_id INTEGER NOT NULL REFERENCES sims(id) ON DELETE CASCADE,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy INTEGER,
        recorded_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS sim_location_sim_idx ON sim_location_history(sim_id);
      CREATE INDEX IF NOT EXISTS sim_location_time_idx ON sim_location_history(recorded_at);
    `);
    console.log("[Migrations] Created sim_location_history");

    // Fuel Prices
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fuel_prices (
        id SERIAL PRIMARY KEY,
        price_date TIMESTAMP NOT NULL,
        price_per_gallon REAL NOT NULL,
        region TEXT NOT NULL,
        source TEXT DEFAULT 'EIA',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS fuel_price_region_date_idx ON fuel_prices(region, price_date);
    `);
    console.log("[Migrations] Created fuel_prices");

    // Savings Config
    await pool.query(`
      CREATE TABLE IF NOT EXISTS savings_config (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
        diesel_kwh_per_gallon REAL DEFAULT 9.0,
        fuel_price_override REAL,
        use_regional_pricing BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("[Migrations] Created savings_config");

    // Schema Version tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id SERIAL PRIMARY KEY,
        version TEXT NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO schema_version (version) VALUES ('v2');
    `);
    console.log("[Migrations] Created schema_version (v2)");

    // Run incremental migrations for new columns
    await runIncrementalMigrations();

    console.log("[Migrations] ✅ All tables created successfully!");
    return true;

  } catch (error) {
    console.error("[Migrations] ❌ Migration failed:", error);
    return false;
  }
}
