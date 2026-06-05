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
 *  - Each new payment from /feed injects a spike whose height is log-
 *    scaled by the USDC amount (micros barely move the line, $100+ peaks).
 *  - Pulses are queued and drained one per tick so dense bursts look
 *    like a continuous trickle, not one big detonation per poll cycle.
 *  - Tx popup chip = shortAddress(from) + amount, lives ~3s with a
 *    slide-left + fade-out animation. Spawns staggered across the burst.
 *  - End-cap on the right edge has two animated concentric rings that
 *    radiate outwards, giving the line a clear "heartbeat" focal point.
 *  - Header shows last_24h volume from /stats, refreshed every 30s.
 */

const SAMPLES = 240;
const TICK_MS = 100;
const FEED_POLL_MS = 5_000;
const STATS_POLL_MS = 30_000;
const DECAY = 0.92;
const IDLE_BREATH_AMPL = 0.04;   // tiny baseline movement when nothing's happening
const PULSE_MIN = 0.30;
const PULSE_MAX = 1.55;

const POPUP_MS = 3_000;
const MAX_POPUPS = 4;
const POPUP_SPAWN_MS = 600;

type Popup = {
  id: string;
  from: string;
  amount: number;
  facilitator: string;
  spawnedAt: number;
};

type QueuedPulse = { height: number };

// Log-scale a USDC amount to a visible pulse height. Tuned so:
//   $0.01 → ~0.40   (barely visible nudge)
//   $0.50 → ~0.60
//   $1.00 → ~0.70
//   $10   → ~0.95
//   $100  → ~1.25
//   $1k+  → clamped at PULSE_MAX
function pulseHeightFromAmount(amount: number): number {
  const a = Math.max(0.001, amount);
  const h = 0.4 + Math.log10(a * 10 + 1) / 4;
  return Math.min(PULSE_MAX, Math.max(PULSE_MIN, h));
}

// Smooth path through samples using midpoint-quadratic Bezier curves —
// each sample becomes a control point, with the curve passing through
// the midpoints between consecutive samples. Avoids the jagged look of
// straight line segments without needing a full Catmull-Rom solver.
function buildSmoothPath(samples: number[], W: number, baseline: number, peakRange: number): string {
  if (samples.length < 2) return "";
  const dx = W / (samples.length - 1);
  const yOf = (v: number) => baseline - (Math.min(PULSE_MAX, Math.max(0, v)) / PULSE_MAX) * peakRange;

  const x0 = 0;
  const y0 = yOf(samples[0]);
  let d = `M ${x0.toFixed(1)} ${y0.toFixed(1)}`;

  for (let i = 1; i < samples.length - 1; i++) {
    const px = i * dx;
    const py = yOf(samples[i]);
    const nx = (i + 1) * dx;
    const ny = yOf(samples[i + 1]);
    const mx = (px + nx) / 2;
    const my = (py + ny) / 2;
    d += ` Q ${px.toFixed(1)} ${py.toFixed(1)}, ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  // Tail off into the final sample.
  const lastIdx = samples.length - 1;
  d += ` T ${(lastIdx * dx).toFixed(1)} ${yOf(samples[lastIdx]).toFixed(1)}`;
  return d;
}

export function LivePulse() {
  const [, setTick] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);

  const samplesRef = useRef<number[]>(new Array(SAMPLES).fill(0));
  const pulseQueueRef = useRef<QueuedPulse[]>([]);
  const pendingTxQueueRef = useRef<FeedRow[]>([]);
  const popupsRef = useRef<Popup[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  const popupSpawnAccRef = useRef(0);
  const startedAtRef = useRef(Date.now());   // for idle-breath phase

  // Poll /feed → enqueue pulses (sized by amount) + popup spawn requests.
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

      for (const r of fresh) {
        pulseQueueRef.current.push({ height: pulseHeightFromAmount(r.amount_usdc) });
      }
      pendingTxQueueRef.current.push(...fresh);
    };
    load();
    const id = setInterval(load, FEED_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll /stats for the 24h volume readout.
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

  // Animation tick.
  useEffect(() => {
    const id = setInterval(() => {
      const arr = samplesRef.current;

      // Shift everything one step left, applying decay so old spikes
      // gradually flatten as they scroll away.
      for (let i = 0; i < arr.length - 1; i++) {
        arr[i] = arr[i + 1] * DECAY;
      }

      // Dequeue one pulse per tick for a continuous trickle.
      const queued = pulseQueueRef.current.length;
      if (queued > 0) {
        const p = pulseQueueRef.current.shift()!;
        arr[arr.length - 1] = p.height;
      } else {
        // Idle breath — a soft sine ripple at the right edge instead of
        // dead-flat zero. Keeps the chart from looking frozen during
        // quiet moments while remaining clearly distinguishable from
        // an actual transaction spike.
        const t = (Date.now() - startedAtRef.current) / 1000;
        arr[arr.length - 1] = IDLE_BREATH_AMPL * (1 + Math.sin(t * 1.5)) * 0.5;
      }

      // Spawn one popup per ~POPUP_SPAWN_MS while txns are queued.
      const now = Date.now();
      popupSpawnAccRef.current += TICK_MS;
      if (
        pendingTxQueueRef.current.length > 0 &&
        popupSpawnAccRef.current >= POPUP_SPAWN_MS
      ) {
        popupSpawnAccRef.current = 0;
        const r = pendingTxQueueRef.current.shift()!;
        popupsRef.current = [
          ...popupsRef.current,
          {
            id: r.tx_hash,
            from: r.from_address,
            amount: r.amount_usdc,
            facilitator: r.facilitator,
            spawnedAt: now,
          },
        ];
      }

      // Expire old popups.
      if (popupsRef.current.length) {
        const next = popupsRef.current
          .filter((p) => now - p.spawnedAt < POPUP_MS)
          .slice(-MAX_POPUPS);
        if (next.length !== popupsRef.current.length) {
          popupsRef.current = next;
        }
      }

      setPopups(popupsRef.current.slice());
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ----------------------------- render -----------------------------

  const W = 1000;
  const H = 200;
  const baseline = H * 0.78;
  const peakRange = H * 0.6;
  const samples = samplesRef.current;
  const lastY = baseline - (Math.min(PULSE_MAX, samples[samples.length - 1]) / PULSE_MAX) * peakRange;

  const topPath = buildSmoothPath(samples, W, baseline, peakRange);
  const areaPath = `${topPath} L ${W} ${baseline} L 0 ${baseline} Z`;

  return (
    <section className="card overflow-hidden p-5 shadow-card animate-fade-in-up text-brand">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Live Pulse
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Each spike is one x402 payment — height scales with USDC amount
          </p>
        </div>

        <div className="flex items-end gap-5">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
              Last 24h Volume
            </div>
            <div className="mt-0.5 text-xl font-semibold tabular text-brand">
              {stats ? `$${formatUsdc(stats.volume_24h_usdc)}` : "—"}
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

      <div className="relative h-[180px] w-full sm:h-[220px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          <defs>
            {/* Soft area gradient — translucent fill under the curve */}
            <linearGradient id="lpFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="currentColor" stopOpacity={0.38} />
              <stop offset="50%"  stopColor="currentColor" stopOpacity={0.16} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
            {/* Horizontal gradient — fade in from left so old samples appear */}
            {/* to dissolve into the void instead of clipping abruptly. */}
            <linearGradient id="lpStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="currentColor" stopOpacity={0} />
              <stop offset="25%"  stopColor="currentColor" stopOpacity={0.6} />
              <stop offset="80%"  stopColor="currentColor" stopOpacity={1} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={1} />
            </linearGradient>
            {/* Big soft halo for the underglow path */}
            <filter id="lpHalo" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
            {/* Sharper glow around the end-cap dot */}
            <filter id="lpEndGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            {/* Subtle ambient radial backdrop */}
            <radialGradient id="lpBackdrop" cx="80%" cy="55%" r="60%">
              <stop offset="0%"  stopColor="currentColor" stopOpacity={0.05} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>

          {/* Ambient halo behind the chart */}
          <rect x="0" y="0" width={W} height={H} fill="url(#lpBackdrop)" />

          {/* Tick lines every ~5s of the 24s window for time orientation */}
          {Array.from({ length: 5 }, (_, i) => {
            const x = ((i + 1) / 5) * W;
            return (
              <line
                key={`tk${i}`}
                x1={x} x2={x}
                y1={baseline - peakRange - 6}
                y2={baseline + 6}
                stroke="rgb(var(--fg-rgb) / 0.04)"
                strokeWidth={1}
              />
            );
          })}

          {/* Baseline (dashed) */}
          <line
            x1={0} x2={W}
            y1={baseline} y2={baseline}
            stroke="rgb(var(--fg-rgb) / 0.08)"
            strokeWidth={1}
            strokeDasharray="2 6"
          />

          {/* Right-edge "now" marker line */}
          <line
            x1={W - 1} x2={W - 1}
            y1={baseline - peakRange - 4}
            y2={baseline + 4}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
          />

          {/* Area fill under the curve */}
          <path d={areaPath} fill="url(#lpFill)" />

          {/* Layer 1: blurred under-halo for ambient depth */}
          <path
            d={topPath}
            stroke="currentColor"
            strokeWidth={6}
            strokeOpacity={0.35}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#lpHalo)"
          />

          {/* Layer 2: main line with horizontal alpha gradient */}
          <path
            d={topPath}
            stroke="url(#lpStroke)"
            strokeWidth={2.2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Layer 3: bright top highlight, slightly thinner */}
          <path
            d={topPath}
            stroke="currentColor"
            strokeOpacity={0.7}
            strokeWidth={0.8}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Animated end-cap rings — radiate outward continuously */}
          <g filter="url(#lpEndGlow)">
            <circle cx={W - 6} cy={lastY} r={3} fill="currentColor" />
            <circle cx={W - 6} cy={lastY} r={3} fill="none" stroke="currentColor" strokeWidth={1}>
              <animate attributeName="r" from="3" to="14" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" from="0.65" to="0" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle cx={W - 6} cy={lastY} r={3} fill="none" stroke="currentColor" strokeWidth={1}>
              <animate attributeName="r" from="3" to="14" dur="1.6s" begin="0.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" from="0.4" to="0" dur="1.6s" begin="0.8s" repeatCount="indefinite" />
            </circle>
          </g>
        </svg>

        {/* Tx popups, top-right */}
        <div className="pointer-events-none absolute right-3 top-2 flex flex-col items-end gap-1.5">
          {popups.map((p) => {
            const age = (Date.now() - p.spawnedAt) / POPUP_MS;
            const opacity = Math.max(0, 1 - age * 1.15);
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

        {/* Time labels with subtle vertical marks */}
        <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] uppercase tracking-wider text-white/30">
          −24s
        </div>
        <div className="pointer-events-none absolute bottom-1 right-2 text-[10px] uppercase tracking-wider text-brand/80">
          now
        </div>
      </div>
    </section>
  );
}
