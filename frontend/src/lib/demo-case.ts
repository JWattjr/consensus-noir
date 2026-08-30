import type { NoirCase } from "./contract";

function baseTime(): number {
  return Math.floor(Date.now() / 1000);
}

function build(now: number): NoirCase {
    return {
    case_id: "glasshouse-0217",
    title: "The Glasshouse at 02:17",
    premise: "A rain-slick conservatory. One vanished ledger. Three alibis that cannot all be true.",
    incident:
    "At 02:17, the gallery clock stopped and the Ashcombe ledger disappeared from a locked plinth. The storm erased the garden tracks, but not the service-door mud.",
    question: "Under the frozen file, which suspect is materially best supported as responsible?",
    suspects: [
    { id: "S1", name: "Mara Vale", profile: "The archivist who can read a room like a ledger." },
    { id: "S2", name: "Ivo March", profile: "A courier who knows every service door in the quarter." },
    { id: "S3", name: "Lenore Quill", profile: "The patron whose umbrella never met the rain." },
    ],
    statements: [
    { id: "S1-STMT-1", suspect_id: "S1", text: "I left before the clock stopped; ask the night clerk." },
    { id: "S2-STMT-1", suspect_id: "S2", text: "I never entered the conservatory that night." },
    { id: "S3-STMT-1", suspect_id: "S3", text: "The ledger was already missing when I arrived." },
    ],
    timeline: [
    { id: "T1", at: "01:40", event: "Rain begins over the north garden." },
    { id: "T2", at: "02:00", event: "The gallery lights flicker twice." },
    { id: "T3", at: "02:09", event: "A service-door latch is heard on the hallway camera." },
    { id: "T4", at: "02:17", event: "The conservatory clock stops; the ledger is gone." },
    ],
    evidence: [
    { id: "E1", summary: "Wet footprints lead from the service door to the ledger plinth." },
    { id: "E2", summary: "A brass key has fresh scratches matching the archive lock." },
    { id: "E3", summary: "The stopped clock is twelve minutes slow against the hallway camera." },
    { id: "E4", summary: "A torn courier seal is caught beneath the plinth." },
    { id: "E5", summary: "The patron's umbrella is dry despite her garden-crossing alibi." },
    { id: "E6", summary: "The night clerk's log places the archivist in the reading room at 02:11." },
    ],
    source_urls: [],
    rubric:
    "Treat the frozen file as authoritative. Identify material contradictions, prefer independent evidence, account for exculpatory facts, reject invented facts, and choose one suspect only when materially better supported. Otherwise return VOID.",
    accusation_deadline: now + 3 * 24 * 60 * 60,
    reveal_deadline: now + 4 * 24 * 60 * 60,
    resolution_eligibility_time: now + 4 * 24 * 60 * 60 + 60 * 60,
    refund_deadline: now + 7 * 24 * 60 * 60,
    entry_stake: 100000000000000000,
    entry_stake_wei: BigInt("100000000000000000"),
    total_escrow_wei: BigInt(0),
    paid_out_wei: BigInt(0),
    frozen_sources: [],
    min_players: 2,
    max_players: 16,
    status: "OPEN",
    player_count: 0,
    total_escrow: 0,
    paid_out: 0,
    resolution_attempts: 0,
    no_winner_refund: false,
    resolution: null,
    entries: [],
    isDemo: true,
  };
}

/** Deadlines are computed per call so a static build cannot freeze them. */
export function demoCase(): NoirCase {
  return build(baseTime());
}

export const DEMO_CASE: NoirCase = build(0);
