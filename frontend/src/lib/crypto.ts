const DOMAIN = "consensus-noir-accusation-v1";

export const REQUIRED_EVIDENCE_PICKS = 3;

export interface LocalAccusation {
  caseId: string;
  player: string;
  suspectId: string;
  theory: string;
  evidenceIds: string[];
  salt: string;
  commitment: string;
  savedAt: number;
}

export function normalizeTheory(value: string): string {
  return value.normalize("NFKC").trim().split(/\s+/u).filter(Boolean).join(" ");
}

export function theoryByteLength(value: string): number {
  return new TextEncoder().encode(normalizeTheory(value)).byteLength;
}

/** The contract sorts and de-duplicates picks, so the client must match it. */
export function canonicalEvidence(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).sort();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Derive the reveal key from a wallet signature instead of random bytes, so a
 * player who clears their browser or moves device can regenerate it. The text
 * below is what the wallet displays, so it says plainly what the signature does.
 */
export function revealKeyMessage(caseId: string, player: string): string {
  return [
    "Consensus Noir reveal key",
    "",
    `Case: ${caseId}`,
    `Wallet: ${player.toLowerCase()}`,
    "",
    "Signing this creates the private key that unlocks your reveal.",
    "It never leaves your browser, moves no funds, and approves no transaction.",
  ].join("\n");
}

export async function deriveSalt(caseId: string, player: string): Promise<string> {
  const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!ethereum) throw new Error("No wallet is available to derive your reveal key.");
  const signature = (await ethereum.request({
    method: "personal_sign",
    params: [revealKeyMessage(caseId, player), player],
  })) as string;
  if (typeof signature !== "string" || signature.length < 32) {
    throw new Error("The wallet did not return a usable signature.");
  }
  return sha256Hex(signature);
}

export async function makeAccusationCommitment(
  caseId: string,
  player: string,
  suspectId: string,
  theory: string,
  evidenceIds: string[],
  salt: string,
): Promise<string> {
  const normalized = normalizeTheory(theory);
  const theoryDigest = await sha256Hex(normalized);
  const canonical = [
    DOMAIN,
    caseId,
    player.toLowerCase(),
    suspectId,
    theoryDigest,
    canonicalEvidence(evidenceIds).join(","),
    salt,
  ].join("\x1f");
  return sha256Hex(canonical);
}

function storageKey(caseId: string, player: string): string {
  return `consensus-noir:accusation:${caseId}:${player.toLowerCase()}`;
}

export function loadLocalAccusation(caseId: string, player?: string): LocalAccusation | null {
  if (!player || typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(storageKey(caseId, player));
    if (!value) return null;
    const parsed = JSON.parse(value) as LocalAccusation;
    if (parsed.caseId !== caseId || parsed.player.toLowerCase() !== player.toLowerCase()) return null;
    return { ...parsed, evidenceIds: canonicalEvidence(parsed.evidenceIds ?? []) };
  } catch {
    return null;
  }
}

export function saveLocalAccusation(value: LocalAccusation): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(value.caseId, value.player), JSON.stringify(value));
  } catch {
    // A full or blocked store must not stop the player committing; the wallet
    // signature can regenerate the key, and the download backup still works.
  }
}

export function downloadSaltBackup(accusation: LocalAccusation): void {
  const payload = JSON.stringify(
    {
      app: "Consensus Noir",
      version: 2,
      case_id: accusation.caseId,
      player: accusation.player,
      suspect_id: accusation.suspectId,
      theory: accusation.theory,
      evidence_ids: accusation.evidenceIds,
      salt: accusation.salt,
      commitment: accusation.commitment,
      saved_at: new Date(accusation.savedAt).toISOString(),
    },
    null,
    2,
  );
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `consensus-noir-${accusation.caseId}-reveal-key.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Restore an accusation from a downloaded backup. This is the recovery path
 * when local storage has been cleared and the wallet cannot re-derive the key
 * (for example after switching wallets).
 */
export function importSaltBackup(raw: string, caseId: string, player: string): LocalAccusation {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("That file is not a Consensus Noir backup.");
  }
  const backupCase = String(parsed.case_id ?? "");
  const backupPlayer = String(parsed.player ?? "");
  if (backupCase !== caseId) {
    throw new Error(`That backup is for case ${backupCase || "unknown"}, not this one.`);
  }
  if (backupPlayer.toLowerCase() !== player.toLowerCase()) {
    throw new Error("That backup belongs to a different wallet.");
  }
  const salt = String(parsed.salt ?? "");
  const suspectId = String(parsed.suspect_id ?? "");
  const theory = String(parsed.theory ?? "");
  const evidenceIds = canonicalEvidence(
    Array.isArray(parsed.evidence_ids) ? (parsed.evidence_ids as unknown[]).map(String) : [],
  );
  if (!salt || !suspectId || !theory) {
    throw new Error("That backup is missing the suspect, theory or key.");
  }
  const restored: LocalAccusation = {
    caseId,
    player,
    suspectId,
    theory,
    evidenceIds,
    salt,
    commitment: String(parsed.commitment ?? ""),
    savedAt: Date.now(),
  };
  saveLocalAccusation(restored);
  return restored;
}
