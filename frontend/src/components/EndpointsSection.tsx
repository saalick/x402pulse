"use client";

import { useMemo, useState } from "react";
import { CopyButton } from "./CopyButton";

const PROD_BASE = "https://api.x402pulse.xyz";

type Param = { name: string; type: string; default?: string; description: string };

export type Endpoint = {
  method: "GET";
  path: string;
  title: string;
  description: string;
  params?: Param[];
  example: unknown;
};

// Filterable endpoints catalog — kept inside this client component so the
// search input can reactively narrow the list with zero round-trips.
const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/stats",
    title: "Headline KPIs",
    description: "All-time totals plus last-24h activity used by the dashboard stats bar.",
    example: {
      total_volume_usdc: 22352.55,
      total_transactions: 4131,
      volume_24h_usdc: 18482.36,
      transactions_24h: 4010,
      active_agents_24h: 17,
      active_sellers_24h: 3,
    },
  },
  {
    method: "GET",
    path: "/volume",
    title: "Bucketed volume series",
    description: "Time-bucketed USDC volume for the chart. 1h → 1-min buckets, 24h/7d → 1-hour buckets.",
    params: [
      { name: "period", type: "1h | 24h | 7d", default: "24h", description: "Lookback window" },
    ],
    example: [
      { timestamp: 1780153200, volume: 387.35, txns: 13 },
      { timestamp: 1780156800, volume: 636.86, txns: 23 },
    ],
  },
  {
    method: "GET",
    path: "/agents/leaderboard",
    title: "Top paying agents",
    description: "Addresses ranked by total USDC sent to x402 facilitators.",
    params: [{ name: "limit", type: "int", default: "20", description: "1 ≤ limit ≤ 200" }],
    example: [
      {
        address: "0x13db4caf175f23f1429c2df6b333350c24705192",
        transactions: 117,
        volume_usdc: 5375.45,
        last_seen: 1780346479,
      },
    ],
  },
  {
    method: "GET",
    path: "/sellers/leaderboard",
    title: "Top receiving facilitator addresses",
    description: "Facilitator deposit addresses ranked by USDC received. Includes facilitator label.",
    params: [{ name: "limit", type: "int", default: "20", description: "1 ≤ limit ≤ 200" }],
    example: [
      {
        address: "0x8e7769d440b3460b92159dd9c6d17302b036e2d6",
        facilitator: "meridian",
        transactions: 657,
        volume_usdc: 30905.04,
        last_seen: 1780348143,
      },
    ],
  },
  {
    method: "GET",
    path: "/feed",
    title: "Latest x402 payments",
    description: "Newest-first stream of indexed transfers. Used to power the dashboard live feed.",
    params: [{ name: "limit", type: "int", default: "50", description: "1 ≤ limit ≤ 500" }],
    example: [
      {
        tx_hash: "0x32d0305c0464e13b14b5a32f98cbf91401f5a2a3461491a6c437420f91fbd9a6",
        block_number: 46686778,
        timestamp: 1780162903,
        from_address: "0xb6dbe48513f9ed41b2de29ee89112a52940931e1",
        to_address: "0x8e7769d440b3460b92159dd9c6d17302b036e2d6",
        amount_usdc: 40.0,
        facilitator: "meridian",
      },
    ],
  },
  {
    method: "GET",
    path: "/alerts",
    title: "Spike detection",
    description: "Agents whose last-hour spend exceeds 3× their prior 23-hour hourly average (with a $1 floor + ≥3 prior txns).",
    example: [
      {
        address: "0xb6dbe48513f9ed41b2de29ee89112a52940931e1",
        last_hour_volume_usdc: 238.57,
        last_hour_transactions: 7,
        prior_hourly_avg_usdc: 10.18,
        multiplier: 23.44,
      },
    ],
  },
  {
    method: "GET",
    path: "/health-score",
    title: "Economy Health Score",
    description: "Composite 0–100 score (velocity 30%, agents 25%, volume 25%, diversity 20%) with a delta vs. 24h ago.",
    example: {
      score: 78.5,
      label: "Good",
      change_24h: 1.1,
      components: {
        velocity:  { score: 55, txns_1h: 18, txns_prev_1h: 26 },
        agents:    { score: 100, agents_24h: 17, daily_avg_7d: 5.7 },
        volume:    { score: 100, volume_24h: 18482.36, volume_prev_24h: 3793.67 },
        diversity: { score: 60, active_facilitators_24h: 3 },
      },
      weights: { velocity: 0.3, agents: 0.25, volume: 0.25, diversity: 0.2 },
      as_of: 1780375048,
    },
  },
  {
    method: "GET",
    path: "/agent/{address}",
    title: "Full agent profile",
    description:
      "All-time totals, 24-bucket hourly activity, facilitators used, last 10 txns, and a single behavior tag (Power user | Batch buyer | Micro-payer | Regular).",
    params: [{ name: "address", type: "0x… (40 hex)", description: "Lowercase EVM address; 400 on bad format, 404 if never seen." }],
    example: {
      address: "0xb6dbe48513f9ed41b2de29ee89112a52940931e1",
      total_spent_usdc: 3691.45,
      total_transactions: 24,
      avg_payment_usdc: 153.81,
      first_seen: 1780324950,
      last_seen: 1780346479,
      favorite_facilitator: "meridian",
      behavior_tag: "Power user",
      is_new: true,
    },
  },
  {
    method: "GET",
    path: "/seller/{address}",
    title: "Full seller profile",
    description:
      "Totals, top payers, 24h hourly chart, recent received payments, and the facilitator label for an x402 recipient address.",
    params: [{ name: "address", type: "0x… (40 hex)", description: "Lowercase EVM address; 400 on bad format, 404 if never seen." }],
    example: {
      address: "0x8e7769d440b3460b92159dd9c6d17302b036e2d6",
      facilitator: "meridian",
      total_earned_usdc: 17840.10,
      total_transactions: 364,
      avg_payment_usdc: 49.01,
      top_payers: [
        { address: "0xb6dbe48513…", transactions: 24, volume_usdc: 3691.45, last_seen: 1780346479 },
      ],
    },
  },
  {
    method: "GET",
    path: "/search",
    title: "Address search",
    description: "Partial or full address lookup. Returns matching addresses, classified as agent / seller / both, with txn counts.",
    params: [{ name: "q", type: "hex string ≥3 chars", description: "Optional 0x prefix; case-insensitive" }],
    example: {
      query: "8e7769",
      matches: [
        {
          address: "0x8e7769d440b3460b92159dd9c6d17302b036e2d6",
          kind: "seller",
          agent_txns: 0,
          seller_txns: 364,
          seller_volume: 17840.10,
          facilitator: "meridian",
          last_seen: 1780382283,
        },
      ],
    },
  },
  {
    method: "GET",
    path: "/facilitators/stats",
    title: "Facilitator breakdown",
    description: "Per-facilitator all-time totals, last-24h volume, % change vs prior 24h, market share, and 24h active agents.",
    example: [
      {
        name: "meridian",
        total_volume_usdc: 17053.06,
        total_transactions: 342,
        avg_payment_usdc: 49.86,
        volume_24h: 13414.14,
        volume_change_pct: 268.6,
        market_share_pct: 76.29,
        active_agents_24h: 6,
      },
    ],
  },
  {
    method: "GET",
    path: "/score/{address}",
    title: "Agent Trust Score",
    description:
      "FICO-style 0–850 trust score for an agent. Five weighted dimensions (Payment History 35%, Wallet Age 15%, Volume 20%, Consistency 15%, Diversity 15%), with label, letter grade, and percentile rank vs all indexed agents. Returns score = 0 with label 'No x402 Activity' for unseen addresses.",
    params: [
      { name: "address", type: "0x… (40 hex)", description: "Lowercase EVM address; 400 on bad format." },
    ],
    example: {
      address: "0x13db4caf175f23f1429c2df6b333350c24705192",
      score: 574,
      label: "Established",
      grade: "B",
      percentile: 50,
      dimensions: {
        payment_history: { score: 147, max: 147, detail: "20+ payments recorded" },
        wallet_age:      { score: 127, max: 127, detail: "first seen 30+ days ago" },
        volume:          { score: 130, max: 170, detail: "$100+ total spent" },
        consistency:     { score: 127, max: 127, detail: "active on 10+ different days" },
        diversity:       { score: 40,  max: 127, detail: "used 1 facilitator" },
      },
      stats: {
        total_transactions: 1725, total_volume_usdc: 5375.45,
        first_seen: 1780156313, last_seen: 1780346479,
        days_active: 29, facilitators_used: ["meridian"],
      },
    },
  },
  {
    method: "GET",
    path: "/score/leaderboard",
    title: "Top trusted agents",
    description: "Agents ranked by trust score (then by total volume as a tiebreaker).",
    params: [{ name: "limit", type: "int", default: "20", description: "1 ≤ limit ≤ 200" }],
    example: [
      {
        address: "0x13db4caf175f23f1429c2df6b333350c24705192",
        score: 574,
        label: "Established",
        grade: "B",
        stats: { total_transactions: 1725, total_volume_usdc: 5375.45, days_active: 29 },
      },
    ],
  },
  {
    method: "GET",
    path: "/agents/new",
    title: "New agents (last 24h)",
    description: "Addresses whose first ever indexed x402 payment occurred in the last 24 hours, with first-tx details and what they've spent since.",
    example: [
      {
        address: "0xb6dbe48513f9ed41b2de29ee89112a52940931e1",
        first_seen: 1780324950,
        first_amount_usdc: 160.89,
        first_facilitator: "meridian",
        total_spent_since: 3691.45,
        tx_count_since: 24,
      },
    ],
  },
];

export function EndpointsSection() {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ENDPOINTS;
    return ENDPOINTS.filter((e) =>
      `${e.path} ${e.title} ${e.description}`.toLowerCase().includes(needle),
    );
  }, [q]);

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-3 p-4 shadow-card animate-fade-in-up">
        <SearchIcon className="h-4 w-4 shrink-0 text-white/40" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter endpoints by path, title, or description…"
          className="w-full bg-transparent text-sm text-white/90 placeholder-white/30 outline-none"
        />
        <span className="shrink-0 text-xs text-white/40 tabular">
          {filtered.length}/{ENDPOINTS.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card grid h-32 place-items-center text-xs text-white/40">
          No endpoints match “{q}”.
        </div>
      ) : (
        <div className="space-y-6">
          {filtered.map((ep) => (
            <EndpointCard key={ep.path} endpoint={ep} />
          ))}
        </div>
      )}
    </div>
  );
}

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const curl = `curl ${PROD_BASE}${endpoint.path}`;
  const exampleJson = JSON.stringify(endpoint.example, null, 2);
  return (
    <section className="card p-5 shadow-card animate-fade-in-up">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="rounded-md border border-brand/30 bg-brand/10 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-brand">
          {endpoint.method}
        </span>
        <code className="font-mono text-sm text-white/90">{endpoint.path}</code>
      </div>
      <h3 className="mt-2 text-base font-semibold text-white/85">
        {endpoint.title}
      </h3>
      <p className="mt-1 text-sm text-white/60">{endpoint.description}</p>

      {endpoint.params && endpoint.params.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">
            Parameters
          </p>
          <div className="mt-2 overflow-hidden rounded-lg border border-white/5">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/[0.02] text-left text-white/40">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Default</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {endpoint.params.map((p) => (
                  <tr key={p.name}>
                    <td className="px-3 py-2 font-mono text-brand">{p.name}</td>
                    <td className="px-3 py-2 font-mono text-white/60">{p.type}</td>
                    <td className="px-3 py-2 font-mono text-white/40">
                      {p.default ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-white/60">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <code className="overflow-x-auto rounded-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white/80">
          {curl}
        </code>
        <CopyButton text={curl} label="Copy curl" copiedLabel="Copied" />
      </div>

      <pre className="mt-3 overflow-x-auto rounded-lg border border-white/5 bg-black/40 p-4 font-mono text-[12px] leading-relaxed text-white/80">
        {exampleJson}
      </pre>
    </section>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
