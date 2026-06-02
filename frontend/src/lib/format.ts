/** Human formatters shared across the dashboard. */

export function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr ?? "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const usd = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdCompact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const intFmt = new Intl.NumberFormat("en-US");

export function formatUsdc(value: number, compact = false): string {
  if (!isFinite(value)) return "—";
  return compact ? usdCompact.format(value) : usd.format(value);
}

export function formatInt(value: number, compact = false): string {
  if (!isFinite(value)) return "—";
  return compact ? usdCompact.format(value) : intFmt.format(value);
}

export function timeAgo(unixSeconds: number, nowMs = Date.now()): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000 - unixSeconds));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

/** basescan link helpers — used to make addresses/txes clickable. */
export const basescanTx = (hash: string) => `https://basescan.org/tx/${hash}`;
export const basescanAddress = (addr: string) => `https://basescan.org/address/${addr}`;
