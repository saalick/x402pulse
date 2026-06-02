"use client";

import { useEffect, useState } from "react";
import { api, DataWindow } from "@/lib/api";
import { shortDate } from "@/lib/format";

const REFRESH_MS = 60_000;

/**
 * Footer strip that says exactly what time range the indexed data covers.
 * Avoids the misleading "all-time" implication on the stat cards above.
 */
export function DataWindowFooter() {
  const [w, setW] = useState<DataWindow | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await api.stats();
        if (!cancelled) setW(s.data_window);
      } catch { /* swallow */ }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!w || !w.since) return null;

  return (
    <p className="pt-2 text-center text-[11px] text-white/30">
      Indexed window:{" "}
      <span className="text-white/55">
        {shortDate(w.since)} → now
      </span>{" "}
      · <span className="tabular text-white/55">{w.days.toFixed(1)} days</span>{" "}
      · <span className="tabular text-white/55">{w.rows.toLocaleString()} rows</span>
      <span className="mx-1 text-white/20">·</span>
      <span className="text-white/40">
        anything older than {shortDate(w.since)} is not in this index
      </span>
    </p>
  );
}
