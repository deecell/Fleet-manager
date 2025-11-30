/**
 * PowerMon Log Sync Service
 * 
 * Manages incremental syncing of log data from PowerMon devices.
 * Tracks sync state per device to avoid re-reading data.
 */

const addon = require('../build/Release/powermon_addon.node');

/**
 * Creates initial sync state for a device
 * @param {string} deviceSerial 
 * @returns {Object} SyncState
 */
function createInitialState(deviceSerial) {
  return {
    deviceSerial,
    lastSyncTime: 0,
    lastFileId: 0,
    lastFileOffset: 0,
    totalSamplesSynced: 0
  };
}

/**
 * Determines which log files need to be synced based on the current state
 * @param {Array} files - Array of log files from device
 * @param {Object|null} state - Previous sync state
 * @returns {Object} { filesToSync, startOffset }
 */
function getFilesToSync(files, state) {
  if (!state || state.lastFileId === 0) {
    return { filesToSync: files, startOffset: 0 };
  }

  const filesToSync = [];
  let startOffset = 0;

  for (const file of files) {
    if (file.id > state.lastFileId) {
      filesToSync.push(file);
    } else if (file.id === state.lastFileId) {
      if (state.lastFileOffset < file.size) {
        filesToSync.push(file);
        startOffset = state.lastFileOffset;
      }
    }
  }

  return { filesToSync, startOffset };
}

/**
 * Estimates time range covered by log files
 * @param {Array} files 
 * @returns {Object} { oldestTime, newestTime, totalBytes, estimatedSamples }
 */
function estimateLogTimeRange(files) {
  if (files.length === 0) {
    return { oldestTime: null, newestTime: null, totalBytes: 0, estimatedSamples: 0 };
  }

  const sorted = [...files].sort((a, b) => a.id - b.id);
  const oldestTime = new Date(sorted[0].id * 1000);
  const newestTime = new Date(sorted[sorted.length - 1].id * 1000);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const estimatedSamples = Math.floor(totalBytes / 7); // ~7 bytes per sample

  return { oldestTime, newestTime, totalBytes, estimatedSamples };
}

/**
 * Gets list of log files from a connected device
 * @param {Object} device - Connected PowermonDevice instance
 * @returns {Promise<Array>} Array of log files
 */
function getLogFileList(device) {
  return new Promise((resolve, reject) => {
    device.getLogFileList((result) => {
      if (result.success && result.data) {
        resolve(result.data);
      } else {
        reject(new Error(`Failed to get log file list, code: ${result.code}`));
      }
    });
  });
}

/**
 * Reads raw data from a log file
 * @param {Object} device - Connected PowermonDevice
 * @param {number} fileId - File ID (timestamp)
 * @param {number} offset - Byte offset to start reading
 * @param {number} size - Number of bytes to read
 * @returns {Promise<Uint8Array>}
 */
function readLogFileRaw(device, fileId, offset, size) {
  return new Promise((resolve, reject) => {
    device.readLogFile(fileId, offset, size, (result) => {
      if (result.success && result.data) {
        resolve(result.data);
      } else {
        reject(new Error(`Failed to read log file ${fileId}, code: ${result.code}`));
      }
    });
  });
}

/**
 * Decodes raw log file data into samples
 * @param {Uint8Array} data - Raw log file data
 * @returns {Object} { success, startTime, samples }
 */
function decodeLogData(data) {
  return addon.PowermonDevice.decodeLogData(data);
}

/**
 * Main sync function - syncs log data from a connected device
 * 
 * @param {Object} device - Connected PowermonDevice instance
 * @param {string} deviceSerial - Device serial number
 * @param {Object|null} state - Previous sync state (null for first sync)
 * @param {Function} onProgress - Optional progress callback
 * @returns {Promise<Object>} SyncResult with samples and new state
 */
async function syncDeviceLogs(device, deviceSerial, state, onProgress) {
  const progress = {
    phase: 'listing',
    filesTotal: 0,
    filesCompleted: 0,
    samplesRetrieved: 0,
    message: null
  };

  const report = (updates) => {
    Object.assign(progress, updates);
    if (onProgress) onProgress(progress);
  };

  try {
    // Get file list
    report({ phase: 'listing', message: 'Getting log file list...' });
    const files = await getLogFileList(device);

    // Determine what needs syncing
    const { filesToSync, startOffset } = getFilesToSync(files, state);
    
    progress.filesTotal = filesToSync.length;
    report({ phase: 'reading', message: `${filesToSync.length} files to sync` });

    if (filesToSync.length === 0) {
      report({ phase: 'complete', message: 'Already up to date' });
      return {
        success: true,
        filesProcessed: 0,
        samplesRetrieved: 0,
        samples: [],
        newState: state || createInitialState(deviceSerial)
      };
    }

    const allSamples = [];
    let lastFileId = state?.lastFileId || 0;
    let lastFileOffset = 0;

    // Process each file
    for (let i = 0; i < filesToSync.length; i++) {
      const file = filesToSync[i];
      const offset = (i === 0) ? startOffset : 0;
      const bytesToRead = file.size - offset;
      
      report({ 
        phase: 'reading',
        filesCompleted: i,
        message: `Reading file ${i + 1}/${filesToSync.length} (${bytesToRead} bytes)`
      });

      try {
        // Read the file data
        const rawData = await readLogFileRaw(device, file.id, offset, bytesToRead);

        report({ phase: 'decoding', message: `Decoding ${rawData.length} bytes...` });

        // Decode the samples
        const decoded = decodeLogData(rawData);
        
        if (decoded.success && decoded.samples.length > 0) {
          allSamples.push(...decoded.samples);
          lastFileId = file.id;
          lastFileOffset = file.size;
          
          report({
            samplesRetrieved: allSamples.length,
            filesCompleted: i + 1
          });
        }
      } catch (readError) {
        console.error(`Error reading file ${file.id}:`, readError.message);
        // Continue with other files
      }
    }

    const newState = {
      deviceSerial,
      lastSyncTime: Date.now(),
      lastFileId,
      lastFileOffset,
      totalSamplesSynced: (state?.totalSamplesSynced || 0) + allSamples.length
    };

    report({ 
      phase: 'complete',
      filesCompleted: filesToSync.length,
      samplesRetrieved: allSamples.length,
      message: `Synced ${allSamples.length} samples from ${filesToSync.length} files`
    });

    return {
      success: true,
      filesProcessed: filesToSync.length,
      samplesRetrieved: allSamples.length,
      samples: allSamples,
      newState
    };

  } catch (error) {
    report({ phase: 'error', message: error.message });
    
    return {
      success: false,
      error: error.message,
      filesProcessed: 0,
      samplesRetrieved: 0,
      samples: [],
      newState: state || createInitialState(deviceSerial)
    };
  }
}

/**
 * Helper to sync only new data since a specific timestamp
 * @param {Object} device - Connected PowermonDevice
 * @param {string} deviceSerial - Device serial
 * @param {number} sinceTimestamp - Unix timestamp to sync from
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>}
 */
async function syncSince(device, deviceSerial, sinceTimestamp, onProgress) {
  // Create a synthetic state that starts from the given timestamp
  const state = {
    deviceSerial,
    lastSyncTime: sinceTimestamp * 1000,
    lastFileId: sinceTimestamp,
    lastFileOffset: 0,
    totalSamplesSynced: 0
  };
  
  return syncDeviceLogs(device, deviceSerial, state, onProgress);
}

module.exports = {
  createInitialState,
  getFilesToSync,
  estimateLogTimeRange,
  getLogFileList,
  readLogFileRaw,
  decodeLogData,
  syncDeviceLogs,
  syncSince
};
