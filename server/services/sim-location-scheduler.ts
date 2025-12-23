import { db } from '../db';
import { sims } from '@shared/schema';
import { sql } from 'drizzle-orm';
import { SimSyncService } from './sim-sync-service';

const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

class SimLocationScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private syncService: SimSyncService;

  constructor() {
    this.syncService = new SimSyncService();
  }

  start(): void {
    if (this.intervalId) {
      console.log('[SIM Scheduler] Already running');
      return;
    }

    console.log('[SIM Scheduler] Starting automatic location sync (every 60 seconds)');
    
    // Run immediately on start, then every minute
    this.pollLocations();
    this.intervalId = setInterval(() => this.pollLocations(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[SIM Scheduler] Stopped');
    }
  }

  private async pollLocations(): Promise<void> {
    if (this.isRunning) {
      console.log('[SIM Scheduler] Previous sync still running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Get all unique organization IDs that have active SIMs with ICCIDs
      const orgsWithSims = await db
        .selectDistinct({ organizationId: sims.organizationId })
        .from(sims)
        .where(sql`${sims.isActive} = true AND ${sims.iccid} IS NOT NULL`);

      if (orgsWithSims.length === 0) {
        return; // Silent return if no SIMs to sync
      }

      let totalUpdated = 0;
      let totalErrors = 0;

      for (const { organizationId } of orgsWithSims) {
        try {
          const result = await this.syncService.syncLocations(organizationId);
          totalUpdated += result.locationsUpdated;
          if (result.errors.length > 0) {
            totalErrors += result.errors.length;
            console.warn(`[SIM Scheduler] Org ${organizationId} errors:`, result.errors);
          }
        } catch (error) {
          totalErrors++;
          console.error(`[SIM Scheduler] Failed to sync org ${organizationId}:`, error);
        }
      }

      const duration = Date.now() - startTime;
      if (totalUpdated > 0 || totalErrors > 0) {
        console.log(
          `[SIM Scheduler] Sync complete: ${totalUpdated} locations updated, ${totalErrors} errors (${duration}ms)`
        );
      }
    } catch (error) {
      console.error('[SIM Scheduler] Poll failed:', error);
    } finally {
      this.isRunning = false;
    }
  }
}

// Export singleton instance
export const simLocationScheduler = new SimLocationScheduler();
