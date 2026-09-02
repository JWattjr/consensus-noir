/*
 * Portable environment resolution for the operator scripts.
 *
 * These scripts previously hard-coded one machine's global npm path and one
 * person's keychain account names, so they only ran for their author. Nothing
 * environment-specific belongs in a public script: the SDK location, the
 * account names and the contract address are all discovered or configured here.
 *
 * Overrides, all optional:
 *   CONSENSUS_NOIR_GENLAYER_MODULES   directory containing genlayer-js and keytar
 *   CONSENSUS_NOIR_CURATOR_ACCOUNT    GenLayer CLI account name used as curator
 *   CONSENSUS_NOIR_PLAYER_ACCOUNT     second account, for scripts needing two
 *   CONSENSUS_NOIR_CONTRACT           contract address, else deployment/studionet.json
 */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(HERE, "..", "..");

const SERVICE = "genlayer-cli";

function globalNodeModules() {
  try {
    // Node refuses to execFile a .cmd shim directly, so npm on Windows has to
    // go through a shell. The command is a constant with no interpolation, so
    // execSync is used rather than passing args alongside shell: true.
    return execSync("npm root -g", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Well-known global install locations, for when `npm root -g` is unavailable. */
function conventionalGlobalRoots() {
  const roots = [];
  const { APPDATA, ProgramFiles, npm_config_prefix: prefix } = process.env;
  if (prefix) roots.push(join(prefix, "node_modules"), join(prefix, "lib", "node_modules"));
  if (APPDATA) roots.push(join(APPDATA, "npm", "node_modules"));
  if (ProgramFiles) roots.push(join(ProgramFiles, "nodejs", "node_modules"));
  roots.push("/usr/local/lib/node_modules", "/usr/lib/node_modules");
  return roots;
}

/** Directories that might hold genlayer-js and keytar, most specific first. */
function candidateRoots() {
  const roots = [];
  const override = process.env.CONSENSUS_NOIR_GENLAYER_MODULES;
  if (override) roots.push(override);

  for (const globalRoot of [globalNodeModules(), ...conventionalGlobalRoots()].filter(Boolean)) {
    // The CLI keeps its own copies nested; prefer those, then the root itself.
    roots.push(join(globalRoot, "genlayer", "node_modules"), globalRoot);
  }
  // A locally installed copy, for anyone who prefers not to install globally.
  roots.push(join(APP_ROOT, "node_modules"), join(APP_ROOT, "frontend", "node_modules"));

  return [...new Set(roots)].filter((root) => root && existsSync(root));
}

function requireFrom(root, specifier) {
  // Anchor resolution inside the candidate root so package exports are honoured
  // rather than reaching into dist/ paths that may change between versions.
  const anchor = createRequire(pathToFileURL(join(root, "package.json")).href);
  return anchor(specifier);
}

/**
 * Loads the GenLayer SDK and keychain binding from wherever they are installed.
 * Throws with actionable guidance rather than a module-not-found stack.
 */
export function loadSdk() {
  const tried = [];
  for (const root of candidateRoots()) {
    try {
      const { createClient, createAccount } = requireFrom(root, "genlayer-js");
      const { studionet } = requireFrom(root, "genlayer-js/chains");
      const keytar = requireFrom(root, "keytar");
      return { createClient, createAccount, studionet, keytar, sdkRoot: root };
    } catch (error) {
      tried.push(`${root}: ${String(error?.message ?? error).split("\n")[0]}`);
    }
  }
  throw new Error(
    "Could not load genlayer-js and keytar.\n" +
      "Install the GenLayer CLI (npm i -g genlayer), or set\n" +
      "CONSENSUS_NOIR_GENLAYER_MODULES to a directory containing both.\n\n" +
      "Looked in:\n  " + (tried.join("\n  ") || "(no candidate directories existed)"),
  );
}

/**
 * Resolves which GenLayer CLI accounts to use.
 *
 * Prefers the environment variables; otherwise lists whatever the keychain
 * holds for the CLI and reports the choice, so the script never silently
 * signs with an account the operator did not expect.
 */
export async function resolveAccounts(keytar, { need = 1 } = {}) {
  const fromEnv = [process.env.CONSENSUS_NOIR_CURATOR_ACCOUNT, process.env.CONSENSUS_NOIR_PLAYER_ACCOUNT]
    .filter(Boolean);
  if (fromEnv.length >= need) return fromEnv.slice(0, need);

  let stored = [];
  try {
    stored = (await keytar.findCredentials(SERVICE))
      .map((entry) => entry.account)
      .filter((account) => account.startsWith("account:"))
      .map((account) => account.slice("account:".length))
      .sort();
  } catch {
    stored = [];
  }

  const names = [...fromEnv, ...stored.filter((name) => !fromEnv.includes(name))];
  if (names.length < need) {
    throw new Error(
      `This script needs ${need} unlocked GenLayer CLI account${need > 1 ? "s" : ""}, found ${names.length}.\n` +
        (stored.length ? `Available: ${stored.join(", ")}\n` : "No unlocked accounts found in the keychain.\n") +
        "Unlock accounts with the GenLayer CLI, or set CONSENSUS_NOIR_CURATOR_ACCOUNT" +
        (need > 1 ? " and CONSENSUS_NOIR_PLAYER_ACCOUNT." : "."),
    );
  }
  const chosen = names.slice(0, need);
  console.log(`Using GenLayer account${need > 1 ? "s" : ""}: ${chosen.join(", ")}\n`);
  return chosen;
}

/** Reads a private key from the CLI keychain. The key is never logged or written. */
export async function privateKeyFor(keytar, accountName) {
  const key = await keytar.getPassword(SERVICE, `account:${accountName}`);
  if (!key) throw new Error(`No unlocked keychain entry for "${accountName}".`);
  return key.startsWith("0x") ? key : `0x${key}`;
}

/** The deployed contract, from the environment or the recorded deployment. */
export function contractAddress() {
  if (process.env.CONSENSUS_NOIR_CONTRACT) return process.env.CONSENSUS_NOIR_CONTRACT;
  const recordPath = join(APP_ROOT, "deployment", "studionet.json");
  if (!existsSync(recordPath)) {
    throw new Error("No contract address: set CONSENSUS_NOIR_CONTRACT or add deployment/studionet.json.");
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (!record.contractAddress) {
    throw new Error("deployment/studionet.json has no contractAddress. Set CONSENSUS_NOIR_CONTRACT instead.");
  }
  return record.contractAddress;
}

/** One connected client per account name. */
export async function sessions(names) {
  const { createClient, createAccount, studionet, keytar } = loadSdk();
  const out = [];
  for (const name of names) {
    const account = createAccount(await privateKeyFor(keytar, name));
    out.push({ name, address: account.address, client: createClient({ chain: studionet, account }) });
  }
  return out;
}
