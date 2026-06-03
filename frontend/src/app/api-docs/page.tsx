import Link from "next/link";
import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { CopyButton } from "@/components/CopyButton";
import { EndpointsSection } from "@/components/EndpointsSection";

export const metadata: Metadata = {
  title: "x402pulse API — docs",
  description: "Free, open API for x402 payment data on Base. No key required.",
};

const PROD_BASE = "https://api.x402pulse.app";
const LOCAL_BASE = "http://localhost:8000";

export default function ApiDocsPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
        <DocsHero />
        <BaseUrls />
        <RateNotice />
        <EndpointsSection />
        <BackLink />
      </main>
    </>
  );
}

function DocsHero() {
  return (
    <div className="animate-fade-in">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        x402pulse <span className="brand-gradient">Public API</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-white/60">
        Free, open access to x402 payment data on Base mainnet. No API key
        required. All endpoints return JSON, with CORS open to every origin.
      </p>
    </div>
  );
}

function BaseUrls() {
  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
        Base URL
      </h2>
      <div className="mt-3 space-y-2 text-sm">
        <Row label="Production" value={PROD_BASE} />
        <Row label="Local dev"  value={LOCAL_BASE} />
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <span className="text-xs uppercase tracking-wider text-white/40">{label}</span>
      <div className="flex items-center gap-2">
        <code className="font-mono text-xs text-brand">{value}</code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

function RateNotice() {
  return (
    <div className="card flex flex-wrap items-center gap-3 p-4 shadow-card animate-fade-in-up">
      <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-brand">
        Free forever
      </span>
      <p className="text-sm text-white/60">
        Rate limited to <span className="text-white">60 requests/minute per IP</span>.
        No API key required.
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
