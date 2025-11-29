const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

class PowermonBridgeClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.bridgePath = options.bridgePath || path.join(__dirname, '..', 'powermon-bridge');
    this.process = null;
    this.connected = false;
    this.connecting = false;
    this.pendingCommands = new Map();
    this.cmdCounter = 0;
  }

  _generateCommandId() {
    return `cmd_${++this.cmdCounter}_${crypto.randomBytes(4).toString('hex')}`;
  }

  async start() {
    if (this.process) {
      throw new Error('Bridge already started');
    }

    return new Promise((resolve, reject) => {
      let startupError = null;
      let startupComplete = false;

      this.process = spawn(this.bridgePath, [], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const rl = readline.createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line);
          
          if (msg.type === 'fatal') {
            if (!startupComplete) {
              startupError = msg.message;
            }
            this.emit('fatal', msg.message);
            return;
          }
          
          this._handleMessage(msg);
        } catch (e) {
          this.emit('error', new Error(`Failed to parse bridge output: ${line}`));
        }
      });

      this.process.stderr.on('data', (data) => {
        const errorText = data.toString();
        this.emit('stderr', errorText);
        if (!startupComplete) {
          startupError = errorText;
        }
      });

      this.process.on('error', (err) => {
        this.emit('error', err);
        if (!startupComplete) {
          reject(err);
        }
      });

      this.process.on('close', (code) => {
        const wasRunning = this.process !== null;
        this.process = null;
        this.connected = false;
        this.connecting = false;
        
        for (const [id, { reject }] of this.pendingCommands) {
          reject(new Error(`Bridge process exited with code ${code}`));
        }
        this.pendingCommands.clear();
        
        this.emit('close', code);
        
        if (!startupComplete) {
          const errorMsg = startupError || `Bridge exited with code ${code} during startup`;
          reject(new Error(errorMsg));
        }
      });

      const readyHandler = (event) => {
        if (event === 'ready') {
          startupComplete = true;
          this.removeListener('event', readyHandler);
          resolve();
        }
      };
      this.on('event', readyHandler);

      setTimeout(() => {
        if (!startupComplete) {
          startupComplete = true;
          this.removeListener('event', readyHandler);
          if (this.process) {
            this.process.kill();
          }
          reject(new Error('Bridge startup timeout'));
        }
      }, 10000);
    });
  }

  stop() {
    if (this.process) {
      const cmdId = this._generateCommandId();
      this._sendCommand(`${cmdId} quit`);
      setTimeout(() => {
        if (this.process) {
          this.process.kill();
        }
      }, 1000);
    }
  }

  _handleMessage(msg) {
    if (msg.type === 'event') {
      this.emit('event', msg.event, msg);
      
      if (msg.event === 'connected') {
        this.connected = true;
        this.connecting = false;
        this.emit('connected');
      } else if (msg.event === 'disconnected') {
        this.connected = false;
        this.connecting = false;
        this.emit('disconnected', msg.reason);
      } else if (msg.event === 'monitor') {
        this.emit('monitor', msg.data);
      }
    } else if (msg.type === 'result' || msg.type === 'error') {
      const cmdId = msg.id;
      if (cmdId && this.pendingCommands.has(cmdId)) {
        const { resolve, reject } = this.pendingCommands.get(cmdId);
        this.pendingCommands.delete(cmdId);
        
        if (msg.type === 'error') {
          reject(new Error(msg.message));
        } else {
          resolve(msg);
        }
      }
    }
  }

  _sendCommand(command) {
    if (!this.process) {
      throw new Error('Bridge not started');
    }
    this.process.stdin.write(command + '\n');
  }

  _sendCommandAsync(command) {
    return new Promise((resolve, reject) => {
      const cmdId = this._generateCommandId();
      this.pendingCommands.set(cmdId, { resolve, reject });
      this._sendCommand(`${cmdId} ${command}`);
      
      setTimeout(() => {
        if (this.pendingCommands.has(cmdId)) {
          this.pendingCommands.delete(cmdId);
          reject(new Error(`Command timeout: ${command}`));
        }
      }, 30000);
    });
  }

  async getVersion() {
    return this._sendCommandAsync('version');
  }

  async parseURL(url) {
    return this._sendCommandAsync(`parse ${url}`);
  }

  async connect(url) {
    if (this.connected || this.connecting) {
      throw new Error('Already connected or connecting');
    }
    this.connecting = true;
    try {
      const result = await this._sendCommandAsync(`connect ${url}`);
      if (!result.success) {
        this.connecting = false;
      }
      return result;
    } catch (err) {
      this.connecting = false;
      throw err;
    }
  }

  async disconnect() {
    return this._sendCommandAsync('disconnect');
  }

  async getStatus() {
    return this._sendCommandAsync('status');
  }

  async getInfo() {
    return this._sendCommandAsync('info');
  }

  async getMonitorData() {
    return this._sendCommandAsync('monitor');
  }

  async getStatistics() {
    return this._sendCommandAsync('statistics');
  }

  async getFuelgaugeStatistics() {
    return this._sendCommandAsync('fgstatistics');
  }

  async getLogFiles() {
    return this._sendCommandAsync('logfiles');
  }

  async readLogFile(fileId, offset, size) {
    return this._sendCommandAsync(`readlog ${fileId} ${offset} ${size}`);
  }

  startStreaming(intervalMs = 2000, count = 0) {
    const cmdId = this._generateCommandId();
    this._sendCommand(`${cmdId} stream ${intervalMs} ${count}`);
  }

  isConnected() {
    return this.connected;
  }

  isRunning() {
    return this.process !== null;
  }
}

async function createBridgeClient(options = {}) {
  const client = new PowermonBridgeClient(options);
  await client.start();
  return client;
}

module.exports = {
  PowermonBridgeClient,
  createBridgeClient
};
