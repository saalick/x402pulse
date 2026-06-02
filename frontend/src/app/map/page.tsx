import Link from "next/link";
import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { EcosystemGraph } from "@/components/EcosystemGraph";
import { API_BASE, type MapData } from "@/lib/api";

export const metadata: Metadata = {
  title: "x402 Ecosystem Map — x402pulse",
  description: "Live force-directed graph of x402 payment flows on Base.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchMap(): Promise<MapData | null> {
  try {
    const res = await fetch(`${API_BASE}/map/data`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function MapPage() {
  const initial = await fetchMap();
  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <Hero />
        <section className="card p-5 shadow-card animate-fade-in-up">
          <EcosystemGraph initialData={initial} />
        </section>
        <BackLink />
      </main>
    </>
  );
}

function Hero() {
  return (
    <div className="animate-fade-in">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        x402 <span className="brand-gradient">Ecosystem Map</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-white/60">
        Live payment flow visualization — agents pay facilitators, facilitators
        route to sellers. Drag, zoom, hover, click.
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
