"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, FeedRow } from "@/lib/api";
import {
  basescanTx,
  formatUsdc,
  shortAddress,
  timeAgo,
} from "@/lib/format";
import { FacilitatorBadge } from "./Leaderboards";

const REFRESH_MS = 5_000;

export function LiveFeed() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  // tick state forces timeAgo re-render every second
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api.feed(50);
        if (!cancelled) setRows(next);
      } catch {
        /* keep prior rows */
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Update relative timestamps once a second.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
            Live Feed
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Newest x402 payments — refreshes every {REFRESH_MS / 1000}s
          </p>
        </div>
        <span className="text-xs text-white/40 tabular">{rows.length} rows</span>
      </div>

      {rows.length === 0 ? (
        <div className="grid h-[420px] place-items-center text-xs text-white/40">
          Waiting for the next payment…
        </div>
      ) : (
        <ul className="h-[420px] divide-y divide-white/5 overflow-y-auto rounded-lg border border-white/5">
          {rows.map((row) => {
            const isNew = !seenRef.current.has(row.tx_hash);
            if (isNew) seenRef.current.add(row.tx_hash);
            return <FeedItem key={row.tx_hash} row={row} fresh={isNew} />;
          })}
        </ul>
      )}
    </section>
  );
}

function FeedItem({ row, fresh }: { row: FeedRow; fresh: boolean }) {
  return (
    <li
      className={`flex items-center justify-between gap-3 px-4 py-3 ${
        fresh ? "animate-row-in" : ""
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <FacilitatorBadge name={row.facilitator} />
        <div className="min-w-0">
          <div className="flex items-center gap-1 font-mono text-xs">
            <Link
              href={`/agent/${row.from_address}`}
              className="truncate text-white/80 hover:text-brand"
              title={`${row.from_address} — agent profile`}
            >
              {shortAddress(row.from_address)}
            </Link>
            {row.agent_tag && <AgentTagBadge tag={row.agent_tag} />}
            <span className="text-white/30">→</span>
            <Link
              href={`/seller/${row.to_address}`}
              className="truncate text-white/80 hover:text-brand"
              title={`${row.to_address} — seller profile`}
            >
              {shortAddress(row.to_address)}
            </Link>
          </div>
          <a
            href={basescanTx(row.tx_hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-white/30 hover:text-brand"
          >
            {timeAgo(row.timestamp)} · block {row.block_number.toLocaleString()} ↗
          </a>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular text-brand">
          ${formatUsdc(row.amount_usdc)}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-white/30">USDC</div>
      </div>
    </li>
  );
}

function AgentTagBadge({ tag }: { tag: string }) {
  const isHermes = tag.toLowerCase() === "hermes";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase leading-none border ${
        isHermes
          ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
          : "bg-brand/10 border-brand/20 text-brand"
      }`}
    >
      {isHermes ? "🪐 hermes" : `⚡ ${tag}`}
    </span>
  );
}
