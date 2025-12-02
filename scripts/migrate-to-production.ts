import { db } from "../server/db";
import { 
  organizations, 
  users, 
  fleets, 
  trucks, 
  powerMonDevices,
  deviceSnapshots,
  deviceMeasurements,
  deviceStatistics,
  deviceCredentials,
  pollingSettings,
  savingsConfig,
  fuelPrices,
  alerts
} from "../shared/schema";
import { asc } from "drizzle-orm";
import * as fs from "fs";

async function exportData() {
  console.log("🚀 Starting data export for production migration...\n");

  const statements: string[] = [];
  
  // Helper to escape SQL strings
  const escape = (val: any): string => {
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
    if (typeof val === "number") return String(val);
    if (val instanceof Date) return `'${val.toISOString()}'`;
    if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  // Helper to generate INSERT statement
  const generateInsert = (table: string, data: Record<string, any>[]): string[] => {
    if (data.length === 0) return [];
    
    return data.map(row => {
      const columns = Object.keys(row).filter(k => row[k] !== undefined);
      const values = columns.map(k => escape(row[k]));
      return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")}) ON CONFLICT DO NOTHING;`;
    });
  };

  try {
    // 1. Organizations (no dependencies)
    console.log("📦 Exporting organizations...");
    const orgs = await db.select().from(organizations).orderBy(asc(organizations.id));
    statements.push("-- Organizations");
    statements.push(...generateInsert("organizations", orgs));
    console.log(`   ✓ ${orgs.length} organizations`);

    // 2. Users (depends on organizations)
    console.log("👤 Exporting users...");
    const userList = await db.select().from(users).orderBy(asc(users.id));
    statements.push("\n-- Users");
    statements.push(...generateInsert("users", userList));
    console.log(`   ✓ ${userList.length} users`);

    // 3. Fleets (depends on organizations)
    console.log("🚛 Exporting fleets...");
    const fleetList = await db.select().from(fleets).orderBy(asc(fleets.id));
    statements.push("\n-- Fleets");
    statements.push(...generateInsert("fleets", fleetList));
    console.log(`   ✓ ${fleetList.length} fleets`);

    // 4. Trucks (depends on fleets, organizations)
    console.log("🚚 Exporting trucks...");
    const truckList = await db.select().from(trucks).orderBy(asc(trucks.id));
    statements.push("\n-- Trucks");
    statements.push(...generateInsert("trucks", truckList));
    console.log(`   ✓ ${truckList.length} trucks`);

    // 5. PowerMon Devices (depends on trucks, organizations)
    console.log("📡 Exporting devices...");
    const deviceList = await db.select().from(powerMonDevices).orderBy(asc(powerMonDevices.id));
    statements.push("\n-- PowerMon Devices");
    statements.push(...generateInsert("power_mon_devices", deviceList));
    console.log(`   ✓ ${deviceList.length} devices`);

    // 6. Device Credentials (depends on devices)
    console.log("🔑 Exporting device credentials...");
    const credsList = await db.select().from(deviceCredentials);
    statements.push("\n-- Device Credentials");
    statements.push(...generateInsert("device_credentials", credsList));
    console.log(`   ✓ ${credsList.length} credentials`);

    // 7. Device Snapshots (depends on devices, trucks, organizations)
    console.log("📸 Exporting snapshots...");
    const snapshotList = await db.select().from(deviceSnapshots);
    statements.push("\n-- Device Snapshots");
    statements.push(...generateInsert("device_snapshots", snapshotList));
    console.log(`   ✓ ${snapshotList.length} snapshots`);

    // 8. Device Measurements (depends on devices, trucks, organizations)
    console.log("📊 Exporting measurements...");
    const measurementList = await db.select().from(deviceMeasurements);
    statements.push("\n-- Device Measurements");
    statements.push(...generateInsert("device_measurements", measurementList));
    console.log(`   ✓ ${measurementList.length} measurements`);

    // 9. Device Statistics (depends on devices, organizations)
    console.log("📈 Exporting statistics...");
    const statsList = await db.select().from(deviceStatistics);
    statements.push("\n-- Device Statistics");
    statements.push(...generateInsert("device_statistics", statsList));
    console.log(`   ✓ ${statsList.length} statistics`);

    // 10. Polling Settings (depends on organizations)
    console.log("⚙️ Exporting polling settings...");
    const pollingList = await db.select().from(pollingSettings);
    statements.push("\n-- Polling Settings");
    statements.push(...generateInsert("polling_settings", pollingList));
    console.log(`   ✓ ${pollingList.length} polling settings`);

    // 11. Savings Config (depends on organizations)
    console.log("💰 Exporting savings config...");
    const savingsList = await db.select().from(savingsConfig);
    statements.push("\n-- Savings Config");
    statements.push(...generateInsert("savings_config", savingsList));
    console.log(`   ✓ ${savingsList.length} savings configs`);

    // 12. Fuel Prices
    console.log("⛽ Exporting fuel prices...");
    const fuelList = await db.select().from(fuelPrices);
    statements.push("\n-- Fuel Prices");
    statements.push(...generateInsert("fuel_prices", fuelList));
    console.log(`   ✓ ${fuelList.length} fuel prices`);

    // 13. Alerts (depends on trucks, organizations)
    console.log("🚨 Exporting alerts...");
    const alertList = await db.select().from(alerts);
    statements.push("\n-- Alerts");
    statements.push(...generateInsert("alerts", alertList));
    console.log(`   ✓ ${alertList.length} alerts`);

    // Reset sequences to avoid ID conflicts
    statements.push("\n-- Reset sequences");
    statements.push(`SELECT setval('organizations_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM organizations), false);`);
    statements.push(`SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM users), false);`);
    statements.push(`SELECT setval('fleets_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM fleets), false);`);
    statements.push(`SELECT setval('trucks_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM trucks), false);`);
    statements.push(`SELECT setval('power_mon_devices_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM power_mon_devices), false);`);
    statements.push(`SELECT setval('device_measurements_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM device_measurements), false);`);
    statements.push(`SELECT setval('alerts_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM alerts), false);`);

    // Write to file
    const sql = statements.join("\n");
    const outputPath = "scripts/production-migration.sql";
    fs.writeFileSync(outputPath, sql);
    
    console.log(`\n✅ Export complete!`);
    console.log(`📄 SQL file written to: ${outputPath}`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Connect to your AWS RDS database`);
    console.log(`   2. Run the schema migration first: npm run db:push`);
    console.log(`   3. Execute the SQL file: psql -h <RDS_ENDPOINT> -U postgres -d deecell_fleet -f ${outputPath}`);
    
  } catch (error) {
    console.error("❌ Export failed:", error);
    process.exit(1);
  }

  process.exit(0);
}

exportData();
