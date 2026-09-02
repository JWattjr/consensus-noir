/**
 * Seeds two more cases on the LIVE production contract.
 *
 *   reviewer  - a long window (30 days) so judges always find something playable
 *   proof     - short windows so the production contract can complete its own
 *               entry -> reveal -> resolve -> claim cycle today
 *
 * The existing `glasshouse-0217-live` case stops accepting entries on
 * 2026-09-01 20:44 UTC, which is why the reviewer case exists.
 *
 * Usage (curator wallet only):
 *   node deploy/02_seed_reviewer_cases.js reviewer
 *   node deploy/02_seed_reviewer_cases.js proof
 */

import { contractAddress } from "../scripts/lib/genlayer-env.mjs";

const CONTRACT = contractAddress();

const SUSPECTS = [
  { id: "SUSPECT-A", name: "Mara Voss", profile: "Night curator" },
  { id: "SUSPECT-B", name: "Elias Quill", profile: "Restoration lead" },
  { id: "SUSPECT-C", name: "Inez Calder", profile: "Security liaison" },
];
const STATEMENTS = [
  { id: "STATEMENT-A", suspect_id: "SUSPECT-A", text: "I left before the lights failed." },
  { id: "STATEMENT-B", suspect_id: "SUSPECT-B", text: "The east door stayed locked." },
  { id: "STATEMENT-C", suspect_id: "SUSPECT-C", text: "I was in the archive corridor." },
];
const TIMELINE = [
  { id: "TIME-01", at: "02:02", event: "The gallery cameras enter maintenance mode." },
  { id: "TIME-02", at: "02:17", event: "The glasshouse alarm reports a forced latch." },
  { id: "TIME-03", at: "02:26", event: "A service badge opens the east corridor." },
];
const EVIDENCE = [
  { id: "EVIDENCE-01", kind: "log", text: "The 02:17 latch sensor records an interior release." },
  { id: "EVIDENCE-02", kind: "badge", text: "Badge C-19 opens the east corridor at 02:26." },
  { id: "EVIDENCE-03", kind: "camera", text: "A reflection places a silver repair case beside the latch." },
  { id: "EVIDENCE-04", kind: "inventory", text: "Only the restoration lead signed out a silver repair case." },
  { id: "EVIDENCE-05", kind: "radio", text: "The security desk heard a request from the east corridor." },
];

const DAY = 86400;

const PROFILES = {
  // Judges may arrive weeks after submission. Entries stay open for 30 days.
  reviewer: {
    caseId: "glasshouse-0217-reviewer",
    accusation: 30 * DAY,
    reveal: 32 * DAY,
    resolution: 32 * DAY + 3600,
    refund: 45 * DAY,
    minPlayers: 2,
    maxPlayers: 16,
  },
  // Short enough to run the full production lifecycle in one sitting. The
  // windows must clear real wall-clock time on StudioNet, so they allow for
  // two entries and two reveals confirming at roughly 20-30s each.
  proof: {
    caseId: "glasshouse-0217-proof",
    accusation: 240,
    reveal: 480,
    resolution: 540,
    refund: 3600,
    minPlayers: 2,
    maxPlayers: 2,
  },
};

export default async function seed(client, profileName = "reviewer") {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown profile "${profileName}". Use: ${Object.keys(PROFILES).join(", ")}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const args = [
    profile.caseId,
    "The Glasshouse at 02:17",
    "A darkened conservatory contains a broken display and one impossible access trail.",
    "At 02:17, the glasshouse alarm reports a forced latch while the cameras are in maintenance mode.",
    "Which suspect could have staged the incident, and which evidence makes the alternatives fail?",
    JSON.stringify(SUSPECTS),
    JSON.stringify(STATEMENTS),
    JSON.stringify(TIMELINE),
    JSON.stringify(EVIDENCE),
    "[]",
    "Return FINAL only when a suspect is materially better supported by multiple independent evidence items; otherwise return VOID.",
    now + profile.accusation,
    now + profile.reveal,
    now + profile.resolution,
    now + profile.refund,
    1000000000000000000n, // 1 GEN
    profile.minPlayers,
    profile.maxPlayers,
  ];

  const createHash = await client.writeContract({
    address: CONTRACT,
    functionName: "create_case",
    args,
    value: 0n,
  });
  await client.waitForTransactionReceipt({ hash: createHash, retries: 120, interval: 3000 });

  const publishHash = await client.writeContract({
    address: CONTRACT,
    functionName: "publish_case",
    args: [profile.caseId],
    value: 0n,
  });
  await client.waitForTransactionReceipt({ hash: publishHash, retries: 120, interval: 3000 });

  const record = {
    profile: profileName,
    caseId: profile.caseId,
    contractAddress: CONTRACT,
    createTransaction: createHash,
    publishTransaction: publishHash,
    accusationDeadline: now + profile.accusation,
    revealDeadline: now + profile.reveal,
    resolutionEligibilityTime: now + profile.resolution,
    refundDeadline: now + profile.refund,
    entryStakeWei: "1000000000000000000",
    minPlayers: profile.minPlayers,
    maxPlayers: profile.maxPlayers,
  };

  // Copy this line into deployment/studionet.json.
  console.log("CONSENSUS_NOIR_SEED_RESULT=" + JSON.stringify(record));
  return record;
}
