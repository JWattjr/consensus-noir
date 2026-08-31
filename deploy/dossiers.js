/**
 * Case dossiers.
 *
 * Each must satisfy the contract's validation: 3-5 suspects, 5-12 evidence
 * items, unique stable IDs throughout, and every statement referencing a real
 * suspect ID. Evidence should converge on one suspect through several
 * independent records, otherwise validators correctly return VOID.
 */

export const GLASSHOUSE = {
  key: "glasshouse-0217",
  title: "The Glasshouse at 02:17",
  premise: "A darkened conservatory contains a broken display and one impossible access trail.",
  incident:
    "At 02:17, the glasshouse alarm reports a forced latch while the cameras are in maintenance mode.",
  question:
    "Which suspect could have staged the incident, and which evidence makes the alternatives fail?",
  suspects: [
    { id: "SUSPECT-A", name: "Mara Voss", profile: "Night curator" },
    { id: "SUSPECT-B", name: "Elias Quill", profile: "Restoration lead" },
    { id: "SUSPECT-C", name: "Inez Calder", profile: "Security liaison" },
  ],
  statements: [
    { id: "STATEMENT-A", suspect_id: "SUSPECT-A", text: "I left before the lights failed." },
    { id: "STATEMENT-B", suspect_id: "SUSPECT-B", text: "The east door stayed locked." },
    { id: "STATEMENT-C", suspect_id: "SUSPECT-C", text: "I was in the archive corridor." },
  ],
  timeline: [
    { id: "TIME-01", at: "02:02", event: "The gallery cameras enter maintenance mode." },
    { id: "TIME-02", at: "02:17", event: "The glasshouse alarm reports a forced latch." },
    { id: "TIME-03", at: "02:26", event: "A service badge opens the east corridor." },
  ],
  evidence: [
    { id: "EVIDENCE-01", kind: "log", text: "The 02:17 latch sensor records an interior release." },
    { id: "EVIDENCE-02", kind: "badge", text: "Badge C-19 opens the east corridor at 02:26." },
    { id: "EVIDENCE-03", kind: "camera", text: "A reflection places a silver repair case beside the latch." },
    { id: "EVIDENCE-04", kind: "inventory", text: "Only the restoration lead signed out a silver repair case." },
    { id: "EVIDENCE-05", kind: "radio", text: "The security desk heard a request from the east corridor." },
  ],
  rubric:
    "Return FINAL only when a suspect is materially better supported by multiple independent evidence items; otherwise return VOID.",
};

export const PRESSROOM = {
  key: "pressroom-0349",
  title: "The Last Edition",
  premise:
    "A newspaper that went to press without its front page, and a plate nobody will admit to pulling.",
  incident:
    "At 03:49 the Argus front-page plate was swapped for filler and the run continued. The original plate and the only proof sheet left the building before dawn.",
  question:
    "Which suspect pulled the plate, and which records make the other accounts impossible?",
  suspects: [
    { id: "SUSPECT-A", name: "Della Fen", profile: "Night editor. Signs off every plate before a run." },
    { id: "SUSPECT-B", name: "Roy Mercer", profile: "Head pressman. The only person who can halt a run without tripping the klaxon." },
    { id: "SUSPECT-C", name: "Halloran Pike", profile: "The publisher's aide. Carries messages nobody writes down." },
  ],
  statements: [
    { id: "STATEMENT-A", suspect_id: "SUSPECT-A", text: "I approved the plate at 03:20 and went straight to the wire room." },
    { id: "STATEMENT-B", suspect_id: "SUSPECT-B", text: "The press halted on a paper fault. I never touched the plate." },
    { id: "STATEMENT-C", suspect_id: "SUSPECT-C", text: "I sat in the publisher's car until gone four." },
  ],
  timeline: [
    { id: "TIME-01", at: "03:20", event: "The night editor signs off the front-page plate." },
    { id: "TIME-02", at: "03:41", event: "The loading-bay door is opened from the inside." },
    { id: "TIME-03", at: "03:49", event: "The press halts and the plate is exchanged for filler." },
    { id: "TIME-04", at: "04:06", event: "A courier collects an unlisted parcel from the bay." },
  ],
  evidence: [
    { id: "EVIDENCE-01", kind: "press-log", text: "The press log records a manual halt at 03:49, not a paper fault. The fault register for that night is empty." },
    { id: "EVIDENCE-02", kind: "door", text: "The loading-bay door has no fault record and can only be opened from the pressroom floor." },
    { id: "EVIDENCE-03", kind: "forensics", text: "Ink transferred to the bay door handle matches the pressroom's night ink, not the ink used upstairs." },
    { id: "EVIDENCE-04", kind: "ledger", text: "The wire room ledger has no entry for the night editor between 03:20 and 04:15." },
    { id: "EVIDENCE-05", kind: "vehicle-log", text: "The publisher's car was parked and empty from 03:30 onward." },
    { id: "EVIDENCE-06", kind: "access", text: "Only the head pressman's key card opened the plate store after 03:00." },
    { id: "EVIDENCE-07", kind: "equipment", text: "The filler plate was taken from a high rack that needs a pressman's lift key to reach." },
  ],
  rubric:
    "Treat the file as authoritative. Weigh which accounts the physical and access records make impossible, and prefer a suspect supported by several independent records over one merely left without an alibi. Return FINAL only when a suspect is materially better supported; otherwise return VOID.",
};

export const DOSSIERS = { glasshouse: GLASSHOUSE, pressroom: PRESSROOM };

/** Builds the create_case argument list the contract expects. */
export function createArgs(dossier, caseId, windows, now, stakeWei, minPlayers, maxPlayers) {
  return [
    caseId,
    dossier.title,
    dossier.premise,
    dossier.incident,
    dossier.question,
    JSON.stringify(dossier.suspects),
    JSON.stringify(dossier.statements),
    JSON.stringify(dossier.timeline),
    JSON.stringify(dossier.evidence),
    "[]",
    dossier.rubric,
    now + windows.accusation,
    now + windows.reveal,
    now + windows.resolution,
    now + windows.refund,
    stakeWei,
    minPlayers,
    maxPlayers,
  ];
}
