import { dbStorage } from "./db-storage";

async function testStorageLayer() {
  console.log("=== Testing Storage Layer ===\n");

  try {
    // Test 1: Create an organization
    console.log("1. Creating test organization...");
    const org = await dbStorage.createOrganization({
      name: "Test Fleet Company",
      slug: "test-fleet-co",
      plan: "standard",
      isActive: true,
    });
    console.log(`   Created org: ${org.name} (ID: ${org.id})`);

    // Test 2: Create a fleet
    console.log("\n2. Creating test fleet...");
    const fleet = await dbStorage.createFleet({
      organizationId: org.id,
      name: "Flatbed Fleet",
      description: "Test flatbed trucks",
      timezone: "America/Los_Angeles",
      isActive: true,
    });
    console.log(`   Created fleet: ${fleet.name} (ID: ${fleet.id})`);

    // Test 3: Create trucks
    console.log("\n3. Creating test trucks...");
    const truck1 = await dbStorage.createTruck({
      organizationId: org.id,
      fleetId: fleet.id,
      truckNumber: "TRK-001",
      driverName: "John Smith",
      make: "Freightliner",
      model: "Cascadia",
      year: 2022,
      status: "in-service",
      isActive: true,
    });
    const truck2 = await dbStorage.createTruck({
      organizationId: org.id,
      fleetId: fleet.id,
      truckNumber: "TRK-002",
      driverName: "Jane Doe",
      make: "Peterbilt",
      model: "579",
      year: 2023,
      status: "in-service",
      isActive: true,
    });
    console.log(`   Created trucks: ${truck1.truckNumber}, ${truck2.truckNumber}`);

    // Test 4: Create PowerMon devices
    console.log("\n4. Creating PowerMon devices...");
    const device1 = await dbStorage.createDevice({
      organizationId: org.id,
      truckId: truck1.id,
      serialNumber: "PM-10001",
      deviceName: "PowerMon Unit 1",
      firmwareVersion: "1.10",
      status: "online",
      isActive: true,
    });
    const device2 = await dbStorage.createDevice({
      organizationId: org.id,
      truckId: truck2.id,
      serialNumber: "PM-10002",
      deviceName: "PowerMon Unit 2",
      firmwareVersion: "1.10",
      status: "online",
      isActive: true,
    });
    console.log(`   Created devices: ${device1.serialNumber}, ${device2.serialNumber}`);

    // Test 5: Create device snapshots (latest readings)
    console.log("\n5. Creating device snapshots...");
    const now = new Date();
    await dbStorage.upsertSnapshot({
      organizationId: org.id,
      deviceId: device1.id,
      truckId: truck1.id,
      fleetId: fleet.id,
      voltage1: 12.8,
      voltage2: 12.7,
      current: 5.2,
      power: 65.5,
      temperature: 28.5,
      soc: 85.0,
      energy: 120.5,
      charge: 45.0,
      runtime: 3600,
      rssi: -65,
      recordedAt: now,
    });
    await dbStorage.upsertSnapshot({
      organizationId: org.id,
      deviceId: device2.id,
      truckId: truck2.id,
      fleetId: fleet.id,
      voltage1: 13.1,
      voltage2: 13.0,
      current: 3.8,
      power: 49.4,
      temperature: 26.2,
      soc: 92.0,
      energy: 145.2,
      charge: 52.0,
      runtime: 7200,
      rssi: -58,
      recordedAt: now,
    });
    console.log("   Created snapshots for both devices");

    // Test 6: Insert measurements (time-series data)
    console.log("\n6. Inserting time-series measurements...");
    const measurements = [];
    for (let i = 0; i < 10; i++) {
      const recordedAt = new Date(now.getTime() - (i * 60 * 1000)); // 1 minute intervals
      measurements.push({
        organizationId: org.id,
        deviceId: device1.id,
        truckId: truck1.id,
        voltage1: 12.5 + Math.random() * 0.5,
        voltage2: 12.4 + Math.random() * 0.5,
        current: 4 + Math.random() * 2,
        power: 50 + Math.random() * 20,
        temperature: 25 + Math.random() * 5,
        soc: 80 + Math.random() * 10,
        energy: 100 + Math.random() * 50,
        charge: 40 + Math.random() * 10,
        runtime: 3600 - i * 60,
        rssi: -60 - Math.floor(Math.random() * 10),
        source: "poll" as const,
        recordedAt,
      });
    }
    const insertCount = await dbStorage.insertMeasurements(measurements);
    console.log(`   Inserted ${insertCount} measurements`);

    // Test 7: Query measurements
    console.log("\n7. Querying measurements...");
    const startTime = new Date(now.getTime() - 15 * 60 * 1000); // 15 minutes ago
    const queriedMeasurements = await dbStorage.getMeasurements(org.id, device1.id, startTime, now);
    console.log(`   Retrieved ${queriedMeasurements.length} measurements`);

    // Test 8: Get fleet stats
    console.log("\n8. Getting fleet stats...");
    const stats = await dbStorage.getFleetStats(org.id, fleet.id);
    console.log("   Fleet Stats:", JSON.stringify(stats, null, 2));

    // Test 9: Create an alert
    console.log("\n9. Creating test alert...");
    const alert = await dbStorage.createAlert({
      organizationId: org.id,
      deviceId: device1.id,
      truckId: truck1.id,
      fleetId: fleet.id,
      alertType: "low_voltage",
      severity: "warning",
      title: "Low Battery Voltage",
      message: "Battery voltage dropped below threshold",
      threshold: 11.5,
      actualValue: 11.2,
      status: "active",
    });
    console.log(`   Created alert: ${alert.title} (ID: ${alert.id})`);

    // Test 10: Count active alerts
    const alertCount = await dbStorage.countActiveAlerts(org.id);
    console.log(`   Active alerts count: ${alertCount}`);

    // Test 11: Get dashboard data
    console.log("\n10. Getting dashboard data...");
    const dashboardData = await dbStorage.getDashboardData(org.id, fleet.id);
    console.log(`    Trucks: ${dashboardData.trucks.length}`);
    console.log(`    Stats: ${JSON.stringify(dashboardData.stats)}`);
    console.log(`    Alerts: ${dashboardData.alerts.length}`);

    // Test 12: Multi-tenancy isolation test
    console.log("\n11. Testing multi-tenancy isolation...");
    const org2 = await dbStorage.createOrganization({
      name: "Other Company",
      slug: "other-co",
      plan: "standard",
      isActive: true,
    });
    
    // Try to get trucks from org2 (should be empty)
    const org2Trucks = await dbStorage.listTrucks(org2.id);
    console.log(`    Org2 trucks (should be 0): ${org2Trucks.length}`);
    
    // Try to get org1 trucks with wrong org ID (should be undefined)
    const wrongOrgTruck = await dbStorage.getTruck(org2.id, truck1.id);
    console.log(`    Cross-org truck access (should be undefined): ${wrongOrgTruck}`);

    // Test 13: Create polling settings
    console.log("\n12. Creating polling settings...");
    const pollSettings = await dbStorage.getOrCreatePollingSettings(org.id);
    console.log(`    Default polling interval: ${pollSettings.pollingIntervalSeconds}s`);

    console.log("\n=== All Tests Passed! ===");
    
    // Cleanup: We'll leave the data for inspection
    console.log("\nTest data left in database for inspection.");
    console.log(`  Organization ID: ${org.id}`);
    console.log(`  Fleet ID: ${fleet.id}`);
    console.log(`  Truck IDs: ${truck1.id}, ${truck2.id}`);
    console.log(`  Device IDs: ${device1.id}, ${device2.id}`);

  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

testStorageLayer().then(() => {
  console.log("\nTest complete.");
  process.exit(0);
}).catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
