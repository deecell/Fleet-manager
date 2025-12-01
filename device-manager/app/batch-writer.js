/**
 * Batch Database Writer
 * 
 * Buffers measurements and writes them in bulk to reduce database load.
 * Flushes based on time interval or queue size, whichever comes first.
 */

const { config } = require('./config');
const logger = require('./logger');
const db = require('./database');

class BatchWriter {
  constructor() {
    this.measurementQueue = [];
    this.snapshotQueue = new Map(); // deviceId -> latest snapshot
    this.flushTimer = null;
    this.isRunning = false;
    
    this.stats = {
      totalWritten: 0,
      totalBatches: 0,
      failedBatches: 0,
      queueHighWaterMark: 0,
      lastFlushTime: null,
      averageFlushDurationMs: 0,
    };
  }

  /**
   * Start the batch writer
   */
  start() {
    if (this.isRunning) {
      logger.warn('Batch writer already running');
      return;
    }

    this.isRunning = true;
    this.scheduleFlush();
    
    logger.info('Batch writer started', {
      flushIntervalMs: config.batchWriter.flushIntervalMs,
      maxBatchSize: config.batchWriter.maxBatchSize,
    });
  }

  /**
   * Stop the batch writer
   */
  async stop() {
    this.isRunning = false;
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    await this.flush();
    
    logger.info('Batch writer stopped', this.stats);
  }

  /**
   * Add a measurement to the queue
   */
  enqueue(measurement) {
    if (this.measurementQueue.length >= config.batchWriter.maxQueueSize) {
      logger.warn('Measurement queue full, dropping oldest entries');
      this.measurementQueue.splice(0, 100); // Drop oldest 100
    }

    this.measurementQueue.push(measurement);

    // Update high water mark
    if (this.measurementQueue.length > this.stats.queueHighWaterMark) {
      this.stats.queueHighWaterMark = this.measurementQueue.length;
    }

    // Flush if we've reached max batch size
    if (this.measurementQueue.length >= config.batchWriter.maxBatchSize) {
      this.flush().catch(err => {
        logger.error('Flush on max batch size failed', { error: err.message });
      });
    }
  }

  /**
   * Add a snapshot update to the queue
   * Only keeps the latest snapshot per device
   */
  enqueueSnapshot(snapshot) {
    this.snapshotQueue.set(snapshot.deviceId, snapshot);
  }

  /**
   * Schedule the next flush
   */
  scheduleFlush() {
    if (!this.isRunning) return;

    this.flushTimer = setTimeout(async () => {
      await this.flush();
      this.scheduleFlush();
    }, config.batchWriter.flushIntervalMs);
  }

  /**
   * Flush queued data to database
   */
  async flush() {
    const flushStart = Date.now();
    
    // Get current queue contents
    const measurements = [...this.measurementQueue];
    const snapshots = Array.from(this.snapshotQueue.values());
    
    // Clear queues
    this.measurementQueue = [];
    this.snapshotQueue.clear();

    if (measurements.length === 0 && snapshots.length === 0) {
      return;
    }

    logger.debug('Flushing batch', { 
      measurements: measurements.length, 
      snapshots: snapshots.length 
    });

    try {
      // Bulk insert measurements
      if (measurements.length > 0) {
        await db.bulkInsertMeasurements(measurements);
      }

      // Update snapshots (one at a time for now, could be optimized)
      for (const snapshot of snapshots) {
        await db.upsertDeviceSnapshot(snapshot);
      }

      this.stats.totalWritten += measurements.length;
      this.stats.totalBatches++;
      this.stats.lastFlushTime = new Date();

      const flushDuration = Date.now() - flushStart;
      this.stats.averageFlushDurationMs = 
        (this.stats.averageFlushDurationMs * 0.9) + (flushDuration * 0.1);

      logger.debug('Flush complete', { 
        written: measurements.length, 
        durationMs: flushDuration 
      });

    } catch (err) {
      this.stats.failedBatches++;
      logger.error('Flush failed', { 
        error: err.message,
        measurements: measurements.length 
      });
      
      // Re-queue failed measurements (at the front)
      this.measurementQueue = [...measurements, ...this.measurementQueue];
      
      // Trim if too large
      if (this.measurementQueue.length > config.batchWriter.maxQueueSize) {
        this.measurementQueue = this.measurementQueue.slice(-config.batchWriter.maxQueueSize);
      }
    }
  }

  /**
   * Get writer statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      currentQueueSize: this.measurementQueue.length,
      pendingSnapshots: this.snapshotQueue.size,
    };
  }

  /**
   * Get current queue depth
   */
  getQueueDepth() {
    return this.measurementQueue.length;
  }
}

// Singleton instance
const batchWriter = new BatchWriter();

module.exports = batchWriter;
