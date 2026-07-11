'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');
const EventEmitter = require('events');
const { DiscordIpcClient } = require('./discord-ipc-client');

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  applicationId: '',
  largeImageKey: '',
  largeImageText: 'ShinaYuu Music',
  smallImageKey: '',
  smallImageText: '',
  showTrack: true,
});

function safeText(value, max = 128) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
}

function safeBoolean(value, fallback) {
  if (value === undefined || value === null) return !!fallback;
  return !!value;
}

function normalizeConfig(input = {}) {
  const rawId = String(input.applicationId || '').replace(/\D/g, '').slice(0, 24);
  return {
    enabled: safeBoolean(input.enabled, DEFAULT_CONFIG.enabled),
    applicationId: rawId,
    largeImageKey: safeText(input.largeImageKey || '', 64),
    largeImageText: safeText(input.largeImageText || DEFAULT_CONFIG.largeImageText, 128),
    smallImageKey: safeText(input.smallImageKey || '', 64),
    smallImageText: safeText(input.smallImageText || '', 128),
    showTrack: safeBoolean(input.showTrack, DEFAULT_CONFIG.showTrack),
  };
}

function isValidApplicationId(value) {
  return /^\d{17,24}$/.test(String(value || ''));
}

function defaultAvatarIndex(user) {
  const discriminator = String(user && user.discriminator || '0');
  if (discriminator && discriminator !== '0') return Number(discriminator) % 5;
  try { return Number((BigInt(String(user.id || '0')) >> 22n) % 6n); } catch (_) { return 0; }
}

function avatarUrl(user) {
  if (!user || !user.id) return '';
  if (user.avatar) {
    const extension = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.${extension}?size=256`;
  }
  return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(user)}.png`;
}

function normalizeUser(user) {
  if (!user || !user.id) return null;
  const username = safeText(user.username || 'Discord User', 64);
  const displayName = safeText(user.global_name || user.display_name || username, 64) || username;
  const discriminator = String(user.discriminator || '0');
  const handle = discriminator && discriminator !== '0' ? `${username}#${discriminator}` : `@${username}`;
  return {
    id: String(user.id),
    username,
    displayName,
    discriminator,
    handle,
    avatar: String(user.avatar || ''),
    avatarUrl: avatarUrl(user),
    flags: Number(user.flags || 0),
    premiumType: Number(user.premium_type || 0),
  };
}

function atomicWriteJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temp, filePath);
}

function discordIpcPath(index) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`;
  const prefix = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return `${String(prefix).replace(/\/$/, '')}/discord-ipc-${index}`;
}

function probeIpcPath(pipePath, timeoutMs = 180) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) {
        socket.removeAllListeners();
        try { socket.destroy(); } catch (_) {}
      }
      resolve(!!ok);
    };
    const timer = setTimeout(() => finish(false), Math.max(60, Number(timeoutMs) || 180));
    timer.unref?.();
    try {
      socket = net.createConnection(pipePath);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('close', () => finish(false));
    } catch (_) {
      finish(false);
    }
  });
}

async function probeDiscordIpc() {
  for (let index = 0; index <= 10; index += 1) {
    // Discord stable, PTB and Canary all expose one of these local IPC pipes.
    // Probe serially so a machine without Discord returns quickly without
    // opening many sockets at once.
    // eslint-disable-next-line no-await-in-loop
    if (await probeIpcPath(discordIpcPath(index))) return true;
  }
  return false;
}

function detectDiscordProcessWindows() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 1800 }, (error, stdout) => {
      if (error) return resolve(false);
      resolve(/"Discord(?:Canary|PTB)?\.exe"/i.test(String(stdout || '')));
    });
  });
}

async function probeDiscordRuntime() {
  const ipcAvailable = await probeDiscordIpc().catch(() => false);
  if (ipcAvailable) return { running: true, ipcAvailable: true };
  const running = await detectDiscordProcessWindows().catch(() => false);
  return { running: !!running, ipcAvailable: false };
}

function normalizeRuntimeStatus(value) {
  if (value === true) return { running: true, ipcAvailable: true };
  if (!value || typeof value !== 'object') return { running: false, ipcAvailable: false };
  return {
    running: !!value.running || !!value.ipcAvailable,
    ipcAvailable: !!value.ipcAvailable,
  };
}

function classifyDiscordConnectionError(error, runtime) {
  const message = String(error && error.message || error || 'DISCORD_RPC_UNAVAILABLE');
  const errorCode = error && typeof error === 'object' && error.code != null ? String(error.code) : '';
  const diagnostic = `${errorCode} ${message}`.trim();
  const status = normalizeRuntimeStatus(runtime);
  if (!status.running) return 'DISCORD_NOT_RUNNING';
  if (!status.ipcAvailable) return 'DISCORD_IPC_UNAVAILABLE';
  if (/invalid.*(?:client|application)|(?:client|application).*(?:invalid|unknown)|no client id|(?:^|\s)4000(?:\s|$)/i.test(diagnostic)) return 'DISCORD_INVALID_APPLICATION';
  if (/RPC_CONNECTION_TIMEOUT|request timed out|timeout/i.test(diagnostic)) return 'DISCORD_RPC_TIMEOUT';
  return 'DISCORD_RPC_UNAVAILABLE';
}

class DiscordPresenceManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.configFile = options.configFile;
    this.defaultConfig = normalizeConfig({ ...DEFAULT_CONFIG, ...(options.defaultConfig || {}) });
    this.processId = Number(options.processId || process.pid);
    this.RPCClient = options.RPCClient || DiscordIpcClient;
    this.runtimeProbe = options.runtimeProbe || probeDiscordRuntime;
    this.config = this.readConfig();
    this.client = null;
    this.connectPromise = null;
    this.connectionGeneration = 0;
    this.reconnectTimer = null;
    this.activityTimer = null;
    this.activityPayload = null;
    this.state = {
      configured: isValidApplicationId(this.config.applicationId),
      enabled: !!this.config.enabled,
      connecting: false,
      connected: false,
      discordRunning: false,
      ipcAvailable: false,
      profile: null,
      activity: null,
      error: '',
      errorDetail: '',
      applicationId: this.config.applicationId,
      transport: 'builtin-ipc-v1',
      ipcPath: '',
      lastUpdated: Date.now(),
    };
  }

  readConfig() {
    try {
      if (this.configFile && fs.existsSync(this.configFile)) {
        return normalizeConfig({ ...this.defaultConfig, ...JSON.parse(fs.readFileSync(this.configFile, 'utf8')) });
      }
    } catch (error) {
      console.warn('[DiscordPresence] Could not read config:', error.message || error);
    }
    return normalizeConfig(this.defaultConfig || DEFAULT_CONFIG);
  }

  saveConfig() {
    if (!this.configFile) return;
    atomicWriteJson(this.configFile, this.config);
  }

  publicState() {
    return {
      ...this.state,
      config: { ...this.config },
    };
  }

  emitState(patch = {}) {
    this.state = {
      ...this.state,
      ...patch,
      configured: isValidApplicationId(this.config.applicationId),
      enabled: !!this.config.enabled,
      applicationId: this.config.applicationId,
      transport: 'builtin-ipc-v1',
      lastUpdated: Date.now(),
    };
    this.emit('state', this.publicState());
  }

  async inspectRuntime() {
    try { return normalizeRuntimeStatus(await this.runtimeProbe()); }
    catch (_) { return { running: false, ipcAvailable: false }; }
  }

  async configure(patch = {}) {
    const oldId = this.config.applicationId;
    this.config = normalizeConfig({ ...this.config, ...patch });
    this.saveConfig();
    if (!this.config.enabled || !isValidApplicationId(this.config.applicationId)) {
      await this.disconnect({ clear: true, permanent: true });
      this.emitState({ error: '', errorDetail: '', connecting: false, connected: false, discordRunning: false, ipcAvailable: false, profile: null });
      return this.publicState();
    }
    if (oldId !== this.config.applicationId || !this.state.connected) {
      await this.disconnect({ clear: true, permanent: true });
      this.connect().catch(() => {});
    } else {
      this.queueActivityUpdate(true);
      this.emitState({ error: '', errorDetail: '' });
    }
    return this.publicState();
  }

  scheduleReconnect(delay) {
    if (this.reconnectTimer || !this.config.enabled || !isValidApplicationId(this.config.applicationId)) return;
    const nextDelay = delay == null ? (this.state.discordRunning ? 5000 : 12000) : delay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, Math.max(2500, Number(nextDelay) || 5000));
    this.reconnectTimer.unref?.();
  }

  connect() {
    if (!this.config.enabled || !isValidApplicationId(this.config.applicationId)) {
      this.emitState({ connecting: false, connected: false, discordRunning: false, ipcAvailable: false, profile: null, error: '', errorDetail: '' });
      return Promise.resolve(this.publicState());
    }
    if (this.state.connected && this.client) return Promise.resolve(this.publicState());
    if (this.connectPromise) return this.connectPromise;

    const generation = ++this.connectionGeneration;
    const pending = this.connectInternal(generation)
      .catch((error) => {
        console.warn('[DiscordPresence] Unexpected connect error:', error && (error.message || error));
        return this.publicState();
      });
    this.connectPromise = pending;
    const clearPending = () => {
      if (this.connectPromise === pending) this.connectPromise = null;
    };
    pending.then(clearPending, clearPending);
    return pending;
  }

  async connectInternal(generation) {
    const runtimeBefore = await this.inspectRuntime();
    if (generation !== this.connectionGeneration) return this.publicState();
    this.emitState({
      connecting: true,
      connected: false,
      discordRunning: runtimeBefore.running,
      ipcAvailable: runtimeBefore.ipcAvailable,
      error: '',
      errorDetail: '',
    });

    const client = new this.RPCClient({ transport: 'ipc' });
    this.client = client;

    client.on('ready', () => {
      if (generation !== this.connectionGeneration || client !== this.client) return;
      const profile = normalizeUser(client.user);
      console.log(`[DiscordPresence] Connected${profile ? ` as ${profile.handle}` : ''}`);
      this.emitState({
        connecting: false,
        connected: true,
        discordRunning: true,
        ipcAvailable: true,
        profile,
        ipcPath: safeText(client.ipcPath || '', 260),
        error: '',
        errorDetail: '',
      });
      this.queueActivityUpdate(true);
    });

    client.on('disconnected', () => {
      if (generation !== this.connectionGeneration || client !== this.client) return;
      this.client = null;
      this.emitState({
        connecting: false,
        connected: false,
        profile: null,
        error: 'DISCORD_CONNECTION_LOST',
        errorDetail: 'connection closed',
      });
      this.inspectRuntime().then((runtime) => {
        if (this.state.connected) return;
        this.emitState({
          discordRunning: runtime.running,
          ipcAvailable: runtime.ipcAvailable,
          error: classifyDiscordConnectionError('connection closed', runtime),
        });
      }).catch(() => {});
      this.scheduleReconnect();
    });

    try {
      await client.login({ clientId: this.config.applicationId });
      if (generation !== this.connectionGeneration) return this.publicState();
      return this.publicState();
    } catch (error) {
      if (generation !== this.connectionGeneration) return this.publicState();
      if (client === this.client) this.client = null;
      try { await client.destroy(); } catch (_) {}
      const runtimeAfter = await this.inspectRuntime();
      const message = String(error && error.message || error || 'DISCORD_RPC_UNAVAILABLE');
      const detail = error && error.code != null ? `[${error.code}] ${message}` : message;
      const code = classifyDiscordConnectionError(error, runtimeAfter);
      console.warn('[DiscordPresence] Connect failed:', message, runtimeAfter);
      this.emitState({
        connecting: false,
        connected: false,
        discordRunning: runtimeAfter.running,
        ipcAvailable: runtimeAfter.ipcAvailable,
        profile: null,
        error: code,
        errorDetail: detail,
        ipcPath: safeText(client.ipcPath || '', 260),
      });
      this.scheduleReconnect();
      return this.publicState();
    }
  }

  async disconnect(options = {}) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = null;
    this.connectionGeneration += 1;
    const client = this.client;
    this.client = null;
    this.connectPromise = null;
    if (client) {
      if (options.clear !== false) {
        try { await client.clearActivity(this.processId); } catch (_) {}
      }
      try { await client.destroy(); } catch (_) {}
    }
    this.emitState({ connecting: false, connected: false, discordRunning: false, ipcAvailable: false, profile: null, activity: null, error: '', errorDetail: '' });
    if (!options.permanent) this.scheduleReconnect();
  }

  updateActivity(payload = {}) {
    this.activityPayload = {
      title: safeText(payload.title || '', 120),
      artist: safeText(payload.artist || '', 120),
      album: safeText(payload.album || '', 120),
      source: safeText(payload.source || '', 24),
      isPlaying: !!payload.isPlaying,
      positionSec: Math.max(0, Number(payload.positionSec) || 0),
      durationSec: Math.max(0, Number(payload.durationSec) || 0),
      cover: safeText(payload.cover || '', 500),
    };
    this.queueActivityUpdate(false);
    return this.publicState();
  }

  buildActivity() {
    const p = this.activityPayload || {};
    const hasTrack = !!p.title;
    const trackText = [p.title, p.artist].filter(Boolean).join(' — ');
    const activity = {
      details: p.isPlaying && hasTrack ? 'Đang nghe trên ShinaYuu Music' : 'Đang sử dụng ShinaYuu Music',
      state: this.config.showTrack && hasTrack
        ? safeText(p.isPlaying ? trackText : `Đang tạm dừng · ${trackText}`, 128)
        : 'Visual Music Experience',
      largeImageKey: this.config.largeImageKey || undefined,
      largeImageText: this.config.largeImageKey ? (this.config.largeImageText || 'ShinaYuu Music') : undefined,
      smallImageKey: this.config.smallImageKey || undefined,
      smallImageText: this.config.smallImageKey ? (this.config.smallImageText || 'ShinaYuu Music') : undefined,
      instance: false,
    };
    if (p.isPlaying && p.durationSec > 0) {
      const startMs = Date.now() - Math.round(p.positionSec * 1000);
      activity.startTimestamp = new Date(startMs);
      activity.endTimestamp = new Date(startMs + Math.round(p.durationSec * 1000));
    }
    return activity;
  }

  queueActivityUpdate(immediate) {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => {
      this.activityTimer = null;
      this.applyActivity().catch(() => {});
    }, immediate ? 0 : 700);
    this.activityTimer.unref?.();
  }

  async applyActivity() {
    if (!this.client || !this.state.connected || !this.config.enabled) return this.publicState();
    const activity = this.buildActivity();
    try {
      await this.client.setActivity(activity, this.processId);
      this.emitState({ activity: this.activityPayload ? { ...this.activityPayload } : null, error: '', errorDetail: '' });
    } catch (error) {
      const message = String(error && error.message || error || 'DISCORD_ACTIVITY_FAILED');
      console.warn('[DiscordPresence] Activity update failed:', message);
      this.emitState({ error: 'DISCORD_ACTIVITY_FAILED', errorDetail: message });
    }
    return this.publicState();
  }

  async shutdown() {
    await this.disconnect({ clear: true, permanent: true });
  }
}

module.exports = {
  DiscordPresenceManager,
  normalizeConfig,
  normalizeUser,
  isValidApplicationId,
  probeDiscordIpc,
  probeDiscordRuntime,
  classifyDiscordConnectionError,
};
