"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, SearchMatch } from "@/lib/api";
import { shortAddress } from "@/lib/format";

const FULL_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
const DEBOUNCE_MS = 220;

/**
 * Header search box.
 *
 * Behaviour:
 *  - Types ≥3 hex chars → debounced live results in a dropdown below.
 *  - ↑/↓ moves the highlight, Enter opens the highlighted match (or the
 *    first one if none highlighted).
 *  - Pasting a full 0x… address: enter routes via /search to determine
 *    agent-vs-seller, falling back to /agent/<addr> if the API returns
 *    nothing (which can happen if it's an address we've never indexed).
 *  - Click anywhere outside collapses the dropdown.
 */
export function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);   // request generation counter for race-safety

  // Debounced fetch.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 3) {
      setMatches([]);
      setEmptyMessage(null);
      return;
    }
    const myReq = ++reqRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.search(needle);
        if (reqRef.current !== myReq) return;
        setMatches(res.matches);
        setEmptyMessage(res.matches.length ? null : "No x402 activity found for this address");
      } catch {
        if (reqRef.current === myReq) {
          setMatches([]);
          setEmptyMessage("Search failed — is the API reachable?");
        }
      } finally {
        if (reqRef.current === myReq) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Reset highlight when results change.
  useEffect(() => { setCursor(0); }, [matches]);

  // Click-outside collapse.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const navigateToMatch = (m: SearchMatch) => {
    const path = m.kind === "seller" ? `/seller/${m.address}` : `/agent/${m.address}`;
    setOpen(false);
    setQ("");
    setMatches([]);
    router.push(path);
  };

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (matches.length) {
      navigateToMatch(matches[Math.min(cursor, matches.length - 1)]);
      return;
    }
    // No matches but the user typed a full address: still let them navigate.
    const needle = q.trim();
    if (FULL_ADDRESS_RE.test(needle)) {
      setOpen(false);
      setQ("");
      router.push(`/agent/${needle.toLowerCase()}`);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => Math.min(c + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown = open && q.trim().length >= 3;

  return (
    <div ref={wrapRef} className="relative w-full">
      <form onSubmit={onSubmit} role="search">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search any wallet address..."
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Search wallet address"
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] py-3 pl-10 pr-11 font-mono text-sm text-white/90 placeholder-white/30 outline-none transition focus:border-brand/50 focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(0,255,136,0.12)]"
          />
          {loading && (
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] text-white/40">
              …
            </span>
          )}
        </div>
      </form>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-white/10 bg-bg/95 shadow-card backdrop-blur-md">
          {matches.length === 0 ? (
            <EmptyState
              message={emptyMessage ?? "Searching…"}
              fullAddr={FULL_ADDRESS_RE.test(q.trim()) ? q.trim().toLowerCase() : null}
            />
          ) : (
            <ul className="max-h-[320px] divide-y divide-white/5 overflow-y-auto">
              {matches.map((m, i) => (
                <li key={m.address}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => navigateToMatch(m)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition ${
                      i === cursor ? "bg-brand/10" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-white/90">
                        {shortAddress(m.address)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-white/40">
                        {m.kind === "seller" || m.kind === "both" ? (
                          <>
                            {m.seller_txns.toLocaleString()} received · $
                            {m.seller_volume.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}
                          </>
                        ) : (
                          <>
                            {m.agent_txns.toLocaleString()} sent · $
                            {m.agent_volume.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}
                          </>
                        )}
                      </div>
                    </div>
                    <KindBadge kind={m.kind} facilitator={m.facilitator} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function KindBadge({ kind, facilitator }: { kind: SearchMatch["kind"]; facilitator: string | null }) {
  if (kind === "seller" || kind === "both") {
    return (
      <span className="shrink-0 rounded-full border border-brand/30 bg-brand/10 px-2 py-[2px] text-[10px] font-medium uppercase tracking-wider text-brand">
        {facilitator ?? "Seller"}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-2 py-[2px] text-[10px] font-medium uppercase tracking-wider text-white/60">
      Agent
    </span>
  );
}

function EmptyState({ message, fullAddr }: { message: string; fullAddr: string | null }) {
  return (
    <div className="px-3 py-3 text-xs text-white/50">
      <p>{message}</p>
      {fullAddr && (
        <a
          href={`https://basescan.org/address/${fullAddr}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
        >
          Check on Basescan ↗
        </a>
      )}
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
