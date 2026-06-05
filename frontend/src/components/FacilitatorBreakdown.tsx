"use client";

import { useEffect, useMemo, useState } from "react";
import { api, FacilitatorStats } from "@/lib/api";
import { formatUsdc } from "@/lib/format";
import { facilitatorLogoUrl } from "@/lib/facilitator-logos";

const REFRESH_MS = 30_000;

type SortKey = "volume" | "txns" | "avg" | "share";
type SortDir = "asc" | "desc";

const SORT_GETTERS: Record<SortKey, (r: FacilitatorStats) => number> = {
  volume: (r) => r.volume_24h,
  txns:   (r) => r.total_transactions,
  avg:    (r) => r.avg_payment_usdc,
  share:  (r) => r.market_share_pct,
};

export function FacilitatorBreakdown() {
  const [rows, setRows] = useState<FacilitatorStats[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

  // Table rows respect the user's sort; the share bars at the top stay
  // ordered by market share regardless so the visual size comparison
  // remains intuitive (biggest bar always on top).
  const sortedRows = useMemo(() => {
    const getter = SORT_GETTERS[sortKey];
    const dir = sortDir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => (getter(a) - getter(b)) * dir);
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Facilitator Market Share
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Click a column header to sort
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
          {/* Horizontal market-share bars (always sorted by market share) */}
          <div className="mb-5 space-y-2">
            {rows.map((r) => (
              <ShareRow key={r.name} row={r} max={maxShare} />
            ))}
          </div>

          {/* Detailed sortable table */}
          <div className="overflow-x-auto rounded-lg border border-white/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.02] text-left text-[11px] uppercase tracking-wider text-white/40">
                  <th className="px-3 py-2 font-medium">Facilitator</th>
                  <SortHeader
                    label="Volume (24h)"
                    active={sortKey === "volume"}
                    dir={sortDir}
                    onClick={() => toggleSort("volume")}
                  />
                  <SortHeader
                    label="Txns"
                    active={sortKey === "txns"}
                    dir={sortDir}
                    onClick={() => toggleSort("txns")}
                  />
                  <SortHeader
                    label="Avg Payment"
                    active={sortKey === "avg"}
                    dir={sortDir}
                    onClick={() => toggleSort("avg")}
                  />
                  <SortHeader
                    label="Market Share"
                    active={sortKey === "share"}
                    dir={sortDir}
                    onClick={() => toggleSort("share")}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sortedRows.map((r) => (
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

function SortHeader({
  label, active, dir, onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2 text-right font-medium">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors hover:text-brand ${
          active ? "text-brand" : "text-white/40"
        }`}
      >
        {label}
        <span className="inline-block w-2 text-[10px] leading-none">
          {active ? (dir === "desc" ? "↓" : "↑") : ""}
        </span>
      </button>
    </th>
  );
}

function ShareRow({ row, max }: { row: FacilitatorStats; max: number }) {
  const widthPct = Math.max(2, (row.market_share_pct / max) * 100);
  const logoUrl = facilitatorLogoUrl(row.name);
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-28 items-center gap-1.5 truncate text-xs uppercase tracking-wider text-white/60">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            width={14}
            height={14}
            className="h-3.5 w-3.5 shrink-0 rounded-sm bg-white/80 object-contain"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <span className="truncate">{row.name}</span>
      </span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700"
          style={{
            width: `${widthPct}%`,
            background: "linear-gradient(90deg, rgb(var(--brand-rgb) / 0.6), rgb(var(--brand-rgb)))",
            boxShadow: "0 0 12px rgb(var(--brand-rgb) / 0.35)",
          }}
        />
      </div>
      <span className="w-16 text-right text-xs tabular text-brand">
        {row.market_share_pct.toFixed(2)}%
      </span>
    </div>
  );
}
