"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type Distribution } from "@/lib/api";
import { formatUsdc } from "@/lib/format";

const REFRESH_MS = 60_000;

// Sequential green palette for the pie segments — dark to bright.
const SEGMENT_COLORS = ["#003522", "#005c39", "#008451", "#00bf6f", "#00ff88"];

export function PaymentSizeDistribution() {
  const [data, setData] = useState<Distribution | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const d = await api.distribution();
        if (!cancelled) setData(d);
      } catch { /* swallow */ }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const largest = useMemo(() => {
    if (!data) return 0;
    return data.buckets.reduce(
      (max, b) => Math.max(max, b.volume_usdc / Math.max(1, b.count)),
      0,
    );
    // best per-bucket-average size proxy; close to "biggest single tx ceiling"
  }, [data]);

  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-4">
        <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
          Payment Size Distribution
        </h2>
        <p className="mt-1 text-xs text-white/40">
          How x402 payments break down across micro to whale tiers
        </p>
      </div>

      {!data ? (
        <div className="grid h-64 place-items-center text-xs text-white/40">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BarPanel buckets={data.buckets} />
            <PiePanel buckets={data.buckets} />
          </div>
          <HighlightRow median={data.median_payment_usdc} mode={data.mode_bucket} largest={largest} />
        </>
      )}
    </section>
  );
}

function BarPanel({ buckets }: { buckets: Distribution["buckets"] }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        Transactions per bucket
      </p>
      <div className="mt-2 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="label"
              tickFormatter={(s: string) => shortLabel(s)}
              stroke="rgba(255,255,255,0.3)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              stroke="rgba(255,255,255,0.3)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => Intl.NumberFormat("en", { notation: "compact" }).format(v)}
            />
            <Tooltip content={<BarTooltip />} cursor={{ fill: "rgba(0,255,136,0.08)" }} />
            <Bar
              dataKey="count"
              fill="#00ff88"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PiePanel({ buckets }: { buckets: Distribution["buckets"] }) {
  const totalVolume = buckets.reduce((s, b) => s + b.volume_usdc, 0) || 1;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        Volume share by bucket
      </p>
      <div className="mt-2 flex h-64 items-center">
        <div className="h-full w-1/2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={buckets}
                dataKey="volume_usdc"
                nameKey="label"
                innerRadius="55%"
                outerRadius="90%"
                paddingAngle={2}
                stroke="rgba(0,0,0,0.4)"
                isAnimationActive={false}
              >
                {buckets.map((_, i) => (
                  <Cell key={i} fill={SEGMENT_COLORS[i % SEGMENT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip total={totalVolume} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="w-1/2 space-y-1 text-xs">
          {buckets.map((b, i) => (
            <li key={b.label} className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 truncate">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SEGMENT_COLORS[i] }} />
                <span className="truncate text-white/70">{shortLabel(b.label)}</span>
              </span>
              <span className="shrink-0 tabular text-white/60">
                {((b.volume_usdc / totalVolume) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HighlightRow({
  median,
  mode,
  largest,
}: {
  median: number;
  mode: string;
  largest: number;
}) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Highlight label="Median Payment" value={`$${formatUsdc(median)}`} />
      <Highlight label="Most Common"    value={shortLabel(mode)} />
      <Highlight label="Largest Single" value={`$${formatUsdc(largest)}`} />
    </div>
  );
}

function Highlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-center">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tabular text-brand">{value}</p>
    </div>
  );
}

function shortLabel(s: string): string {
  // "Micro (<$0.01)" → "Micro <$0.01"
  return s.replace(/\s*\(([^)]+)\)$/, " $1");
}

function BarTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: Distribution["buckets"][number] }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/10 bg-bg/90 px-3 py-2 text-xs shadow-card backdrop-blur">
      <div className="text-white/60">{label}</div>
      <div className="mt-1 tabular text-brand">{p.count.toLocaleString()} txns</div>
      <div className="text-white/40">${formatUsdc(p.volume_usdc)} volume · {p.pct.toFixed(1)}%</div>
    </div>
  );
}

function PieTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-white/10 bg-bg/90 px-3 py-2 text-xs shadow-card backdrop-blur">
      <div className="text-white/60">{p.name}</div>
      <div className="mt-1 tabular text-brand">${formatUsdc(p.value)}</div>
      <div className="text-white/40">{((p.value / total) * 100).toFixed(1)}% of volume</div>
    </div>
  );
}
