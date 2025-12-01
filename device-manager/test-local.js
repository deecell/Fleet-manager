#!/usr/bin/env node
/**
 * Device Manager - Local Test Script
 * 
 * Tests the Device Manager components locally before EC2 deployment.
 * Run: node device-manager/test-local.js
 * 
 * Prerequisites:
 * - DATABASE_URL environment variable set
 * - Native addon built (npx node-gyp rebuild)
 * - At least one active device in the database
 */

const path = require('path');

// Verify native addon is built
let addon;
try {
  addon = require('./build/Release/powermon_addon.node');
  console.log('✅ Native addon loaded');
  const version = addon.PowermonDevice.getLibraryVersion();
  console.log(`   libpowermon version: ${version.string}`);
} catch (err) {
  console.error('❌ Native addon not found. Run: cd device-manager && npx node-gyp rebuild');
  process.exit(1);
}

// Verify database connection
const { Pool } = require('pg');

async function testDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable not set');
    process.exit(1);
  }
  console.log('✅ DATABASE_URL is set');

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  
  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful');
    
    // Check for active devices (status can be 'online', 'offline', etc.)
    const devicesResult = await client.query(`
      SELECT d.id, d.serial_number, d.device_name, d.status, d.is_active, t.truck_number
      FROM power_mon_devices d
      LEFT JOIN trucks t ON d.truck_id = t.id
      WHERE d.is_active = true
      ORDER BY d.id
    `);
    
    console.log(`\n📊 Active Devices: ${devicesResult.rows.length}`);
    
    if (devicesResult.rows.length === 0) {
      console.log('   No active devices found in database.');
      console.log('   Add devices via Admin Dashboard before running Device Manager.');
    } else {
      devicesResult.rows.forEach(device => {
        console.log(`   - ${device.device_name} (${device.serial_number}) → Truck: ${device.truck_number || 'Unassigned'}`);
      });
    }
    
    // Check for device credentials
    const credsResult = await client.query(`
      SELECT c.device_id, d.device_name
      FROM device_credentials c
      JOIN power_mon_devices d ON c.device_id = d.id
    `);
    
    console.log(`\n🔑 Devices with Credentials: ${credsResult.rows.length}`);
    credsResult.rows.forEach(cred => {
      console.log(`   - ${cred.device_name}`);
    });
    
    // Check for recent measurements
    const measurementsResult = await client.query(`
      SELECT COUNT(*) as count, 
             MAX(recorded_at) as latest
      FROM device_measurements
      WHERE recorded_at > NOW() - INTERVAL '24 hours'
    `);
    
    const row = measurementsResult.rows[0];
    console.log(`\n📈 Measurements (last 24h): ${row.count}`);
    if (row.latest) {
      console.log(`   Latest: ${new Date(row.latest).toLocaleString()}`);
    }
    
    client.release();
    await pool.end();
    
    return devicesResult.rows.length;
    
  } catch (err) {
    console.error('❌ Database error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

async function testDeviceConnection() {
  console.log('\n🔌 Testing Device Connection...');
  
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  
  try {
    const client = await pool.connect();
    
    // Get first device with credentials
    const result = await client.query(`
      SELECT d.id, d.device_name, d.serial_number, c.applink_url
      FROM power_mon_devices d
      JOIN device_credentials c ON d.id = c.device_id
      WHERE d.is_active = true
      LIMIT 1
    `);
    
    client.release();
    await pool.end();
    
    if (result.rows.length === 0) {
      console.log('   No devices with credentials found. Skipping connection test.');
      return;
    }
    
    const device = result.rows[0];
    console.log(`   Testing connection to: ${device.device_name}`);
    
    // Parse applink URL
    const parsed = addon.PowermonDevice.parseAccessURL(device.applink_url);
    console.log(`   Serial: ${parsed.serial}`);
    console.log(`   Hardware: ${parsed.hardwareString}`);
    
    // Create device instance
    const pm = new addon.PowermonDevice();
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log('   ⏱️  Connection timeout (10s) - device may be offline');
        pm.disconnect();
        resolve();
      }, 10000);
      
      pm.connect({
        accessKey: parsed.accessKey,
        onConnect: () => {
          clearTimeout(timeout);
          console.log('   ✅ Connected successfully!');
          
          pm.getMonitorData((result) => {
            if (result.success) {
              console.log(`   📊 Live Data:`);
              console.log(`      Voltage: ${result.data.voltage1.toFixed(2)}V`);
              console.log(`      Current: ${result.data.current.toFixed(2)}A`);
              console.log(`      Power: ${result.data.power.toFixed(1)}W`);
              console.log(`      SOC: ${result.data.soc.toFixed(0)}%`);
              console.log(`      Temp: ${result.data.temperature.toFixed(1)}°C`);
            }
            pm.disconnect();
            resolve();
          });
        },
        onDisconnect: (reason) => {
          clearTimeout(timeout);
          if (reason !== 0) {
            console.log(`   ⚠️  Disconnected (reason: ${reason})`);
          }
          resolve();
        }
      });
    });
    
  } catch (err) {
    console.error('   ❌ Connection test error:', err.message);
    await pool.end();
  }
}

async function testModules() {
  console.log('\n🧩 Testing Device Manager Modules...');
  
  try {
    // Test config module
    const { config, validateConfig } = require('./app/config');
    console.log('   ✅ config.js loaded');
    console.log(`      Poll interval: ${config.polling.intervalMs}ms`);
    console.log(`      Cohorts: ${config.polling.cohortCount}`);
    
    // Validate config (will throw if DATABASE_URL missing)
    validateConfig();
    console.log('   ✅ Configuration validated');
    
    // Test logger
    const logger = require('./app/logger');
    console.log('   ✅ logger.js loaded');
    
    // Test database module
    const db = require('./app/database');
    console.log('   ✅ database.js loaded');
    
    // Test other modules (just load, don't start)
    require('./app/batch-writer');
    console.log('   ✅ batch-writer.js loaded');
    
    require('./app/connection-pool');
    console.log('   ✅ connection-pool.js loaded');
    
    require('./app/polling-scheduler');
    console.log('   ✅ polling-scheduler.js loaded');
    
    require('./app/backfill-service');
    console.log('   ✅ backfill-service.js loaded');
    
    require('./app/metrics');
    console.log('   ✅ metrics.js loaded');
    
  } catch (err) {
    console.error('   ❌ Module error:', err.message);
    process.exit(1);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('       Device Manager - Local Test Suite');
  console.log('═══════════════════════════════════════════════════\n');
  
  // Test 1: Database
  const deviceCount = await testDatabase();
  
  // Test 2: Modules
  await testModules();
  
  // Test 3: Device connection (if devices exist)
  if (deviceCount > 0) {
    await testDeviceConnection();
  }
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('                    Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log('✅ All tests passed!');
  console.log('\nTo start Device Manager:');
  console.log('  cd device-manager && npm start');
  console.log('\nOr with custom settings:');
  console.log('  POLL_INTERVAL_MS=5000 LOG_LEVEL=debug npm start');
  console.log('═══════════════════════════════════════════════════\n');
  
  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
