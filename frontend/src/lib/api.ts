/**
 * Typed fetchers for the x402pulse API.
 *
 * API base resolves to NEXT_PUBLIC_API_URL or http://127.0.0.1:8000 in dev.
 * Every endpoint returns the same JSON shape as documented in api/main.py.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type DataWindow = {
  since: number | null;   // unix seconds, oldest indexed tx
  until: number | null;   // unix seconds, newest indexed tx
  days: number;
  rows: number;
};

export type Stats = {
  total_volume_usdc: number;
  total_transactions: number;
  volume_24h_usdc: number;
  transactions_24h: number;
  active_agents_24h: number;
  active_sellers_24h: number;
  data_window: DataWindow;
};

export type VolumePoint = {
  timestamp: number;
  volume: number;
  txns: number;
};

export type AgentRow = {
  address: string;
  transactions: number;
  volume_usdc: number;
  last_seen: number;
};

export type SellerRow = AgentRow & { facilitator: string };

export type FeedRow = {
  tx_hash: string;
  block_number: number;
  timestamp: number;
  from_address: string;
  to_address: string;
  amount_usdc: number;
  facilitator: string;
};

export type Alert = {
  address: string;
  last_hour_volume_usdc: number;
  last_hour_transactions: number;
  prior_hourly_avg_usdc: number;
  multiplier: number;
};

export type AgentHourPoint = {
  hour: number;
  volume: number;
  txns: number;
};

export type AgentFacilitator = {
  name: string;
  transactions: number;
  volume_usdc: number;
};

export type AgentProfile = {
  address: string;
  total_spent_usdc: number;
  total_transactions: number;
  first_seen: number;
  first_seen_bounded: boolean;
  last_seen: number;
  avg_payment_usdc: number;
  favorite_facilitator: string | null;
  behavior_tag: "Micro-payer" | "Power user" | "Batch buyer" | "Regular";
  is_new: boolean;
  hourly_24h: AgentHourPoint[];
  facilitators: AgentFacilitator[];
  recent_transactions: FeedRow[];
  // legacy aliases also returned by the API
  total_volume_usdc: number;
  avg_transaction_usdc: number;
  max_txns_in_any_hour: number;
  tags: string[];
};

export type DistributionBucket = {
  label: string;
  count: number;
  volume_usdc: number;
  pct: number;
};

export type Distribution = {
  buckets: DistributionBucket[];
  median_payment_usdc: number;
  mode_bucket: string;
};

export type DailyReport = {
  period: "last 24 hours";
  generated_at: number;
  total_volume_usdc: number;
  total_transactions: number;
  unique_agents: number;
  unique_sellers: number;
  avg_payment_usdc: number;
  volume_change_pct: number;
  new_agents_count: number;
  top_agent: { address: string; volume: number; txns: number } | null;
  top_seller: { address: string; volume: number; txns: number; facilitator: string | null } | null;
  top_facilitator: { name: string; volume: number; market_share_pct: number } | null;
  biggest_single_tx: {
    amount: number; from: string; to: string;
    facilitator: string; tx_hash: string; timestamp: number;
  } | null;
  busiest_hour: { hour: number; tx_count: number } | null;
  payment_size_breakdown: {
    micro: number; small: number; medium: number; large: number; whale: number;
  };
};

export type MapNode = {
  id: string;
  type: "agent" | "facilitator" | "seller";
  label: string;
  volume: number;
  tx_count: number;
  facilitator?: string;
};
export type MapEdge = {
  source: string;
  target: string;
  weight: number;
};
export type MapData = {
  nodes: MapNode[];
  edges: MapEdge[];
  min_txns: number;
};

export type WatchSparkPoint = { hour: number; volume: number };
export type WatchLast6 = {
  tx_hash: string;
  timestamp: number;
  amount_usdc: number;
  direction: "sent" | "received";
  facilitator: string;
};

export type WatchedAddress = {
  address: string;
  kind: "agent" | "seller" | "both" | "unknown";
  total_sent_usdc: number;
  total_received_usdc: number;
  total_transactions: number;
  last_active: number | null;
  facilitator: string | null;
  last_6: WatchLast6[];
  sparkline_24h: WatchSparkPoint[];
};

export type ScoreDimension = {
  score: number;
  max: number;
  detail: string;
};

export type TrustScore = {
  address: string;
  score: number;
  label: "No x402 Activity" | "New Agent" | "Developing" | "Established" | "Trusted" | "Elite Agent";
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: {
    payment_history: ScoreDimension;
    wallet_age:      ScoreDimension;
    volume:          ScoreDimension;
    consistency:     ScoreDimension;
    diversity:       ScoreDimension;
  };
  stats: {
    total_transactions: number;
    total_volume_usdc:  number;
    first_seen:         number;
    last_seen:          number;
    days_active:        number;
    facilitators_used:  string[];
  };
  percentile: number;
};

export type FingerprintAxis = {
  label: "Speed" | "Volume" | "Diversity" | "Consistency" | "Activity";
  score: number;
  detail: string;
};

export type Fingerprint = {
  address: string;
  axes: FingerprintAxis[];
};

export type SearchMatch = {
  address: string;
  kind: "agent" | "seller" | "both";
  agent_txns: number;
  seller_txns: number;
  agent_volume: number;
  seller_volume: number;
  last_seen: number;
  facilitator: string | null;
};

export type SearchResult = {
  query: string;
  matches: SearchMatch[];
};

export type SellerProfile = {
  address: string;
  facilitator: string | null;
  total_earned_usdc: number;
  total_transactions: number;
  avg_payment_usdc: number;
  first_seen: number;
  first_seen_bounded: boolean;
  last_seen: number;
  unique_payers: number;
  top_payers: AgentRow[];
  hourly_24h: AgentHourPoint[];
  recent_transactions: FeedRow[];
};

export type NewAgent = {
  address: string;
  first_seen: number;
  first_amount_usdc: number;
  first_facilitator: string;
  total_spent_since: number;
  tx_count_since: number;
};

export type FacilitatorStats = {
  name: string;
  total_volume_usdc: number;
  total_transactions: number;
  avg_payment_usdc: number;
  volume_24h: number;
  volume_change_pct: number;
  market_share_pct: number;
  active_agents_24h: number;
};

export type Period = "1h" | "24h" | "7d";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export type HealthScore = {
  score: number;
  label: "Critical" | "Fair" | "Good" | "Strong" | "Excellent";
  change_24h: number;
  components: {
    velocity:  { score: number; txns_1h: number; txns_prev_1h: number };
    agents:    { score: number; agents_24h: number; daily_avg_7d: number };
    volume:    { score: number; volume_24h: number; volume_prev_24h: number };
    diversity: { score: number; active_facilitators_24h: number };
  };
  weights: Record<string, number>;
  as_of: number;
};

export const api = {
  stats:   (signal?: AbortSignal) => get<Stats>("/stats", signal),
  healthScore: (signal?: AbortSignal) => get<HealthScore>("/health-score", signal),
  volume:  (period: Period, signal?: AbortSignal) =>
             get<VolumePoint[]>(`/volume?period=${period}`, signal),
  agents:  (limit = 20, signal?: AbortSignal) =>
             get<AgentRow[]>(`/agents/leaderboard?limit=${limit}`, signal),
  sellers: (limit = 20, signal?: AbortSignal) =>
             get<SellerRow[]>(`/sellers/leaderboard?limit=${limit}`, signal),
  feed:    (limit = 50, signal?: AbortSignal) =>
             get<FeedRow[]>(`/feed?limit=${limit}`, signal),
  alerts:  (signal?: AbortSignal) => get<Alert[]>("/alerts", signal),
  agent:   (address: string, signal?: AbortSignal) =>
             get<AgentProfile>(`/agent/${address.toLowerCase()}`, signal),
  facilitators: (signal?: AbortSignal) =>
             get<FacilitatorStats[]>(`/facilitators/stats`, signal),
  newAgents: (signal?: AbortSignal) =>
             get<NewAgent[]>(`/agents/new`, signal),
  search: (q: string, signal?: AbortSignal) =>
             get<SearchResult>(`/search?q=${encodeURIComponent(q)}`, signal),
  seller: (address: string, signal?: AbortSignal) =>
             get<SellerProfile>(`/seller/${address.toLowerCase()}`, signal),
  fingerprint: (address: string, signal?: AbortSignal) =>
             get<Fingerprint>(`/agent/${address.toLowerCase()}/fingerprint`, signal),
  batch: (addresses: string[], signal?: AbortSignal) =>
             get<WatchedAddress[]>(
               `/agents/batch?addresses=${addresses.map((a) => a.toLowerCase()).join(",")}`,
               signal,
             ),
  mapData: (signal?: AbortSignal) => get<MapData>(`/map/data`, signal),
  dailyReport: (signal?: AbortSignal) => get<DailyReport>(`/report/daily`, signal),
  distribution: (signal?: AbortSignal) => get<Distribution>(`/stats/distribution`, signal),
  trustScore: (address: string, signal?: AbortSignal) =>
             get<TrustScore>(`/score/${address.toLowerCase()}`, signal),
  scoreLeaderboard: (limit = 20, signal?: AbortSignal) =>
             get<TrustScore[]>(`/score/leaderboard?limit=${limit}`, signal),
};
