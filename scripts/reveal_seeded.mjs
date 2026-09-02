/*
 * Reveals the two seeded players once the accusation window closes.
 *
 * They are deliberately wrong, so revealing does not change who wins — but it
 * puts their reasoning on the public file, which is where the social half of
 * the game lives. A case whose theory panel is empty looks unplayed.
 *
 * Waits for the window, advances the case, then reveals both. Safe to run in
 * the background straight after prepare_rolling_case.mjs.
 *
 * Usage:
 *   node scripts/reveal_seeded.mjs <caseId> [dossier]
 */

import { contractAddress, loadSdk, resolveAccounts, privateKeyFor } from "./lib/genlayer-env.mjs";

const CONTRACT = contractAddress();
const { createClient, createAccount, studionet, keytar } = loadSdk();
const normalize = (t) => t.normalize("NFKC").trim().split(/\s+/u).join(" ");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const caseId = process.argv[2];
  const name = (process.argv[3] ?? "pressroom").toLowerCase();
  if (!caseId) throw new Error("Usage: node scripts/reveal_seeded.mjs <caseId> [dossier]");

  const { SEEDED } = await import("./seeded-players.mjs");
  const players = SEEDED[name];
  if (!players) throw new Error(`Unknown dossier "${name}".`);

  const accounts = await resolveAccounts(keytar, { need: players.length });
  const sessions = [];
  for (const [index, player] of players.entries()) {
    const account = createAccount(await privateKeyFor(keytar, accounts[index]));
    sessions.push({ ...player, client: createClient({ chain: studionet, account }) });
  }

  const lead = sessions[0].client;
  const caseFile = await lead.readContract({ address: CONTRACT, functionName: "get_case", args: [caseId] });
  const accusationDeadline = Number(caseFile.accusation_deadline);

  for (;;) {
    const remaining = accusationDeadline - Math.floor(Date.now() / 1000);
    if (remaining <= 0) break;
    console.log(`waiting ${remaining}s for the accusation window to close…`);
    await sleep(Math.min(remaining, 30) * 1000);
  }

  const current = await lead.readContract({ address: CONTRACT, functionName: "get_case", args: [caseId] });
  if (current.status === "OPEN") {
    process.stdout.write("advance_case … ");
    const hash = await lead.writeContract({ address: CONTRACT, functionName: "advance_case", args: [caseId], value: 0n });
    await lead.waitForTransactionReceipt({ hash, retries: 200, interval: 3000 });
    console.log(hash);
  }

  for (const [index, seed] of sessions.entries()) {
    process.stdout.write(`player ${index + 1} reveals … `);
    try {
      const hash = await seed.client.writeContract({
        address: CONTRACT,
        functionName: "reveal_accusation",
        args: [caseId, seed.suspect, normalize(seed.theory), JSON.stringify([...seed.picks].sort()), seed.salt],
        value: 0n,
      });
      await seed.client.waitForTransactionReceipt({ hash, retries: 200, interval: 3000 });
      console.log(hash);
    } catch (error) {
      console.log(`skipped (${String(error?.message ?? error).split("\n")[0]})`);
    }
  }
  console.log("\nSeeded theories are now on the public file.");
}

main().catch((error) => {
  console.error("\n" + (error?.message ?? error));
  process.exitCode = 1;
});
