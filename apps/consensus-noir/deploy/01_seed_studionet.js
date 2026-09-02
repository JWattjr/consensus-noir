import { contractAddress } from "../scripts/lib/genlayer-env.mjs";
const CONTRACT = contractAddress();
const CASE_ID = "glasshouse-0217-live";

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

export default async function seed(client) {
  const now = Math.floor(Date.now() / 1000);
  const args = [
    CASE_ID,
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
    now + 172800,
    now + 259200,
    now + 262800,
    now + 604800,
    1000000000000000000n,
    2,
    4,
  ];

  let createHash;
  try {
    createHash = await client.writeContract({
      address: CONTRACT,
      functionName: "create_case",
      args,
      value: 0n,
    });
    const createReceipt = await client.waitForTransactionReceipt({
      hash: createHash,
      retries: 120,
      interval: 5000,
    });
    console.log("CONSENSUS_NOIR_CREATE=" + JSON.stringify({ hash: createHash, receipt: createReceipt }));
  } catch (error) {
    if (!String(error).includes("Case already exists")) throw error;
    console.log("CONSENSUS_NOIR_CREATE=already_exists");
  }

  const current = await client.readContract({
    address: CONTRACT,
    functionName: "get_case",
    args: [CASE_ID],
    jsonSafeReturn: true,
  });
  if (current.status === "DRAFT") {
    const publishHash = await client.writeContract({
      address: CONTRACT,
      functionName: "publish_case",
      args: [CASE_ID],
      value: 0n,
    });
    const publishReceipt = await client.waitForTransactionReceipt({
      hash: publishHash,
      retries: 120,
      interval: 5000,
    });
    console.log("CONSENSUS_NOIR_PUBLISH=" + JSON.stringify({ hash: publishHash, receipt: publishReceipt }));
  } else {
    console.log("CONSENSUS_NOIR_PUBLISH=already_published");
  }

  const finalCase = await client.readContract({
    address: CONTRACT,
    functionName: "get_case",
    args: [CASE_ID],
    jsonSafeReturn: true,
  });
  console.log("CONSENSUS_NOIR_CASE=" + JSON.stringify({ caseId: CASE_ID, case: finalCase }));
}
