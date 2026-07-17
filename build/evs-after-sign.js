const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

function runPython(args, cwd) {
  const commands = process.platform === "win32"
    ? [
        ["py", ["-3", ...args]],
        ["python", args],
      ]
    : [
        ["python3", args],
        ["python", args],
      ];

  let lastError = "";

  for (const [command, commandArgs] of commands) {
    const result = spawnSync(command, commandArgs, {
      cwd,
      stdio: "inherit",
      shell: true,
    });

    if (!result.error && result.status === 0) {
      return;
    }

    lastError = result.error?.message || `Exit code ${result.status}`;
  }

  throw new Error(`EVS command failed: ${lastError}`);
}

exports.default = async function evsAfterSign(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const appDirectory = context.appOutDir;

  if (!fs.existsSync(appDirectory)) {
    throw new Error(`Packaged app directory was not found: ${appDirectory}`);
  }

  console.log(`[EVS] Signing packaged app: ${appDirectory}`);

  runPython(
    ["-m", "castlabs_evs.vmp", "sign-pkg", appDirectory],
    context.outDir
  );

  console.log("[EVS] Verifying VMP signature...");

  runPython(
    ["-m", "castlabs_evs.vmp", "verify-pkg", appDirectory],
    context.outDir
  );

  console.log("[EVS] Production VMP signing completed.");
};