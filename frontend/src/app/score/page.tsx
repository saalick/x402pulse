"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { api, type TrustScore } from "@/lib/api";
import { formatUsdc, shortAddress, timeAgo } from "@/lib/format";

const ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
const MAX_SCORE = 850;

// Calibrated to the score-label thresholds in api/main.py.
const SCORE_COLORS: Array<{ max: number; hex: string }> = [
  { max: 1,   hex: "#9ca3af" },  // 0 = grey
  { max: 300, hex: "#ff4d4d" },  // New Agent — red
  { max: 500, hex: "#ff9333" },  // Developing — orange
  { max: 650, hex: "#f0d030" },  // Established — yellow
  { max: 750, hex: "#00ff88" },  // Trusted — brand
  { max: 851, hex: "#66ffb2" },  // Elite — bright
];
const colorForScore = (s: number) =>
  SCORE_COLORS.find((c) => s < c.max)?.hex ?? "#66ffb2";

// Page wrapper — useSearchParams() must live inside a Suspense boundary
// for Next.js App Router (otherwise build fails on static prerender).
export default function ScorePage() {
  return (
    <Suspense fallback={null}>
      <ScoreBody />
    </Suspense>
  );
}

function ScoreBody() {
  const params = useSearchParams();
  const router = useRouter();

  const initial = params.get("address") ?? "";
  const [input, setInput] = useState(initial);
  const [submitted, setSubmitted] = useState<string | null>(
    initial && ADDRESS_RE.test(initial) ? initial.toLowerCase() : null,
  );
  const [error, setError] = useState<string | null>(null);

  const [score, setScore] = useState<TrustScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [board, setBoard] = useState<TrustScore[]>([]);

  // Fetch score for submitted address.
  useEffect(() => {
    if (!submitted) { setScore(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const s = await api.trustScore(submitted);
        if (!cancelled) { setScore(s); setError(null); }
      } catch (e) {
        if (!cancelled) {
          setScore(null);
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [submitted]);

  // Top-N leaderboard always visible.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lb = await api.scoreLeaderboard(20);
        if (!cancelled) setBoard(lb);
      } catch { /* leave empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = input.trim().toLowerCase();
    if (!ADDRESS_RE.test(v)) {
      setError("Not a valid 0x… address");
      setScore(null);
      setSubmitted(null);
      return;
    }
    setError(null);
    setSubmitted(v);
    // Reflect in URL so the result is shareable / refresh-safe.
    router.replace(`/score?address=${v}`);
  };

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        <Hero />

        <SearchSection
          value={input}
          onChange={setInput}
          onSubmit={onSubmit}
          error={error}
          loading={loading}
        />

        {submitted && score && <ScoreResult score={score} />}

        <Leaderboard board={board} />

        <HowItWorks />

        <Footer />
      </main>
    </>
  );
}

/* ---------------- pieces ---------------- */

function Hero() {
  return (
    <div className="animate-fade-in">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Agent <span className="brand-gradient">Trust Score</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-white/60">
        The credit score for AI agents on Base. Built from real x402 payment
        history — payments, age, volume, consistency, and facilitator diversity.
      </p>
    </div>
  );
}

function SearchSection({
  value,
  onChange,
  onSubmit,
  error,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  error: string | null;
  loading: boolean;
}) {
  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex flex-wrap gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter any wallet address..."
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 font-mono text-sm text-white/90 placeholder-white/30 outline-none transition focus:border-brand/50 focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(0,255,136,0.12)]"
        />
        <button
          type="submit"
          disabled={loading}
          className="shrink-0 rounded-md border border-brand/40 bg-brand/15 px-5 text-xs font-semibold uppercase tracking-wider text-brand transition hover:border-brand/60 hover:bg-brand/20 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Check Score"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-400/80">{error}</p>}
    </section>
  );
}

function ScoreResult({ score }: { score: TrustScore }) {
  const color = colorForScore(score.score);
  const isInactive = score.score === 0;
  return (
    <section className="card space-y-6 p-6 shadow-card animate-fade-in-up">
      <div className="flex flex-col items-center gap-3 text-center">
        <ScoreGauge score={score.score} color={color} />
        <div
          className="text-xs font-semibold uppercase tracking-[0.22em]"
          style={{ color }}
        >
          {score.label}
        </div>
        <div className="flex items-center gap-3">
          <GradeBadge grade={score.grade} color={color} />
          {!isInactive && (
            <span className="text-xs text-white/50">
              Better than{" "}
              <span className="tabular text-white/85">{score.percentile.toFixed(0)}%</span>{" "}
              of agents
            </span>
          )}
        </div>
        <div className="mt-1 font-mono text-xs text-white/50">
          {shortAddress(score.address)}
        </div>
      </div>

      <BreakdownGrid score={score} />

      <StatsRow score={score} />
    </section>
  );
}

function ScoreGauge({ score, color }: { score: number; color: string }) {
  // Semicircle arc — start at left (180°), end at right (0°).
  const r = 100;
  const cx = 140;
  const cy = 130;
  const startX = cx - r;
  const endX = cx + r;
  const arc = `M ${startX} ${cy} A ${r} ${r} 0 0 1 ${endX} ${cy}`;
  const arcLen = Math.PI * r;
  const filled = (Math.max(0, Math.min(MAX_SCORE, score)) / MAX_SCORE) * arcLen;
  return (
    <svg viewBox="0 0 280 160" width="100%" className="max-w-[320px]" aria-hidden>
      <path
        d={arc}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={14}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={arc}
        stroke={color}
        strokeWidth={14}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${filled} ${arcLen}`}
        style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1), stroke 0.4s" }}
      />
      <text
        x={cx}
        y={cy - 10}
        textAnchor="middle"
        fontSize="56"
        fontWeight="700"
        fontFamily="var(--font-geist-sans), system-ui, sans-serif"
        fill={color}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {Math.round(score)}
      </text>
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        fontSize="11"
        letterSpacing="0.22em"
        fontFamily="var(--font-geist-mono), monospace"
        fill="rgba(255,255,255,0.40)"
      >
        / {MAX_SCORE}
      </text>
    </svg>
  );
}

function GradeBadge({ grade, color }: { grade: string; color: string }) {
  return (
    <span
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 text-lg font-bold tabular"
      style={{ borderColor: color, color }}
    >
      {grade}
    </span>
  );
}

const DIM_LABELS: Record<string, string> = {
  payment_history: "Payment History",
  wallet_age:      "Wallet Age",
  volume:          "Volume",
  consistency:     "Consistency",
  diversity:       "Diversity",
};

function BreakdownGrid({ score }: { score: TrustScore }) {
  const order: Array<keyof TrustScore["dimensions"]> = [
    "payment_history", "wallet_age", "volume", "consistency", "diversity",
  ];
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
        Score breakdown
      </p>
      <ul className="space-y-2">
        {order.map((k) => {
          const d = score.dimensions[k];
          const pct = (d.score / d.max) * 100;
          return (
            <li key={k} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-white/75">{DIM_LABELS[k]}</span>
                <span className="tabular text-xs text-white/60">
                  <span className="font-semibold text-white/90">{d.score}</span>
                  <span className="text-white/40"> / {d.max}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-700"
                  style={{
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, rgba(0,255,136,0.5), #00ff88)",
                  }}
                />
              </div>
              <p className="mt-1 text-[10px] text-white/40">{d.detail}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatsRow({ score }: { score: TrustScore }) {
  const s = score.stats;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat label="Transactions"  value={s.total_transactions.toLocaleString()} />
      <Stat label="Volume"        value={`$${formatUsdc(s.total_volume_usdc)}`} />
      <Stat label="Days Active"   value={s.days_active.toString()} />
      <Stat label="First Seen"    value={s.first_seen ? timeAgo(s.first_seen) : "—"} />
      <Stat
        label="Facilitators"
        value={
          s.facilitators_used.length === 0
            ? "—"
            : s.facilitators_used.join(", ")
        }
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-center">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
        {label}
      </p>
      <p className="mt-1 truncate text-xs font-semibold text-white/90" title={value}>
        {value}
      </p>
    </div>
  );
}

function Leaderboard({ board }: { board: TrustScore[] }) {
  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
          Top Trusted Agents
        </h2>
        <span className="text-xs text-white/40">{board.length}</span>
      </div>
      {board.length === 0 ? (
        <div className="grid h-32 place-items-center text-xs text-white/40">
          Loading leaderboard…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/[0.02] text-left text-[11px] uppercase tracking-wider text-white/40">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 font-medium text-right">Score</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium text-right">Volume</th>
                <th className="px-3 py-2 font-medium text-right">Txns</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {board.map((s, i) => {
                const color = colorForScore(s.score);
                return (
                  <tr key={s.address} className="transition-colors hover:bg-brand/5">
                    <td className="px-3 py-2 text-xs text-white/40 tabular">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/agent/${s.address}`}
                        className="font-mono text-xs text-white/85 hover:text-brand"
                      >
                        {shortAddress(s.address)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular">
                      <span style={{ color }} className="font-semibold">
                        {s.score}
                      </span>
                      <span className="text-white/30 text-[10px]"> /{MAX_SCORE}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span style={{ color }} className="text-xs uppercase tracking-wider">
                        {s.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular text-white/85">
                      ${formatUsdc(s.stats.total_volume_usdc)}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-white/70">
                      {s.stats.total_transactions.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HowItWorks() {
  const steps = [
    "We index every x402 payment on Base in real time.",
    "We calculate a trust score from payment history, age, volume, consistency, and diversity.",
    "Scores update live as new payments are recorded.",
  ];
  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
        How it works
      </h2>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-white/70">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand/40 bg-brand/10 text-[10px] font-semibold tabular text-brand">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] italic text-white/40">
        AgentScore is based purely on x402 payment behavior. It is not financial advice.
      </p>
    </section>
  );
}

function Footer() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-brand"
    >
      ← Back to dashboard
    </Link>
  );
}
