/**
 * SIM Sync Service
 * 
 * Synchronizes SIM data from SIMPro API:
 * 1. Fetches all SIMs and matches to PowerMon devices by name
 * 2. Polls SIM locations and updates truck positions
 * 3. Tracks data usage for alerting (not displayed in UI)
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import {
  sims,
  simLocationHistory,
  simUsageHistory,
  simSyncSettings,
  trucks,
  powerMonDevices,
  alerts,
  ALERT_TYPES,
  ALERT_SEVERITY,
  type Sim,
  type InsertSim,
  type InsertSimLocationHistory,
} from '@shared/schema';
import {
  SimProClient,
  createSimProClient,
  type SimProSim,
  type SimProSimDetails,
  type SimProLocation,
} from './simpro-client';

export interface SimSyncResult {
  simsFound: number;
  simsMatched: number;
  simsCreated: number;
  simsUpdated: number;
  errors: string[];
}

export interface LocationSyncResult {
  simsProcessed: number;
  locationsUpdated: number;
  trucksUpdated: number;
  errors: string[];
}

export interface UsageSyncResult {
  simsProcessed: number;
  alertsGenerated: number;
  errors: string[];
}

export class SimSyncService {
  private client: SimProClient | null = null;

  constructor() {
    this.client = createSimProClient();
  }

  /**
   * Check if the service is configured and ready
   */
  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Test connection to SIMPro API
   */
  async testConnection(): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    return this.client.testConnection();
  }

  /**
   * Sync all SIMs from SIMPro and match to PowerMon devices
   */
  async syncSims(organizationId: number): Promise<SimSyncResult> {
    const result: SimSyncResult = {
      simsFound: 0,
      simsMatched: 0,
      simsCreated: 0,
      simsUpdated: 0,
      errors: [],
    };

    if (!this.client) {
      result.errors.push('SIMPro API not configured');
      return result;
    }

    try {
      // Fetch all SIMs from SIMPro
      const simProResponse = await this.client.getSims({ limit: 2000 });
      result.simsFound = simProResponse.sim_count;

      // Get all devices for this organization to match by name
      const devices = await db
        .select()
        .from(powerMonDevices)
        .where(eq(powerMonDevices.organizationId, organizationId));

      const devicesByName = new Map<string, typeof devices[0]>();
      for (const device of devices) {
        if (device.deviceName) {
          devicesByName.set(device.deviceName.toLowerCase(), device);
        }
      }

      // Process each SIM with rate limiting (100ms delay between API calls)
      for (const simProSim of simProResponse.sims) {
        try {
          // Small delay to avoid API rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Get detailed SIM info to access custom fields
          const simDetails = await this.client.getSimDetails(simProSim.msisdn);
          
          // The device name is stored in custom_field1 in SIMPro
          const deviceName = simDetails.custom_field1 || simDetails.custom_field2;
          
          // Try to match to a PowerMon device
          let matchedDevice = null;
          let matchedTruck = null;
          
          if (deviceName) {
            matchedDevice = devicesByName.get(deviceName.toLowerCase());
            if (matchedDevice) {
              result.simsMatched++;
              // Get the truck associated with this device
              if (matchedDevice.truckId) {
                const [truck] = await db
                  .select()
                  .from(trucks)
                  .where(eq(trucks.id, matchedDevice.truckId));
                matchedTruck = truck;
              }
            }
          }

          // Check if SIM already exists in our database
          const [existingSim] = await db
            .select()
            .from(sims)
            .where(eq(sims.iccid, simProSim.iccid));

          const simData: InsertSim = {
            organizationId,
            deviceId: matchedDevice?.id || null,
            truckId: matchedTruck?.id || null,
            simproId: simProSim.id,
            iccid: simProSim.iccid,
            msisdn: simProSim.msisdn,
            imsi: simProSim.imsi || null,
            eid: simProSim.eid || null,
            deviceName: deviceName || null,
            status: simProSim.status,
            workflowStatus: simProSim.workflow_status || null,
            ipAddress: simDetails.ip_address || null,
            isActive: true,
          };

          if (existingSim) {
            // Update existing SIM
            await db
              .update(sims)
              .set({
                ...simData,
                lastSyncAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(sims.id, existingSim.id));
            result.simsUpdated++;
          } else {
            // Create new SIM
            await db.insert(sims).values(simData);
            result.simsCreated++;
          }

        } catch (error) {
          result.errors.push(
            `Error processing SIM ${simProSim.msisdn}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Update sync settings timestamp
      await this.updateSyncTimestamp(organizationId, 'sim');

    } catch (error) {
      result.errors.push(
        `Error fetching SIMs from SIMPro: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return result;
  }

  /**
   * Sync locations for all SIMs and update truck positions
   */
  async syncLocations(organizationId: number): Promise<LocationSyncResult> {
    const result: LocationSyncResult = {
      simsProcessed: 0,
      locationsUpdated: 0,
      trucksUpdated: 0,
      errors: [],
    };

    if (!this.client) {
      result.errors.push('SIMPro API not configured');
      return result;
    }

    try {
      // Get all SIMs for this organization that have MSISDN
      const orgSims = await db
        .select()
        .from(sims)
        .where(
          and(
            eq(sims.organizationId, organizationId),
            eq(sims.isActive, true)
          )
        );

      for (const sim of orgSims) {
        if (!sim.msisdn) continue;
        result.simsProcessed++;

        try {
          // Get location from SIMPro
          const location = await this.client.getSimLocation(sim.msisdn);

          if (location.latitude && location.longitude) {
            // Update SIM record with new location
            await db
              .update(sims)
              .set({
                latitude: location.latitude,
                longitude: location.longitude,
                locationAccuracy: location.accuracy || null,
                lastLocationUpdate: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(sims.id, sim.id));
            result.locationsUpdated++;

            // Store location history
            const locationRecord: InsertSimLocationHistory = {
              organizationId,
              simId: sim.id,
              truckId: sim.truckId,
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy || null,
              source: 'cell_tower',
              recordedAt: new Date(),
            };
            await db.insert(simLocationHistory).values(locationRecord);

            // Update truck location if linked
            if (sim.truckId) {
              await db
                .update(trucks)
                .set({
                  latitude: location.latitude,
                  longitude: location.longitude,
                  lastLocationUpdate: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(trucks.id, sim.truckId));
              result.trucksUpdated++;
            }
          }

        } catch (error) {
          result.errors.push(
            `Error getting location for SIM ${sim.msisdn}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Update sync settings timestamp
      await this.updateSyncTimestamp(organizationId, 'location');

    } catch (error) {
      result.errors.push(
        `Error syncing locations: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return result;
  }

  /**
   * Sync usage data for all SIMs and generate alerts if thresholds exceeded
   */
  async syncUsage(organizationId: number): Promise<UsageSyncResult> {
    const result: UsageSyncResult = {
      simsProcessed: 0,
      alertsGenerated: 0,
      errors: [],
    };

    if (!this.client) {
      result.errors.push('SIMPro API not configured');
      return result;
    }

    try {
      // Get sync settings for alert threshold
      const [syncSettings] = await db
        .select()
        .from(simSyncSettings)
        .where(eq(simSyncSettings.organizationId, organizationId));

      const alertThreshold = syncSettings?.dataUsageAlertThresholdPercent || 80;

      // Get all active SIMs
      const orgSims = await db
        .select()
        .from(sims)
        .where(
          and(
            eq(sims.organizationId, organizationId),
            eq(sims.isActive, true)
          )
        );

      for (const sim of orgSims) {
        if (!sim.msisdn) continue;
        result.simsProcessed++;

        try {
          // Get usage from SIMPro
          const usage = await this.client.getSimUsage(sim.msisdn);

          if (usage.data_used_mb !== undefined) {
            // Update SIM with usage data
            await db
              .update(sims)
              .set({
                dataUsedMb: usage.data_used_mb,
                dataLimitMb: usage.data_limit_mb || null,
                lastUsageUpdate: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(sims.id, sim.id));

            // Store usage history
            await db.insert(simUsageHistory).values({
              organizationId,
              simId: sim.id,
              dataUsedMb: usage.data_used_mb,
              smsCount: usage.sms_used || 0,
              period: usage.billing_period_start || null,
              recordedAt: new Date(),
            });

            // Check if we need to generate an alert
            if (usage.data_limit_mb && usage.data_limit_mb > 0) {
              const usagePercent = (usage.data_used_mb / usage.data_limit_mb) * 100;
              
              if (usagePercent >= alertThreshold) {
                // Generate data usage alert - deviceId and truckId can be null
                await db.insert(alerts).values({
                  organizationId,
                  deviceId: sim.deviceId || null,
                  truckId: sim.truckId || null,
                  fleetId: null,
                  alertType: 'high_data_usage',
                  severity: usagePercent >= 90 ? ALERT_SEVERITY.CRITICAL : ALERT_SEVERITY.WARNING,
                  title: `High Data Usage: ${sim.deviceName || sim.msisdn}`,
                  message: `SIM data usage at ${usagePercent.toFixed(1)}% (${usage.data_used_mb.toFixed(1)}MB / ${usage.data_limit_mb}MB)`,
                  threshold: alertThreshold,
                  actualValue: usagePercent,
                  status: 'active',
                });
                result.alertsGenerated++;
              }
            }
          }

        } catch (error) {
          result.errors.push(
            `Error getting usage for SIM ${sim.msisdn}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Update sync settings timestamp
      await this.updateSyncTimestamp(organizationId, 'usage');

    } catch (error) {
      result.errors.push(
        `Error syncing usage: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return result;
  }

  /**
   * Get all SIMs for an organization
   */
  async getSimsForOrganization(organizationId: number): Promise<Sim[]> {
    return db
      .select()
      .from(sims)
      .where(eq(sims.organizationId, organizationId));
  }

  /**
   * Get location history for a SIM
   */
  async getLocationHistory(
    simId: number,
    limit: number = 100
  ): Promise<typeof simLocationHistory.$inferSelect[]> {
    return db
      .select()
      .from(simLocationHistory)
      .where(eq(simLocationHistory.simId, simId))
      .orderBy(simLocationHistory.recordedAt)
      .limit(limit);
  }

  /**
   * Update sync timestamp in settings
   */
  private async updateSyncTimestamp(
    organizationId: number,
    syncType: 'sim' | 'location' | 'usage'
  ): Promise<void> {
    const now = new Date();
    const updateData: Partial<typeof simSyncSettings.$inferSelect> = {
      updatedAt: now,
    };

    switch (syncType) {
      case 'sim':
        updateData.lastSimSyncAt = now;
        break;
      case 'location':
        updateData.lastLocationSyncAt = now;
        break;
      case 'usage':
        updateData.lastUsageSyncAt = now;
        break;
    }

    // Upsert sync settings
    const [existing] = await db
      .select()
      .from(simSyncSettings)
      .where(eq(simSyncSettings.organizationId, organizationId));

    if (existing) {
      await db
        .update(simSyncSettings)
        .set(updateData)
        .where(eq(simSyncSettings.id, existing.id));
    } else {
      await db.insert(simSyncSettings).values({
        organizationId,
        ...updateData,
      });
    }
  }
}

// Singleton instance
let simSyncServiceInstance: SimSyncService | null = null;

export function getSimSyncService(): SimSyncService {
  if (!simSyncServiceInstance) {
    simSyncServiceInstance = new SimSyncService();
  }
  return simSyncServiceInstance;
}
