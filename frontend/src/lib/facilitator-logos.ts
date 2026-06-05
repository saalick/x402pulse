/**
 * Facilitator-id → home domain map for logo rendering.
 *
 * We use Google's favicon service so we don't have to host or maintain
 * logo assets — it pulls each project's favicon by domain at no cost.
 *
 * Entries here are the confidently-known facilitator websites. Any name
 * not in the map falls back to a text-only badge in the UI.
 *
 * To add a new one: pick the project's marketing domain (NOT a docs
 * subdomain) and append it here. Lowercase key matches the `name` field
 * the API returns.
 */
export const FACILITATOR_DOMAINS: Record<string, string> = {
  // Already-mapped from prior research
  bitrefill:        "bitrefill.com",
  coinbase:         "coinbase.com",
  daydreams:        "daydreams.fun",
  heurist:          "heurist.ai",
  meridian:         "meridian.so",
  payai:            "payai.network",
  polymer:          "polymerdao.com",
  thirdweb:         "thirdweb.com",
  treasure:         "treasure.lol",
  virtuals:         "virtuals.io",
  relai:            "relai.app",
  cascade:          "cascade.tech",
  primer:           "primer.io",
  questflow:        "questflow.ai",
  ultravioletadao:  "ultravioleta.org",
  xecho:            "xecho.ai",
  // Added after full ecosystem sweep (facilitators.x402.watch + x402.org/ecosystem)
  "402104":         "load.network",
  anyspend:         "anyspend.com",
  aurracloud:       "aurracloud.com",
  codenut:          "codenut.ai",
  corbits:          "corbits.dev",
  dexter:           "dexter.cash",
  fluxa:            "fluxapay.xyz",
  kamiyo:           "kamiyo.ai",
  mogami:           "mogami.tech",
  openfacilitator:  "openfacilitator.io",
  openmid:          "openmid.xyz",
  openx402:         "openx402.ai",
  x402jobs:         "x402.jobs",
  x402rs:           "x402.rs",
};

/**
 * Returns the favicon URL for a facilitator, or null if we don't have
 * a domain mapped. Caller should fall back to text-only rendering on null.
 */
export function facilitatorLogoUrl(name: string): string | null {
  const id = name.toLowerCase();
  const domain = FACILITATOR_DOMAINS[id];
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
}
