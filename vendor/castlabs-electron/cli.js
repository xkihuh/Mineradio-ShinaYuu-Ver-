#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const electron = require('./');
const child = spawn(electron, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: false,
  env: process.env,
});
child.on('error', (error) => {
  console.error(error && (error.stack || error.message) || error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 1 : code);
});
