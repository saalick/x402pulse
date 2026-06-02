"use client";

import { useEffect, useState } from "react";
import { CountUp } from "./CountUp";
import { api, Stats } from "@/lib/api";

const REFRESH_MS = 30_000;

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await api.stats();
        if (!cancelled) {
          setStats(s);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total Volume"
        sub="all time, USDC"
        value={stats?.total_volume_usdc ?? 0}
        prefix="$"
        decimals={2}
        compact
      />
      <StatCard
        label="Total Transactions"
        sub="all time"
        value={stats?.total_transactions ?? 0}
      />
      <StatCard
        label="Active Agents"
        sub="last 24h"
        value={stats?.active_agents_24h ?? 0}
      />
      <StatCard
        label="Active Sellers"
        sub="last 24h"
        value={stats?.active_sellers_24h ?? 0}
      />
      {error && (
        <p className="col-span-full text-xs text-red-400/80">
          stats error: {error}
        </p>
      )}
    </section>
  );
}

function StatCard({
  label,
  sub,
  value,
  prefix,
  decimals = 0,
  compact = false,
}: {
  label: string;
  sub: string;
  value: number;
  prefix?: string;
  decimals?: number;
  compact?: boolean;
}) {
  return (
    <div className="card group relative overflow-hidden p-5 shadow-card animate-fade-in-up">
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="absolute -inset-px rounded-2xl shadow-brand-glow" />
      </div>
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold leading-none brand-gradient">
        <CountUp
          value={value}
          prefix={prefix}
          decimals={decimals}
          compact={compact}
        />
      </p>
      <p className="mt-2 text-xs text-white/40">{sub}</p>
    </div>
  );
}
