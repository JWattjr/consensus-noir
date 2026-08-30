import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const gltestCandidates = process.platform === "win32"
  ? [resolve("genlayer/.venv/Scripts/gltest.exe"), "gltest.exe", "gltest"]
  : [resolve("genlayer/.venv/bin/gltest"), "gltest"];
const gltest = gltestCandidates.find((candidate) =>
  candidate.includes("/") || candidate.includes("\\") ? existsSync(candidate) : true,
);

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, cwd });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!gltest) throw new Error("Install the GenLayer test environment before running the network flow.");

console.log("Running real Studionet web adjudication through the authenticated Base message…");
const networkRun = spawnSync(
  gltest,
  [
    "tests/integration/test_studionet_real_resolution.py",
    "-v",
    "-s",
    "-p",
    "no:cacheprovider",
    "--network",
    "studionet",
  ],
  {
    cwd: "genlayer",
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
  },
);
if (networkRun.stdout) process.stdout.write(networkRun.stdout);
if (networkRun.stderr) process.stderr.write(networkRun.stderr);
if (networkRun.error) throw networkRun.error;
if (networkRun.status !== 0) process.exit(networkRun.status ?? 1);

const markerPrefix = "PROOFPLAY_STUDIONET_RESULT=";
const marker = networkRun.stdout
  .split(/\r?\n/)
  .find((line) => line.includes(markerPrefix));
if (!marker) throw new Error("Studionet completed without exporting its consensus result.");
const networkProof = JSON.parse(marker.slice(marker.indexOf(markerPrefix) + markerPrefix.length));

console.log("Relaying that exact Studionet result through Base settlement and payout…");
run(process.execPath, ["contracts/scripts/full-flow.mjs", JSON.stringify(networkProof)]);
console.log("✓ Football-duel real-web network flow passed");
