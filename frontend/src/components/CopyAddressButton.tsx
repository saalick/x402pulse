"use client";

import { useState } from "react";

export function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — silently no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Copy address to clipboard"
      title={copied ? "Copied" : "Copy address"}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
        copied
          ? "border-brand/40 bg-brand/15 text-brand"
          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-brand/30 hover:text-brand"
      }`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
