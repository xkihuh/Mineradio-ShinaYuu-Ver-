'use strict';

const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');

const OPCODE = Object.freeze({
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
});

function safeError(message, code, data) {
  const error = new Error(String(message || 'Discord RPC error'));
  if (code !== undefined && code !== null) error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}

function encodeFrame(op, payload) {
  const json = Buffer.from(JSON.stringify(payload == null ? {} : payload), 'utf8');
  const frame = Buffer.allocUnsafe(8 + json.length);
  frame.writeInt32LE(Number(op) || 0, 0);
  frame.writeInt32LE(json.length, 4);
  json.copy(frame, 8);
  return frame;
}

class FrameDecoder {
  constructor(onFrame) {
    this.buffer = Buffer.alloc(0);
    this.onFrame = typeof onFrame === 'function' ? onFrame : () => {};
  }

  push(chunk) {
    if (!chunk || !chunk.length) return;
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, Buffer.from(chunk)])
      : Buffer.from(chunk);

    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > 16 * 1024 * 1024) {
        throw safeError(`Invalid Discord IPC frame length: ${length}`, 'DISCORD_INVALID_FRAME');
      }
      if (this.buffer.length < 8 + length) return;

      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      let data = {};
      if (body.length) {
        try {
          data = JSON.parse(body.toString('utf8'));
        } catch (error) {
          throw safeError(`Invalid Discord IPC JSON: ${error.message}`, 'DISCORD_INVALID_JSON');
        }
      }
      this.onFrame({ op, data });
    }
  }
}

function discordIpcCandidates() {
  if (process.platform === 'win32') {
    const candidates = [];
    for (let index = 0; index < 10; index += 1) {
      // Both forms address the same Windows named pipe. Trying both helps
      // with Electron/Node and Windows builds that normalize pipe names differently.
      candidates.push(`\\\\?\\pipe\\discord-ipc-${index}`);
      candidates.push(`\\\\.\\pipe\\discord-ipc-${index}`);
    }
    return candidates;
  }

  const prefix = process.env.XDG_RUNTIME_DIR
    || process.env.TMPDIR
    || process.env.TMP
    || process.env.TEMP
    || '/tmp';
  const root = String(prefix).replace(/[\\/]$/, '');
  return Array.from({ length: 10 }, (_, index) => `${root}/discord-ipc-${index}`);
}

function connectPath(pipePath, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (socket) {
          socket.removeAllListeners();
          try { socket.destroy(); } catch (_) {}
        }
        reject(error);
      } else {
        socket.removeListener('error', onError);
        resolve(socket);
      }
    };
    const onError = (error) => finish(error || safeError('Could not connect to Discord IPC'));
    const timer = setTimeout(() => finish(safeError('Discord IPC pipe timed out', 'DISCORD_PIPE_TIMEOUT')), Math.max(250, Number(timeoutMs) || 1200));
    timer.unref?.();

    try {
      socket = net.createConnection(pipePath);
      socket.once('connect', () => finish());
      socket.once('error', onError);
    } catch (error) {
      finish(error);
    }
  });
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.keys(value).forEach((key) => {
    const item = value[key];
    if (item === undefined) return;
    result[key] = compactObject(item);
  });
  return result;
}

function nonce() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

class DiscordIpcClient extends EventEmitter {
  constructor(options = {}) {
    super();
    if (options.transport && options.transport !== 'ipc') {
      throw new TypeError(`Unsupported Discord transport: ${options.transport}`);
    }
    this.options = options;
    this.socket = null;
    this.ipcPath = '';
    this.clientId = '';
    this.user = null;
    this.application = null;
    this.connected = false;
    this.manualClose = false;
    this.decoder = new FrameDecoder((frame) => this.handleFrame(frame));
    this.pending = new Map();
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.connectTimer = null;
    this.disconnectEmitted = false;
  }

  async openSocket() {
    const candidates = Array.isArray(this.options.ipcPaths) && this.options.ipcPaths.length
      ? this.options.ipcPaths
      : discordIpcCandidates();
    let lastError = null;
    for (const candidate of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const socket = await connectPath(candidate, this.options.pipeTimeoutMs || 1200);
        this.ipcPath = candidate;
        return socket;
      } catch (error) {
        lastError = error;
      }
    }
    throw safeError(lastError && lastError.message || 'Could not connect to Discord IPC', 'DISCORD_IPC_CONNECT_FAILED', lastError);
  }

  connect(clientId) {
    const normalizedId = String(clientId || '').trim();
    if (!/^\d{17,24}$/.test(normalizedId)) {
      return Promise.reject(safeError('Invalid Discord Application ID', 'DISCORD_INVALID_APPLICATION'));
    }
    if (this.connected && this.clientId === normalizedId) return Promise.resolve(this);
    if (this.connectPromise) return this.connectPromise;

    this.clientId = normalizedId;
    this.manualClose = false;
    this.disconnectEmitted = false;
    this.connectPromise = this.connectInternal()
      .finally(() => {
        if (!this.connected) this.connectPromise = null;
      });
    return this.connectPromise;
  }

  async connectInternal() {
    const socket = await this.openSocket();
    this.socket = socket;
    try { socket.setNoDelay(true); } catch (_) {}
    this.decoder = new FrameDecoder((frame) => this.handleFrame(frame));

    socket.on('data', (chunk) => {
      try {
        this.decoder.push(chunk);
      } catch (error) {
        this.failConnection(error);
      }
    });
    socket.on('error', (error) => this.handleSocketClose(error));
    socket.on('close', () => this.handleSocketClose(safeError('Discord IPC connection closed', 'DISCORD_CONNECTION_CLOSED')));

    const readyPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.connectTimer = setTimeout(() => {
        this.failConnection(safeError('RPC_CONNECTION_TIMEOUT', 'DISCORD_RPC_TIMEOUT'));
      }, Math.max(5000, Number(this.options.connectTimeoutMs) || 15000));
      this.connectTimer.unref?.();
    });

    this.sendRaw(OPCODE.HANDSHAKE, { v: 1, client_id: this.clientId });
    await readyPromise;
    return this;
  }

  async login(options = {}) {
    await this.connect(options.clientId);
    this.emit('ready');
    return this;
  }

  sendRaw(op, data) {
    if (!this.socket || this.socket.destroyed || !this.socket.writable) {
      throw safeError('Discord IPC socket is not writable', 'DISCORD_SOCKET_UNAVAILABLE');
    }
    this.socket.write(encodeFrame(op, compactObject(data)));
  }

  handleFrame({ op, data }) {
    if (op === OPCODE.PING) {
      try { this.sendRaw(OPCODE.PONG, data); } catch (_) {}
      return;
    }
    if (op === OPCODE.CLOSE) {
      const error = safeError(data && (data.message || data.error) || 'Discord closed the RPC connection', data && data.code, data);
      this.failConnection(error);
      return;
    }
    if (op !== OPCODE.FRAME || !data) return;

    if (data.cmd === 'DISPATCH' && data.evt === 'READY') {
      this.user = data.data && data.data.user || null;
      this.application = data.data && (data.data.application || data.data.config) || null;
      this.connected = true;
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
      const resolve = this.connectResolve;
      this.connectResolve = null;
      this.connectReject = null;
      if (resolve) resolve(this);
      this.emit('connected');
      return;
    }

    if (data.nonce && this.pending.has(data.nonce)) {
      const pending = this.pending.get(data.nonce);
      this.pending.delete(data.nonce);
      clearTimeout(pending.timer);
      if (data.evt === 'ERROR') {
        const details = data.data || {};
        pending.reject(safeError(details.message || 'Discord RPC request failed', details.code, details));
      } else {
        pending.resolve(data.data);
      }
      return;
    }

    if (data.evt === 'ERROR' && !this.connected) {
      const details = data.data || {};
      this.failConnection(safeError(details.message || 'Discord RPC handshake failed', details.code, details));
      return;
    }

    if (data.evt) this.emit(data.evt, data.data);
  }

  failConnection(error) {
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
    const reject = this.connectReject;
    this.connectResolve = null;
    this.connectReject = null;
    if (reject) reject(error);
    this.closeSocket(false);
  }

  handleSocketClose(error) {
    const wasConnected = this.connected;
    this.connected = false;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;

    if (this.connectReject) {
      const reject = this.connectReject;
      this.connectResolve = null;
      this.connectReject = null;
      reject(error || safeError('Discord IPC connection closed'));
    }

    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(error || safeError('Discord IPC connection closed'));
    });
    this.pending.clear();

    if (wasConnected && !this.manualClose && !this.disconnectEmitted) {
      this.disconnectEmitted = true;
      this.emit('disconnected');
    }
  }

  closeSocket(sendClose) {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    if (!socket) return;
    if (sendClose && !socket.destroyed && socket.writable) {
      try { socket.write(encodeFrame(OPCODE.CLOSE, {})); } catch (_) {}
    }
    try { socket.end(); } catch (_) {}
    setTimeout(() => {
      try { if (!socket.destroyed) socket.destroy(); } catch (_) {}
    }, 80).unref?.();
  }

  request(cmd, args, evt) {
    if (!this.connected) return Promise.reject(safeError('Discord RPC is not connected', 'DISCORD_NOT_CONNECTED'));
    const requestNonce = nonce();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestNonce);
        reject(safeError(`Discord RPC request timed out: ${cmd}`, 'DISCORD_REQUEST_TIMEOUT'));
      }, Math.max(3000, Number(this.options.requestTimeoutMs) || 10000));
      timer.unref?.();
      this.pending.set(requestNonce, { resolve, reject, timer });
      try {
        this.sendRaw(OPCODE.FRAME, compactObject({ cmd, args: args || {}, evt, nonce: requestNonce }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestNonce);
        reject(error);
      }
    });
  }

  setActivity(args = {}, pid = process.pid) {
    let timestamps;
    let assets;
    if (args.startTimestamp || args.endTimestamp) {
      const toTimestamp = (value) => value instanceof Date ? Math.round(value.getTime()) : Math.round(Number(value) || 0);
      timestamps = {
        start: args.startTimestamp ? toTimestamp(args.startTimestamp) : undefined,
        end: args.endTimestamp ? toTimestamp(args.endTimestamp) : undefined,
      };
    }
    if (args.largeImageKey || args.largeImageText || args.smallImageKey || args.smallImageText) {
      assets = {
        large_image: args.largeImageKey,
        large_text: args.largeImageText,
        small_image: args.smallImageKey,
        small_text: args.smallImageText,
      };
    }
    return this.request('SET_ACTIVITY', {
      pid: Number(pid) || process.pid,
      activity: compactObject({
        state: args.state,
        details: args.details,
        timestamps,
        assets,
        buttons: args.buttons,
        instance: !!args.instance,
      }),
    });
  }

  clearActivity(pid = process.pid) {
    return this.request('SET_ACTIVITY', { pid: Number(pid) || process.pid });
  }

  async destroy() {
    this.manualClose = true;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(safeError('Discord RPC client destroyed', 'DISCORD_CLIENT_DESTROYED'));
    });
    this.pending.clear();
    this.closeSocket(true);
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }
}

module.exports = {
  DiscordIpcClient,
  FrameDecoder,
  encodeFrame,
  discordIpcCandidates,
  OPCODE,
};
