"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AgentHourPoint } from "@/lib/api";
import { formatUsdc } from "@/lib/format";

/** 24-bar hourly spend chart for the agent profile. */
export function AgentHourlyChart({ data }: { data: AgentHourPoint[] }) {
  const total = data.reduce((s, p) => s + p.volume, 0);
  if (total === 0) {
    return (
      <div className="grid h-56 place-items-center text-xs text-white/40">
        No spending in the last 24h.
      </div>
    );
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="hour"
            tickFormatter={fmtHourTick}
            stroke="rgba(255,255,255,0.3)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval={3}
          />
          <YAxis
            stroke="rgba(255,255,255,0.3)"
            fontSize={11}
            tickFormatter={(v) => `$${formatUsdc(v, true)}`}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip content={<BarTooltip />} cursor={{ fill: "rgba(0,255,136,0.08)" }} />
          <Bar
            dataKey="volume"
            fill="#00ff88"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function fmtHourTick(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: undefined,
  });
}

function BarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: AgentHourPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/10 bg-bg/90 px-3 py-2 text-xs shadow-card backdrop-blur">
      <div className="text-white/50">
        {new Date(p.hour * 1000).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
        })}
      </div>
      <div className="mt-1 font-medium text-brand">${formatUsdc(p.volume)}</div>
      <div className="text-white/40">{p.txns} txns</div>
    </div>
  );
}
