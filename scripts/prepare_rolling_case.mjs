/*
 * Produces a judge-ready case in one command.
 *
 * A long-window case is always joinable but cannot be completed in a sitting;
 * a short-window case completes but expires. You need both, so this seeds the
 * short one and pre-fills it with two entries, which means a visitor is player
 * three, min_players is already satisfied, and they can run
 * enter -> reveal -> resolve -> claim while still on the page.
 *
 * Re-run it before recording a demo or before judging. Each run appends a new
 * case to the contract's case list, so don't run it more often than you need.
 *
 * Usage:
 *   node scripts/prepare_rolling_case.mjs               # pressroom dossier
 *   node scripts/prepare_rolling_case.mjs glasshouse
 */
import crypto from "node:crypto";
import { DOSSIERS, createArgs } from "../deploy/dossiers.js";
import { SEEDED } from "./seeded-players.mjs";
import { contractAddress, loadSdk, resolveAccounts, privateKeyFor } from "./lib/genlayer-env.mjs";

const CONTRACT = contractAddress();
const { createClient, createAccount, studionet, keytar } = loadSdk();
const DOMAIN = "consensus-noir-accusation-v1";
const STAKE = 1000000000000000000n;

// Long enough for a visitor to read the dossier and commit, short enough that
// the whole cycle finishes inside about half an hour.
const WINDOWS = { accusation: 1200, reveal: 1800, resolution: 1980, refund: 10800 };

const sha256 = (v) => crypto.createHash("sha256").update(v, "utf8").digest("hex");
const normalize = (t) => t.normalize("NFKC").trim().split(/\s+/u).join(" ");
const clock = (u) => new Date(u * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

function commitment(caseId, player, suspectId, theory, picks, salt) {
  return sha256(
    [DOMAIN, caseId, player.toLowerCase(), suspectId, sha256(normalize(theory)),
      [...new Set(picks)].sort().join(","), salt].join("\x1f"),
  );
}

async function session(accountName) {
  const account = createAccount(await privateKeyFor(keytar, accountName));
  return { client: createClient({ chain: studionet, account }), address: account.address };
}

async function send(client, label, functionName, args, value = 0n) {
  process.stdout.write(`  ${label} … `);
  const hash = await client.writeContract({ address: CONTRACT, functionName, args, value });
  await client.waitForTransactionReceipt({ hash, retries: 200, interval: 3000 });
  console.log(hash);
  return hash;
}

async function main() {
  const name = (process.argv[2] ?? "pressroom").toLowerCase();
  const dossier = DOSSIERS[name];
  if (!dossier) throw new Error(`Unknown dossier "${name}". Use: ${Object.keys(DOSSIERS).join(", ")}`);

  const seeded = SEEDED[name] ?? [];
  // The curator also plays: seeded player 1 signs with the curator account, so
  // this needs as many accounts as there are seeded players, not one more.
  const accounts = await resolveAccounts(keytar, { need: Math.max(1, seeded.length) });
  const curatorAccount = accounts[0];

  const now = Math.floor(Date.now() / 1000);
  const caseId = `${dossier.key}-r${now.toString(36)}`;
  const curator = await session(curatorAccount);

  console.log(`Seeding ${caseId} — "${dossier.title}"\n`);
  const createTransaction = await send(curator.client, "create_case", "create_case",
    createArgs(dossier, caseId, WINDOWS, now, STAKE, 2, 16));
  const publishTransaction = await send(curator.client, "publish_case", "publish_case", [caseId]);

  console.log("\nPre-filling entries so a visitor is never stuck below min_players:");
  const entries = {};
  for (const [index, seed] of seeded.entries()) {
    const player = await session(accounts[index % accounts.length]);
    const digest = commitment(caseId, player.address, seed.suspect, seed.theory, seed.picks, seed.salt);
    entries[`enter_${index + 1}`] = await send(player.client, `player ${index + 1} enters`,
      "enter_case", [caseId, digest], STAKE);
  }

  const record = {
    caseId, dossier: name, contractAddress: CONTRACT,
    createTransaction, publishTransaction, entries,
    accusationDeadline: now + WINDOWS.accusation,
    revealDeadline: now + WINDOWS.reveal,
    resolutionEligibilityTime: now + WINDOWS.resolution,
    refundDeadline: now + WINDOWS.refund,
    entryStakeWei: String(STAKE), minPlayers: 2, maxPlayers: 16,
  };

  console.log(`\n  entries close    ${clock(record.accusationDeadline)}`);
  console.log(`  reveal closes    ${clock(record.revealDeadline)}`);
  console.log(`  verdict from     ${clock(record.resolutionEligibilityTime)}`);
  console.log(`\n  A visitor can complete the full loop in about 30 minutes from now.`);
  console.log(`\n  Then, in order:`);
  console.log(`    node scripts/reveal_seeded.mjs ${caseId} ${name}`);
  console.log(`    node scripts/finish_rolling_case.mjs ${caseId}`);
  console.log(`\n  The second one matters. A rolling case nobody finishes stalls with`);
  console.log(`  escrow locked, and past its refund deadline it can never reach a verdict.\n`);
  console.log("CONSENSUS_NOIR_ROLLING_RESULT=" + JSON.stringify(record));
}

main().catch((error) => {
  console.error("\n" + (error?.message ?? error));
  process.exitCode = 1;
});
