/*
 * Runs the opt-in hosted test without ever writing private keys to git.
 *
 * Keys are read from the GenLayer CLI OS keychain, placed in gltest.config.yaml
 * only for the child process, and the original file is restored in a finally
 * block whether the run passes, fails, or is interrupted.
 *
 * Account names and the SDK location are resolved from the environment rather
 * than hard-coded, so this runs on any machine. See scripts/lib/genlayer-env.mjs.
 *
 * Usage:
 *   node scripts/run_studionet_integration.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT, loadSdk, resolveAccounts, privateKeyFor } from "./lib/genlayer-env.mjs";

const configPath = join(APP_ROOT, "gltest.config.yaml");
const original = readFileSync(configPath, "utf8");

function pythonCommand() {
  if (process.env.PYTHON) return process.env.PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

async function main() {
  const { keytar } = loadSdk();
  const accounts = await resolveAccounts(keytar, { need: 2 });
  const keys = [];
  for (const name of accounts) keys.push(await privateKeyFor(keytar, name));

  const temporaryConfig = [
    "networks:",
    "  default: studionet",
    "  studionet:",
    `    accounts: [${keys.map((key) => `"${key}"`).join(", ")}]`,
    "paths:",
    "  contracts: contracts",
    "  artifacts: artifacts",
    "environment: .env",
    "",
  ].join("\n");

  writeFileSync(configPath, temporaryConfig, "utf8");
  try {
    const result = spawnSync(
      pythonCommand(),
      ["-m", "pytest", "tests/integration/test_consensus_noir_studionet.py", "-m", "integration", "-v", "-s"],
      {
        cwd: APP_ROOT,
        env: { ...process.env, CONSENSUS_NOIR_RUN_INTEGRATION: "1" },
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );
    process.exitCode = result.status ?? 1;
  } finally {
    writeFileSync(configPath, original, "utf8");
  }
}

main().catch((error) => {
  try {
    writeFileSync(configPath, original, "utf8");
  } catch {
    /* keep the original failure visible */
  }
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
