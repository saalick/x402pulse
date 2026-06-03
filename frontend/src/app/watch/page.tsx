"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Header } from "@/components/Header";
import { CopyButton } from "@/components/CopyButton";
import { FacilitatorBadge } from "@/components/Leaderboards";
import { api, type WatchedAddress } from "@/lib/api";
import { formatUsdc, shortAddress, timeAgo } from "@/lib/format";

const MAX_WATCH = 5;
const REFRESH_MS = 30_000;
const ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

// Page wrapper — useSearchParams() must live inside a Suspense boundary
// for Next.js App Router (otherwise build fails on static prerender).
export default function WatchPage() {
  return (
    <Suspense fallback={null}>
      <WatchBody />
    </Suspense>
  );
}

function WatchBody() {
  const router = useRouter();
  const params = useSearchParams();

  // Source of truth is the URL — we read `?a=…&a=…` once per render.
  const watched = useMemo(() => dedupe(params.getAll("a")).slice(0, MAX_WATCH), [params]);

  const [data, setData] = useState<WatchedAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Re-render timeAgo each second.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1_000);
    return () => clearInterval(id);
  }, []);

  // Fetch /agents/batch whenever the watched list changes + every 30s.
  useEffect(() => {
    if (watched.length === 0) { setData([]); return; }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.batch(watched);
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [watched.join(",")]);

  const replaceWatched = useCallback(
    (next: string[]) => {
      const sp = new URLSearchParams();
      next.forEach((a) => sp.append("a", a));
      router.replace(`/watch${sp.toString() ? "?" + sp.toString() : ""}`);
    },
    [router],
  );

  const onAdd = () => {
    const candidate = input.trim().toLowerCase();
    if (!ADDRESS_RE.test(candidate)) {
      setInputError("Not a valid 0x… address");
      return;
    }
    if (watched.includes(candidate)) {
      setInputError("Already watching this address");
      return;
    }
    if (watched.length >= MAX_WATCH) {
      setInputError(`Watchlist full (${MAX_WATCH} max). Remove one first.`);
      return;
    }
    setInputError(null);
    setInput("");
    replaceWatched([...watched, candidate]);
  };

  const onRemove = (addr: string) => {
    replaceWatched(watched.filter((a) => a !== addr));
  };

  const shareUrl =
    typeof window === "undefined" ? "" : window.location.href;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <Hero />

        <section className="card space-y-3 p-5 shadow-card animate-fade-in-up">
          <div className="flex flex-wrap items-stretch gap-2">
            <div className="flex flex-1 items-stretch overflow-hidden rounded-md border border-white/10 bg-white/[0.03] focus-within:border-brand/50 focus-within:shadow-[0_0_0_3px_rgba(0,255,136,0.12)]">
              <input
                type="text"
                value={input}
                onChange={(e) => { setInput(e.target.value); setInputError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
                placeholder="Add wallet address (0x...)"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-transparent px-3 py-2 font-mono text-sm text-white/90 placeholder-white/30 outline-none"
              />
              <button
                type="button"
                onClick={onAdd}
                className="shrink-0 border-l border-white/10 bg-brand/10 px-4 text-xs font-medium uppercase tracking-wider text-brand transition hover:bg-brand/15"
              >
                Add
              </button>
            </div>
            <CopyButton text={shareUrl} label="Share Watchlist" copiedLabel="Copied" />
          </div>
          <p className="text-[11px] text-white/40">
            Watching {watched.length} / {MAX_WATCH}. Addresses live only in this URL —
            bookmark it to save.
          </p>
          {inputError && <p className="text-xs text-red-400/80">{inputError}</p>}
          {error && <p className="text-xs text-red-400/80">batch error: {error}</p>}
        </section>

        {watched.length === 0 ? (
          <EmptyState />
        ) : (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {watched.map((addr) => {
              const row = data.find((d) => d.address === addr);
              return (
                <WatchCard
                  key={addr}
                  addr={addr}
                  row={row}
                  loading={loading && !row}
                  onRemove={() => onRemove(addr)}
                />
              );
            })}
          </section>
        )}

        <BackLink />
      </main>
    </>
  );
}

/* ---------------- pieces ---------------- */

function Hero() {
  return (
    <div className="animate-fade-in">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Wallet <span className="brand-gradient">Watchlist</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-white/60">
        Track up to {MAX_WATCH} wallets. Bookmark the URL to save your list.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card grid place-items-center px-6 py-12 text-center shadow-card animate-fade-in-up">
      <p className="text-sm text-white/60">No addresses yet.</p>
      <p className="mt-1 text-xs text-white/40">
        Paste any 0x… address above and press Add.
      </p>
    </div>
  );
}

function WatchCard({
  addr,
  row,
  loading,
  onRemove,
}: {
  addr: string;
  row?: WatchedAddress;
  loading: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="card space-y-3 p-4 shadow-card animate-fade-in-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/agent/${addr}`}
              className="font-mono text-sm text-white/90 hover:text-brand"
              title={addr}
            >
              {shortAddress(addr)}
            </Link>
            {row?.facilitator && <FacilitatorBadge name={row.facilitator} />}
            {row && <KindPill kind={row.kind} />}
          </div>
          <p className="mt-1 text-[10px] text-white/40">
            {row?.last_active
              ? `Last active ${timeAgo(row.last_active)}`
              : loading
                ? "Loading…"
                : "No activity in our index"}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove from watchlist"
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white/50 transition hover:border-red-400/30 hover:text-red-400"
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Mini label="Spent (sent)" value={row ? `$${formatUsdc(row.total_sent_usdc)}` : "—"} />
        <Mini label="Earned (received)" value={row ? `$${formatUsdc(row.total_received_usdc)}` : "—"} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <Last6Dots last6={row?.last_6 ?? []} />
        <div className="h-8 w-24 shrink-0">
          {row && row.sparkline_24h.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={row.sparkline_24h}>
                <Line
                  type="monotone"
                  dataKey="volume"
                  stroke="#00ff88"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-brand tabular">{value}</p>
    </div>
  );
}

function KindPill({ kind }: { kind: WatchedAddress["kind"] }) {
  if (kind === "agent") return <Pill label="agent" />;
  if (kind === "seller") return <Pill label="seller" tone="seller" />;
  if (kind === "both") return <Pill label="both" tone="seller" />;
  return <Pill label="unseen" tone="muted" />;
}

function Pill({ label, tone = "agent" }: { label: string; tone?: "agent" | "seller" | "muted" }) {
  const tones: Record<string, string> = {
    agent:  "border-white/15 bg-white/[0.04] text-white/70",
    seller: "border-brand/30 bg-brand/10 text-brand",
    muted:  "border-white/10 bg-white/[0.02] text-white/40",
  };
  return (
    <span className={`rounded-full border px-2 py-[2px] text-[10px] font-medium uppercase tracking-wider ${tones[tone]}`}>
      {label}
    </span>
  );
}

function Last6Dots({ last6 }: { last6: WatchedAddress["last_6"] }) {
  // Always render 6 slots so the row height never jumps.
  const slots = Array.from({ length: 6 });
  return (
    <div className="flex items-center gap-1.5" title="Last 6 transactions">
      {slots.map((_, i) => {
        const tx = last6[i];
        if (!tx) {
          return (
            <span
              key={i}
              className="h-2 w-2 rounded-full bg-white/10"
              aria-hidden
            />
          );
        }
        const color = tx.direction === "sent" ? "bg-brand" : "bg-sky-400";
        return (
          <span
            key={tx.tx_hash}
            className={`h-2 w-2 rounded-full ${color}`}
            title={`${tx.direction} $${tx.amount_usdc.toFixed(4)} • ${timeAgo(tx.timestamp)}`}
          />
        );
      })}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-brand"
    >
      ← Back to dashboard
    </Link>
  );
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of arr) {
    const lower = a.toLowerCase();
    if (ADDRESS_RE.test(lower) && !seen.has(lower)) {
      seen.add(lower);
      out.push(lower);
    }
  }
  return out;
}
