import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Address } from "genlayer-js/types";

export const CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_CONSENSUS_NOIR_CONTRACT ?? "") as Address;
export const IS_CONFIGURED = CONTRACT_ADDRESS.length > 0;
export const NETWORK_NAME = "GenLayer StudioNet";
export const NETWORK_CHAIN_ID = 61999;
export const NETWORK_RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "https://studio.genlayer.com/api";
export const EXPLORER_URL =
  studionet.blockExplorers?.default?.url ?? "https://genlayer-explorer.vercel.app";

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export type CaseStatus =
  | "DRAFT"
  | "OPEN"
  | "REVEAL"
  | "RESOLVABLE"
  | "RESOLVED"
  | "VOID"
  | "CANCELLED"
  | "REFUNDABLE";

export type ResultStatus = "FINAL" | "VOID" | "UNRESOLVED";

export interface Suspect {
  id: string;
  name: string;
  profile: string;
}

export interface Statement {
  id: string;
  suspect_id: string;
  text: string;
}

export interface TimelineEntry {
  id: string;
  at: string;
  event: string;
}

export interface EvidenceItem {
  id: string;
  summary: string;
}

export interface Resolution {
  case_id: string;
  status: ResultStatus;
  culprit_id: string;
  material_evidence_ids: string[];
  contradicted_statement_ids: string[];
  confidence_bucket: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  reason_code: string;
  resolved_at: number;
}

export interface NoirEntry {
  case_id?: string;
  player: string;
  stake?: number;
  commitment?: string;
  revealed: boolean;
  suspect_id: string;
  theory: string;
  evidence_ids: string[];
  claimed: boolean;
  refunded: boolean;
}

export interface NoirCase {
  case_id: string;
  title: string;
  premise: string;
  incident: string;
  question: string;
  suspects: Suspect[];
  statements: Statement[];
  timeline: TimelineEntry[];
  evidence: EvidenceItem[];
  source_urls: string[];
  rubric: string;
  accusation_deadline: number;
  reveal_deadline: number;
  resolution_eligibility_time: number;
  refund_deadline: number;
  entry_stake: number;
  entry_stake_wei: bigint;
  total_escrow_wei: bigint;
  paid_out_wei: bigint;
  frozen_sources: { url: string; sha256: string }[];
  min_players: number;
  max_players: number;
  status: CaseStatus;
  player_count: number;
  total_escrow: number;
  paid_out: number;
  resolution_attempts: number;
  no_winner_refund: boolean;
  resolution: Resolution | null;
  entries: NoirEntry[];
  isDemo?: boolean;
}

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function clientConfig(account?: Address) {
  const endpoint = process.env.NEXT_PUBLIC_GENLAYER_RPC;
  return {
    chain: studionet,
    ...(endpoint ? { endpoint } : {}),
    ...(account && typeof window !== "undefined" && window.ethereum
      ? { account, provider: window.ethereum }
      : {}),
  };
}

export function makeReadClient() {
  return createClient(clientConfig());
}

export function makeWriteClient(account: string) {
  return createClient(clientConfig(account.toLowerCase() as Address));
}

function valueAsNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

/** Wei values never pass through a JS number, which loses precision past 2^53. */
function valueAsWei(value: unknown): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    if (typeof value === "string" && value.trim()) return BigInt(value.trim());
  } catch {
    return BigInt(0);
  }
  return BigInt(0);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normaliseResolution(value: unknown): Resolution | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!raw.status) return null;
  return {
    case_id: String(raw.case_id ?? ""),
    status: String(raw.status) as ResultStatus,
    culprit_id: String(raw.culprit_id ?? ""),
    material_evidence_ids: asArray<string>(raw.material_evidence_ids),
    contradicted_statement_ids: asArray<string>(raw.contradicted_statement_ids),
    confidence_bucket: String(raw.confidence_bucket ?? "NONE") as Resolution["confidence_bucket"],
    reason_code: String(raw.reason_code ?? ""),
    resolved_at: valueAsNumber(raw.resolved_at),
  };
}

export function normaliseCase(value: unknown, entries: unknown[] = []): NoirCase {
  const raw = value as Record<string, unknown>;
  return {
    case_id: String(raw.case_id ?? ""),
    title: String(raw.title ?? ""),
    premise: String(raw.premise ?? ""),
    incident: String(raw.incident ?? ""),
    question: String(raw.question ?? ""),
    suspects: asArray<Suspect>(raw.suspects),
    statements: asArray<Statement>(raw.statements),
    timeline: asArray<TimelineEntry>(raw.timeline),
    evidence: asArray<EvidenceItem>(raw.evidence),
    source_urls: asArray<string>(raw.source_urls),
    rubric: String(raw.rubric ?? ""),
    accusation_deadline: valueAsNumber(raw.accusation_deadline),
    reveal_deadline: valueAsNumber(raw.reveal_deadline),
    resolution_eligibility_time: valueAsNumber(raw.resolution_eligibility_time),
    refund_deadline: valueAsNumber(raw.refund_deadline),
    entry_stake: valueAsNumber(raw.entry_stake),
    entry_stake_wei: valueAsWei(raw.entry_stake),
    total_escrow_wei: valueAsWei(raw.total_escrow),
    paid_out_wei: valueAsWei(raw.paid_out),
    frozen_sources: asArray<{ url: string; sha256: string }>(raw.frozen_sources),
    min_players: valueAsNumber(raw.min_players),
    max_players: valueAsNumber(raw.max_players),
    status: String(raw.status ?? "DRAFT") as CaseStatus,
    player_count: valueAsNumber(raw.player_count),
    total_escrow: valueAsNumber(raw.total_escrow),
    paid_out: valueAsNumber(raw.paid_out),
    resolution_attempts: valueAsNumber(raw.resolution_attempts),
    no_winner_refund: Boolean(raw.no_winner_refund),
    resolution: normaliseResolution(raw.resolution),
    entries: entries.map((entry) => normaliseEntry(entry)),
  };
}

function normaliseEntry(value: unknown): NoirEntry {
  const raw = value as Record<string, unknown>;
  return {
    case_id: raw.case_id ? String(raw.case_id) : undefined,
    player: String(raw.player ?? ""),
    stake: raw.stake === undefined ? undefined : valueAsNumber(raw.stake),
    commitment: raw.commitment ? String(raw.commitment) : undefined,
    revealed: Boolean(raw.revealed),
    suspect_id: String(raw.suspect_id ?? ""),
    theory: String(raw.theory ?? ""),
    evidence_ids: asArray<string>(raw.evidence_ids).map(String),
    claimed: Boolean(raw.claimed),
    refunded: Boolean(raw.refunded),
  };
}

export async function readCaseIds(): Promise<string[]> {
  if (!IS_CONFIGURED) return [];
  const client = makeReadClient();
  const value = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_case_ids",
    args: [],
  });
  return asArray<unknown>(value).map(String);
}

export async function readCase(caseId: string): Promise<NoirCase> {
  const client = makeReadClient();
  const [rawCase, rawEntries] = await Promise.all([
    client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_case",
      args: [caseId],
    }),
    client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_case_entries",
      args: [caseId],
    }),
  ]);
  return normaliseCase(rawCase, asArray<unknown>(rawEntries));
}

export async function readEntry(caseId: string, account: string): Promise<NoirEntry | null> {
  if (!IS_CONFIGURED) return null;
  const client = makeReadClient();
  const value = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_entry",
    args: [caseId, account],
  });
  if (!value || typeof value !== "object" || Object.keys(value as object).length === 0) {
    return null;
  }
  return normaliseEntry(value);
}

export function genToWei(gen: number): bigint {
  const fixed = gen.toFixed(18);
  const [whole, fraction = ""] = fixed.split(".");
  return BigInt(whole) * BigInt("1000000000000000000") + BigInt(fraction.padEnd(18, "0"));
}

const WEI_PER_GEN = BigInt("1000000000000000000");

/** Format wei as GEN without ever going through a float. */
export function formatGen(wei: bigint, decimals = 3): string {
  const negative = wei < BigInt(0);
  const value = negative ? -wei : wei;
  const whole = value / WEI_PER_GEN;
  const fraction = (value % WEI_PER_GEN).toString().padStart(18, "0").slice(0, decimals);
  const sign = negative ? "-" : "";
  return decimals > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export function weiToGen(wei: number | bigint): string {
  return formatGen(valueAsWei(wei));
}

export async function writeCase(
  account: string,
  functionName: string,
  args: unknown[],
  value: bigint = BigInt(0),
): Promise<string> {
  if (!IS_CONFIGURED) throw new Error("Configure the Consensus Noir contract address first.");
  const client = makeWriteClient(account);
  await client.connect("studionet");
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
    value,
    consensusMaxRotations: 5,
  });
  return String(hash);
}
