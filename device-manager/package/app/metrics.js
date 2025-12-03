/**
 * Metrics and Health Check Server
 * 
 * Exposes Prometheus-compatible metrics and health check endpoint.
 * Runs on a separate port from the main app.
 */

const http = require('http');
const { config } = require('./config');
const logger = require('./logger');
const { connectionPool } = require('./connection-pool');
const { pollingScheduler } = require('./polling-scheduler');
const batchWriter = require('./batch-writer');
const { backfillService } = require('./backfill-service');

let server = null;

/**
 * Generate Prometheus metrics output
 */
function generateMetrics() {
  const poolStats = connectionPool.getStats();
  const schedulerStats = pollingScheduler.getStats();
  const writerStats = batchWriter.getStats();
  const backfillStats = backfillService.getStats();

  const lines = [
    '# HELP dm_devices_total Total number of devices in pool',
    '# TYPE dm_devices_total gauge',
    `dm_devices_total ${poolStats.totalDevices}`,
    '',
    '# HELP dm_devices_connected Number of connected devices',
    '# TYPE dm_devices_connected gauge',
    `dm_devices_connected ${poolStats.connected}`,
    '',
    '# HELP dm_devices_disconnected Number of disconnected devices',
    '# TYPE dm_devices_disconnected gauge',
    `dm_devices_disconnected ${poolStats.disconnected}`,
    '',
    '# HELP dm_polls_total Total number of polls',
    '# TYPE dm_polls_total counter',
    `dm_polls_total ${schedulerStats.totalPolls}`,
    '',
    '# HELP dm_polls_successful_total Total successful polls',
    '# TYPE dm_polls_successful_total counter',
    `dm_polls_successful_total ${schedulerStats.successfulPolls}`,
    '',
    '# HELP dm_polls_failed_total Total failed polls',
    '# TYPE dm_polls_failed_total counter',
    `dm_polls_failed_total ${schedulerStats.failedPolls}`,
    '',
    '# HELP dm_polls_skipped_total Polls skipped due to concurrency limit',
    '# TYPE dm_polls_skipped_total counter',
    `dm_polls_skipped_total ${schedulerStats.skippedPolls || 0}`,
    '',
    '# HELP dm_polls_active Current active concurrent polls',
    '# TYPE dm_polls_active gauge',
    `dm_polls_active ${schedulerStats.activePolls || 0}`,
    '',
    '# HELP dm_poll_duration_ms Average poll duration in milliseconds',
    '# TYPE dm_poll_duration_ms gauge',
    `dm_poll_duration_ms ${schedulerStats.averagePollDurationMs.toFixed(2)}`,
    '',
    '# HELP dm_writer_queue_size Current batch writer queue size',
    '# TYPE dm_writer_queue_size gauge',
    `dm_writer_queue_size ${writerStats.currentQueueSize}`,
    '',
    '# HELP dm_writer_total_written Total measurements written',
    '# TYPE dm_writer_total_written counter',
    `dm_writer_total_written ${writerStats.totalWritten}`,
    '',
    '# HELP dm_writer_flush_duration_ms Average flush duration in milliseconds',
    '# TYPE dm_writer_flush_duration_ms gauge',
    `dm_writer_flush_duration_ms ${writerStats.averageFlushDurationMs.toFixed(2)}`,
    '',
    '# HELP dm_backfills_total Total backfill operations',
    '# TYPE dm_backfills_total counter',
    `dm_backfills_total ${backfillStats.totalBackfills}`,
    '',
    '# HELP dm_backfills_successful_total Successful backfill operations',
    '# TYPE dm_backfills_successful_total counter',
    `dm_backfills_successful_total ${backfillStats.successfulBackfills}`,
    '',
    '# HELP dm_backfills_active Current active backfill operations',
    '# TYPE dm_backfills_active gauge',
    `dm_backfills_active ${backfillStats.activeBackfills}`,
    '',
    '# HELP dm_samples_backfilled_total Total samples backfilled',
    '# TYPE dm_samples_backfilled_total counter',
    `dm_samples_backfilled_total ${backfillStats.totalSamplesBackfilled}`,
  ];

  return lines.join('\n');
}

/**
 * Generate health check response
 */
function generateHealthCheck() {
  const poolStats = connectionPool.getStats();
  const schedulerStats = pollingScheduler.getStats();
  const writerStats = batchWriter.getStats();

  const healthy = 
    schedulerStats.isRunning && 
    writerStats.isRunning &&
    writerStats.currentQueueSize < config.batchWriter.maxQueueSize * 0.9;

  return {
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    components: {
      connectionPool: {
        status: poolStats.connected > 0 ? 'ok' : 'warning',
        devices: poolStats.totalDevices,
        connected: poolStats.connected,
      },
      pollingScheduler: {
        status: schedulerStats.isRunning ? 'ok' : 'error',
        totalPolls: schedulerStats.totalPolls,
        successRate: schedulerStats.totalPolls > 0 
          ? ((schedulerStats.successfulPolls / schedulerStats.totalPolls) * 100).toFixed(1) + '%'
          : 'N/A',
      },
      batchWriter: {
        status: writerStats.isRunning ? 'ok' : 'error',
        queueSize: writerStats.currentQueueSize,
        totalWritten: writerStats.totalWritten,
      },
    },
  };
}

/**
 * Start the metrics/health server
 */
function startMetricsServer() {
  server = http.createServer((req, res) => {
    if (req.url === config.server.metricsPath) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(generateMetrics());
    } else if (req.url === config.server.healthPath) {
      const health = generateHealthCheck();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(config.server.port, '0.0.0.0', () => {
    logger.info('Metrics server started', { 
      port: config.server.port,
      metricsPath: config.server.metricsPath,
      healthPath: config.server.healthPath,
    });
  });
}

/**
 * Stop the metrics server
 */
function stopMetricsServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        logger.info('Metrics server stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = { 
  startMetricsServer, 
  stopMetricsServer,
  generateMetrics,
  generateHealthCheck,
};
