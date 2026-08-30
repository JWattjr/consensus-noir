import Link from "next/link";
import { ShieldCheck, Trophy, Users } from "lucide-react";

const principles = [
  {
    icon: <Users size={20} />,
    title: "Real head-to-head play",
    copy: "Two players build full tickets on the same football fixture. They may agree on any pick; the better scored ticket wins.",
  },
  {
    icon: <Trophy size={20} />,
    title: "Six independent markets",
    copy: "Match winner, first scorer, goals, corners, cards, and both teams to score each settle against the real match facts.",
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "Testnet by design",
    copy: "Base Sepolia holds test USDC only. GenLayer Studionet validates the fixture facts before a ticket is scored.",
  },
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-bg-base px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-5">
        <Link href="/" className="text-xs font-bold opacity-60">Back home</Link>
        <section className="bubbly-card bg-white p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-primary-700">Archived football duel</p>
          <h1 className="mt-2 font-display text-4xl font-bold">A football prediction duel, not a pooled market.</h1>
          <p className="mt-3 text-sm font-bold leading-relaxed opacity-70">
            This is an archived head-to-head football prediction prototype. Each player creates a six-pick ticket for the same fixture, then both tickets are independently scored against the final match facts. The player with the stronger ticket wins the duel. The active submission is Reality Bridge.
          </p>
        </section>
        <section className="grid gap-3 sm:grid-cols-3">
          {principles.map((principle) => (
            <article key={principle.title} className="bubbly-card bg-white p-4">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border-2 border-primary-900 bg-pastel-green">
                {principle.icon}
              </div>
              <p className="font-display text-xl font-bold">{principle.title}</p>
              <p className="mt-1 text-xs font-bold leading-relaxed opacity-60">{principle.copy}</p>
            </article>
          ))}
        </section>
        <section className="bubbly-card bg-pastel-yellow p-5">
          <h2 className="font-display text-2xl font-black">Scoring and ties</h2>
          <p className="mt-2 text-sm font-bold leading-relaxed">
            Correct lower-probability calls are worth more. Ties resolve by weighted score, then correct-pick count, then the most valuable correct pick, then the earlier ticket. An exact final tie refunds both test-USDC entries.
          </p>
        </section>
      </div>
    </main>
  );
}
