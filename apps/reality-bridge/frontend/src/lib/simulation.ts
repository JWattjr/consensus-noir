import type {
  ConfigView,
  PlayerView,
  RoundBundle,
  RoundView,
  TileView,
} from "@/lib/contract";

/**
 * Offline simulation.
 *
 * Nothing here touches a chain, a wallet or a validator. Outcomes are fixed in
 * advance by the scenario, never derived from the player's own choice, so the
 * simulation can never flatter the player into believing they were right.
 *
 * The interface must label this mode as a simulation everywhere it appears and
 * must never use live-network vocabulary for it.
 */

export const SIMULATION_ACCOUNT = "0x51mu1a7100000000000000000000000000000002";
export const SIMULATION_CONTRACT = "0x51mu1a7100000000000000000000000000000000";

export const SIMULATION_CONFIG: ConfigView = {
  max_tiles: 3,
  min_players: 2,
  max_players: 8,
  base_weight: 1,
  credit_weight: 3,
  protocol_fee_bps: 0,
  min_commit_window: 60,
  max_commit_window: 86400,
  min_reveal_grace: 30,
  max_reveal_grace: 86400,
  max_corroborating_sources: 2,
  commitment_domain: "reality-bridge-choice-v1",
  evidence_domain: "reality-bridge-evidence-v1",
};

export type ScenarioId =
  | "clean-crossing"
  | "wrong-answer"
  | "void-panel"
  | "unresolved-retry"
  | "missed-reveal"
  | "terminal-refund";

export interface Scenario {
  id: ScenarioId;
  name: string;
  summary: string;
  /** Fixed outcomes for each panel, decided before the player chooses. */
  script: PanelScript[];
}

export interface PanelScript {
  outcome: "YES" | "NO" | "VOID";
  reasonCode: string;
  /** Simulated validator behaviour on the first resolution attempt. */
  firstAttempt: "resolves" | "unresolved";
  note: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "clean-crossing",
    name: "Clean crossing",
    summary:
      "All three panels resolve with clear evidence. Shows discovery credits and a weighted settlement.",
    script: [
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture states the result plainly." },
      { outcome: "NO", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture contradicts the YES condition." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture states the result plainly." },
    ],
  },
  {
    id: "wrong-answer",
    name: "Runner eliminated",
    summary:
      "The first panel resolves against the runner. Shows elimination and hand-over to the next seat.",
    script: [
      { outcome: "NO", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as NO." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as YES." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as YES." },
    ],
  },
  {
    id: "void-panel",
    name: "Void panel",
    summary:
      "A corroborating fixture contradicts the primary one. Shows VOID: nobody is eliminated and nobody earns a credit.",
    script: [
      { outcome: "VOID", reasonCode: "VOID_CONTRADICTION", firstAttempt: "resolves", note: "The corroborating fixture disagrees with the primary." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as YES." },
      { outcome: "NO", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as NO." },
    ],
  },
  {
    id: "unresolved-retry",
    name: "Unresolved, then retried",
    summary:
      "The first resolution attempt reports UNRESOLVED. Shows that a retry costs nothing and moves no deadline.",
    script: [
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "unresolved", note: "The fixture is unreachable on the first attempt." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as YES." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as YES." },
    ],
  },
  {
    id: "missed-reveal",
    name: "Missed reveal",
    summary:
      "The runner never reveals. Shows the permissionless forfeit path and the hand-over to the next seat.",
    script: [
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as YES." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as YES." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "resolves", note: "The fixture settles the panel as YES." },
    ],
  },
  {
    id: "terminal-refund",
    name: "Terminal refund",
    summary:
      "Evidence never becomes usable and the round reaches its terminal deadline. Shows individually claimable refunds.",
    script: [
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "unresolved", note: "The fixture never publishes a usable result." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "unresolved", note: "The fixture never publishes a usable result." },
      { outcome: "YES", reasonCode: "FINAL_EVIDENCE", firstAttempt: "unresolved", note: "The fixture never publishes a usable result." },
    ],
  },
];

const ENTRY = "1000000000000000000"; // 1 unit in the simulation's play currency

const FIXTURE_QUESTIONS = [
  {
    question:
      "Simulation panel 1 — did the fixture record a daily high above 35 degrees?",
    condition:
      "YES when the simulated fixture records a high strictly above 35 degrees.",
  },
  {
    question:
      "Simulation panel 2 — did the fixture record a closing value above 245?",
    condition:
      "YES when the simulated fixture reports a close strictly above 245.00.",
  },
  {
    question: "Simulation panel 3 — did the fixture mark the proposal as passed?",
    condition:
      "YES when the simulated fixture marks the proposal as passed; otherwise NO.",
  },
];

/** Clearly fictional hosts. These are fixtures, not real evidence sources. */
export const FIXTURE_HOST = "fixture.invalid";

function simulationPlayer(index: number, account: string): PlayerView {
  return {
    round_id: "1",
    account,
    join_index: index,
    status: "ACTIVE",
    discovery_credits: 0,
    commitment: "",
    committed: false,
    revealed: false,
    choice: "",
    claim_amount: "0",
    claimed: false,
    refund_amount: "0",
    refunded: false,
  };
}

function simulationTile(index: number, base: number): TileView {
  const fixture = FIXTURE_QUESTIONS[index];
  return {
    round_id: "1",
    tile_index: index,
    question: fixture.question,
    yes_condition: fixture.condition,
    primary_url: `https://${FIXTURE_HOST}/simulated-panel-${index + 1}`,
    support_url_1: index === 0 ? `https://mirror.${FIXTURE_HOST}/panel-1` : "",
    support_url_2: "",
    choice_deadline: base + 1800 + index * 1800,
    resolution_time: base + 2100 + index * 1800,
    status: "PENDING",
    outcome: "UNSET",
    reason_code: "",
    evidence_receipt: "",
    event_id: "",
    effective_date: "",
    observed_at: "",
    resolved_at: 0,
    opener_index: 0,
    attempts: 0,
  };
}

export interface SimulationState extends RoundBundle {
  scenarioId: ScenarioId;
  /** Resolution attempts already made against the current panel. */
  attempts: number;
  /** Simulated log so the player can see exactly what the script decided. */
  journal: string[];
  /**
   * True once the player has deliberately let a reveal window lapse, which is
   * how the forfeit path is reached without waiting on a real clock.
   */
  lapsed: boolean;
}

/**
 * The simulation's own clock.
 *
 * Action availability is time-gated, and simulated panels sit far enough in
 * the future that gating them on the wall clock would stall the walkthrough
 * for half an hour. The clock is therefore derived from the stage the
 * scenario has reached, so every scenario completes immediately and nothing
 * about the real time of day changes what the simulation demonstrates.
 */
export function simulationClock(state: SimulationState): number {
  const round = state.round;
  if (round.status !== "ACTIVE") return round.join_deadline + 1;

  const tile = state.tiles[round.current_tile_index];
  const runner = state.players[round.active_player_index];
  if (!tile || !runner) return round.join_deadline + 1;

  // Deliberately lapsed: past the reveal cut-off so the forfeit path opens.
  if (state.lapsed) return round.reveal_deadline + 1;

  // Revealed: at the evidence timestamp so resolution becomes available.
  if (runner.revealed) return tile.resolution_time;

  // Otherwise inside the commit/reveal window.
  return round.join_deadline + 1;
}

export function createSimulation(
  scenarioId: ScenarioId,
  nowSeconds: number,
): SimulationState {
  const base = nowSeconds;
  const round: RoundView = {
    round_id: "1",
    title: "Simulation — The Weather Line",
    entry_amount: ENTRY,
    join_deadline: base + 900,
    terminal_deadline: base + 9000,
    commit_window_seconds: 1800,
    reveal_grace_seconds: 300,
    status: "ACTIVE",
    tile_count: 3,
    current_tile_index: 0,
    active_player_index: 0,
    attempt_deadline: base + 1800,
    reveal_deadline: base + 2100,
    player_count: 3,
    pool: (BigInt(ENTRY) * BigInt(3)).toString(),
    claimed_amount: "0",
    refunded_amount: "0",
  };
  return {
    scenarioId,
    attempts: 0,
    lapsed: false,
    journal: [
      `Scenario "${scenarioName(scenarioId)}" loaded. All outcomes are fixed in advance.`,
    ],
    round,
    tiles: [0, 1, 2].map((index) => simulationTile(index, base)),
    players: [
      simulationPlayer(0, SIMULATION_ACCOUNT),
      simulationPlayer(1, "0x51mu1a7100000000000000000000000000000003"),
      simulationPlayer(2, "0x51mu1a7100000000000000000000000000000004"),
    ],
  };
}

export function scenarioName(id: ScenarioId): string {
  return SCENARIOS.find((scenario) => scenario.id === id)?.name ?? id;
}

export function currentScript(state: SimulationState): PanelScript {
  const scenario = SCENARIOS.find((entry) => entry.id === state.scenarioId);
  const index = Math.min(
    state.round.current_tile_index,
    (scenario?.script.length ?? 1) - 1,
  );
  return (
    scenario?.script[index] ?? {
      outcome: "VOID",
      reasonCode: "VOID_EVIDENCE",
      firstAttempt: "resolves",
      note: "",
    }
  );
}

function weight(credits: number): number {
  return SIMULATION_CONFIG.base_weight + SIMULATION_CONFIG.credit_weight * credits;
}

function settle(state: SimulationState): SimulationState {
  const survivors = state.players.filter((player) => player.status === "ACTIVE");
  if (survivors.length === 0) {
    return refundAll(state, "No runner survived, so every entry is refundable.");
  }
  const pool = BigInt(state.round.pool);
  const total = survivors.reduce(
    (sum, player) => sum + weight(player.discovery_credits),
    0,
  );
  let assigned = BigInt(0);
  let bestIndex = -1;
  let bestCredits = -1;
  const players = state.players.map((player, index) => {
    if (player.status !== "ACTIVE") return player;
    if (player.discovery_credits > bestCredits) {
      bestCredits = player.discovery_credits;
      bestIndex = index;
    }
    const amount =
      (pool * BigInt(weight(player.discovery_credits))) / BigInt(total);
    assigned += amount;
    return { ...player, claim_amount: amount.toString() };
  });
  const remainder = pool - assigned;
  if (remainder > BigInt(0) && bestIndex >= 0) {
    players[bestIndex] = {
      ...players[bestIndex],
      claim_amount: (
        BigInt(players[bestIndex].claim_amount) + remainder
      ).toString(),
    };
  }
  return {
    ...state,
    players,
    round: { ...state.round, status: "SETTLED" },
    journal: [
      ...state.journal,
      "All panels resolved. Simulated payouts are fixed by survivor weight.",
    ],
  };
}

function refundAll(state: SimulationState, note: string): SimulationState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      refund_amount: state.round.entry_amount,
    })),
    round: { ...state.round, status: "REFUNDABLE" },
    journal: [...state.journal, note],
  };
}

function advance(state: SimulationState): SimulationState {
  const nextIndex = state.round.current_tile_index + 1;
  if (nextIndex >= state.round.tile_count) return settle(state);

  const runner = state.players[state.round.active_player_index];
  let activeIndex = state.round.active_player_index;
  if (runner.status !== "ACTIVE") {
    const next = state.players.findIndex(
      (player, index) => index > activeIndex && player.status === "ACTIVE",
    );
    if (next === -1) {
      return refundAll(
        state,
        "No runner remained, so every entry became refundable.",
      );
    }
    activeIndex = next;
  }
  const tile = state.tiles[nextIndex];
  return {
    ...state,
    attempts: 0,
    lapsed: false,
    round: {
      ...state.round,
      current_tile_index: nextIndex,
      active_player_index: activeIndex,
      attempt_deadline: tile.choice_deadline,
      reveal_deadline: tile.choice_deadline + state.round.reveal_grace_seconds,
    },
    players: state.players.map((player, index) =>
      index === activeIndex
        ? { ...player, committed: false, revealed: false, choice: "", commitment: "" }
        : player,
    ),
  };
}

export function simulateCommit(
  state: SimulationState,
  choice: "YES" | "NO",
  commitment: string,
): SimulationState {
  const index = state.round.active_player_index;
  return {
    ...state,
    players: state.players.map((player, position) =>
      position === index
        ? { ...player, committed: true, commitment, choice: "" }
        : player,
    ),
    journal: [
      ...state.journal,
      `Sealed a simulated ${choice} choice. The hash reveals nothing until you open it.`,
    ],
  };
}

export function simulateReveal(
  state: SimulationState,
  choice: "YES" | "NO",
): SimulationState {
  const index = state.round.active_player_index;
  return {
    ...state,
    players: state.players.map((player, position) =>
      position === index ? { ...player, revealed: true, choice } : player,
    ),
    journal: [...state.journal, `Opened the simulated choice as ${choice}.`],
  };
}

export function simulateResolve(state: SimulationState): SimulationState {
  const script = currentScript(state);
  const attempts = state.attempts + 1;

  if (script.firstAttempt === "unresolved" && attempts === 1) {
    return {
      ...state,
      attempts,
      tiles: state.tiles.map((tile, index) =>
        index === state.round.current_tile_index
          ? { ...tile, attempts: tile.attempts + 1 }
          : tile,
      ),
      journal: [
        ...state.journal,
        `Simulated resolution returned UNRESOLVED: ${script.note} Nothing changed and no deadline moved.`,
      ],
    };
  }

  if (state.scenarioId === "terminal-refund") {
    return refundAll(
      {
        ...state,
        attempts,
        tiles: state.tiles.map((tile, index) =>
          index === state.round.current_tile_index
            ? { ...tile, attempts: tile.attempts + 1 }
            : tile,
        ),
      },
      "The simulated terminal deadline passed with no usable evidence. Every entry is refundable.",
    );
  }

  const tileIndex = state.round.current_tile_index;
  const runnerIndex = state.round.active_player_index;
  const runner = state.players[runnerIndex];
  const correct = script.outcome !== "VOID" && runner.choice === script.outcome;
  const eliminated = script.outcome !== "VOID" && !correct;

  const resolved: SimulationState = {
    ...state,
    attempts,
    tiles: state.tiles.map((tile, index) =>
      index === tileIndex
        ? {
            ...tile,
            status: "RESOLVED",
            outcome: script.outcome,
            reason_code: script.reasonCode,
            evidence_receipt: `simulated-${state.scenarioId}-${tileIndex}`,
            event_id: `SIM-PANEL-${tileIndex + 1}`,
            effective_date: "2035-01-01",
            // The scripted panel is anchored the same way a live one is: the
            // observation predates the instant the panel is answered as of.
            observed_at: String(tile.resolution_time - 120),
            resolved_at: tile.resolution_time,
            opener_index: runnerIndex,
            attempts: tile.attempts + 1,
          }
        : tile,
    ),
    players: state.players.map((player, index) =>
      index === runnerIndex
        ? {
            ...player,
            status: eliminated ? "ELIMINATED" : player.status,
            discovery_credits: correct
              ? player.discovery_credits + 1
              : player.discovery_credits,
          }
        : player,
    ),
    journal: [
      ...state.journal,
      script.outcome === "VOID"
        ? `Simulated panel voided (${script.reasonCode}): ${script.note} Nobody was eliminated and nobody earned a credit.`
        : `Simulated panel resolved ${script.outcome}: ${script.note} ${
            correct ? "The runner earned a discovery credit." : "The runner was eliminated."
          }`,
    ],
  };

  return advance(resolved);
}

export function simulateForfeit(state: SimulationState): SimulationState {
  const runnerIndex = state.round.active_player_index;
  const eliminated: SimulationState = {
    ...state,
    players: state.players.map((player, index) =>
      index === runnerIndex ? { ...player, status: "ELIMINATED" } : player,
    ),
    journal: [
      ...state.journal,
      "The runner missed the simulated reveal window and forfeited the crossing.",
    ],
  };
  const nextIndex = eliminated.players.findIndex(
    (player, index) => index > runnerIndex && player.status === "ACTIVE",
  );
  if (nextIndex === -1) {
    return refundAll(
      eliminated,
      "No runner remained, so every entry became refundable.",
    );
  }
  const tile = eliminated.tiles[eliminated.round.current_tile_index];
  return {
    ...eliminated,
    attempts: 0,
    lapsed: false,
    round: {
      ...eliminated.round,
      active_player_index: nextIndex,
      attempt_deadline: tile.choice_deadline,
      reveal_deadline: tile.choice_deadline + eliminated.round.reveal_grace_seconds,
    },
  };
}

/** Deliberately miss the reveal window, so the forfeit path can be shown. */
export function simulateLapse(state: SimulationState): SimulationState {
  if (state.lapsed) return state;
  return {
    ...state,
    lapsed: true,
    journal: [
      ...state.journal,
      "You let the reveal window lapse. Anyone may now forfeit this runner and keep the round moving.",
    ],
  };
}

export function simulateClaim(state: SimulationState): SimulationState {
  const index = state.players.findIndex((player) =>
    player.account.toLowerCase() === SIMULATION_ACCOUNT.toLowerCase(),
  );
  if (index === -1) return state;
  if (state.players[index].claimed) return state;
  return {
    ...state,
    players: state.players.map((player, position) =>
      position === index ? { ...player, claimed: true } : player,
    ),
    round: {
      ...state.round,
      claimed_amount: (
        BigInt(state.round.claimed_amount) +
        BigInt(state.players[index].claim_amount)
      ).toString(),
    },
    journal: [...state.journal, "Simulated payout collected. No value moved."],
  };
}

export function simulateRefund(state: SimulationState): SimulationState {
  const index = state.players.findIndex((player) =>
    player.account.toLowerCase() === SIMULATION_ACCOUNT.toLowerCase(),
  );
  if (index === -1) return state;
  if (state.players[index].refunded) return state;
  return {
    ...state,
    players: state.players.map((player, position) =>
      position === index ? { ...player, refunded: true } : player,
    ),
    round: {
      ...state.round,
      refunded_amount: (
        BigInt(state.round.refunded_amount) +
        BigInt(state.players[index].refund_amount)
      ).toString(),
    },
    journal: [...state.journal, "Simulated refund collected. No value moved."],
  };
}
