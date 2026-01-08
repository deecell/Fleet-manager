-- =============================================================================
-- SHELLY DEVICES PRODUCTION MIGRATION
-- Run via CloudShell with: psql $DATABASE_URL -f shelly_devices_production.sql
-- =============================================================================

-- Create shelly_devices table
CREATE TABLE IF NOT EXISTS shelly_devices (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
    device_id VARCHAR(64) NOT NULL UNIQUE,
    device_name VARCHAR(128),
    device_model VARCHAR(64) DEFAULT 'Plus Uni',
    ip_address VARCHAR(45),
    firmware_version VARCHAR(32),
    last_seen_at TIMESTAMP,
    connection_status VARCHAR(20) DEFAULT 'offline',
    last_frequency REAL DEFAULT 0,
    is_moving BOOLEAN DEFAULT FALSE,
    movement_threshold REAL DEFAULT 10,
    webhook_secret VARCHAR(64),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for shelly_devices
CREATE INDEX IF NOT EXISTS shelly_device_org_idx ON shelly_devices(organization_id);
CREATE INDEX IF NOT EXISTS shelly_device_truck_idx ON shelly_devices(truck_id);
CREATE INDEX IF NOT EXISTS shelly_device_id_idx ON shelly_devices(device_id);
CREATE INDEX IF NOT EXISTS shelly_device_connection_status_idx ON shelly_devices(organization_id, connection_status);

-- Create shelly_snapshots table
CREATE TABLE IF NOT EXISTS shelly_snapshots (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    shelly_device_id INTEGER NOT NULL REFERENCES shelly_devices(id) ON DELETE CASCADE,
    truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
    frequency REAL DEFAULT 0,
    is_moving BOOLEAN DEFAULT FALSE,
    temperature REAL,
    voltage REAL,
    rssi INTEGER,
    recorded_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for shelly_snapshots
CREATE UNIQUE INDEX IF NOT EXISTS shelly_snapshot_device_idx ON shelly_snapshots(shelly_device_id);
CREATE INDEX IF NOT EXISTS shelly_snapshot_org_idx ON shelly_snapshots(organization_id);

-- Verify tables created
SELECT 'shelly_devices' as table_name, COUNT(*) as row_count FROM shelly_devices
UNION ALL
SELECT 'shelly_snapshots' as table_name, COUNT(*) as row_count FROM shelly_snapshots;
