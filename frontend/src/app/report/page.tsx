"use client";

import Link from "next/link";
import { forwardRef, useEffect, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { FacilitatorBadge } from "@/components/Leaderboards";
import { api, type DailyReport } from "@/lib/api";
import {
  basescanTx,
  formatUsdc,
  shortAddress,
  timeAgo,
} from "@/lib/format";

const REFRESH_MS = 60_000;

export default function ReportPage() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgStatus, setImgStatus] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.dailyReport();
        if (!cancelled) { setReport(r); setError(null); }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const downloadImage = async () => {
    if (!cardRef.current) return;
    setImgStatus("Rendering…");
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#0a0a0a",
        scale: 2,
        logging: false,
        useCORS: true,
      });
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("blob failed"))),
          "image/png",
        ),
      );
      // Trigger a real download — works in every browser without needing
      // the (HTTPS-only, gesture-coupled) Clipboard API for image MIME types.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `x402pulse-daily-${date}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setImgStatus("Downloaded");
      setTimeout(() => setImgStatus(null), 2000);
    } catch (e) {
      setImgStatus(`Download failed (${(e as Error).message})`);
      setTimeout(() => setImgStatus(null), 3500);
    }
  };

  const tweetUrl = report ? buildTweetUrl(report) : "#";

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <Hero />

        {error && (
          <p className="text-xs text-red-400/80">report error: {error}</p>
        )}

        <ReportCard ref={cardRef} report={report} />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={downloadImage}
            disabled={!report}
            className="rounded-md border border-brand/30 bg-brand/10 px-4 py-2 text-xs font-medium uppercase tracking-wider text-brand transition hover:border-brand/50 disabled:opacity-40"
          >
            Download Image
          </button>
          <a
            href={tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!report}
            className={`rounded-md border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium uppercase tracking-wider text-white/80 transition hover:border-brand/30 hover:text-brand ${
              !report ? "pointer-events-none opacity-40" : ""
            }`}
          >
            Share on X
          </a>
          {imgStatus && (
            <span className="text-xs text-white/50">{imgStatus}</span>
          )}
        </div>

        <BackLink />
      </main>
    </>
  );
}

/* ------------------- shareable card ------------------- */

const ReportCard = forwardRef<HTMLDivElement, { report: DailyReport | null }>(
  function ReportCard({ report }, ref) {
    if (!report) {
      return (
        <div
          ref={ref}
          className="card mx-auto grid h-[640px] w-full max-w-[600px] place-items-center text-xs text-white/40 shadow-[0_0_60px_rgba(0,255,136,0.08)]"
        >
          Loading report…
        </div>
      );
    }
    const date = new Date(report.generated_at * 1000);
    const positive = report.volume_change_pct >= 0;
    const arrow = positive ? "↑" : "↓";
    const changeColor = positive ? "text-brand" : "text-red-400";

    return (
      <div
        ref={ref}
        className="mx-auto w-full max-w-[600px] rounded-2xl border border-brand/25 bg-bg p-6 shadow-[0_0_60px_rgba(0,255,136,0.10)]"
        style={{ backgroundImage: "radial-gradient(800px 400px at 50% -120px, rgba(0,255,136,0.10), transparent 60%)" }}
      >
        <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.18em] text-white/40">
          <span>x402 Daily Report</span>
          <span className="text-brand">x402pulse.app</span>
        </div>
        <p className="mt-1 text-xs text-white/40">
          {date.toLocaleString(undefined, {
            weekday: "short", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
        </p>

        <div className="mt-6 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
            24h Volume
          </p>
          <p className="mt-2 text-5xl font-semibold brand-gradient tabular">
            ${formatUsdc(report.total_volume_usdc)}
          </p>
          <p className={`mt-2 text-sm tabular ${changeColor}`}>
            {arrow} {Math.abs(report.volume_change_pct).toFixed(1)}%{" "}
            <span className="text-white/40">vs yesterday</span>
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric label="Transactions" value={report.total_transactions.toLocaleString()} />
          <Metric label="Agents"       value={report.unique_agents.toString()} />
          <Metric label="Sellers"      value={report.unique_sellers.toString()} />
          <Metric label="Avg Payment"  value={`$${formatUsdc(report.avg_payment_usdc)}`} />
          <Metric label="New Agents"   value={report.new_agents_count.toString()} />
          <Metric
            label="Busiest Hour"
            value={report.busiest_hour ? `${report.busiest_hour.tx_count.toLocaleString()} txns` : "—"}
          />
        </div>

        <div className="mt-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
            Top Performers
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            <Performer
              kind="Agent"
              addr={report.top_agent?.address}
              right={report.top_agent ? `$${formatUsdc(report.top_agent.volume)}` : "—"}
            />
            <Performer
              kind="Seller"
              addr={report.top_seller?.address}
              right={report.top_seller ? `$${formatUsdc(report.top_seller.volume)}` : "—"}
              facilitator={report.top_seller?.facilitator ?? undefined}
            />
            <li className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
              <span className="text-xs uppercase tracking-wider text-white/40">Facilitator</span>
              <span className="text-right text-sm">
                {report.top_facilitator ? (
                  <>
                    <FacilitatorBadge name={report.top_facilitator.name} />
                    <span className="ml-2 tabular text-brand">
                      {report.top_facilitator.market_share_pct}% share
                    </span>
                  </>
                ) : "—"}
              </span>
            </li>
          </ul>
        </div>

        {report.biggest_single_tx && (
          <div className="mt-6 rounded-xl border border-brand/30 bg-brand/[0.06] p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand/80">
              Biggest Single Transaction
            </p>
            <p className="mt-2 text-3xl font-semibold tabular text-brand">
              ${formatUsdc(report.biggest_single_tx.amount)}
            </p>
            <p className="mt-1 font-mono text-[11px] text-white/50">
              {shortAddress(report.biggest_single_tx.from)} →{" "}
              {shortAddress(report.biggest_single_tx.to)}
            </p>
            <a
              href={basescanTx(report.biggest_single_tx.tx_hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-brand"
            >
              <FacilitatorBadge name={report.biggest_single_tx.facilitator} />
              {timeAgo(report.biggest_single_tx.timestamp)} · view tx ↗
            </a>
          </div>
        )}

        <p className="mt-6 text-center text-[10px] uppercase tracking-[0.18em] text-white/30">
          Generated by x402pulse.app · {date.toISOString().slice(0, 19)}Z
        </p>
      </div>
    );
  },
);

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-center">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tabular text-white/90">{value}</p>
    </div>
  );
}

function Performer({
  kind,
  addr,
  right,
  facilitator,
}: {
  kind: string;
  addr?: string;
  right: string;
  facilitator?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="min-w-0">
        <span className="text-xs uppercase tracking-wider text-white/40">{kind}</span>
        <div className="mt-0.5 flex items-center gap-2">
          {addr ? (
            <Link
              href={kind === "Seller" ? `/seller/${addr}` : `/agent/${addr}`}
              className="font-mono text-xs text-white/85 hover:text-brand"
              title={addr}
            >
              {shortAddress(addr)}
            </Link>
          ) : (
            <span className="text-xs text-white/30">—</span>
          )}
          {facilitator && <FacilitatorBadge name={facilitator} />}
        </div>
      </div>
      <span className="tabular text-sm font-semibold text-brand">{right}</span>
    </li>
  );
}

function Hero() {
  return (
    <div className="animate-fade-in">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        x402 <span className="brand-gradient">Daily Report</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-white/60">
        Last 24 hours on the x402 network — shareable as an image or a tweet.
      </p>
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

function buildTweetUrl(r: DailyReport): string {
  const text = `x402 Daily Report
Volume: $${r.total_volume_usdc.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC
Transactions: ${r.total_transactions.toLocaleString()}
Active Agents: ${r.unique_agents}

Full report → x402pulse.app/report

@jessepollak @buildonbase #x402 #BaseChain`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
