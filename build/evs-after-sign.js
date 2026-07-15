"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    windowsHide: true
  });

  if (result.error) {
    return {
      ok: false,
      error: result.error.message
    };
  }

  return {
    ok: result.status === 0,
    error: `Exit code ${result.status}`
  };
}

function runEvs(argumentsList, cwd) {
  const candidates = process.platform === "win32"
    ? [
        ["py", ["-3", ...argumentsList]],
        ["python", argumentsList]
      ]
    : [
        ["python3", argumentsList],
        ["python", argumentsList]
      ];

  const errors = [];

  for (const [command, args] of candidates) {
    const result = runCommand(command, args, cwd);

    if (result.ok) {
      return;
    }

    errors.push(`${command}: ${result.error}`);
  }

  throw new Error(
    `Unable to execute Castlabs EVS:\n${errors.join("\n")}`
  );
}

exports.default = async function evsAfterSign(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const appOutDir = context.appOutDir;
  const executablePath = path.join(
    appOutDir,
    "ShinaYuuMusic.exe"
  );

  if (!fs.existsSync(executablePath)) {
    throw new Error(
      `Packaged executable was not found: ${executablePath}`
    );
  }

  console.log("");
  console.log("[EVS] Signing production VMP package...");
  console.log(`[EVS] Package: ${appOutDir}`);

  runEvs(
    [
      "-m",
      "castlabs_evs.vmp",
      "sign-pkg",
      appOutDir
    ],
    appOutDir
  );

  console.log("[EVS] Verifying production VMP signature...");

  runEvs(
    [
      "-m",
      "castlabs_evs.vmp",
      "verify-pkg",
      appOutDir
    ],
    appOutDir
  );

  console.log("[EVS] VMP signing and verification completed.");
  console.log("");
};