'use strict';

const fs = require('fs');
const path = require('path');
const { runtimePaths } = require('./castlabs-runtime-paths');

const root = path.resolve(__dirname, '..');
const paths = runtimePaths(root);

function fail(message) {
  console.error('[Castlabs verify] ' + message);
  process.exitCode = 1;
}

if (!fs.existsSync(paths.packageFile)) {
  fail('node_modules/electron is missing. Run npm install first.');
  return;
}

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(paths.packageFile, 'utf8'));
} catch (error) {
  fail('Unable to read Electron package metadata: ' + error.message);
  return;
}

const version = String(pkg.version || '');
if (!/wvcus/i.test(version)) {
  fail('Installed Electron is not a Castlabs wvcus build: ' + (version || 'unknown'));
  return;
}

if (!fs.existsSync(paths.executable)) {
  fail('Castlabs Electron executable is missing: ' + paths.executable);
  return;
}

const rawPath = fs.existsSync(paths.pathFile) ? fs.readFileSync(paths.pathFile) : Buffer.alloc(0);
const expectedPath = Buffer.from(paths.relativeExecutable, 'utf8');
if (!rawPath.equals(expectedPath)) {
  fail('path.txt is not normalized. Run npm run setup:castlabs.');
  return;
}

let installedVersion = '';
try {
  installedVersion = fs.readFileSync(paths.versionFile, 'utf8').trim().replace(/^v/, '');
} catch (_) {}
if (installedVersion !== version) {
  fail('Runtime version mismatch. Package=' + version + ', runtime=' + (installedVersion || 'missing'));
  return;
}

const stat = fs.statSync(paths.executable);
if (!stat.isFile() || stat.size < 1024 * 1024) {
  fail('The runtime executable is incomplete: ' + paths.executable);
  return;
}

console.log('[Castlabs verify] Package version: ' + version);
console.log('[Castlabs verify] Platform: ' + process.platform + '/' + process.arch);
console.log('[Castlabs verify] Executable: ' + paths.executable);
console.log('[Castlabs verify] Runtime installation looks complete.');
