"use client";

import { useEffect, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { api, Fingerprint } from "@/lib/api";

/**
 * Five-axis fingerprint radar for a single agent. Loads /agent/{addr}/fingerprint
 * once on mount — these scores only shift with new activity, so refresh on the
 * same cadence as the rest of the profile (once on page render).
 */
export function AgentFingerprint({ address }: { address: string }) {
  const [data, setData] = useState<Fingerprint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fp = await api.fingerprint(address);
        if (!cancelled) setData(fp);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [address]);

  const rows = data?.axes.map((a) => ({ axis: a.label, value: a.score, detail: a.detail })) ?? [];

  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Agent Fingerprint
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Five 0–100 axes, each normalized against the full indexed network
          </p>
        </div>
      </div>

      {error ? (
        <div className="grid h-56 place-items-center text-xs text-red-400/80">
          fingerprint error: {error}
        </div>
      ) : !data ? (
        <div className="grid h-56 place-items-center text-xs text-white/40">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-2">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={rows} outerRadius="80%">
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis
                  dataKey="axis"
                  stroke="rgba(255,255,255,0.65)"
                  tick={{ fontSize: 11 }}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  stroke="rgba(255,255,255,0.15)"
                  tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }}
                  tickCount={5}
                  axisLine={false}
                />
                <Radar
                  name="score"
                  dataKey="value"
                  stroke="#00ff88"
                  fill="#00ff88"
                  fillOpacity={0.3}
                  isAnimationActive
                  animationDuration={700}
                />
                <Tooltip content={<RadarTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-2">
            {data.axes.map((a) => (
              <li
                key={a.label}
                className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
                    {a.label}
                  </p>
                  <p className="mt-0.5 text-xs text-white/70">{a.detail}</p>
                </div>
                <span className="shrink-0 tabular text-sm font-semibold text-brand">
                  {Math.round(a.score)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function RadarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { axis: string; value: number; detail: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/10 bg-bg/90 px-3 py-2 text-xs shadow-card backdrop-blur">
      <div className="text-white/50">{p.axis}</div>
      <div className="mt-1 font-medium text-brand tabular">{Math.round(p.value)} / 100</div>
      <div className="text-white/40">{p.detail}</div>
    </div>
  );
}
