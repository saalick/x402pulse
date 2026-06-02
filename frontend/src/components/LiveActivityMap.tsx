"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, FeedRow } from "@/lib/api";

/**
 * "Live payment network" — flat-SVG world canvas.
 *
 * Renders a dark map with a thin lat/lon grid, plots facilitator nodes
 * at their known city coordinates, and animates a glowing arc from a
 * random origin to the corresponding facilitator node every time a new
 * row appears in /feed.
 *
 * We poll /feed every 5 s independently (so the map keeps animating
 * even if the LiveFeed component is unmounted on small screens).
 */

const MAP_W = 1000;
const MAP_H = 500;

// Equirectangular projection. lat ∈ [-90, 90], lon ∈ [-180, 180].
function proj(lat: number, lon: number): [number, number] {
  const x = ((lon + 180) / 360) * MAP_W;
  const y = ((90 - lat) / 180) * MAP_H;
  return [x, y];
}

type City = { name: string; lat: number; lon: number };

const FACILITATOR_NODES: Record<string, City[]> = {
  meridian:  [{ name: "San Francisco", lat: 37.7749, lon: -122.4194 }],
  coinbase:  [{ name: "San Francisco", lat: 37.7749, lon: -122.4194 }],
  thirdweb:  [{ name: "San Francisco", lat: 37.7749, lon: -122.4194 }],
  polymer:   [{ name: "New York",      lat: 40.7128, lon:  -74.0060 }],
  virtuals:  [{ name: "Singapore",     lat:  1.3521, lon:  103.8198 }],
  relai:     [{ name: "Zurich",        lat: 47.3769, lon:    8.5417 }],
  payai:     [{ name: "London",        lat: 51.5074, lon:   -0.1278 }],
  mogami:    [{ name: "Tokyo",         lat: 35.6762, lon:  139.6503 }],
  daydreams: [{ name: "London",        lat: 51.5074, lon:   -0.1278 }],
  corbits:   [{ name: "Toronto",       lat: 43.6532, lon:  -79.3832 }],
  kamiyo:    [{ name: "San Francisco", lat: 37.7749, lon: -122.4194 }],
  // distributed facilitators — render multiple nodes
  heurist: [
    { name: "San Francisco", lat: 37.7749, lon: -122.4194 },
    { name: "Berlin",        lat: 52.5200, lon:  13.4050 },
    { name: "Singapore",     lat:  1.3521, lon: 103.8198 },
    { name: "Tokyo",         lat: 35.6762, lon: 139.6503 },
  ],
};
// Anything not listed above defaults to SF (visual fallback).
const DEFAULT_NODE: City = { name: "Default", lat: 37.7749, lon: -122.4194 };

function nodesFor(facilitator: string): City[] {
  return FACILITATOR_NODES[facilitator] ?? [DEFAULT_NODE];
}

function randomOrigin(): [number, number] {
  // Random lat between -55 and 70 (skip empty polar bands),
  // random lon across the full strip.
  const lat = Math.random() * 125 - 55;
  const lon = Math.random() * 360 - 180;
  return [lat, lon];
}

type Arc = {
  id: string;
  d: string;          // svg path
  spawned: number;    // ms
};

const ARC_TTL_MS = 2_400;
const FEED_REFRESH_MS = 5_000;

export function LiveActivityMap() {
  const [arcs, setArcs] = useState<Arc[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  // Background grid: precompute once.
  const grid = useMemo(buildGrid, []);
  // Flatten facilitator nodes for the dots layer.
  const nodes = useMemo(flattenNodes, []);

  // Poll /feed and spawn arcs for new transactions.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let rows: FeedRow[];
      try { rows = await api.feed(50); }
      catch { return; }
      if (cancelled) return;

      // On the first load, mark everything seen without animating.
      if (firstLoadRef.current) {
        rows.forEach((r) => seenRef.current.add(r.tx_hash));
        firstLoadRef.current = false;
        return;
      }

      // Anything not yet seen → spawn an arc.
      const fresh = rows.filter((r) => !seenRef.current.has(r.tx_hash));
      if (!fresh.length) return;
      const now = Date.now();
      const next: Arc[] = [];
      for (const row of fresh.reverse()) {        // oldest first
        seenRef.current.add(row.tx_hash);
        const targets = nodesFor(row.facilitator);
        const target = targets[Math.floor(Math.random() * targets.length)];
        const [olat, olon] = randomOrigin();
        next.push({
          id: `${row.tx_hash}-${target.name}`,
          d:  arcPath(olat, olon, target.lat, target.lon),
          spawned: now,
        });
      }
      setArcs((prev) => [...prev, ...next]);
    };
    load();
    const id = setInterval(load, FEED_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Prune expired arcs every 500ms.
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - ARC_TTL_MS;
      setArcs((cur) => (cur.length && cur[0].spawned < cutoff
        ? cur.filter((a) => a.spawned >= cutoff)
        : cur));
    }, 500);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="card overflow-hidden p-5 shadow-card animate-fade-in-up">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Live Payment Network
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Each arc is one x402 payment landing at a facilitator
          </p>
        </div>
        <span className="flex items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-brand">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-brand" />
            <span className="relative inline-flex h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" />
          </span>
          Live
        </span>
      </div>

      <div className="relative w-full" style={{ aspectRatio: `${MAP_W} / ${MAP_H}`, maxHeight: 400 }}>
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          <defs>
            <radialGradient id="map-fade" cx="50%" cy="50%" r="70%">
              <stop offset="0%"   stopColor="rgba(0,255,136,0.04)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" />
            </filter>
          </defs>

          {/* ambient halo */}
          <rect width={MAP_W} height={MAP_H} fill="url(#map-fade)" />

          {/* lat/lon grid */}
          <g stroke="rgba(255,255,255,0.04)" strokeWidth={1}>
            {grid.lon.map((x) => (
              <line key={`v${x}`} x1={x} y1={0} x2={x} y2={MAP_H} />
            ))}
            {grid.lat.map((y) => (
              <line key={`h${y}`} x1={0} y1={y} x2={MAP_W} y2={y} />
            ))}
          </g>
          {/* grid-intersection nodes */}
          <g fill="rgba(255,255,255,0.08)">
            {grid.lon.map((x) =>
              grid.lat.map((y) => (
                <circle key={`d${x}-${y}`} cx={x} cy={y} r={0.8} />
              )),
            )}
          </g>

          {/* animated payment arcs */}
          <g fill="none" stroke="#00ff88" strokeWidth={1.4} strokeLinecap="round">
            {arcs.map((a) => (
              <ArcPath key={a.id} d={a.d} />
            ))}
          </g>

          {/* facilitator nodes (rendered last so they sit on top) */}
          <g>
            {nodes.map((n) => {
              const [x, y] = proj(n.lat, n.lon);
              return (
                <g key={`${n.facilitator}-${n.name}`}>
                  <circle cx={x} cy={y} r={8} fill="rgba(0,255,136,0.18)" filter="url(#dot-glow)" />
                  <circle cx={x} cy={y} r={3.5} fill="#00ff88">
                    <animate
                      attributeName="r"
                      values="3;4.5;3"
                      dur="2.6s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}

/* ----------------------------- helpers ----------------------------- */

function buildGrid() {
  const lon: number[] = [];
  for (let l = -180; l <= 180; l += 30) lon.push(proj(0, l)[0]);
  const lat: number[] = [];
  for (let l = -60; l <= 60; l += 20) lat.push(proj(l, 0)[1]);
  return { lat, lon };
}

function flattenNodes() {
  const out: { facilitator: string; name: string; lat: number; lon: number }[] = [];
  for (const [fac, cities] of Object.entries(FACILITATOR_NODES)) {
    for (const c of cities) out.push({ facilitator: fac, ...c });
  }
  return out;
}

/**
 * Quadratic-bezier arc from (lat1,lon1) to (lat2,lon2). The control point
 * is lifted above the midpoint so the path arcs visibly off the surface.
 */
function arcPath(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const [x1, y1] = proj(lat1, lon1);
  const [x2, y2] = proj(lat2, lon2);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const lift = Math.min(180, dist * 0.35);
  const cx = mx;
  const cy = my - lift;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/**
 * One arc: draws itself with stroke-dashoffset, then fades the opacity.
 * Uses inline style/animations so we don't need to add bespoke keyframes
 * to globals.css just for this component.
 */
function ArcPath({ d }: { d: string }) {
  const ref = useRef<SVGPathElement>(null);
  const [len, setLen] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    setLen(ref.current.getTotalLength());
  }, []);

  return (
    <path
      ref={ref}
      d={d}
      style={
        len === null
          ? { opacity: 0 }
          : {
              strokeDasharray: `${len}`,
              strokeDashoffset: `${len}`,
              animation: "x402arc 2.2s cubic-bezier(0.22,1,0.36,1) forwards",
            }
      }
      filter="url(#dot-glow)"
    />
  );
}
