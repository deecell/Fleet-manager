const path = require('path');

let addon;
try {
  addon = require('../build/Release/powermon_addon.node');
} catch (e) {
  try {
    addon = require('../build/Debug/powermon_addon.node');
  } catch (e2) {
    console.error('Failed to load powermon addon:', e.message);
    console.error('Make sure to run "npm run build" first');
    
    addon = {
      PowermonDevice: class MockPowermonDevice {
        static getLibraryVersion() {
          return { major: 0, minor: 0, string: '0.0 (mock)' };
        }
        static parseAccessURL(url) {
          return null;
        }
        static decodeLogData(data) {
          return { success: false, code: -1, samples: [] };
        }
        static getHardwareString(rev) {
          return 'Unknown';
        }
        static getPowerStatusString(status) {
          return 'Unknown';
        }
        connect(options) {
          throw new Error('Addon not loaded');
        }
        disconnect() {}
        isConnected() { return false; }
        getInfo(cb) { cb({ success: false, code: -1 }); }
        getMonitorData(cb) { cb({ success: false, code: -1 }); }
        getStatistics(cb) { cb({ success: false, code: -1 }); }
        getFuelgaugeStatistics(cb) { cb({ success: false, code: -1 }); }
        getLogFileList(cb) { cb({ success: false, code: -1 }); }
        readLogFile(id, offset, size, cb) { cb({ success: false, code: -1 }); }
      }
    };
  }
}

const { PowermonDevice } = addon;

function createDevice() {
  return new PowermonDevice();
}

function getLibraryVersion() {
  return PowermonDevice.getLibraryVersion();
}

function parseAccessURL(url) {
  return PowermonDevice.parseAccessURL(url);
}

function decodeLogData(data) {
  return PowermonDevice.decodeLogData(data);
}

const DisconnectReason = {
  CLOSED: 0,
  NO_ROUTE: 1,
  FAILED: 2,
  UNEXPECTED_ERROR: 3,
  UNEXPECTED_RESPONSE: 4,
  WRITE_ERROR: 5,
  READ_ERROR: 6,
};

const ResponseCode = {
  RSP_SUCCESS: 0x0000,
  RSP_SUCCESS_MORE: 0x0100,
  RSP_INVALID_REQ: 0x0001,
  RSP_INVALID_PARAM: 0x0002,
  RSP_ERROR: 0x0003,
  RSP_LOCKED_USER: 0x0004,
  RSP_LOCKED_MASTER: 0x0005,
  RSP_CANNOT_UNLOCK: 0x0006,
  RSP_NOT_FOUND: 0x0007,
  RSP_TIMEOUT: 0x0008,
  RSP_INVALID: 0x0009,
  RSP_CANCELLED: 0x000A,
};

const PowerStatus = {
  PS_OFF: 0,
  PS_ON: 1,
  PS_LVD: 2,
  PS_OCD: 3,
  PS_HVD: 4,
  PS_FGD: 5,
  PS_NCH: 6,
  PS_LTD: 7,
  PS_HTD: 8,
};

module.exports = {
  PowermonDevice,
  createDevice,
  getLibraryVersion,
  parseAccessURL,
  decodeLogData,
  DisconnectReason,
  ResponseCode,
  PowerStatus,
};
