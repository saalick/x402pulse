"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, Period, VolumePoint } from "@/lib/api";
import { formatUsdc } from "@/lib/format";

const REFRESH_MS = 30_000;
const PERIODS: Period[] = ["1h", "24h", "7d"];

export function VolumeChart() {
  const [period, setPeriod] = useState<Period>("24h");
  const [data, setData] = useState<VolumePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const points = await api.volume(period);
        if (!cancelled) {
          setData(points);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [period]);

  const totals = useMemo(() => {
    const vol = data.reduce((acc, p) => acc + p.volume, 0);
    const txns = data.reduce((acc, p) => acc + p.txns, 0);
    return { vol, txns };
  }, [data]);

  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Volume
          </h2>
          <p className="mt-1 text-2xl font-semibold tabular brand-gradient">
            ${formatUsdc(totals.vol)}{" "}
            <span className="ml-1 text-xs font-normal text-white/40">
              {totals.txns.toLocaleString()} txns · last {period}
            </span>
          </p>
        </div>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>
      <div className="h-72 w-full">
        {loading && data.length === 0 ? (
          <Loader />
        ) : data.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="volGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00ff88" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#00ff88" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(t) => fmtTick(t, period)}
                stroke="rgba(255,255,255,0.3)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="rgba(255,255,255,0.3)"
                fontSize={11}
                tickFormatter={(v) => `$${formatUsdc(v, true)}`}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip content={<ChartTooltip period={period} />} cursor={{ stroke: "rgba(0,255,136,0.3)" }} />
              <Area
                type="monotone"
                dataKey="volume"
                stroke="#00ff88"
                strokeWidth={2}
                fill="url(#volGradient)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function PeriodTabs({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-white/10 bg-white/[0.02] p-1">
      {PERIODS.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider transition ${
              active
                ? "bg-brand/15 text-brand"
                : "text-white/50 hover:text-white"
            }`}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  period,
}: {
  active?: boolean;
  payload?: Array<{ payload: VolumePoint }>;
  label?: number;
  period: Period;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/10 bg-bg/90 px-3 py-2 text-xs shadow-card backdrop-blur">
      <div className="text-white/50">{fmtTick(label!, period, true)}</div>
      <div className="mt-1 font-medium text-brand">${formatUsdc(point.volume)}</div>
      <div className="text-white/40">{point.txns} txns</div>
    </div>
  );
}

function fmtTick(ts: number, period: Period, full = false): string {
  const d = new Date(ts * 1000);
  if (period === "7d") {
    return full
      ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (period === "24h") {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  // 1h → mm:ss-ish
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function Loader() {
  return (
    <div className="grid h-full place-items-center text-xs text-white/40">
      Loading…
    </div>
  );
}

function Empty() {
  return (
    <div className="grid h-full place-items-center text-xs text-white/40">
      No volume in this window yet.
    </div>
  );
}
