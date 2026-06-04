"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { timeAgo } from "@/lib/format";

/**
 * "First Seen" stat card that asks the API to look up the address's
 * actual earliest USDC transfer on Base mainnet (via Alchemy) — so the
 * value isn't bounded by how far back our own index reaches.
 *
 * Renders an indexed-window fallback while the on-chain lookup is in
 * flight, then swaps in the true date once it arrives.
 */
export function OnChainFirstSeen({
  address,
  indexedFirstSeen,
  bounded,
}: {
  address: string;
  indexedFirstSeen: number;
  bounded: boolean;
}) {
  const [actual, setActual] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/agent/${address}/first-seen`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d && typeof d.first_seen === "number") setActual(d.first_seen);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  // If we got an on-chain answer, use it. Otherwise fall through to the
  // indexed value (with a bounded note if relevant).
  const ts = actual ?? indexedFirstSeen;
  const isReal = actual !== null;
  const sub = loading
    ? "looking up on-chain…"
    : isReal
      ? `${absoluteDate(ts)} · on-chain`
      : bounded
        ? `pinned to indexed window · ${absoluteDate(ts)}`
        : absoluteDate(ts);

  return (
    <div className="card p-4 shadow-card animate-fade-in-up">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        First Seen
      </p>
      <p className="mt-2 text-xl font-semibold leading-none brand-gradient">
        {timeAgo(ts)}
      </p>
      <p className="mt-2 text-xs text-white/40">{sub}</p>
    </div>
  );
}

function absoluteDate(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
