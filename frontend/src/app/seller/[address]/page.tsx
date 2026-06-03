import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { AgentHourlyChart } from "@/components/AgentHourlyChart";
import { CopyAddressButton } from "@/components/CopyAddressButton";
import { FacilitatorBadge } from "@/components/Leaderboards";
import { API_BASE, type SellerProfile } from "@/lib/api";
import {
  basescanAddress,
  basescanTx,
  formatUsdc,
  shortAddress,
  timeAgo,
  timeAgoBounded,
} from "@/lib/format";

// Same posture as the agent page — totals shift block-by-block.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

async function fetchSeller(address: string): Promise<SellerProfile | null> {
  const res = await fetch(`${API_BASE}/seller/${address}`, { cache: "no-store" });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`seller fetch failed: HTTP ${res.status}`);
  return res.json();
}

export default async function SellerPage({
  params,
}: {
  params: { address: string };
}) {
  const address = params.address.toLowerCase();
  if (!ADDRESS_RE.test(address)) notFound();
  const profile = await fetchSeller(address);
  if (!profile) notFound();

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <BackLink />
        <ProfileHero profile={profile} />
        <StatGrid profile={profile} />

        <section className="card p-5 shadow-card animate-fade-in-up">
          <SectionHead title="Incoming Volume — last 24h" sub="Hourly USDC received" />
          <AgentHourlyChart data={profile.hourly_24h} />
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="card p-5 shadow-card animate-fade-in-up lg:col-span-2">
            <SectionHead title="Top Payers" sub={`Highest USDC paid into this address`} />
            {profile.top_payers.length === 0 ? (
              <p className="text-xs text-white/40">No payers yet.</p>
            ) : (
              <ul className="space-y-2">
                {profile.top_payers.map((p, i) => (
                  <li
                    key={p.address}
                    className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-4 text-xs text-white/40 tabular">{i + 1}</span>
                      <Link
                        href={`/agent/${p.address}`}
                        className="truncate font-mono text-xs text-white/85 hover:text-brand"
                        title={p.address}
                      >
                        {shortAddress(p.address)}
                      </Link>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-medium tabular text-brand">
                        ${formatUsdc(p.volume_usdc)}
                      </div>
                      <div className="text-white/40">
                        {p.transactions.toLocaleString()} txns
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5 shadow-card animate-fade-in-up lg:col-span-3">
            <SectionHead
              title="Recent Transactions"
              sub={`Last ${profile.recent_transactions.length} received`}
            />
            <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/5">
              {profile.recent_transactions.map((tx) => (
                <li
                  key={tx.tx_hash}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 font-mono text-xs">
                      <Link
                        href={`/agent/${tx.from_address}`}
                        className="truncate text-white/80 hover:text-brand"
                        title={tx.from_address}
                      >
                        {shortAddress(tx.from_address)}
                      </Link>
                      <span className="text-white/30">→</span>
                      <FacilitatorBadge name={tx.facilitator} />
                    </div>
                    <a
                      href={basescanTx(tx.tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-white/30 hover:text-brand"
                    >
                      {timeAgo(tx.timestamp)} · block {tx.block_number.toLocaleString()} ↗
                    </a>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular text-brand">
                      ${formatUsdc(tx.amount_usdc)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-white/30">
                      USDC
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}

/* ---------------------------- pieces ---------------------------- */

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

function ProfileHero({ profile }: { profile: SellerProfile }) {
  return (
    <div className="card flex flex-wrap items-start justify-between gap-4 p-5 shadow-card animate-fade-in-up">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
            Seller profile
          </p>
          {profile.facilitator && <FacilitatorBadge name={profile.facilitator} />}
        </div>
        <h1 className="mt-1 break-all font-mono text-xl text-white">
          {profile.address}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CopyAddressButton address={profile.address} />
          <span className="font-mono text-xs text-white/40">
            {shortAddress(profile.address)}
          </span>
        </div>
      </div>
      <a
        href={basescanAddress(profile.address)}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:border-brand/40 hover:text-brand"
      >
        View on Basescan ↗
      </a>
    </div>
  );
}

function StatGrid({ profile }: { profile: SellerProfile }) {
  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat
        label="Total Earned"
        value={`$${formatUsdc(profile.total_earned_usdc)}`}
        sub="USDC, all time"
      />
      <Stat
        label="Transactions"
        value={profile.total_transactions.toLocaleString()}
        sub={`avg $${formatUsdc(profile.avg_payment_usdc)}`}
      />
      <Stat
        label="First Seen"
        value={timeAgoBounded(profile.first_seen, profile.first_seen_bounded)}
        sub={
          profile.first_seen_bounded
            ? `pinned to indexed window · ${absoluteDate(profile.first_seen)}`
            : absoluteDate(profile.first_seen)
        }
      />
      <Stat
        label="Last Seen"
        value={timeAgo(profile.last_seen)}
        sub={absoluteDate(profile.last_seen)}
      />
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4 shadow-card animate-fade-in-up">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold leading-none brand-gradient">
        {value}
      </p>
      <p className="mt-2 text-xs text-white/40">{sub}</p>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">
        {title}
      </h2>
      <p className="mt-1 text-xs text-white/40">{sub}</p>
    </div>
  );
}

function absoluteDate(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
