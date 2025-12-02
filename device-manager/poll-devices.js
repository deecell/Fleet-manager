const path = require('path');
const powermon = require(path.join(__dirname, 'build/Release/powermon_addon.node'));
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function pollDevice(applinkUrl, serial, deviceId) {
  console.log('\n=== Polling', serial, '===');
  
  try {
    const parsed = powermon.PowermonDevice.parseAccessURL(applinkUrl);
    const device = new powermon.PowermonDevice();
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 15000);
      
      device.connect({
        accessKey: parsed.accessKey,
        onConnect: async () => {
          clearTimeout(timeout);
          console.log('Connected!');
          
          await new Promise(r => setTimeout(r, 500));
          
          device.getMonitorData(async (result) => {
            if (!result.success) {
              console.log('  Poll failed, code:', result.code);
              device.disconnect();
              resolve(null);
              return;
            }
            
            const monitor = result.data;
            console.log('Monitor Data:');
            console.log('  Voltage:', monitor.voltage1?.toFixed(2), 'V');
            console.log('  Current:', monitor.current?.toFixed(2), 'A');
            console.log('  Power:', monitor.power?.toFixed(2), 'W');
            console.log('  Temperature:', monitor.temperature?.toFixed(1), '°C');
            console.log('  SOC:', monitor.soc, '%');
            console.log('  Energy (Wh):', monitor.energyMeter?.toFixed(2));
            console.log('  Charge (Ah):', monitor.coulombMeter?.toFixed(2));
            console.log('  Runtime:', monitor.runtime, 'sec');
            console.log('  Power Status:', monitor.powerStatusString);
            
            const now = new Date();
            await pool.query(`
              UPDATE device_snapshots 
              SET voltage1 = $1, current = $2, power = $3, temperature = $4, 
                  soc = $5, energy = $6, charge = $7, runtime = $8, 
                  power_status = $9, power_status_string = $10, updated_at = $11
              WHERE device_id = $12
            `, [
              monitor.voltage1, monitor.current, monitor.power, monitor.temperature,
              monitor.soc, monitor.energyMeter, monitor.coulombMeter, monitor.runtime,
              monitor.powerStatus, monitor.powerStatusString, now, deviceId
            ]);
            
            console.log('  ✓ Database updated');
            
            device.disconnect();
            resolve(monitor);
          });
        },
        onDisconnect: (reason) => {
          clearTimeout(timeout);
          reject(new Error('Disconnected: ' + reason));
        }
      });
    });
  } catch (err) {
    console.log('Error:', err.message);
  }
}

async function main() {
  try {
    const devices = await pool.query(`
      SELECT d.id as device_id, d.serial_number, dc.applink_url, d.device_name as name
      FROM power_mon_devices d 
      JOIN device_credentials dc ON dc.device_id = d.id AND dc.is_active = true
      WHERE d.organization_id = 9 AND d.status = 'online'
    `);
    
    console.log('Found', devices.rows.length, 'devices to poll');
    
    for (const dev of devices.rows) {
      await pollDevice(dev.applink_url, dev.serial_number, dev.device_id);
    }
    
    const result = await pool.query('SELECT AVG(soc) as avg_soc FROM device_snapshots WHERE organization_id = 9');
    console.log('\n=== Fleet Stats ===');
    console.log('Avg SOC:', Number(result.rows[0].avg_soc).toFixed(2) + '%');
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
