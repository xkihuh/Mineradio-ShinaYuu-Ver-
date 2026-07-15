'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runtimePaths } = require('./castlabs-runtime-paths');

const root = path.resolve(__dirname, '..');
const paths = runtimePaths(root);

function fail(message) {
  console.error('[Castlabs setup] ' + message);
  process.exit(1);
}

if (!fs.existsSync(paths.packageFile)) {
  fail('node_modules/electron is missing. Run npm install first.');
}

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(paths.packageFile, 'utf8'));
} catch (error) {
  fail('Unable to read node_modules/electron/package.json: ' + error.message);
}

const version = String(pkg.version || '');
if (!/wvcus/i.test(version)) {
  fail('The installed Electron package is not Castlabs ECS: ' + (version || 'unknown'));
}

function installedVersionMatches() {
  try {
    return fs.readFileSync(paths.versionFile, 'utf8').trim().replace(/^v/, '') === version;
  } catch (_) {
    return false;
  }
}

function runtimeLooksValid() {
  try {
    const stat = fs.statSync(paths.executable);
    return stat.isFile() && stat.size > 1024 * 1024 && installedVersionMatches();
  } catch (_) {
    return false;
  }
}

if (!runtimeLooksValid()) {
  if (!fs.existsSync(paths.installFile)) {
    fail('Castlabs install.js is missing. Delete node_modules/electron and run npm install again.');
  }

  console.log('[Castlabs setup] Installing the ' + process.platform + '/' + process.arch + ' runtime...');
  const result = spawnSync(process.execPath, [paths.installFile], {
    cwd: paths.electronRoot,
    env: {
      ...process.env,
      ELECTRON_INSTALL_PLATFORM: process.platform,
      ELECTRON_INSTALL_ARCH: process.arch,
    },
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) fail('Unable to run Castlabs install.js: ' + result.error.message);
  if (result.status !== 0) fail('Castlabs install.js exited with code ' + result.status + '.');
}

if (!runtimeLooksValid()) {
  fail('The Castlabs runtime was not installed correctly at ' + paths.executable);
}

// Castlabs reads path.txt verbatim. Keep it free of BOM and line endings.
fs.writeFileSync(paths.pathFile, Buffer.from(paths.relativeExecutable, 'utf8'));

console.log('[Castlabs setup] Package version: ' + version);
console.log('[Castlabs setup] Executable: ' + paths.executable);
console.log('[Castlabs setup] Runtime is ready.');
