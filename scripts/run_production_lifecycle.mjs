/*
 * Drives a full entry -> reveal -> resolve -> claim cycle on the PRODUCTION
 * contract, so the deployment behind the live app proves its own settlement
 * rather than borrowing that proof from the integration deployment.
 *
 * Two keychain accounts both accuse SUSPECT-B but cite different exhibits, so
 * the run also demonstrates the evidence-weighted split.
 *
 * Keys come from the GenLayer CLI OS keychain and are never written or printed.
 *
 * Usage:
 *   node scripts/run_production_lifecycle.mjs glasshouse-0217-proof
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";

const CLI_MODULES = "C:/Users/User/AppData/Roaming/npm/node_modules/genlayer/node_modules";
const require = createRequire(import.meta.url);
const keytar = require(`${CLI_MODULES}/keytar`);
const { createClient, createAccount } = require(`${CLI_MODULES}/genlayer-js/dist/index.js`);
const { studionet } = require(`${CLI_MODULES}/genlayer-js/dist/chains/index.js`);

const CONTRACT = "0x3133B01d4EB7e1022913dF5fb1219cAE77D3f4a6";
const DOMAIN = "consensus-noir-accusation-v1";
const CASE_ID = process.argv[2] ?? "glasshouse-0217-proof";
const STAKE = 1000000000000000000n;

const sha256 = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const normalize = (text) => text.normalize("NFKC").trim().split(/\s+/u).join(" ");

/** Mirrors _accusation_commitment in contracts/consensus_noir.py exactly. */
function commitment(caseId, player, suspectId, theory, picks, salt) {
  const canonical = [
    DOMAIN,
    caseId,
    player.toLowerCase(),
    suspectId,
    sha256(normalize(theory)),
    [...new Set(picks)].sort().join(","),
    salt,
  ].join("\x1f");
  return sha256(canonical);
}

const PLAYERS = [
  {
    keychain: "moment-grid-studionet",
    suspect: "SUSPECT-B",
    // Matches the exhibits validators cited on the integration run -> weight 4.
    picks: ["EVIDENCE-01", "EVIDENCE-03", "EVIDENCE-04"],
    salt: "a".repeat(32),
    theory:
      "The restoration lead is the only person the physical trail can accommodate. " +
      "The latch sensor records an interior release at 02:17, which rules out a forced " +
      "entry from the garden and means somebody already inside opened it. The camera " +
      "reflection places a silver repair case beside that latch at the same moment, and " +
      "the inventory shows only the restoration lead signed a silver repair case out that " +
      "night. The service badge opening the east corridor at 02:26 fits a departure after " +
      "the fact rather than an arrival before it. Taken together these are independent " +
      "records that converge on one person, and the alternative readings each require " +
      "discarding one of them without cause.",
  },
  {
    keychain: "portal-five-release",
    suspect: "SUSPECT-B",
    // Deliberately different -> partial overlap, exercising the weighted split.
    picks: ["EVIDENCE-02", "EVIDENCE-04", "EVIDENCE-05"],
    salt: "b".repeat(32),
    theory:
      "The access trail is what settles this. Badge C-19 opens the east corridor at 02:26, " +
      "the security desk logs a radio request from that same corridor, and the inventory " +
      "record shows the restoration lead holding the silver repair case that night. A " +
      "curator leaving before the lights failed cannot account for the badge event, and a " +
      "security liaison already stationed in the archive corridor would not need to request " +
      "passage through it. The reading that survives every one of these records without " +
      "special pleading is that the restoration lead staged the incident and left through " +
      "the corridor afterwards.",
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clientFor(keychainName) {
  const key = await keytar.getPassword("genlayer-cli", `account:${keychainName}`);
  if (!key) throw new Error(`No unlocked keychain entry for "${keychainName}".`);
  const account = createAccount(key.startsWith("0x") ? key : `0x${key}`);
  return { client: createClient({ chain: studionet, account }), address: account.address };
}

async function send(client, label, functionName, args, value = 0n) {
  process.stdout.write(`  ${label} … `);
  const hash = await client.writeContract({ address: CONTRACT, functionName, args, value });
  await client.waitForTransactionReceipt({ hash, retries: 200, interval: 3000 });
  console.log(hash);
  return hash;
}

async function readCase(client) {
  return client.readContract({ address: CONTRACT, functionName: "get_case", args: [CASE_ID] });
}

async function waitUntil(client, unix, label) {
  for (;;) {
    const remaining = unix - Math.floor(Date.now() / 1000);
    if (remaining <= 0) return;
    console.log(`  waiting ${remaining}s for ${label}…`);
    await sleep(Math.min(remaining, 30) * 1000);
  }
}

async function main() {
  const sessions = [];
  for (const player of PLAYERS) sessions.push({ ...player, ...(await clientFor(player.keychain)) });
  const lead = sessions[0].client;

  const caseFile = await readCase(lead);
  if (caseFile.status !== "OPEN") throw new Error(`Case ${CASE_ID} is ${caseFile.status}, expected OPEN.`);
  console.log(`Case ${CASE_ID} is OPEN. Stake ${caseFile.entry_stake}.\n`);

  const tx = {};

  console.log("1. Entries");
  for (const [index, session] of sessions.entries()) {
    const digest = commitment(CASE_ID, session.address, session.suspect, session.theory, session.picks, session.salt);
    tx[`enter_${index + 1}`] = await send(session.client, `player ${index + 1} enters`, "enter_case", [CASE_ID, digest], STAKE);
  }

  console.log("\n2. Advance to REVEAL");
  await waitUntil(lead, Number(caseFile.accusation_deadline), "the accusation window to close");
  tx.advance_reveal = await send(lead, "advance_case", "advance_case", [CASE_ID]);

  console.log("\n3. Reveals");
  for (const [index, session] of sessions.entries()) {
    tx[`reveal_${index + 1}`] = await send(
      session.client,
      `player ${index + 1} reveals`,
      "reveal_accusation",
      [CASE_ID, session.suspect, normalize(session.theory), JSON.stringify([...session.picks].sort()), session.salt],
    );
  }

  console.log("\n4. Advance to RESOLVABLE");
  await waitUntil(lead, Number(caseFile.reveal_deadline), "the reveal window to close");
  tx.advance_resolvable = await send(lead, "advance_case", "advance_case", [CASE_ID]);

  console.log("\n5. Verdict");
  await waitUntil(lead, Number(caseFile.resolution_eligibility_time), "resolution eligibility");
  tx.resolve = await send(lead, "resolve_case", "resolve_case", [CASE_ID]);

  const resolved = await readCase(lead);
  console.log(`\n  status: ${resolved.status}`);
  console.log(`  resolution: ${JSON.stringify(resolved.resolution)}`);
  if (resolved.status !== "RESOLVED") {
    console.log("\n  Verdict was not FINAL, so there is no payout to prove on this case.");
    console.log("CONSENSUS_NOIR_LIFECYCLE_RESULT=" + JSON.stringify({ caseId: CASE_ID, status: resolved.status, transactions: tx }));
    return;
  }

  console.log("\n6. Claims");
  const before = await lead.readContract({ address: CONTRACT, functionName: "get_accounting", args: [CASE_ID] });
  for (const [index, session] of sessions.entries()) {
    try {
      tx[`claim_${index + 1}`] = await send(session.client, `player ${index + 1} claims`, "claim_case", [CASE_ID]);
    } catch (error) {
      console.log(`skipped (${error?.message?.split("\n")[0] ?? error})`);
    }
  }
  const after = await lead.readContract({ address: CONTRACT, functionName: "get_accounting", args: [CASE_ID] });
  console.log(`\n  paid_out: ${before.paid_out} -> ${after.paid_out} of ${after.total_escrow}`);

  console.log(
    "\nCONSENSUS_NOIR_LIFECYCLE_RESULT=" +
      JSON.stringify({
        caseId: CASE_ID,
        contractAddress: CONTRACT,
        status: resolved.status,
        resolution: resolved.resolution,
        paidOut: String(after.paid_out),
        totalEscrow: String(after.total_escrow),
        transactions: tx,
      }),
  );
}

main().catch((error) => {
  console.error("\n" + (error?.message ?? error));
  process.exitCode = 1;
});
