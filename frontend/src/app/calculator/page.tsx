"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Header } from "@/components/Header";
import { CopyButton } from "@/components/CopyButton";
import { api, type HealthScore } from "@/lib/api";
import { formatUsdc } from "@/lib/format";

// Facilitators the user can pick. The actual revenue math doesn't depend on
// this — x402 has no protocol fee — but the dropdown is explicit feedback
// that the answer's the same no matter which one they choose.
const FACILITATORS = ["Meridian", "Polymer", "Relai", "Other"] as const;
type Facilitator = (typeof FACILITATORS)[number];

const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

// Growth-projection sanity caps. Real x402 growth right now (post-backfill)
// would explode any uncapped compounding; clamp to a plausible range.
const MONTHLY_GROWTH_MIN = -0.20;   // -20% / month
const MONTHLY_GROWTH_MAX =  0.50;   // +50% / month
const MONTHLY_GROWTH_FALLBACK = 0.15;

export default function CalculatorPage() {
  const params = useSearchParams();
  const [price, setPrice] = useState<number>(
    Number(params.get("price")) || 0.01,
  );
  const [calls, setCalls] = useState<number>(
    Number(params.get("calls")) || 1000,
  );
  const [facilitator, setFacilitator] = useState<Facilitator>(
    (params.get("fac") as Facilitator) || "Meridian",
  );
  const [health, setHealth] = useState<HealthScore | null>(null);

  // Network growth context, fetched once. Refreshes on /health-score's
  // own 60s cadence aren't worth wiring — the projection is a static
  // estimate, not a live feed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.healthScore();
        if (!cancelled) setHealth(s);
      } catch { /* leave as null */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Derived: monthly growth rate, clamped.
  const monthlyGrowth = useMemo(() => {
    if (!health) return MONTHLY_GROWTH_FALLBACK;
    const v24 = health.components.volume.volume_24h;
    const vPrev = health.components.volume.volume_prev_24h;
    if (vPrev <= 0) return MONTHLY_GROWTH_FALLBACK;
    // 24h-over-prior-24h compounded across ~30 days, then clamped.
    const dailyRatio = v24 / vPrev;
    const monthlyRatio = Math.pow(dailyRatio, 1 / 1) * Math.pow(dailyRatio, 0); // identity, placeholder
    // Treat the observed ratio as the *monthly* signal (a heuristic that
    // avoids absurd compounding when the indexer just backfilled).
    const raw = dailyRatio - 1;
    return Math.max(MONTHLY_GROWTH_MIN, Math.min(MONTHLY_GROWTH_MAX, raw));
  }, [health]);

  const weeklyGrowth = useMemo(() => {
    return Math.pow(1 + monthlyGrowth, 1 / 4.33) - 1;
  }, [monthlyGrowth]);

  const safePrice = Math.max(0, price);
  const safeCalls = Math.max(0, calls);
  const dailyRev = safePrice * safeCalls;
  const monthlyRev = dailyRev * DAYS_PER_MONTH;
  const yearlyRev = dailyRev * DAYS_PER_YEAR;

  // 6-months-from-now projected daily calls.
  const projectedCalls6m = safeCalls * Math.pow(1 + monthlyGrowth, 6);

  // 12-month projected monthly revenue series.
  const projection = useMemo(() => {
    const series: { month: number; revenue: number }[] = [];
    let mRev = monthlyRev;
    for (let m = 1; m <= 12; m++) {
      series.push({ month: m, revenue: mRev });
      mRev *= 1 + monthlyGrowth;
    }
    return series;
  }, [monthlyRev, monthlyGrowth]);

  // Shareable URL with the current scenario.
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const u = new URL(window.location.href);
    u.searchParams.set("price", String(price));
    u.searchParams.set("calls", String(calls));
    u.searchParams.set("fac", facilitator);
    return u.toString();
  }, [price, calls, facilitator]);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <Hero />

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="card space-y-4 p-5 shadow-card animate-fade-in-up lg:col-span-2">
            <SectionHead title="Inputs" sub="Tune your scenario" />
            <NumberField
              label="Price per API call (USDC)"
              value={price}
              step={0.001}
              min={0}
              onChange={setPrice}
            />
            <NumberField
              label="Expected daily calls"
              value={calls}
              step={100}
              min={0}
              onChange={setCalls}
            />
            <SelectField
              label="Your facilitator"
              value={facilitator}
              options={[...FACILITATORS]}
              onChange={(v) => setFacilitator(v as Facilitator)}
            />

            <div className="rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-xs text-brand">
              x402 charges <span className="font-semibold">zero protocol fees</span>.
              <br />
              <span className="text-brand/70">All revenue flows directly to you.</span>
            </div>

            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-white/70">
                {shareUrl || "—"}
              </code>
              <CopyButton text={shareUrl} label="Share" copiedLabel="Copied" />
            </div>
          </div>

          <div className="card space-y-4 p-5 shadow-card animate-fade-in-up lg:col-span-3">
            <SectionHead title="Estimated Revenue" sub="Updates as you type" />
            <div className="grid grid-cols-3 gap-3">
              <RevenueCard label="Daily"   value={`$${formatUsdc(dailyRev)}`}    sub="USDC" />
              <RevenueCard label="Monthly" value={`$${formatUsdc(monthlyRev)}`}  sub={`${DAYS_PER_MONTH}d`} />
              <RevenueCard label="Yearly"  value={`$${formatUsdc(yearlyRev)}`}   sub="365d" />
            </div>

            <GrowthCallout
              loading={!health}
              monthlyGrowth={monthlyGrowth}
              weeklyGrowth={weeklyGrowth}
              currentCalls={safeCalls}
              projectedCalls6m={projectedCalls6m}
            />

            <ProjectionChart series={projection} />
          </div>
        </section>

        <BackLink />
      </main>
    </>
  );
}

/* ---------------- pieces ---------------- */

function Hero() {
  return (
    <div className="animate-fade-in">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        x402 <span className="brand-gradient">Revenue Calculator</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-white/60">
        Estimate your earnings as an x402 API seller based on real network data.
      </p>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">{title}</h2>
      <p className="mt-1 text-xs text-white/40">{sub}</p>
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        {label}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/90 outline-none transition focus:border-brand/50 focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(0,255,136,0.12)]"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/90 outline-none transition focus:border-brand/50 focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(0,255,136,0.12)]"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-bg">
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function RevenueCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold leading-none brand-gradient tabular">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-white/40">{sub}</p>
    </div>
  );
}

function GrowthCallout({
  loading,
  monthlyGrowth,
  weeklyGrowth,
  currentCalls,
  projectedCalls6m,
}: {
  loading: boolean;
  monthlyGrowth: number;
  weeklyGrowth: number;
  currentCalls: number;
  projectedCalls6m: number;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-white/40">
        Loading network growth rate…
      </div>
    );
  }
  const wPct = (weeklyGrowth * 100).toFixed(1);
  const mPct = (monthlyGrowth * 100).toFixed(1);
  return (
    <div className="rounded-lg border border-brand/20 bg-brand/[0.06] px-3 py-2 text-xs text-white/70">
      At current x402 network growth (
      <span className="text-brand tabular">
        {Number(wPct) >= 0 ? "+" : ""}
        {wPct}%/wk
      </span>{" "}
      ·{" "}
      <span className="text-brand tabular">
        {Number(mPct) >= 0 ? "+" : ""}
        {mPct}%/mo
      </span>
      ), your daily call volume of{" "}
      <span className="font-semibold text-white tabular">
        {Math.round(currentCalls).toLocaleString()}
      </span>{" "}
      could reach{" "}
      <span className="font-semibold text-brand tabular">
        {Math.round(projectedCalls6m).toLocaleString()}
      </span>{" "}
      in 6 months.
    </div>
  );
}

function ProjectionChart({ series }: { series: { month: number; revenue: number }[] }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        12-month projected monthly revenue
      </p>
      <div className="mt-2 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#00ff88" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#00ff88" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={(m: number) => `M${m}`}
              stroke="rgba(255,255,255,0.3)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="rgba(255,255,255,0.3)"
              fontSize={11}
              tickFormatter={(v: number) => `$${formatUsdc(v, true)}`}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip content={<ProjTooltip />} cursor={{ stroke: "rgba(0,255,136,0.3)" }} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#00ff88"
              strokeWidth={2}
              fill="url(#projGrad)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ProjTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-bg/90 px-3 py-2 text-xs shadow-card backdrop-blur">
      <div className="text-white/50">Month {label}</div>
      <div className="mt-1 font-medium text-brand tabular">
        ${formatUsdc(payload[0].value)}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <a
      href="/"
      className="inline-flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-brand"
    >
      ← Back to dashboard
    </a>
  );
}
