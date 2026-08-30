"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Link2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import WalletLoginButton from "@/components/WalletLoginButton";
import {
  acceptBaseDuel,
  approveAndCreateBaseDuel,
  createFixtureCommitment,
  findOrCreateBaseDuel,
  isBaseDuelConfigured,
  type TicketFixture,
} from "@/lib/base-sepolia";
import { useAuthStore } from "@/store/useAuthStore";

type TicketOption = {
  value: number;
  label: string;
  probabilityBps: number;
};

type TicketMarket = {
  id: number;
  title: string;
  helper: string;
  options: TicketOption[];
};

type DemoBot = {
  id: string;
  name: string;
  strategy: string;
  picks: number[];
};

type DemoScenario = {
  id: string;
  summary: string;
  outcomes: number[];
};

type DemoScore = {
  correct: number;
  weighted: number;
  bestPick: number;
};

type DemoDuel = {
  bot: DemoBot;
  scenario: DemoScenario;
  playerScore: DemoScore;
  botScore: DemoScore;
  winner: "player" | "bot" | "draw";
};

const fixture: TicketFixture = {
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  competition: "Premier League",
  kickoff: Math.floor(Date.UTC(2026, 8, 5, 15, 0, 0) / 1000),
  matchDate: "2026-09-05",
  resolutionUrl: "https://www.bbc.com/sport/football/scores-fixtures/2026-09-05",
  totalGoalsLineTenths: 25,
  totalCornersLineTenths: 95,
  totalCardsLineTenths: 35,
};

const ticketMarkets: TicketMarket[] = [
  {
    id: 0,
    title: "Match winner",
    helper: "Full-time result",
    options: [
      { value: 1, label: "Arsenal", probabilityBps: 3400 },
      { value: 2, label: "Draw", probabilityBps: 2500 },
      { value: 3, label: "Chelsea", probabilityBps: 4100 },
    ],
  },
  {
    id: 1,
    title: "First team to score",
    helper: "First goal, or no goals",
    options: [
      { value: 1, label: "Arsenal", probabilityBps: 4400 },
      { value: 2, label: "Chelsea", probabilityBps: 4700 },
      { value: 3, label: "No goals", probabilityBps: 900 },
    ],
  },
  {
    id: 2,
    title: "Total goals",
    helper: "Over / under 2.5",
    options: [
      { value: 1, label: "Over 2.5", probabilityBps: 5900 },
      { value: 2, label: "Under 2.5", probabilityBps: 4100 },
    ],
  },
  {
    id: 3,
    title: "Total corners",
    helper: "Over / under 9.5",
    options: [
      { value: 1, label: "Over 9.5", probabilityBps: 5600 },
      { value: 2, label: "Under 9.5", probabilityBps: 4400 },
    ],
  },
  {
    id: 4,
    title: "Total cards",
    helper: "Over / under 3.5",
    options: [
      { value: 1, label: "Over 3.5", probabilityBps: 5300 },
      { value: 2, label: "Under 3.5", probabilityBps: 4700 },
    ],
  },
  {
    id: 5,
    title: "Both teams to score",
    helper: "One goal each",
    options: [
      { value: 1, label: "Yes", probabilityBps: 6100 },
      { value: 2, label: "No", probabilityBps: 3900 },
    ],
  },
];

const defaultPicks = ticketMarkets.map((market) => market.options[0].value);
const impliedProbabilityBps = ticketMarkets.flatMap((market) =>
  market.options.map((option) => option.probabilityBps),
);

const demoBots: DemoBot[] = [
  {
    id: "form",
    name: "FormBot",
    strategy: "Follows the market favourites",
    picks: [3, 2, 1, 1, 1, 1],
  },
  {
    id: "value",
    name: "ValueBot",
    strategy: "Hunts low-probability outcomes",
    picks: [2, 3, 2, 2, 2, 2],
  },
  {
    id: "stats",
    name: "StatsBot",
    strategy: "Backs a tight away performance",
    picks: [3, 2, 2, 1, 1, 2],
  },
];

const demoScenarios: DemoScenario[] = [
  {
    id: "home-thriller",
    summary: "Arsenal 2–1 Chelsea · Arsenal scored first · 12 corners · 4 cards",
    outcomes: [1, 1, 1, 1, 1, 1],
  },
  {
    id: "score-draw",
    summary: "Arsenal 1–1 Chelsea · Chelsea scored first · 8 corners · 3 cards",
    outcomes: [2, 2, 2, 2, 2, 1],
  },
  {
    id: "away-control",
    summary: "Arsenal 0–2 Chelsea · Chelsea scored first · 11 corners · 5 cards",
    outcomes: [3, 2, 2, 1, 1, 2],
  },
  {
    id: "stalemate",
    summary: "Arsenal 0–0 Chelsea · No goals · 7 corners · 2 cards",
    outcomes: [2, 3, 2, 2, 2, 2],
  },
];

function formatProbability(probabilityBps: number) {
  return (probabilityBps / 100).toFixed(probabilityBps % 100 === 0 ? 0 : 1) + "%";
}

function formatKickoff(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp * 1000)) + " UTC";
}

function weightedValue(probabilityBps: number) {
  return Math.floor(1_000_000 / probabilityBps);
}

function optionFor(marketIndex: number, outcome: number) {
  return ticketMarkets[marketIndex].options.find((option) => option.value === outcome);
}

function scoreDemoTicket(ticket: number[], actualOutcomes: number[]): DemoScore {
  return ticket.reduce<DemoScore>(
    (score, pick, marketIndex) => {
      if (pick !== actualOutcomes[marketIndex]) return score;
      const probability = optionFor(marketIndex, pick)?.probabilityBps ?? 10_000;
      const value = weightedValue(probability);
      return {
        correct: score.correct + 1,
        weighted: score.weighted + value,
        bestPick: Math.max(score.bestPick, value),
      };
    },
    { correct: 0, weighted: 0, bestPick: 0 },
  );
}

function demoWinner(player: DemoScore, bot: DemoScore): DemoDuel["winner"] {
  if (player.weighted !== bot.weighted) return player.weighted > bot.weighted ? "player" : "bot";
  if (player.correct !== bot.correct) return player.correct > bot.correct ? "player" : "bot";
  if (player.bestPick !== bot.bestPick) return player.bestPick > bot.bestPick ? "player" : "bot";
  return "draw";
}

export default function ProofPlayMvp() {
  const auth = useAuthStore();
  const [picks, setPicks] = useState<number[]>(defaultPicks);
  const [entryStake, setEntryStake] = useState("5");
  const [opponentAddress, setOpponentAddress] = useState("");
  const [joinDuelId, setJoinDuelId] = useState("");
  const [pendingAction, setPendingAction] = useState<"match" | "invite" | "join" | null>(null);
  const [notice, setNotice] = useState(
    "Build a six-pick ticket. Every pick will settle independently at full time.",
  );
  const [transactionUrl, setTransactionUrl] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [demoDuel, setDemoDuel] = useState<DemoDuel | null>(null);
  const baseDuelConfigured = isBaseDuelConfigured();

  useEffect(() => {
    const duelId = new URLSearchParams(window.location.search).get("duel");
    if (!duelId) return;
    const frame = window.requestAnimationFrame(() => {
      setJoinDuelId(duelId);
      setNotice("Challenge link detected. Build your ticket, then join the duel before kickoff.");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const selectedOptions = useMemo(
    () =>
      ticketMarkets.map((market, index) => {
        return market.options.find((option) => option.value === picks[index]) ?? market.options[0];
      }),
    [picks],
  );
  const ticketWeight = selectedOptions.reduce(
    (total, option) => total + weightedValue(option.probabilityBps),
    0,
  );
  const fixtureCommitment = createFixtureCommitment(fixture);

  function choosePick(marketIndex: number, value: number) {
    setPicks((current) => current.map((pick, index) => (index === marketIndex ? value : pick)));
    setDemoDuel(null);
  }

  function playDemoBot() {
    const randomValues = new Uint32Array(2);
    window.crypto.getRandomValues(randomValues);
    const bot = demoBots[randomValues[0] % demoBots.length];
    const scenario = demoScenarios[randomValues[1] % demoScenarios.length];
    const playerScore = scoreDemoTicket(picks, scenario.outcomes);
    const botScore = scoreDemoTicket(bot.picks, scenario.outcomes);
    const winner = demoWinner(playerScore, botScore);
    setDemoDuel({ bot, scenario, playerScore, botScore, winner });
    setNotice(
      winner === "player"
        ? `You beat ${bot.name} in the demo duel.`
        : winner === "bot"
          ? `${bot.name} won this demo duel. Adjust your ticket and replay.`
          : `You drew with ${bot.name}. Identical demo scores split the result.`,
    );
  }

  function connectedWallet() {
    if (!auth.authenticated) {
      void auth.login();
      return null;
    }
    if (!auth.wallet) {
      setNotice("Reconnect your EVM wallet and try again.");
      return null;
    }
    return auth.wallet;
  }

  async function createChallenge(invitedOpponent: string | null) {
    const isPrivateChallenge = Boolean(invitedOpponent?.trim());
    if (!baseDuelConfigured) {
      setNotice(
        isPrivateChallenge
          ? "Preview mode: configure the duel contract to create a private invitation."
          : "Preview mode: configure the duel contract to enter automatic matchmaking.",
      );
      return;
    }
    const wallet = connectedWallet();
    if (!wallet) return;

    setPendingAction(isPrivateChallenge ? "invite" : "match");
    setTransactionUrl(null);
    setInviteLink(null);
    try {
      const result = isPrivateChallenge
        ? await approveAndCreateBaseDuel({
            wallet,
            fixture,
            invitedOpponent,
            entryStake,
            impliedProbabilityBps,
            picks,
          })
        : await findOrCreateBaseDuel({
            wallet,
            fixture,
            entryStake,
            impliedProbabilityBps,
            picks,
          });
      setTransactionUrl(result.explorerUrl);
      if (result.duelId) {
        const link = window.location.origin + "/?duel=" + result.duelId;
        if (isPrivateChallenge) {
          setInviteLink(link);
          setNotice(
            "Private duel #" + result.duelId + " created. Copy the link and send it to your friend before kickoff.",
          );
        } else if ("matchmakingStatus" in result && result.matchmakingStatus === "matched") {
          setNotice(
            "Matched automatically in duel #" + result.duelId + ". Both tickets are locked until the fixture is verified.",
          );
        } else {
          setNotice(
            "No compatible player was waiting. Your ticket is queued as duel #" + result.duelId + " for automatic pairing.",
          );
        }
      } else {
        setNotice(
          isPrivateChallenge
            ? "Private duel created on the test network. Open the transaction to read its duel ID and share it with your friend."
            : "Ticket entered into automatic matchmaking on the test network. Open the transaction to read its duel ID.",
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create the duel.");
    } finally {
      setPendingAction(null);
    }
  }

  async function joinDuel() {
    if (!baseDuelConfigured) {
      setNotice(
        "Preview mode: configure the duel contract before joining a duel.",
      );
      return;
    }
    const wallet = connectedWallet();
    if (!wallet) return;

    setPendingAction("join");
    setTransactionUrl(null);
    try {
      const result = await acceptBaseDuel({ wallet, duelId: joinDuelId.trim(), picks });
      setTransactionUrl(result.explorerUrl);
      setNotice("Ticket locked. It can settle only after the fixture result is verified.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not join this duel.");
    } finally {
      setPendingAction(null);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink || !navigator.clipboard) return;
    await navigator.clipboard.writeText(inviteLink);
    setNotice("Invitation link copied. Your friend can open it and submit a competing ticket.");
  }

  return (
    <main className="min-h-screen bg-bg-base px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="font-display text-2xl font-black tracking-tight sm:text-3xl">
            Football Duel<span className="text-primary-500">.</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="rounded-full border-2 border-primary-900 bg-pastel-yellow px-3 py-1.5 text-[10px] font-black uppercase tracking-wide">
              Archived test prototype
            </span>
            <WalletLoginButton compact />
          </div>
        </header>

        <section className="mt-8 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="bubbly-card overflow-hidden bg-white">
            <div className="border-b-3 border-primary-900 bg-primary-900 px-5 py-6 text-white sm:px-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-pastel-yellow">
                    Head-to-head football prediction
                  </p>
                  <h1 className="mt-2 font-display text-4xl font-black leading-none sm:text-5xl">
                    Build your ticket.
                    <br />
                    Beat your rival.
                  </h1>
                </div>
                <div className="rounded-2xl border-2 border-white/70 bg-white/10 px-3 py-2 text-right">
                  <p className="text-[10px] font-black uppercase tracking-wide text-white/70">Kickoff lock</p>
                  <p className="mt-1 text-xs font-bold">{formatKickoff(fixture.kickoff)}</p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-pastel-green px-3 py-1.5 text-primary-900">Arsenal</span>
                <span className="rounded-full bg-white/15 px-3 py-1.5">vs</span>
                <span className="rounded-full bg-pastel-pink px-3 py-1.5 text-primary-900">Chelsea</span>
                <span className="rounded-full bg-white/15 px-3 py-1.5">{fixture.competition}</span>
              </div>
            </div>

            <div className="p-4 sm:p-6">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="font-display text-2xl font-black">Your six-pick ticket</p>
                  <p className="mt-1 text-sm font-semibold opacity-65">
                    Pick one outcome in every independent market.
                  </p>
                </div>
                <span className="rounded-full bg-pastel-blue px-3 py-1.5 text-xs font-black">
                  {ticketWeight.toLocaleString()} potential weighted points
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {ticketMarkets.map((market, marketIndex) => (
                  <section key={market.title} className="rounded-2xl border-2 border-primary-900 bg-bg-base p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black">{market.title}</p>
                        <p className="text-[11px] font-semibold opacity-60">{market.helper}</p>
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black">
                        Pick {marketIndex + 1}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {market.options.map((option) => {
                        const selected = picks[marketIndex] === option.value;
                        return (
                          <button
                            key={option.label}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => choosePick(marketIndex, option.value)}
                            className={
                              "flex items-center justify-between rounded-xl border-2 px-3 py-2 text-left text-xs font-black transition " +
                              (selected
                                ? "border-primary-900 bg-pastel-green shadow-[2px_2px_0px_0px_#312e81]"
                                : "border-primary-300 bg-white hover:border-primary-900")
                            }
                          >
                            <span>{option.label}</span>
                            <span className="text-[10px] opacity-65">{formatProbability(option.probabilityBps)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <section className="bubbly-card bg-pastel-yellow p-5">
              <div className="flex items-center gap-2">
                <Trophy size={20} />
                <h2 className="font-display text-2xl font-black">How you win</h2>
              </div>
              <p className="mt-3 text-sm font-bold leading-relaxed">
                Each correct pick scores by its implied probability. Calling a 9% no-goals
                outcome earns more than calling a 61% favourite.
              </p>
              <ol className="mt-4 space-y-2 text-xs font-bold leading-relaxed">
                <li><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-900 text-white">1</span>Highest weighted score</li>
                <li><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-900 text-white">2</span>Most correct picks, then highest-value pick</li>
                <li><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-900 text-white">3</span>Earlier ticket; exact tie refunds both entries</li>
              </ol>
            </section>

            <section className="bubbly-card bg-pastel-pink p-5">
              <div className="flex items-center gap-2">
                <Bot size={21} />
                <h2 className="font-display text-2xl font-black">Automatic bot match</h2>
              </div>
              <p className="mt-2 text-xs font-bold leading-relaxed opacity-70">
                Lock your ticket and the app will assign an opponent. You cannot choose the bot, and its ticket stays hidden until settlement.
              </p>
              <button
                type="button"
                onClick={playDemoBot}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary-900 bg-primary-900 px-3 py-3 text-xs font-black text-white shadow-[3px_3px_0px_0px_#fef08a] transition hover:translate-y-0.5 hover:shadow-none"
              >
                <Bot size={16} />{demoDuel ? "Find another bot" : "Find a bot & play"}
              </button>

              {demoDuel ? (
                <div className="mt-4 rounded-2xl border-2 border-primary-900 bg-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-wide opacity-55">Demo full-time result</p>
                  <p className="mt-1 text-xs font-black leading-relaxed">{demoDuel.scenario.summary}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-xl bg-pastel-green p-2">
                      <p className="text-[10px] font-black uppercase">You</p>
                      <p className="font-display text-2xl font-black">{demoDuel.playerScore.correct}/6</p>
                      <p className="text-[9px] font-bold">{demoDuel.playerScore.weighted} pts</p>
                    </div>
                    <div className="rounded-xl bg-pastel-blue p-2">
                      <p className="text-[10px] font-black uppercase">{demoDuel.bot.name}</p>
                      <p className="font-display text-2xl font-black">{demoDuel.botScore.correct}/6</p>
                      <p className="text-[9px] font-bold">{demoDuel.botScore.weighted} pts</p>
                    </div>
                  </div>
                  <p className="mt-3 rounded-xl bg-primary-900 px-3 py-2 text-center text-xs font-black text-white">
                    {demoDuel.winner === "player"
                      ? "You win the duel"
                      : demoDuel.winner === "bot"
                        ? `${demoDuel.bot.name} wins`
                        : "Duel drawn"}
                  </p>
                  <div className="mt-3 space-y-2">
                    {ticketMarkets.map((market, marketIndex) => {
                      const actual = demoDuel.scenario.outcomes[marketIndex];
                      const playerCorrect = picks[marketIndex] === actual;
                      const botCorrect = demoDuel.bot.picks[marketIndex] === actual;
                      return (
                        <div key={market.title} className="rounded-xl border border-primary-200 bg-bg-base px-2.5 py-2 text-[9px] font-bold">
                          <p className="font-black">{market.title}: {optionFor(marketIndex, actual)?.label}</p>
                          <p className="mt-1 flex justify-between gap-2 opacity-70">
                            <span>You: {optionFor(marketIndex, picks[marketIndex])?.label} {playerCorrect ? "✓" : "×"}</span>
                            <span>Bot: {optionFor(marketIndex, demoDuel.bot.picks[marketIndex])?.label} {botCorrect ? "✓" : "×"}</span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="bubbly-card bg-white p-5">
              <div className="flex items-center gap-2">
                <Users size={20} />
                <h2 className="font-display text-2xl font-black">Find an opponent</h2>
              </div>
              <p className="mt-2 text-xs font-bold leading-relaxed opacity-65">
                Enter the shared queue for this fixture. The app pairs you automatically with the next eligible player.
              </p>
              <label className="mt-4 block text-[11px] font-black uppercase tracking-wide">
                Entry per player (test USDC)
                <input
                  inputMode="decimal"
                  value={entryStake}
                  onChange={(event) => setEntryStake(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border-2 border-primary-900 bg-bg-base px-3 py-2.5 text-sm font-black outline-none focus:bg-white"
                />
              </label>
              <button
                type="button"
                onClick={() => void createChallenge(null)}
                disabled={pendingAction !== null}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary-900 bg-pastel-green px-3 py-3 text-xs font-black shadow-[3px_3px_0px_0px_#312e81] transition hover:translate-y-0.5 hover:shadow-none disabled:cursor-wait disabled:opacity-60"
              >
                <Users size={16} />
                {pendingAction === "match" ? "Finding opponent…" : "Find me an opponent"}
              </button>
            </section>

            <section className="bubbly-card bg-white p-5">
              <div className="flex items-center gap-2">
                <Link2 size={20} />
                <h2 className="font-display text-2xl font-black">Challenge a friend privately</h2>
              </div>
              <p className="mt-2 text-xs font-bold leading-relaxed opacity-65">
                This is the only mode where you choose your opponent. The invitation is restricted to their wallet.
              </p>
              <label className="mt-4 block text-[11px] font-black uppercase tracking-wide">
                Friend&apos;s wallet
                <input
                  value={opponentAddress}
                  onChange={(event) => setOpponentAddress(event.target.value)}
                  placeholder="0x…"
                  className="mt-1.5 w-full rounded-xl border-2 border-primary-900 bg-bg-base px-3 py-2.5 text-xs font-semibold outline-none focus:bg-white"
                />
              </label>
              <p className="mt-2 text-[10px] font-bold opacity-55">Uses the {entryStake || "0"} test-USDC entry selected above.</p>
              <button
                type="button"
                onClick={() => void createChallenge(opponentAddress)}
                disabled={pendingAction !== null || !opponentAddress.trim()}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary-900 bg-pastel-yellow px-3 py-3 text-xs font-black shadow-[3px_3px_0px_0px_#312e81] transition hover:translate-y-0.5 hover:shadow-none disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Link2 size={16} />
                {pendingAction === "invite" ? "Creating invitation…" : "Create private challenge"}
              </button>
              {inviteLink ? (
                <button
                  type="button"
                  onClick={copyInviteLink}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary-900 bg-white px-3 py-2.5 text-xs font-black"
                >
                  <Link2 size={15} />Copy invitation link
                </button>
              ) : null}
            </section>

            <section className="bubbly-card bg-pastel-blue p-5">
              <div className="flex items-center gap-2">
                <CircleDollarSign size={20} />
                <h2 className="font-display text-2xl font-black">Join a private challenge</h2>
              </div>
              <p className="mt-2 text-xs font-bold leading-relaxed opacity-65">
                A friend&apos;s private challenge link fills this automatically. You can still make entirely different picks.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  inputMode="numeric"
                  value={joinDuelId}
                  onChange={(event) => setJoinDuelId(event.target.value)}
                  placeholder="Duel ID"
                  className="min-w-0 flex-1 rounded-xl border-2 border-primary-900 bg-white px-3 py-2.5 text-sm font-black outline-none"
                />
                <button
                  type="button"
                  onClick={joinDuel}
                  disabled={pendingAction !== null}
                  className="rounded-xl border-2 border-primary-900 bg-primary-900 px-3 text-xs font-black text-white disabled:opacity-60"
                >
                  {pendingAction === "join" ? "…" : "Join"}
                </button>
              </div>
            </section>
          </aside>
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-3">
          <article className="bubbly-card bg-white p-4">
            <ShieldCheck size={20} />
            <h2 className="mt-3 font-display text-xl font-black">Independent settlement</h2>
            <p className="mt-1 text-xs font-bold leading-relaxed opacity-65">
              Your corners pick can be right even when your match-winner pick is wrong. No money moves between individual picks.
            </p>
          </article>
          <article className="bubbly-card bg-white p-4">
            <Sparkles size={20} />
            <h2 className="mt-3 font-display text-xl font-black">GenLayer verifies facts</h2>
            <p className="mt-1 text-xs font-bold leading-relaxed opacity-65">
              Studionet independently validates the final score, first scorer, corners, and cards before Base scores either ticket.
            </p>
          </article>
          <article className="bubbly-card bg-white p-4">
            <CheckCircle2 size={20} />
            <h2 className="mt-3 font-display text-xl font-black">One pot, one duel</h2>
            <p className="mt-1 text-xs font-bold leading-relaxed opacity-65">
              Base Sepolia holds one test-USDC entry from each player. The winner claims the two-player pot; a true tie refunds both.
            </p>
          </article>
        </section>

        <section className="mt-5 rounded-2xl border-2 border-primary-900 bg-white p-4 text-sm font-bold leading-relaxed">
          <p>{notice}</p>
          {transactionUrl ? (
            <a className="mt-2 inline-block text-primary-700 underline" href={transactionUrl} target="_blank" rel="noreferrer">
              View Base Sepolia transaction
            </a>
          ) : null}
          <p className="mt-2 text-[11px] opacity-60">
            Fixture commitment: {fixtureCommitment}. Testnet assets have no value. {baseDuelConfigured ? "On-chain Base duel contract detected." : "Running in honest preview mode until the Base duel contract address is configured."}
          </p>
        </section>
      </div>
    </main>
  );
}
