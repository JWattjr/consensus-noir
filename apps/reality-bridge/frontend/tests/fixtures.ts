import type {
  ConfigView,
  PlayerView,
  RoundView,
  TileView,
} from "@/lib/contract";

export const CONTRACT = "0x1111111111111111111111111111111111111111";
export const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const CAROL = "0xcccccccccccccccccccccccccccccccccccccccc";

export const NOW = 1_800_000_000;
export const ENTRY = "1000000000000000000";

export const CONFIG: ConfigView = {
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

export function round(overrides: Partial<RoundView> = {}): RoundView {
  return {
    round_id: "1",
    title: "The Weather Line",
    entry_amount: ENTRY,
    join_deadline: NOW + 600,
    terminal_deadline: NOW + 7200,
    commit_window_seconds: 300,
    reveal_grace_seconds: 60,
    status: "ACTIVE",
    tile_count: 3,
    current_tile_index: 0,
    active_player_index: 0,
    attempt_deadline: NOW + 300,
    reveal_deadline: NOW + 360,
    player_count: 3,
    pool: (BigInt(ENTRY) * BigInt(3)).toString(),
    claimed_amount: "0",
    refunded_amount: "0",
    ...overrides,
  };
}

export function tile(index: number, overrides: Partial<TileView> = {}): TileView {
  return {
    round_id: "1",
    tile_index: index,
    question: `Panel ${index + 1} question?`,
    yes_condition: `YES when panel ${index + 1} condition holds.`,
    primary_url: `https://evidence.example.com/panel-${index}`,
    support_url_1: "",
    support_url_2: "",
    choice_deadline: NOW + 1800 + index * 600,
    resolution_time: NOW + 1860 + index * 600,
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
    ...overrides,
  };
}

export function player(
  index: number,
  account: string,
  overrides: Partial<PlayerView> = {},
): PlayerView {
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
    ...overrides,
  };
}

export function players(): PlayerView[] {
  return [player(0, ALICE), player(1, BOB), player(2, CAROL)];
}

export function tiles(): TileView[] {
  return [tile(0), tile(1), tile(2)];
}
