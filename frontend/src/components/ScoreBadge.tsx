"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type TrustScore } from "@/lib/api";

const PALETTE: Array<{ max: number; hex: string }> = [
  { max: 1,   hex: "#9ca3af" },
  { max: 300, hex: "#ff4d4d" },
  { max: 500, hex: "#ff9333" },
  { max: 650, hex: "#f0d030" },
  { max: 750, hex: "#00ff88" },
  { max: 851, hex: "#66ffb2" },
];
const colorFor = (s: number) => PALETTE.find((c) => s < c.max)?.hex ?? "#66ffb2";

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
  const color = colorFor(data.score);
  return (
    <Link
      href={`/score?address=${address}`}
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] transition hover:brightness-110"
      style={{
        borderColor: `${color}55`,
        backgroundColor: `${color}1a`,
        color,
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
