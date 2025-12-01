/**
 * Staggered Polling Scheduler
 * 
 * Spreads device polling across the poll interval to avoid thundering herd.
 * Uses a timing wheel approach with cohorts.
 */

const { config } = require('./config');
const logger = require('./logger');
const { connectionPool } = require('./connection-pool');
const batchWriter = require('./batch-writer');

class PollingScheduler {
  constructor() {
    this.isRunning = false;
    this.tickTimer = null;
    this.currentTick = 0;
    this.ticksPerInterval = config.polling.cohortCount;
    this.tickDurationMs = config.polling.intervalMs / this.ticksPerInterval;
    
    this.stats = {
      totalPolls: 0,
      successfulPolls: 0,
      failedPolls: 0,
      ticksProcessed: 0,
      lastTickTime: null,
      averagePollDurationMs: 0,
    };
  }

  /**
   * Start the polling scheduler
   */
  start() {
    if (this.isRunning) {
      logger.warn('Polling scheduler already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting polling scheduler', {
      intervalMs: config.polling.intervalMs,
      cohorts: this.ticksPerInterval,
      tickDurationMs: this.tickDurationMs,
    });

    // Start the tick loop
    this.scheduleTick();
  }

  /**
   * Stop the polling scheduler
   */
  stop() {
    this.isRunning = false;
    
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    
    logger.info('Polling scheduler stopped', this.stats);
  }

  /**
   * Schedule the next tick
   */
  scheduleTick() {
    if (!this.isRunning) return;

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * config.polling.jitterMs * 2 - config.polling.jitterMs;
    const delay = this.tickDurationMs + jitter;

    this.tickTimer = setTimeout(() => this.processTick(), Math.max(100, delay));
  }

  /**
   * Process a single tick (poll one cohort)
   */
  async processTick() {
    if (!this.isRunning) return;

    const tickStart = Date.now();
    this.stats.lastTickTime = new Date();
    this.stats.ticksProcessed++;

    // Get the cohort for this tick
    const cohortId = this.currentTick;
    const devices = connectionPool.getCohortDevices(cohortId);
    
    logger.debug('Processing tick', { 
      tick: this.currentTick, 
      cohort: cohortId, 
      devices: devices.length 
    });

    // Poll all devices in this cohort
    const pollPromises = devices
      .filter(conn => conn.isReady())
      .map(conn => this.pollDevice(conn));

    const results = await Promise.allSettled(pollPromises);

    // Count results
    let successCount = 0;
    let failCount = 0;
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        successCount++;
      } else {
        failCount++;
      }
    }

    this.stats.totalPolls += results.length;
    this.stats.successfulPolls += successCount;
    this.stats.failedPolls += failCount;

    // Update average poll duration
    const tickDuration = Date.now() - tickStart;
    this.stats.averagePollDurationMs = 
      (this.stats.averagePollDurationMs * 0.9) + (tickDuration * 0.1);

    // Move to next tick
    this.currentTick = (this.currentTick + 1) % this.ticksPerInterval;

    // Schedule next tick
    this.scheduleTick();
  }

  /**
   * Poll a single device
   */
  async pollDevice(conn) {
    try {
      const measurement = await conn.poll();
      
      if (measurement) {
        // Add to batch writer queue
        batchWriter.enqueue(measurement);
        
        // Update snapshot for dashboard
        batchWriter.enqueueSnapshot(measurement);
        
        return measurement;
      }
      
      return null;
    } catch (err) {
      logger.error('Poll failed', { 
        deviceId: conn.deviceId, 
        error: err.message 
      });
      return null;
    }
  }

  /**
   * Get scheduler statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      currentTick: this.currentTick,
      ticksPerInterval: this.ticksPerInterval,
      poolStats: connectionPool.getStats(),
    };
  }

  /**
   * Force poll a specific device (for testing/debugging)
   */
  async forcePoll(deviceId) {
    const conn = connectionPool.getConnection(deviceId);
    if (!conn) {
      throw new Error(`Device ${deviceId} not found in pool`);
    }

    if (!conn.isReady()) {
      await conn.connect();
    }

    return this.pollDevice(conn);
  }
}

// Singleton instance
const pollingScheduler = new PollingScheduler();

module.exports = { pollingScheduler };
