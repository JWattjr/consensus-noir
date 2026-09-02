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
 *   --account <name>   GenLayer CLI account. Defaults to
 *                      CONSENSUS_NOIR_CURATOR_ACCOUNT, else the first
 *                      unlocked account in the keychain.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_ROOT, loadSdk, resolveAccounts, privateKeyFor } from "./lib/genlayer-env.mjs";

const { createClient, createAccount, studionet, keytar } = loadSdk();


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

  const [discovered] = await resolveAccounts(keytar, { need: 1 });
  const accountName = arg("--account", discovered);
  const client = createClient({
    chain: studionet,
    account: createAccount(await privateKeyFor(keytar, accountName)),
  });

  const modulePath = path.join(APP_ROOT, "deploy", `${scriptName}.js`);
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
