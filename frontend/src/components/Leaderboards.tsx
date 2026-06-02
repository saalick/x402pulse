"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, AgentRow, SellerRow, TrustScore } from "@/lib/api";
import { basescanAddress, formatUsdc, shortAddress, timeAgo } from "@/lib/format";

const REFRESH_MS = 30_000;

// Calibrated to the score-label thresholds in api/main.py.
const SCORE_PALETTE: Array<{ max: number; hex: string }> = [
  { max: 1,   hex: "#9ca3af" },
  { max: 300, hex: "#ff4d4d" },
  { max: 500, hex: "#ff9333" },
  { max: 650, hex: "#f0d030" },
  { max: 750, hex: "#00ff88" },
  { max: 851, hex: "#66ffb2" },
];
const scoreColor = (s: number) =>
  SCORE_PALETTE.find((c) => s < c.max)?.hex ?? "#66ffb2";

export function Leaderboards() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [scoreMap, setScoreMap] = useState<Map<string, TrustScore>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Pull agent + seller boards in parallel with the score leaderboard.
        // The score-board covers every active agent in our DB (≤200), so
        // joining by address in the client gives us O(1) score lookups
        // without N+1 per-row /score calls.
        const [a, s, scores] = await Promise.all([
          api.agents(20),
          api.sellers(20),
          api.scoreLeaderboard(200).catch(() => [] as TrustScore[]),
        ]);
        if (!cancelled) {
          setAgents(a);
          setSellers(s);
          setScoreMap(new Map(scores.map((x) => [x.address, x])));
        }
      } catch {
        /* leave the previous state on transient errors */
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
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <BoardCard
        title="Top Agents"
        subtitle="Highest USDC spent on x402"
        rows={agents}
        amountLabel="Spent"
        addressKind="agent"
        scoreMap={scoreMap}
      />
      <BoardCard
        title="Top Sellers"
        subtitle="Most USDC received via facilitators"
        rows={sellers}
        amountLabel="Earned"
        showFacilitator
        addressKind="external"
      />
    </section>
  );
}

type BoardRow = AgentRow | SellerRow;

function BoardCard({
  title,
  subtitle,
  rows,
  amountLabel,
  showFacilitator = false,
  addressKind,
  scoreMap,
}: {
  title: string;
  subtitle: string;
  rows: BoardRow[];
  amountLabel: string;
  showFacilitator?: boolean;
  /** "agent" → internal /agent/[address] link, "external" → basescan */
  addressKind: "agent" | "external";
  /** When provided, render a Score column (Top Agents only). */
  scoreMap?: Map<string, TrustScore>;
}) {
  const showScore = !!scoreMap;
  return (
    <div className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            {title}
          </h2>
          <p className="mt-1 text-xs text-white/40">{subtitle}</p>
        </div>
        <span className="text-xs text-white/40">{rows.length} addresses</span>
      </div>

      {rows.length === 0 ? (
        <div className="grid h-40 place-items-center text-xs text-white/40">
          No data yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/[0.02] text-left text-[11px] uppercase tracking-wider text-white/40">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Address</th>
                {showScore && (
                  <th className="px-3 py-2 font-medium text-right">Score</th>
                )}
                <th className="px-3 py-2 font-medium text-right">Txns</th>
                <th className="px-3 py-2 font-medium text-right">{amountLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r, i) => (
                <tr
                  key={r.address}
                  className="transition-colors hover:bg-brand/5"
                >
                  <td className="px-3 py-2 text-xs text-white/40 tabular">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {addressKind === "agent" ? (
                        <Link
                          href={`/agent/${r.address}`}
                          className="font-mono text-xs text-white/85 hover:text-brand"
                        >
                          {shortAddress(r.address)}
                        </Link>
                      ) : (
                        <a
                          href={basescanAddress(r.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-white/85 hover:text-brand"
                        >
                          {shortAddress(r.address)}
                        </a>
                      )}
                      {showFacilitator && "facilitator" in r && (
                        <FacilitatorBadge name={(r as SellerRow).facilitator} />
                      )}
                    </div>
                    <div className="text-[10px] text-white/30">
                      last {timeAgo(r.last_seen)}
                    </div>
                  </td>
                  {showScore && (
                    <td className="px-3 py-2 text-right tabular">
                      {(() => {
                        const s = scoreMap?.get(r.address);
                        if (!s) return <span className="text-white/30">—</span>;
                        return (
                          <Link
                            href={`/score?address=${r.address}`}
                            className="font-semibold hover:underline"
                            style={{ color: scoreColor(s.score) }}
                            title={s.label}
                          >
                            {s.score}
                          </Link>
                        );
                      })()}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right text-xs tabular text-white/70">
                    {r.transactions.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-sm tabular text-brand">
                    ${formatUsdc(r.volume_usdc)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FacilitatorBadge({ name }: { name: string }) {
  return (
    <span className="rounded-full border border-brand/25 bg-brand/10 px-2 py-[2px] text-[10px] font-medium uppercase tracking-wider text-brand">
      {name}
    </span>
  );
}
