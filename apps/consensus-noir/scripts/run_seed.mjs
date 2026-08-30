/*
 * Runner for the deploy/ seed scripts.
 *
 * The GenLayer CLI has no "run a deploy script" command, so the seeders in
 * deploy/ had no way to execute. This supplies one.
 *
 * Private keys are read from the GenLayer CLI's OS keychain and handed straight
 * to genlayer-js. They are never written to disk, never placed in a config file,
 * and never printed.
 *
 * Usage:
 *   node scripts/run_seed.mjs 02_seed_reviewer_cases reviewer
 *   node scripts/run_seed.mjs 02_seed_reviewer_cases proof
 *   node scripts/run_seed.mjs 01_seed_studionet
 *
 * Options:
 *   --account <keychain-name>   defaults to moment-grid-studionet (the curator)
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CLI_MODULES = "C:/Users/User/AppData/Roaming/npm/node_modules/genlayer/node_modules";
const require = createRequire(import.meta.url);
const keytar = require(`${CLI_MODULES}/keytar`);
const { createClient, createAccount } = require(`${CLI_MODULES}/genlayer-js/dist/index.js`);
const { studionet } = require(`${CLI_MODULES}/genlayer-js/dist/chains/index.js`);

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");

function arg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  const scriptName = positional[0];
  const profile = positional[1];
  if (!scriptName) {
    throw new Error("Usage: node scripts/run_seed.mjs <deploy-script-name> [profile] [--account <name>]");
  }

  const accountName = arg("--account", "moment-grid-studionet");
  const key = await keytar.getPassword("genlayer-cli", `account:${accountName}`);
  if (!key) {
    throw new Error(
      `No unlocked keychain entry for "${accountName}". ` +
        `Unlock it with the GenLayer CLI first; this runner never accepts a key on the command line.`,
    );
  }

  const client = createClient({
    chain: studionet,
    account: createAccount(key.startsWith("0x") ? key : `0x${key}`),
  });

  const modulePath = path.join(root, "deploy", `${scriptName}.js`);
  const seed = (await import(pathToFileURL(modulePath).href)).default;
  if (typeof seed !== "function") {
    throw new Error(`${modulePath} has no default-exported seed function.`);
  }

  console.log(`Running deploy/${scriptName}.js` + (profile ? ` (${profile})` : "") + ` as ${accountName}`);
  const result = profile ? await seed(client, profile) : await seed(client);
  if (result) console.log("\nPaste this into deployment/studionet.json:\n" + JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
