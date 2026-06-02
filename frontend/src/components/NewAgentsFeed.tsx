"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, NewAgent } from "@/lib/api";
import { formatUsdc, shortAddress, timeAgo } from "@/lib/format";
import { FacilitatorBadge } from "./Leaderboards";

const REFRESH_MS = 30_000;
const ONE_HOUR = 3_600;

export function NewAgentsFeed() {
  const [rows, setRows] = useState<NewAgent[]>([]);
  // Tick so timeAgo refreshes every second.
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api.newAgents();
        if (!cancelled) setRows(next);
      } catch { /* keep prior */ }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-4 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            New Agents Detected
          </h2>
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-[2px] text-[10px] font-semibold tabular text-brand">
            {rows.length}
          </span>
        </div>
        <span className="text-xs text-white/40">last 24h</span>
      </div>

      {rows.length === 0 ? (
        <div className="grid h-32 place-items-center text-xs text-white/40">
          No new agents in the last 24h.
        </div>
      ) : (
        <ul className="max-h-[300px] divide-y divide-white/5 overflow-y-auto rounded-lg border border-white/5">
          {rows.map((a) => {
            const ageSec = Math.max(0, Math.floor(Date.now() / 1000 - a.first_seen));
            const hot = ageSec < ONE_HOUR;
            return (
              <li
                key={a.address}
                className={`px-4 py-3 text-sm ${hot ? "bg-brand/[0.06]" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-1 text-white/80">
                  <Link
                    href={`/agent/${a.address}`}
                    className="font-mono text-xs text-white/90 hover:text-brand"
                    title={`${a.address} — open profile`}
                  >
                    {shortAddress(a.address)}
                  </Link>
                  <span className="text-white/50">made their first x402 payment</span>
                  <span className={hot ? "text-brand" : "text-white/60"}>
                    {timeAgo(a.first_seen)}
                  </span>
                  <span className="text-white/50">via</span>
                  <FacilitatorBadge name={a.first_facilitator} />
                  <span className="text-white/50">—</span>
                  <span className="font-semibold tabular text-brand">
                    ${formatUsdc(a.first_amount_usdc)} USDC
                  </span>
                </div>
                {a.tx_count_since > 1 && (
                  <p className="mt-1 text-[11px] text-white/40">
                    Has since spent{" "}
                    <span className="text-white/70 tabular">
                      ${formatUsdc(a.total_spent_since)}
                    </span>{" "}
                    across {a.tx_count_since.toLocaleString()} txns
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
