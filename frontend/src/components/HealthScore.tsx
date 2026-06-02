"use client";

import { useEffect, useState } from "react";
import { api, HealthScore as HS } from "@/lib/api";
import { CountUp } from "./CountUp";

const REFRESH_MS = 60_000;

const COLORS = [
  { max: 40, hex: "#ff4d4d" },   // Critical
  { max: 60, hex: "#ff9333" },   // Fair
  { max: 80, hex: "#f0d030" },   // Good (yellow)
  { max: 90, hex: "#00ff88" },   // Strong (brand)
  { max: 101, hex: "#66ffb2" },  // Excellent (bright)
];

function colorFor(score: number): string {
  for (const c of COLORS) if (score < c.max) return c.hex;
  return COLORS[COLORS.length - 1].hex;
}

export function HealthScore() {
  const [data, setData] = useState<HS | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await api.healthScore();
        if (!cancelled) setData(s);
      } catch { /* keep prior */ }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const score = data?.score ?? 0;
  const color = colorFor(score);
  const label = data?.label ?? "—";
  const change = data?.change_24h ?? 0;

  return (
    <section
      className="card relative overflow-hidden p-6 shadow-card animate-fade-in-up"
      aria-label="Agent economy health score"
    >
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-6">
          <Gauge score={score} color={color} />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
              Agent Economy Health Score
            </p>
            <p
              className="mt-1 text-2xl font-semibold leading-none tabular"
              style={{ color }}
            >
              {label}
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs text-white/50">
              <ChangeArrow value={change} />
              <span className="tabular">
                {change > 0 ? "+" : ""}
                {change.toFixed(1)}
              </span>
              <span>since 24h ago</span>
            </p>
          </div>
        </div>
        {data && (
          <div className="hidden grid-cols-2 gap-x-6 gap-y-1 text-xs text-white/40 sm:grid">
            <ComponentRow label="Velocity"  pct={data.components.velocity.score} />
            <ComponentRow label="Agents"    pct={data.components.agents.score} />
            <ComponentRow label="Volume"    pct={data.components.volume.score} />
            <ComponentRow label="Diversity" pct={data.components.diversity.score} />
          </div>
        )}
      </div>
    </section>
  );
}

function ChangeArrow({ value }: { value: number }) {
  if (value > 0.5) return <span className="text-brand">↑</span>;
  if (value < -0.5) return <span className="text-red-400">↓</span>;
  return <span className="text-white/40">→</span>;
}

function ComponentRow({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-white/50">{label}</span>
      <div className="h-1 w-20 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="tabular text-white/60">{Math.round(pct)}</span>
    </div>
  );
}

/**
 * 180° gauge arc with the score number centered.
 * Uses SVG path stroke-dasharray so the fill animates smoothly with the score.
 */
function Gauge({ score, color }: { score: number; color: string }) {
  const radius = 60;
  const cx = 80;
  const cy = 78;
  // semi-circle, start at left (180°), end at right (0°)
  const startX = cx - radius;
  const startY = cy;
  const endX = cx + radius;
  const endY = cy;
  const arcPath = `M ${startX},${startY} A ${radius},${radius} 0 0 1 ${endX},${endY}`;
  // arc length = π * r
  const arcLen = Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * arcLen;
  return (
    <svg
      width={160}
      height={96}
      viewBox="0 0 160 96"
      className="shrink-0"
      aria-hidden
    >
      {/* track */}
      <path
        d={arcPath}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={10}
        strokeLinecap="round"
        fill="none"
      />
      {/* filled portion */}
      <path
        d={arcPath}
        stroke={color}
        strokeWidth={10}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${filled} ${arcLen}`}
        style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1), stroke 0.4s" }}
      />
      {/* score number, centered */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize="32"
        fontWeight="600"
        fontFamily="var(--font-geist-sans), system-ui, sans-serif"
        fill={color}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <tspan>
          <CountUpText value={Math.round(score)} />
        </tspan>
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        fontSize="9"
        fontFamily="var(--font-geist-mono), monospace"
        fill="rgba(255,255,255,0.35)"
        style={{ letterSpacing: "0.18em" }}
      >
        / 100
      </text>
    </svg>
  );
}

// Tiny inline variant of CountUp that renders as an SVG text content.
function CountUpText({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const from = display;
    const start = performance.now();
    const dur = 900;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{display}</>;
}
