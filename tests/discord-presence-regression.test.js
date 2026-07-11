'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const {
  DiscordPresenceManager,
  normalizeUser,
  isValidApplicationId,
  classifyDiscordConnectionError,
} = require('../desktop/discord-presence');

class FakeRpcClient extends EventEmitter {
  constructor() {
    super();
    this.user = {
      id: '123456789012345678',
      username: 'ShinaYuu',
      global_name: 'ShinaYuu',
      discriminator: '0',
      avatar: 'abc123',
    };
    this.activities = [];
    FakeRpcClient.instances.push(this);
  }

  async login({ clientId }) {
    this.clientId = clientId;
    setImmediate(() => this.emit('ready'));
    return this;
  }

  async setActivity(activity) {
    this.activities.push(activity);
    return activity;
  }

  async clearActivity() { this.cleared = true; }
  async destroy() { this.destroyed = true; }
}
FakeRpcClient.instances = [];

(async () => {
  assert.equal(isValidApplicationId('123456789012345678'), true);
  assert.equal(isValidApplicationId('abc'), false);
  const normalized = normalizeUser({
    id: '123456789012345678',
    username: 'ShinaYuu',
    global_name: 'ShinaYuu',
    discriminator: '0',
    avatar: 'abc123',
  });
  assert.equal(normalized.handle, '@ShinaYuu');
  assert.match(normalized.avatarUrl, /cdn\.discordapp\.com\/avatars/);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinayuu-discord-'));
  const configFile = path.join(tempDir, 'discord.json');
  const manager = new DiscordPresenceManager({
    configFile,
    processId: 4321,
    RPCClient: FakeRpcClient,
    runtimeProbe: async () => ({ running: true, ipcAvailable: true }),
  });

  await manager.configure({
    enabled: true,
    applicationId: '123456789012345678',
    largeImageKey: 'shinayuu',
  });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(manager.publicState().connected, true);
  assert.equal(manager.publicState().profile.displayName, 'ShinaYuu');

  manager.updateActivity({
    title: 'MONTAGEM 486',
    artist: 'NIGHTX!',
    source: 'Spotify',
    isPlaying: true,
    positionSec: 30,
    durationSec: 150,
  });
  await new Promise(resolve => setTimeout(resolve, 760));
  const client = FakeRpcClient.instances.at(-1);
  assert.ok(client.activities.length > 0);
  const activity = client.activities.at(-1);
  assert.equal(activity.details, 'Đang nghe trên ShinaYuu Music');
  assert.match(activity.state, /MONTAGEM 486/);
  assert.equal(activity.largeImageKey, 'shinayuu');


  assert.equal(classifyDiscordConnectionError(new Error('Could not connect'), { running:false, ipcAvailable:false }), 'DISCORD_NOT_RUNNING');
  assert.equal(classifyDiscordConnectionError(new Error('Could not connect'), { running:true, ipcAvailable:false }), 'DISCORD_IPC_UNAVAILABLE');
  assert.equal(classifyDiscordConnectionError(new Error('RPC_CONNECTION_TIMEOUT'), { running:true, ipcAvailable:true }), 'DISCORD_RPC_TIMEOUT');

  class FailingRpcClient extends EventEmitter {
    async login() { throw new Error('RPC_CONNECTION_TIMEOUT'); }
    async destroy() { this.destroyed = true; }
  }
  const timeoutConfig = path.join(tempDir, 'discord-timeout.json');
  fs.writeFileSync(timeoutConfig, JSON.stringify({ enabled:true, applicationId:'123456789012345678' }));
  const timeoutManager = new DiscordPresenceManager({
    configFile: timeoutConfig,
    RPCClient: FailingRpcClient,
    runtimeProbe: async () => ({ running:true, ipcAvailable:true }),
  });
  await timeoutManager.connect();
  assert.equal(timeoutManager.publicState().discordRunning, true);
  assert.equal(timeoutManager.publicState().error, 'DISCORD_RPC_TIMEOUT');
  await timeoutManager.shutdown();

  await manager.shutdown();
  assert.equal(client.cleared, true);
  assert.equal(client.destroyed, true);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Discord presence regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
