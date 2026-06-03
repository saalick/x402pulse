"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type TrustScore } from "@/lib/api";

// Sentinel: top-tier scores resolve to the theme's brand var so
// they stay green in dark and Coinbase blue in light.
const BRAND_KEY = "BRAND";
const PALETTE: Array<{ max: number; key: string }> = [
  { max: 1,   key: "#9ca3af" },
  { max: 300, key: "#ff4d4d" },
  { max: 500, key: "#ff9333" },
  { max: 650, key: "#f0d030" },
  { max: 750, key: BRAND_KEY },
  { max: 851, key: BRAND_KEY },
];
const colorFor = (s: number) => PALETTE.find((c) => s < c.max)?.key ?? BRAND_KEY;
const cssColor = (key: string) => (key === BRAND_KEY ? "var(--brand-hex)" : key);
const cssColorAlpha = (key: string, a: number) =>
  key === BRAND_KEY
    ? `rgb(var(--brand-rgb) / ${a})`
    : `${key}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

/**
 * Small inline score chip used on the agent profile page header.
 * Clicking it opens the full /score page with the address pre-filled.
 */
export function ScoreBadge({ address }: { address: string }) {
  const [data, setData] = useState<TrustScore | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.trustScore(address);
        if (!cancelled) setData(s);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [address]);

  if (error) return null;
  if (!data) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/40">
        Trust Score …
      </span>
    );
  }
  const key = colorFor(data.score);
  return (
    <Link
      href={`/score?address=${address}`}
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] transition hover:brightness-110"
      style={{
        borderColor: cssColorAlpha(key, 0.33),
        backgroundColor: cssColorAlpha(key, 0.10),
        color: cssColor(key),
      }}
      title="Open full score page"
    >
      <span className="text-white/55">Trust Score</span>
      <span className="tabular font-semibold">{data.score}</span>
      <span className="text-white/40">·</span>
      <span>{data.label}</span>
    </Link>
  );
}
