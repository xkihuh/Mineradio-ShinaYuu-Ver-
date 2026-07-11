'use strict';

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32') {
  console.error('preview:win chỉ chạy trên Windows.');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const builder = path.join(root, 'node_modules', '.bin', 'electron-builder.cmd');
const exe = path.join(root, 'dist', 'win-unpacked', 'ShinaYuuMusic.exe');

if (!fs.existsSync(builder)) {
  console.error('Chưa có electron-builder. Hãy chạy npm install trước.');
  process.exit(1);
}

execFileSync(builder, ['--win', 'dir', '--x64', '--publish', 'never'], {
  cwd: root,
  stdio: 'inherit',
});

if (!fs.existsSync(exe)) {
  console.error(`Không tìm thấy bản đóng gói: ${exe}`);
  process.exit(1);
}

const child = spawn(exe, [], {
  cwd: path.dirname(exe),
  detached: true,
  windowsHide: false,
  stdio: 'ignore',
});
child.unref();
console.log(`Đã mở bản EXE đóng gói: ${exe}`);
