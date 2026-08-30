/**
 * The contract tags every failure with [EXPECTED], [TRANSIENT] or [LLM_ERROR].
 * Players should never see those markers, or the raw sentence behind them.
 */

interface Explanation {
  text: string;
  retry: boolean;
}

const MESSAGES: Array<[string, Explanation]> = [
  [
    "Reveal does not match commitment",
    {
      retry: false,
      text:
        "This does not match what you committed. Check you are using the same wallet, and the exact suspect, theory, evidence and key you saved.",
    },
  ],
  [
    "Pick exactly three distinct evidence items",
    { retry: false, text: "Choose exactly three different pieces of evidence." },
  ],
  [
    "Accusation deadline has passed",
    {
      retry: false,
      text: "Entries have closed for this case. Anyone can advance it to open the reveal window.",
    },
  ],
  [
    "Reveal deadline has passed",
    { retry: false, text: "The reveal window has closed for this case." },
  ],
  [
    "Player already entered",
    { retry: false, text: "This wallet already has an entry in this case." },
  ],
  [
    "Entry value must equal the case stake",
    { retry: false, text: "The amount sent must match the case stake exactly." },
  ],
  [
    "Entry already settled",
    {
      retry: false,
      text: "You have already settled this case. Check your wallet for the transfer.",
    },
  ],
  [
    "Entry is not a correct revealed accusation",
    {
      retry: false,
      text: "Only a correct, revealed accusation can claim a share of this pool.",
    },
  ],
  [
    "Case is not resolvable",
    { retry: false, text: "This case is not ready for a verdict yet." },
  ],
  [
    "Resolution eligibility time has not passed",
    { retry: false, text: "The verdict cannot be requested yet. The case clock shows when." },
  ],
  [
    "Minimum players not reached",
    {
      retry: false,
      text: "Too few players entered, so this case cannot be judged. Every entrant can recover their stake.",
    },
  ],
  [
    "Case is full",
    { retry: false, text: "This case has reached its maximum number of players." },
  ],
  [
    "Only curator",
    { retry: false, text: "Only the case curator can do that." },
  ],
];

export function explain(error: unknown): Explanation {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const body = raw.replace(/\[(EXPECTED|TRANSIENT|LLM_ERROR)\]\s*/g, "").trim();

  for (const [needle, message] of MESSAGES) {
    if (body.includes(needle)) return message;
  }
  if (raw.includes("[LLM_ERROR]")) {
    return {
      retry: true,
      text: "The validators could not agree on a reading of this case. Anyone can request the verdict again.",
    };
  }
  if (/user rejected|denied|rejected the request/i.test(body)) {
    return { retry: true, text: "You cancelled the signature. Nothing was sent." };
  }
  return { retry: true, text: body || "Something went wrong. Please try again." };
}
