"use client";

import { useEffect, useRef, useState } from "react";
import { api, FeedRow, Stats } from "@/lib/api";
import { formatUsdc, shortAddress } from "@/lib/format";

/**
 * Abstract live-activity waveform with a 24h-volume readout in the header
 * and short-lived tx popups that appear in the top-right of the chart area
 * each time a new transaction lands.
 *
 *  - Right edge of the waveform = now; line flows leftward over ~24s.
 *  - Each new payment from /feed injects a spike at the right edge.
 *  - Spike decays 8% per tick (100ms cadence) and scrolls away.
 *  - Tx popup chip = shortAddress(from) + amount, lives ~3s with a
 *    slide-left + fade-out animation. Multiple chips stack briefly.
 *  - Header shows last_24h volume from /stats, refreshed every 30s.
 */

const SAMPLES = 240;
const TICK_MS = 100;
const FEED_POLL_MS = 5_000;
const STATS_POLL_MS = 30_000;
const DECAY = 0.92;
const PULSE_BASE = 0.95;
const PULSE_STACK = 0.25;

const POPUP_MS = 3_000;       // each popup visible for 3s
const MAX_POPUPS = 4;          // max visible at once

type Popup = {
  id: string;
  from: string;
  amount: number;
  facilitator: string;
  spawnedAt: number;
};

export function LivePulse() {
  const [, setTick] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);

  const samplesRef = useRef<number[]>(new Array(SAMPLES).fill(0));
  const pendingPulsesRef = useRef(0);
  const pendingPopupsRef = useRef<Popup[]>([]);
  const popupsRef = useRef<Popup[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  // Poll /feed → queue waveform pulses + tx popups
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let rows: FeedRow[];
      try { rows = await api.feed(50); }
      catch { return; }
      if (cancelled) return;

      if (firstLoadRef.current) {
        rows.forEach((r) => seenRef.current.add(r.tx_hash));
        firstLoadRef.current = false;
        return;
      }

      const fresh = rows.filter((r) => !seenRef.current.has(r.tx_hash));
      if (!fresh.length) return;
      fresh.forEach((r) => seenRef.current.add(r.tx_hash));

      pendingPulsesRef.current += fresh.length;
      const now = Date.now();
      const newPopups: Popup[] = fresh.slice(0, MAX_POPUPS).map((r) => ({
        id: r.tx_hash,
        from: r.from_address,
        amount: r.amount_usdc,
        facilitator: r.facilitator,
        spawnedAt: now,
      }));
      pendingPopupsRef.current.push(...newPopups);
    };
    load();
    const id = setInterval(load, FEED_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll /stats for the 24h volume readout
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await api.stats();
        if (!cancelled) setStats(s);
      } catch { /* swallow */ }
    };
    load();
    const id = setInterval(load, STATS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Animation tick — shift waveform, decay, drain popup queue, expire old ones.
  useEffect(() => {
    const id = setInterval(() => {
      const arr = samplesRef.current;
      for (let i = 0; i < arr.length - 1; i++) {
        arr[i] = arr[i + 1] * DECAY;
      }
      const pulses = pendingPulsesRef.current;
      arr[arr.length - 1] = pulses > 0
        ? PULSE_BASE + (pulses - 1) * PULSE_STACK
        : 0;
      pendingPulsesRef.current = 0;

      // Drain pending popups + expire old ones in one pass.
      const now = Date.now();
      if (pendingPopupsRef.current.length || popupsRef.current.length) {
        const incoming = pendingPopupsRef.current;
        pendingPopupsRef.current = [];
        const next = [...incoming, ...popupsRef.current]
          .filter((p) => now - p.spawnedAt < POPUP_MS)
          .slice(0, MAX_POPUPS);
        popupsRef.current = next;
        setPopups(next);
      }

      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // popupsRef is maintained inside the tick loop alongside `popups` state;
  // the loop both reads `popupsRef.current` to merge incoming items and
  // writes it back after setting state, so renders stay in sync without
  // chasing stale closures.

  const W = 1000;
  const H = 200;
  const baseline = H * 0.78;
  const peakRange = H * 0.55;
  const dx = W / (SAMPLES - 1);
  const samples = samplesRef.current;

  let topPath = "";
  for (let i = 0; i < samples.length; i++) {
    const x = i * dx;
    const v = Math.min(1.6, samples[i]);
    const y = baseline - (v / 1.6) * peakRange;
    topPath += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  const areaPath = `${topPath} L ${W} ${baseline} L 0 ${baseline} Z`;

  return (
    <section className="card overflow-hidden p-5 shadow-card animate-fade-in-up text-brand">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Live Pulse
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Each spike is one x402 payment landing on Base
          </p>
        </div>

        <div className="flex items-end gap-5">
          {/* Last-24h volume readout */}
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
              Last 24h Volume
            </div>
            <div className="mt-0.5 text-xl font-semibold tabular text-brand">
              {stats
                ? `$${formatUsdc(stats.volume_24h_usdc)}`
                : "—"}
            </div>
          </div>
          <span className="flex items-center gap-1.5 pb-1 text-[11px] uppercase tracking-[0.18em] text-brand">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-brand" />
              <span className="relative inline-flex h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" />
            </span>
            Live
          </span>
        </div>
      </div>

      <div className="relative h-[180px] w-full sm:h-[200px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="currentColor" stopOpacity={0.32} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="pulseStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="currentColor" stopOpacity={0.15} />
              <stop offset="70%"  stopColor="currentColor" stopOpacity={0.85} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={1} />
            </linearGradient>
            <filter id="pulseGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
          </defs>

          <line
            x1={0} x2={W} y1={baseline} y2={baseline}
            stroke="rgb(var(--fg-rgb) / 0.08)"
            strokeWidth={1}
            strokeDasharray="3 6"
          />

          <path d={areaPath} fill="url(#pulseFill)" />

          <path
            d={topPath}
            stroke="currentColor"
            strokeWidth={2.4}
            strokeOpacity={0.45}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#pulseGlow)"
          />
          <path
            d={topPath}
            stroke="url(#pulseStroke)"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <circle
            cx={W - 6}
            cy={baseline - (Math.min(1.6, samples[samples.length - 1]) / 1.6) * peakRange}
            r={4.5}
            fill="currentColor"
          />
        </svg>

        {/* Ephemeral tx popups, top-right of the chart area */}
        <div className="pointer-events-none absolute right-3 top-2 flex flex-col items-end gap-1.5">
          {popups.map((p) => {
            const age = (Date.now() - p.spawnedAt) / POPUP_MS;
            const opacity = Math.max(0, 1 - age * 1.15);
            // Slide slightly to the left as it ages.
            const translateX = age * -14;
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-brand/30 bg-bg/80 px-2.5 py-1 shadow-brand-glow-sm backdrop-blur-sm"
                style={{
                  opacity,
                  transform: `translateX(${translateX}px)`,
                  transition: "opacity 200ms linear, transform 200ms linear",
                }}
              >
                <span className="font-mono text-[10px] text-white/70">
                  {shortAddress(p.from)}
                </span>
                <span className="text-[10px] text-white/30">·</span>
                <span className="text-xs font-semibold tabular text-brand">
                  ${formatUsdc(p.amount)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Time labels */}
        <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] uppercase tracking-wider text-white/30">
          −24s
        </div>
        <div className="pointer-events-none absolute bottom-1 right-2 text-[10px] uppercase tracking-wider text-brand/70">
          now
        </div>
      </div>
    </section>
  );
}
