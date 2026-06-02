"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type FacilitatorStats } from "@/lib/api";
import { formatUsdc } from "@/lib/format";

/**
 * Live bar-chart race across facilitators.
 *
 * On the first poll we snapshot each facilitator's `volume_24h` as the baseline
 * (start of race). Every 12 s thereafter we re-poll and plot (current − baseline)
 * — that's the new USDC routed since the user opened the page.
 *
 * Bar width animates via CSS `transition: width`. Rank shuffling is a
 * `transform: translateY(rank * row)` so the whole bar slides into its new
 * slot, rather than the table rearranging row-by-row.
 */

const POLL_MS = 12_000;
const ROW_HEIGHT = 48; // px, must match Tailwind h-12

const SHADES: Record<string, string> = {
  meridian: "#00ff88",
  relai:    "#00cc6a",
  polymer:  "#009950",
};
const FALLBACK_SHADE = "#006633";

const colorFor = (name: string) => SHADES[name] ?? FALLBACK_SHADE;

export function FacilitatorRace() {
  const [stats, setStats] = useState<FacilitatorStats[]>([]);
  const [raceStartTs, setRaceStartTs] = useState<number>(() => Date.now());
  const baselineRef = useRef<Record<string, number>>({});
  const baselinedRef = useRef(false);
  const [, setTick] = useState(0);

  // Poll loop.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api.facilitators();
        if (cancelled) return;
        // First poll → snapshot baselines so the race truly starts at zero.
        if (!baselinedRef.current) {
          const seed: Record<string, number> = {};
          for (const f of next) seed[f.name] = f.volume_24h;
          baselineRef.current = seed;
          baselinedRef.current = true;
        } else {
          // Any newcomers (rare): baseline at their current volume so they
          // start the race at zero too rather than instantly leading.
          for (const f of next) {
            if (!(f.name in baselineRef.current)) {
              baselineRef.current[f.name] = f.volume_24h;
            }
          }
        }
        setStats(next);
      } catch { /* keep prior */ }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [raceStartTs]);

  // "started X minutes ago" subtitle ticks once a second.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1_000);
    return () => clearInterval(id);
  }, []);

  const racing = useMemo(() => {
    const out = stats.map((f) => ({
      name:   f.name,
      // Volume earned since the race started. Clamp at 0 in case the
      // 24h-rolling window slipped backward.
      gained: Math.max(0, f.volume_24h - (baselineRef.current[f.name] ?? 0)),
    }));
    out.sort((a, b) => b.gained - a.gained);
    return out;
  }, [stats]);

  const maxGained = Math.max(1e-6, ...racing.map((r) => r.gained));
  const since = humanSince(raceStartTs);

  const onReset = () => {
    baselinedRef.current = false;
    baselineRef.current = {};
    setRaceStartTs(Date.now());
  };

  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Facilitator Race
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Volume earned since you opened the page · race started {since} ago
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/70 transition hover:border-brand/30 hover:text-brand"
        >
          Reset
        </button>
      </div>

      {racing.length === 0 ? (
        <div className="grid h-32 place-items-center text-xs text-white/40">
          Waiting for the first poll…
        </div>
      ) : (
        <div className="relative" style={{ height: racing.length * ROW_HEIGHT + 8 }}>
          {racing.map((r, rank) => (
            <RaceBar
              key={r.name}
              name={r.name}
              gained={r.gained}
              maxGained={maxGained}
              rank={rank}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RaceBar({
  name,
  gained,
  maxGained,
  rank,
}: {
  name: string;
  gained: number;
  maxGained: number;
  rank: number;
}) {
  const widthPct = Math.max(2, (gained / maxGained) * 100);
  const color = colorFor(name);
  return (
    <div
      className="absolute left-0 right-0 flex h-12 items-center gap-3 transition-transform duration-700 ease-out"
      style={{ transform: `translateY(${rank * ROW_HEIGHT}px)` }}
    >
      <span
        className="w-6 text-right text-xs tabular text-white/40"
        title={`Rank #${rank + 1}`}
      >
        {rank + 1}
      </span>
      <span className="w-24 truncate text-xs uppercase tracking-wider text-white/80">
        {name}
      </span>
      <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-white/[0.04]">
        <div
          className="h-full rounded-md transition-all duration-[1100ms] ease-out"
          style={{
            width: `${widthPct}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: `0 0 12px ${color}55`,
          }}
        />
      </div>
      <span
        className="w-32 shrink-0 text-right text-sm font-semibold tabular"
        style={{ color }}
      >
        ${formatUsdc(gained)}
      </span>
    </div>
  );
}

function humanSince(t: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}
