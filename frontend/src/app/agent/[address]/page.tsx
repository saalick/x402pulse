import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { AgentHourlyChart } from "@/components/AgentHourlyChart";
import { AgentFingerprint } from "@/components/AgentFingerprint";
import { CopyAddressButton } from "@/components/CopyAddressButton";
import { FacilitatorBadge } from "@/components/Leaderboards";
import { OnChainFirstSeen } from "@/components/OnChainFirstSeen";
import { ScoreBadge } from "@/components/ScoreBadge";
import { API_BASE, type AgentProfile } from "@/lib/api";
import {
  basescanAddress,
  basescanTx,
  formatUsdc,
  shortAddress,
  timeAgo,
} from "@/lib/format";

// Always fetch fresh — agent stats change as the indexer ingests new blocks.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

async function fetchAgent(address: string): Promise<AgentProfile | null> {
  const res = await fetch(`${API_BASE}/agent/${address}`, { cache: "no-store" });
  // Treat both "bad address" (400) and "not in DB" (404) as a friendly
  // not-found rather than a runtime error — a stray/truncated URL should
  // render the empty-state page, not crash the route.
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`agent fetch failed: HTTP ${res.status}`);
  return res.json();
}

export default async function AgentPage({
  params,
}: {
  params: { address: string };
}) {
  const address = params.address.toLowerCase();
  if (!ADDRESS_RE.test(address)) notFound();
  const profile = await fetchAgent(address);
  if (!profile) notFound();

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <BackLink />
        <ProfileHero profile={profile} />
        <StatGrid profile={profile} />

        <section className="card p-5 shadow-card animate-fade-in-up">
          <SectionHead title="Spending — last 24h" sub="Hourly USDC volume" />
          <AgentHourlyChart data={profile.hourly_24h} />
          {profile.max_txns_in_any_hour > 0 && (
            <p className="mt-3 text-xs text-white/40">
              Peak burst:{" "}
              <span className="text-white/80 tabular">
                {profile.max_txns_in_any_hour}
              </span>{" "}
              txns in a single hour
            </p>
          )}
        </section>

        <AgentFingerprint address={profile.address} />

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="card p-5 shadow-card animate-fade-in-up lg:col-span-2">
            <SectionHead
              title="Facilitators used"
              sub={`${profile.facilitators.length} routes paid through`}
            />
            <ul className="space-y-2">
              {profile.facilitators.map((f) => (
                <li
                  key={f.name}
                  className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                >
                  <FacilitatorBadge name={f.name} />
                  <div className="text-right text-xs">
                    <div className="font-medium tabular text-brand">
                      ${formatUsdc(f.volume_usdc)}
                    </div>
                    <div className="text-white/40">
                      {f.transactions.toLocaleString()} txns
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-5 shadow-card animate-fade-in-up lg:col-span-3">
            <SectionHead
              title="Recent transactions"
              sub={`Last ${profile.recent_transactions.length}`}
            />
            <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/5">
              {profile.recent_transactions.map((tx) => (
                <li
                  key={tx.tx_hash}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 font-mono text-xs">
                      <span className="text-white/30">→</span>
                      <Link
                        href={`/seller/${tx.to_address}`}
                        className="truncate text-white/80 hover:text-brand"
                        title={`${tx.to_address} — seller profile`}
                      >
                        {shortAddress(tx.to_address)}
                      </Link>
                      <FacilitatorBadge name={tx.facilitator} />
                    </div>
                    <a
                      href={basescanTx(tx.tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-white/30 hover:text-brand"
                    >
                      {timeAgo(tx.timestamp)} · block{" "}
                      {tx.block_number.toLocaleString()} ↗
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

function ProfileHero({ profile }: { profile: AgentProfile }) {
  return (
    <div className="card flex flex-wrap items-start justify-between gap-4 p-5 shadow-card animate-fade-in-up">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
            Agent profile
          </p>
          {profile.is_new && <NewBadge />}
          <ScoreBadge address={profile.address} />
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BehaviorTag tag={profile.behavior_tag} />
          {profile.favorite_facilitator && (
            <span className="text-xs text-white/40">
              favorite route{" "}
              <FacilitatorBadge name={profile.favorite_facilitator} />
            </span>
          )}
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

function NewBadge() {
  return (
    <span className="rounded-full border border-brand/40 bg-brand/15 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
      New
    </span>
  );
}

const TAG_STYLES: Record<string, string> = {
  "Power user":   "border-brand/40 bg-brand/15 text-brand",
  "Batch buyer":  "border-warn/40 bg-warn-bg text-warn",
  "Micro-payer":  "border-sky-400/40 bg-sky-400/10 text-sky-300",
  "Regular":      "border-white/15 bg-white/[0.04] text-white/60",
};

function BehaviorTag({ tag }: { tag: string }) {
  const cls = TAG_STYLES[tag] ?? TAG_STYLES["Regular"];
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${cls}`}>
      {tag}
    </span>
  );
}

function StatGrid({ profile }: { profile: AgentProfile }) {
  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat
        label="Total Spent"
        value={`$${formatUsdc(profile.total_spent_usdc)}`}
        sub="USDC, last 30 days"
      />
      <Stat
        label="Transactions"
        value={profile.total_transactions.toLocaleString()}
        sub="last 30 days"
      />
      <OnChainFirstSeen
        address={profile.address}
        indexedFirstSeen={profile.first_seen}
        bounded={profile.first_seen_bounded}
      />
      <Stat
        label="Avg Payment"
        value={`$${formatUsdc(profile.avg_payment_usdc)}`}
        sub={`last seen ${timeAgo(profile.last_seen)}`}
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

