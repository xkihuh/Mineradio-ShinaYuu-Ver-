'use strict';

const path = require('path');

function executableRelativeForPlatform(platform = process.platform) {
  switch (platform) {
    case 'win32':
      return 'electron.exe';
    case 'darwin':
      return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
    case 'linux':
      return 'electron';
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function runtimePaths(projectRoot, platform = process.platform) {
  const electronRoot = path.join(projectRoot, 'node_modules', 'electron');
  const relativeExecutable = executableRelativeForPlatform(platform);
  return {
    electronRoot,
    packageFile: path.join(electronRoot, 'package.json'),
    installFile: path.join(electronRoot, 'install.js'),
    pathFile: path.join(electronRoot, 'path.txt'),
    distRoot: path.join(electronRoot, 'dist'),
    versionFile: path.join(electronRoot, 'dist', 'version'),
    relativeExecutable,
    executable: path.join(electronRoot, 'dist', relativeExecutable),
  };
}

module.exports = { executableRelativeForPlatform, runtimePaths };
