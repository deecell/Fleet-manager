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
   * 
   * IMPORTANT: Only clears queue on successful write to prevent data loss.
   * Failed writes keep data in queue for retry on next flush.
   */
  async flush() {
    const flushStart = Date.now();
    
    // Snapshot current queue state (don't clear yet - only clear on success)
    const measurementsToFlush = this.measurementQueue.length;
    const snapshotsToFlush = this.snapshotQueue.size;
    
    if (measurementsToFlush === 0 && snapshotsToFlush === 0) {
      return;
    }

    // Copy data for flush attempt
    const measurements = this.measurementQueue.slice(0, measurementsToFlush);
    const snapshots = Array.from(this.snapshotQueue.values());

    logger.debug('Flushing batch', { 
      measurements: measurementsToFlush, 
      snapshots: snapshotsToFlush 
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

      // SUCCESS: Now safe to remove flushed items from queue
      this.measurementQueue.splice(0, measurementsToFlush);
      this.snapshotQueue.clear();

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
      logger.error('Flush failed - data retained in queue for retry', { 
        error: err.message,
        measurements: measurements.length 
      });
      
      // Data stays in queue for retry on next flush
      // Trim oldest entries if queue exceeds max size
      if (this.measurementQueue.length > config.batchWriter.maxQueueSize) {
        const dropped = this.measurementQueue.length - config.batchWriter.maxQueueSize;
        this.measurementQueue = this.measurementQueue.slice(-config.batchWriter.maxQueueSize);
        logger.warn('Queue overflow - dropped oldest entries', { dropped });
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
