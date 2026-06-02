"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, api } from "@/lib/api";
import { formatUsdc, shortAddress } from "@/lib/format";

const REFRESH_MS = 60_000;

export function AlertBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api.alerts();
        if (!cancelled) setAlerts(next);
      } catch {
        /* swallow */
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="card animate-fade-in-up overflow-hidden border-warn/30 bg-warn-bg p-0">
      <div className="flex items-stretch">
        <div
          aria-hidden
          className="w-1.5 shrink-0 bg-warn/60"
        />
        <div className="min-w-0 flex-1 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-warn">
            Unusual activity detected
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-white/85">
            {alerts.slice(0, 3).map((a) => (
              <li key={a.address} className="truncate">
                <Link
                  href={`/agent/${a.address}`}
                  className="font-mono text-warn hover:underline"
                  title={`${a.address} — open profile`}
                >
                  {shortAddress(a.address)}
                </Link>{" "}
                — ${formatUsdc(a.last_hour_volume_usdc)} in the last hour ·{" "}
                <span className="text-warn">{a.multiplier.toFixed(1)}x</span>{" "}
                <span className="text-white/40">normal volume</span>
              </li>
            ))}
            {alerts.length > 3 && (
              <li className="text-xs text-white/40">
                +{alerts.length - 3} more
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
