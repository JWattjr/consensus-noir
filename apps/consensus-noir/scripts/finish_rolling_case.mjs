/*
 * Drives a case to a clean terminal state.
 *
 * A rolling case that nobody finishes does not sit still — it stalls in REVEAL
 * or RESOLVABLE with escrow locked, and once the refund deadline passes it can
 * never reach a verdict at all. Left alone, every refresh leaves another dead
 * case in the rail with GEN stranded in it.
 *
 * This closes one out, taking whichever route the contract still allows:
 *   advance -> resolve -> (settlement is left to the players)
 *   or, past the refund deadline, make_refundable -> refund every entry
 *
 * Every call here is permissionless; the curator has no special power over it.
 *
 * Usage:
 *   node scripts/finish_rolling_case.mjs <caseId>
 */
import { createRequire } from "node:module";

const CLI_MODULES = "C:/Users/User/AppData/Roaming/npm/node_modules/genlayer/node_modules";
const require = createRequire(import.meta.url);
const keytar = require(`${CLI_MODULES}/keytar`);
const { createClient, createAccount } = require(`${CLI_MODULES}/genlayer-js/dist/index.js`);
const { studionet } = require(`${CLI_MODULES}/genlayer-js/dist/chains/index.js`);

const CONTRACT = "0x3133B01d4EB7e1022913dF5fb1219cAE77D3f4a6";
const ACCOUNTS = ["moment-grid-studionet", "portal-five-release"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(keychain) {
  const key = await keytar.getPassword("genlayer-cli", `account:${keychain}`);
  if (!key) throw new Error(`No unlocked keychain entry for "${keychain}".`);
  const account = createAccount(key.startsWith("0x") ? key : `0x${key}`);
  return { client: createClient({ chain: studionet, account }), address: account.address, keychain };
}

async function send(client, label, functionName, args) {
  process.stdout.write(`  ${label} … `);
  try {
    const hash = await client.writeContract({ address: CONTRACT, functionName, args, value: 0n });
    await client.waitForTransactionReceipt({ hash, retries: 200, interval: 3000 });
    console.log(hash);
    return hash;
  } catch (error) {
    console.log(`skipped (${String(error?.message ?? error).split("\n")[0]})`);
    return null;
  }
}

const read = (client, caseId) =>
  client.readContract({ address: CONTRACT, functionName: "get_case", args: [caseId] });

async function main() {
  const caseId = process.argv[2];
  if (!caseId) throw new Error("Usage: node scripts/finish_rolling_case.mjs <caseId>");

  const sessions = [];
  for (const name of ACCOUNTS) sessions.push(await session(name));
  const lead = sessions[0].client;

  let caseFile = await read(lead, caseId);
  const now = () => Math.floor(Date.now() / 1000);
  console.log(`${caseId}: ${caseFile.status}, escrow ${Number(caseFile.total_escrow) / 1e18} GEN\n`);

  const pastRefund = now() >= Number(caseFile.refund_deadline);

  if (!pastRefund) {
    // Still recoverable as a real verdict: walk it forward.
    while (["OPEN", "REVEAL"].includes(caseFile.status)) {
      const gate = caseFile.status === "OPEN"
        ? Number(caseFile.accusation_deadline)
        : Number(caseFile.reveal_deadline);
      const wait = gate - now();
      if (wait > 0) {
        console.log(`  waiting ${wait}s for the ${caseFile.status} window to close…`);
        await sleep(Math.min(wait, 30) * 1000);
        continue;
      }
      await send(lead, `advance from ${caseFile.status}`, "advance_case", [caseId]);
      caseFile = await read(lead, caseId);
    }
    if (caseFile.status === "RESOLVABLE") {
      const wait = Number(caseFile.resolution_eligibility_time) - now();
      if (wait > 0) {
        console.log(`  waiting ${wait}s for resolution eligibility…`);
        await sleep((wait + 2) * 1000);
      }
      await send(lead, "resolve_case", "resolve_case", [caseId]);
      caseFile = await read(lead, caseId);
    }
  }

  if (["OPEN", "REVEAL", "RESOLVABLE"].includes(caseFile.status) && now() >= Number(caseFile.refund_deadline)) {
    console.log("\n  Past the refund deadline with no verdict — using the liveness backstop.");
    await send(lead, "make_refundable", "make_refundable", [caseId]);
    caseFile = await read(lead, caseId);
  }

  if (["VOID", "CANCELLED", "REFUNDABLE"].includes(caseFile.status) || caseFile.no_winner_refund) {
    console.log("\n  Returning stakes:");
    for (const player of sessions) await send(player.client, `refund ${player.keychain}`, "refund_case", [caseId]);
  } else if (caseFile.status === "RESOLVED") {
    console.log("\n  Resolved. Settlement is left to the players who entered.");
  }

  const done = await read(lead, caseId);
  const accounting = await lead.readContract({ address: CONTRACT, functionName: "get_accounting", args: [caseId] });
  console.log(`\n  final: ${done.status}  paid ${Number(accounting.paid_out) / 1e18} of ${Number(accounting.total_escrow) / 1e18} GEN  unpaid ${Number(accounting.unpaid_obligation) / 1e18}`);
}

main().catch((error) => {
  console.error("\n" + (error?.message ?? error));
  process.exitCode = 1;
});
