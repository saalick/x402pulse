"use client";

import { useEffect, useState } from "react";
import { api, FacilitatorStats } from "@/lib/api";
import { formatUsdc } from "@/lib/format";

const REFRESH_MS = 30_000;

export function FacilitatorBreakdown() {
  const [rows, setRows] = useState<FacilitatorStats[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api.facilitators();
        if (!cancelled) setRows(next);
      } catch { /* keep prior */ }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const maxShare = Math.max(0.0001, ...rows.map((r) => r.market_share_pct));

  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Facilitator Market Share
          </h2>
          <p className="mt-1 text-xs text-white/40">
            All-time USDC volume, with last-24h metrics and change vs prior 24h
          </p>
        </div>
        <span className="text-xs text-white/40 tabular">{rows.length} active</span>
      </div>

      {rows.length === 0 ? (
        <div className="grid h-40 place-items-center text-xs text-white/40">
          No facilitator data yet.
        </div>
      ) : (
        <>
          {/* Horizontal market-share bars */}
          <div className="mb-5 space-y-2">
            {rows.map((r) => (
              <ShareRow key={r.name} row={r} max={maxShare} />
            ))}
          </div>

          {/* Detailed table */}
          <div className="overflow-x-auto rounded-lg border border-white/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.02] text-left text-[11px] uppercase tracking-wider text-white/40">
                  <th className="px-3 py-2 font-medium">Facilitator</th>
                  <th className="px-3 py-2 font-medium text-right">Volume (24h)</th>
                  <th className="px-3 py-2 font-medium text-right">Txns</th>
                  <th className="px-3 py-2 font-medium text-right">Avg Payment</th>
                  <th className="px-3 py-2 font-medium text-right">Change</th>
                  <th className="px-3 py-2 font-medium text-right">Market Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((r) => (
                  <tr key={r.name} className="transition-colors hover:bg-brand/5">
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-brand/25 bg-brand/10 px-2 py-[2px] text-[10px] font-medium uppercase tracking-wider text-brand">
                        {r.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular text-white/85">
                      ${formatUsdc(r.volume_24h)}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-white/70">
                      {r.total_transactions.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-white/70">
                      ${formatUsdc(r.avg_payment_usdc)}
                    </td>
                    <td className="px-3 py-2 text-right tabular">
                      <Change pct={r.volume_change_pct} />
                    </td>
                    <td className="px-3 py-2 text-right tabular text-brand">
                      {r.market_share_pct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function ShareRow({ row, max }: { row: FacilitatorStats; max: number }) {
  const widthPct = Math.max(2, (row.market_share_pct / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 truncate text-xs uppercase tracking-wider text-white/60">
        {row.name}
      </span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700"
          style={{
            width: `${widthPct}%`,
            background: "linear-gradient(90deg, rgba(0,255,136,0.6), #00ff88)",
            boxShadow: "0 0 12px rgba(0,255,136,0.35)",
          }}
        />
      </div>
      <span className="w-16 text-right text-xs tabular text-brand">
        {row.market_share_pct.toFixed(2)}%
      </span>
    </div>
  );
}

function Change({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-white/40">–</span>;
  const positive = pct > 0;
  const cls = positive ? "text-brand" : "text-red-400";
  const arrow = positive ? "↑" : "↓";
  const display = Math.abs(pct) >= 1000
    ? `${(pct / 1000).toFixed(1)}k%`
    : `${pct.toFixed(1)}%`;
  return <span className={cls}>{arrow} {display}</span>;
}
