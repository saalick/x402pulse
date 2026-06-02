"use client";

import { useState } from "react";

/**
 * Small "copy text to clipboard" button. Generic — used by api-docs to
 * copy curl commands. For copying agent addresses, see CopyAddressButton
 * which has slightly different default labels.
 */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
        copied
          ? "border-brand/40 bg-brand/15 text-brand"
          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-brand/30 hover:text-brand"
      }`}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
