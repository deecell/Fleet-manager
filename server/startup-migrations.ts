import { pool } from "./db";

export async function runStartupMigrations(): Promise<boolean> {
  const isProduction = process.env.NODE_ENV === "production";
  
  if (!isProduction) {
    console.log("[Migrations] Skipping startup migrations in development mode");
    return true;
  }

  console.log("[Migrations] Running startup migrations...");

  try {
    // Test connection first
    console.log("[Migrations] Testing database connection...");
    await pool.query("SELECT 1");
    console.log("[Migrations] Database connection successful!");

    // Create enum types first (idempotent)
    console.log("[Migrations] Creating enum types...");
    
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE organization_status AS ENUM ('active', 'inactive', 'suspended');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'manager', 'viewer');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE fleet_status AS ENUM ('active', 'inactive', 'maintenance');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE truck_status AS ENUM ('active', 'inactive', 'maintenance', 'decommissioned');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE device_status AS ENUM ('online', 'offline', 'error', 'maintenance');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE alert_severity AS ENUM ('critical', 'warning', 'info');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE alert_status AS ENUM ('active', 'acknowledged', 'resolved');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    console.log("[Migrations] Enum types ready!");

    // Create tables (idempotent with IF NOT EXISTS)
    console.log("[Migrations] Creating tables...");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        status organization_status DEFAULT 'active' NOT NULL,
        logo_url TEXT,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        role user_role DEFAULT 'viewer' NOT NULL,
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        last_login TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fleets (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status fleet_status DEFAULT 'active' NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS trucks (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        fleet_id INTEGER REFERENCES fleets(id),
        truck_number VARCHAR(50) NOT NULL,
        vin VARCHAR(17),
        make VARCHAR(100),
        model VARCHAR(100),
        year INTEGER,
        status truck_status DEFAULT 'active' NOT NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        last_location_update TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        UNIQUE(organization_id, truck_number)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        truck_id INTEGER REFERENCES trucks(id),
        serial_number VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255),
        firmware_version VARCHAR(50),
        status device_status DEFAULT 'offline' NOT NULL,
        last_seen TIMESTAMP WITH TIME ZONE,
        ip_address VARCHAR(45),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_snapshots (
        id SERIAL PRIMARY KEY,
        device_id INTEGER NOT NULL REFERENCES devices(id),
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        battery_soc DOUBLE PRECISION,
        battery_voltage DOUBLE PRECISION,
        battery_current DOUBLE PRECISION,
        battery_temperature DOUBLE PRECISION,
        solar_power DOUBLE PRECISION,
        solar_voltage DOUBLE PRECISION,
        solar_current DOUBLE PRECISION,
        load_power DOUBLE PRECISION,
        load_voltage DOUBLE PRECISION,
        load_current DOUBLE PRECISION,
        raw_data JSONB
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_measurements (
        id SERIAL PRIMARY KEY,
        device_id INTEGER NOT NULL REFERENCES devices(id),
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        measurement_type VARCHAR(50) NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        unit VARCHAR(20)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_statistics (
        id SERIAL PRIMARY KEY,
        device_id INTEGER NOT NULL REFERENCES devices(id),
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        total_charge_wh DOUBLE PRECISION,
        total_discharge_wh DOUBLE PRECISION,
        min_voltage DOUBLE PRECISION,
        max_voltage DOUBLE PRECISION,
        min_current DOUBLE PRECISION,
        max_current DOUBLE PRECISION,
        total_cycles INTEGER,
        raw_data JSONB
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        device_id INTEGER REFERENCES devices(id),
        truck_id INTEGER REFERENCES trucks(id),
        severity alert_severity NOT NULL,
        status alert_status DEFAULT 'active' NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        acknowledged_at TIMESTAMP WITH TIME ZONE,
        resolved_at TIMESTAMP WITH TIME ZONE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fuel_prices (
        id SERIAL PRIMARY KEY,
        region VARCHAR(50) NOT NULL,
        price_per_gallon DOUBLE PRECISION NOT NULL,
        effective_date DATE NOT NULL,
        source VARCHAR(100) DEFAULT 'EIA' NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        UNIQUE(region, effective_date)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS savings_config (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) UNIQUE,
        diesel_kwh_per_gallon DOUBLE PRECISION DEFAULT 9.0 NOT NULL,
        custom_fuel_price DOUBLE PRECISION,
        use_regional_pricing BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sims (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        device_id INTEGER REFERENCES devices(id),
        truck_id INTEGER REFERENCES trucks(id),
        iccid VARCHAR(22) NOT NULL UNIQUE,
        msisdn VARCHAR(20),
        imsi VARCHAR(15),
        status VARCHAR(50) DEFAULT 'active' NOT NULL,
        carrier VARCHAR(100),
        data_plan VARCHAR(100),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        location_accuracy INTEGER,
        last_location_update TIMESTAMP WITH TIME ZONE,
        data_usage_mb DOUBLE PRECISION DEFAULT 0,
        data_limit_mb DOUBLE PRECISION,
        billing_cycle_start DATE,
        simpro_id VARCHAR(100),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sim_location_history (
        id SERIAL PRIMARY KEY,
        sim_id INTEGER NOT NULL REFERENCES sims(id),
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        accuracy INTEGER,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sim_usage_history (
        id SERIAL PRIMARY KEY,
        sim_id INTEGER NOT NULL REFERENCES sims(id),
        organization_id INTEGER NOT NULL REFERENCES organizations(id),
        usage_mb DOUBLE PRECISION NOT NULL,
        period_start TIMESTAMP WITH TIME ZONE NOT NULL,
        period_end TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sim_sync_settings (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) UNIQUE,
        location_sync_interval INTEGER DEFAULT 300 NOT NULL,
        usage_sync_interval INTEGER DEFAULT 3600 NOT NULL,
        usage_alert_threshold DOUBLE PRECISION DEFAULT 80 NOT NULL,
        enabled BOOLEAN DEFAULT TRUE NOT NULL,
        last_sync TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    // Session table for connect-pg-simple
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" VARCHAR NOT NULL COLLATE "default",
        "sess" JSON NOT NULL,
        "expire" TIMESTAMP(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    console.log("[Migrations] Tables created!");

    // Create indexes
    console.log("[Migrations] Creating indexes...");
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fleets_org ON fleets(organization_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_trucks_org ON trucks(organization_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_trucks_fleet ON trucks(fleet_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_devices_org ON devices(organization_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_devices_truck ON devices(truck_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_device ON device_snapshots(device_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_org ON device_snapshots(organization_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON device_snapshots(timestamp);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_measurements_device ON device_measurements(device_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(organization_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sims_org ON sims(organization_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sims_device ON sims(device_id);`);
    console.log("[Migrations] Indexes created!");

    console.log("[Migrations] ✅ Startup migrations completed successfully!");
    return true;

  } catch (error) {
    console.error("[Migrations] ❌ Migration failed:", error);
    return false;
  }
}
