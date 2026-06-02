import Link from "next/link";
import { Header } from "@/components/Header";

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="mx-auto grid max-w-2xl place-items-center px-6 py-24 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
          404 · seller
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          No x402 activity found for this address.
        </h1>
        <p className="mt-3 max-w-md text-sm text-white/50">
          This address hasn’t received any payments via an x402 facilitator on
          Base mainnet, or the indexer hasn’t reached it yet.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-full border border-brand/30 bg-brand/10 px-4 py-2 text-sm text-brand transition hover:border-brand/50"
        >
          ← Back to dashboard
        </Link>
      </main>
    </>
  );
}
