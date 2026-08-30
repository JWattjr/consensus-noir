/*
 * Run the opt-in hosted test without ever writing private keys to git.
 * The two account keys are read from the GenLayer CLI OS keychain, placed in
 * gltest.config.yaml only for the child process, and restored in finally.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const keytar = require("C:/Users/User/AppData/Roaming/npm/node_modules/genlayer/node_modules/keytar");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "gltest.config.yaml");
const original = fs.readFileSync(configPath, "utf8");

async function main() {
  const names = ["moment-grid-studionet", "portal-five-release"];
  const keys = [];
  for (const name of names) {
    const key = await keytar.getPassword("genlayer-cli", "account:" + name);
    if (!key) throw new Error("No unlocked keychain entry for " + name);
    keys.push(key);
  }

  const temporaryConfig = [
    "networks:",
    "  default: studionet",
    "  studionet:",
    "    accounts: [\"" + keys[0] + "\", \"" + keys[1] + "\"]",
    "paths:",
    "  contracts: contracts",
    "  artifacts: artifacts",
    "environment: .env",
    "",
  ].join("\n");

  fs.writeFileSync(configPath, temporaryConfig, "utf8");
  try {
    const result = spawnSync(
      process.env.PYTHON ?? "C:/Python314/python.exe",
      ["-m", "pytest", "tests/integration/test_consensus_noir_studionet.py", "-m", "integration", "-v", "-s"],
      {
        cwd: root,
        env: { ...process.env, CONSENSUS_NOIR_RUN_INTEGRATION: "1" },
        stdio: "inherit",
      },
    );
    process.exitCode = result.status ?? 1;
  } finally {
    fs.writeFileSync(configPath, original, "utf8");
  }
}

main().catch((error) => {
  try { fs.writeFileSync(configPath, original, "utf8"); } catch { /* preserve the original error */ }
  console.error(error.message);
  process.exitCode = 1;
});
