'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fail(message) {
  console.error(`[EVS] ${message}`);
  process.exit(1);
}

function pythonCandidates(args) {
  if (process.platform === 'win32') {
    return [
      ['py', ['-3', ...args]],
      ['python', args],
      ['python3', args],
    ];
  }
  return [
    ['python3', args],
    ['python', args],
  ];
}

function runPython(args, cwd) {
  let lastFailure = 'No Python interpreter was available.';
  for (const [command, commandArgs] of pythonCandidates(args)) {
    const result = spawnSync(command, commandArgs, {
      cwd,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });

    if (!result.error && result.status === 0) return;
    if (result.error && result.error.code === 'ENOENT') {
      lastFailure = `${command} was not found.`;
      continue;
    }
    lastFailure = result.error?.message || `${command} exited with code ${result.status}`;
  }
  fail(`EVS command failed. ${lastFailure}`);
}

const action = String(process.argv[2] || '').toLowerCase();
const targetArg = process.argv[3];
if (!['sign', 'verify'].includes(action) || !targetArg) {
  fail('Usage: node tools/evs-package.js <sign|verify> <package-directory>');
}

const root = path.resolve(__dirname, '..');
const target = path.resolve(root, targetArg);
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  fail(`Package directory was not found: ${target}`);
}

const command = action === 'sign' ? 'sign-pkg' : 'verify-pkg';
console.log(`[EVS] ${action === 'sign' ? 'Signing' : 'Verifying'} package: ${target}`);
runPython(['-m', 'castlabs_evs.vmp', command, target], root);
console.log(`[EVS] ${action === 'sign' ? 'Production VMP signing' : 'VMP verification'} completed.`);
