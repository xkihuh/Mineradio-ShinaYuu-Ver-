'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {
  DiscordIpcClient,
  FrameDecoder,
  encodeFrame,
  OPCODE,
} = require('../desktop/discord-ipc-client');

function listen(server, socketPath) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinayuu-discord-ipc-'));
  const socketPath = path.join(tempDir, 'discord-ipc-test.sock');
  const requests = [];

  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder(({ op, data }) => {
      if (op === OPCODE.HANDSHAKE) {
        assert.equal(data.v, 1);
        assert.equal(data.client_id, '123456789012345678');
        const ready = encodeFrame(OPCODE.FRAME, {
          cmd: 'DISPATCH',
          evt: 'READY',
          data: {
            user: {
              id: '123456789012345678',
              username: 'ShinaYuu',
              global_name: 'ShinaYuu',
              discriminator: '0',
              avatar: null,
            },
            application: { id: data.client_id, name: 'ShinaYuu Music' },
          },
        });
        // Deliberately fragment both the header and JSON body. The old
        // discord-rpc decoder could time out when READY arrived this way.
        socket.write(ready.subarray(0, 3));
        setTimeout(() => socket.write(ready.subarray(3, 11)), 2);
        setTimeout(() => socket.write(ready.subarray(11)), 4);
        return;
      }

      if (op === OPCODE.FRAME && data.cmd === 'SET_ACTIVITY') {
        requests.push(data);
        socket.write(encodeFrame(OPCODE.FRAME, {
          cmd: 'SET_ACTIVITY',
          evt: null,
          nonce: data.nonce,
          data: { accepted: true },
        }));
        return;
      }

      if (op === OPCODE.CLOSE) socket.end();
    });
    socket.on('data', (chunk) => decoder.push(chunk));
  });

  await listen(server, socketPath);

  const client = new DiscordIpcClient({
    transport: 'ipc',
    ipcPaths: [socketPath],
    pipeTimeoutMs: 250,
    connectTimeoutMs: 1000,
    requestTimeoutMs: 1000,
  });

  let readyCount = 0;
  client.on('ready', () => { readyCount += 1; });
  await client.login({ clientId: '123456789012345678' });
  assert.equal(readyCount, 1);
  assert.equal(client.connected, true);
  assert.equal(client.user.username, 'ShinaYuu');
  assert.equal(client.ipcPath, socketPath);

  await client.setActivity({
    details: 'Đang nghe trên ShinaYuu Music',
    state: 'MONTAGEM SOLITARIA — Ranifish222',
    startTimestamp: new Date(Date.now() - 10_000),
    endTimestamp: new Date(Date.now() + 90_000),
    largeImageKey: 'shinayuu',
  }, 4321);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].args.pid, 4321);
  assert.equal(requests[0].args.activity.details, 'Đang nghe trên ShinaYuu Music');
  assert.equal(requests[0].args.activity.assets.large_image, 'shinayuu');

  await client.clearActivity(4321);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].args.pid, 4321);
  assert.equal(Object.prototype.hasOwnProperty.call(requests[1].args, 'activity'), false);

  await client.destroy();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await closeServer(server);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Discord built-in IPC client regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
