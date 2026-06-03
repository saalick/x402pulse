"use client";

import { useEffect, useRef, useState } from "react";
import { api, FeedRow } from "@/lib/api";

/**
 * Abstract live-activity waveform. Right edge = now. The line flows
 * leftward over time. Every time a new payment lands in /feed, a bump
 * is injected at the right edge; bumps decay as they scroll left.
 *
 * Replaces the old LiveActivityMap (which used random "agent origins"
 * on a world map and implied geographic data we don't actually have).
 */

const SAMPLES = 240;            // 240 sample points across the width
const TICK_MS = 100;            // animation cadence → 24s of history visible
const FEED_POLL_MS = 5_000;     // how often we pull new transactions
const DECAY = 0.92;             // amplitude decays 8% per tick
const PULSE_BASE = 0.95;        // height of one transaction's spike
const PULSE_STACK = 0.25;       // additional height per coincident tx

export function LivePulse() {
  // Force a re-render every TICK_MS so the SVG path updates.
  const [, setTick] = useState(0);

  // Live state lives in refs so we don't pay re-render cost on every mutation.
  const samplesRef = useRef<number[]>(new Array(SAMPLES).fill(0));
  const pendingPulsesRef = useRef(0);
  const seenRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  // Poll /feed and queue pulses for any tx_hashes we haven't seen.
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
    };
    load();
    const id = setInterval(load, FEED_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Tick loop — shift samples left, decay, inject pulses.
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
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const W = 1000;
  const H = 200;
  const baseline = H * 0.78;          // line sits 78% down — leaves room above
  const peakRange = H * 0.55;          // a max-height pulse reaches this far up
  const dx = W / (SAMPLES - 1);

  const samples = samplesRef.current;

  // Build smooth path from the sample buffer.
  let topPath = "";
  for (let i = 0; i < samples.length; i++) {
    const x = i * dx;
    const v = Math.min(1.6, samples[i]);
    const y = baseline - (v / 1.6) * peakRange;
    topPath += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  // Close back to baseline for the gradient fill area.
  const areaPath = `${topPath} L ${W} ${baseline} L 0 ${baseline} Z`;

  return (
    <section className="card overflow-hidden p-5 shadow-card animate-fade-in-up">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Live Pulse
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Each spike is one x402 payment landing on Base
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-brand">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-brand" />
            <span className="relative inline-flex h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" />
          </span>
          Live
        </span>
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
              <stop offset="0%"   stopColor="#00ff88" stopOpacity={0.32} />
              <stop offset="100%" stopColor="#00ff88" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="pulseStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#00ff88" stopOpacity={0.15} />
              <stop offset="70%"  stopColor="#00ff88" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#00ff88" stopOpacity={1} />
            </linearGradient>
            <filter id="pulseGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
          </defs>

          {/* Baseline guide */}
          <line
            x1={0} x2={W} y1={baseline} y2={baseline}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
            strokeDasharray="3 6"
          />

          {/* Filled area under the curve */}
          <path d={areaPath} fill="url(#pulseFill)" />

          {/* Glow pass + crisp stroke on top */}
          <path
            d={topPath}
            stroke="#00ff88"
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

          {/* "Now" marker on the right edge */}
          <circle
            cx={W - 6}
            cy={baseline - (Math.min(1.6, samples[samples.length - 1]) / 1.6) * peakRange}
            r={4.5}
            fill="#00ff88"
          />
        </svg>

        {/* Subtle time labels */}
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
