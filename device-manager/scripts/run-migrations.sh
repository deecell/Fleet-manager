#!/bin/bash
set -e

export DATABASE_URL="postgresql://deecell_admin:yDuUAs2pv4y12kS3@deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432/deecell_fleet"

cat > /tmp/init.sql << 'SQLEOF'
-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'viewer',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Fleets table
CREATE TABLE IF NOT EXISTS fleets (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Trucks table
CREATE TABLE IF NOT EXISTS trucks (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  fleet_id INTEGER REFERENCES fleets(id),
  truck_number VARCHAR(50) NOT NULL,
  vin VARCHAR(50),
  make VARCHAR(100),
  model VARCHAR(100),
  year INTEGER,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  status VARCHAR(50) DEFAULT 'offline',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  truck_id INTEGER REFERENCES trucks(id),
  serial_number VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255),
  powermon_mode VARCHAR(50) DEFAULT 'wifi',
  wifi_host VARCHAR(255),
  status VARCHAR(50) DEFAULT 'offline',
  is_active BOOLEAN DEFAULT true,
  firmware_version VARCHAR(50),
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Snapshots table for real-time device data
CREATE TABLE IF NOT EXISTS snapshots (
  id SERIAL PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id),
  timestamp TIMESTAMP NOT NULL,
  soc DECIMAL(5, 2),
  voltage DECIMAL(10, 3),
  current DECIMAL(10, 3),
  power DECIMAL(10, 3),
  temperature DECIMAL(5, 2),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Device statistics table
CREATE TABLE IF NOT EXISTS device_statistics (
  id SERIAL PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id),
  timestamp TIMESTAMP NOT NULL,
  total_charge_ah DECIMAL(12, 3),
  total_discharge_ah DECIMAL(12, 3),
  max_voltage DECIMAL(10, 3),
  min_voltage DECIMAL(10, 3),
  max_current DECIMAL(10, 3),
  min_current DECIMAL(10, 3),
  max_temperature DECIMAL(5, 2),
  min_temperature DECIMAL(5, 2),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  device_id INTEGER REFERENCES devices(id),
  truck_id INTEGER REFERENCES trucks(id),
  severity VARCHAR(50) NOT NULL,
  type VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create default organization
INSERT INTO organizations (name, slug) 
VALUES ('Deecell Fleet', 'deecell')
ON CONFLICT (slug) DO NOTHING;

-- Create admin user (password: admin123)
INSERT INTO users (organization_id, email, password_hash, name, role)
SELECT 1, 'admin@deecell.com', '$2a$10$gKzBYjdP5vF8h0TKzGrJ.eYL.6h1Wd2i/VZrb5aXz0YWXmM9nQXXq', 'Admin User', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@deecell.com');

SQLEOF

psql "$DATABASE_URL" < /tmp/init.sql
echo "Migration complete"
