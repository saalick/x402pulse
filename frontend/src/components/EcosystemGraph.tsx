"use client";

import * as d3 from "d3";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MapData, type MapEdge, type MapNode } from "@/lib/api";

/**
 * D3 force-directed graph of the x402 ecosystem.
 *
 * Nodes:
 *   - agent      → green circle, sized by total volume sent
 *   - facilitator→ blue rounded square, label inside
 *   - seller     → purple circle, sized by total volume received
 *
 * Edges: agent → facilitator → seller, line thickness ∝ tx count.
 *
 * Interactions: hover tooltip; click agent → /agent/{addr}; click seller →
 * /seller/{addr}; drag nodes; scroll to zoom. The simulation runs cooled
 * after layout settles so the canvas stops thrashing in the background.
 */
export function EcosystemGraph({ initialData }: { initialData: MapData | null }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const [data, setData] = useState<MapData | null>(initialData);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [resetKey, setResetKey] = useState(0);

  // Fallback fetch on the client if SSR didn't ship initial data.
  useEffect(() => {
    if (data) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await api.mapData();
        if (!cancelled) setData(d);
      } catch { /* leave null */ }
    })();
    return () => { cancelled = true; };
  }, [data]);

  // Build/refresh the D3 simulation whenever data or reset changes.
  useEffect(() => {
    if (!data || !svgRef.current || !gRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    g.selectAll("*").remove();

    // Read both dims live so the force layout centers on whatever the
    // SVG actually rendered as — varies by viewport on mobile vs desktop.
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 560;

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const edges: SimEdge[] = data.edges.map((e) => ({ ...e }));

    // Size scales (sqrt to dampen extreme volumes).
    const volMax = d3.max(nodes, (n) => n.volume) ?? 1;
    const rScale = d3.scaleSqrt().domain([0, volMax]).range([4, 18]);
    const wMax = d3.max(edges, (e) => e.weight) ?? 1;
    const wScale = d3.scaleSqrt().domain([0, wMax]).range([0.6, 3.0]);

    const sim = d3
      .forceSimulation<SimNode>(nodes)
      .force("link", d3.forceLink<SimNode, SimEdge>(edges)
        .id((d) => d.id)
        .distance(70)
        .strength(0.6))
      .force("charge", d3.forceManyBody().strength(-180))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<SimNode>().radius((d) => rScale(d.volume) + 6))
      .alpha(1)
      .alphaDecay(0.04);

    simRef.current = sim;

    // --- edges
    const link = g.append("g")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", "rgba(255,255,255,0.18)")
      .attr("stroke-width", (d) => wScale(d.weight))
      .attr("stroke-linecap", "round");

    // --- nodes
    const node = g.append("g")
      .selectAll<SVGGElement, SimNode>("g.node")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", "node")
      .style("cursor", (d) => (d.type === "facilitator" ? "default" : "pointer"));

    node.each(function (d) {
      const sel = d3.select(this);
      if (d.type === "facilitator") {
        // rounded square
        const size = Math.max(28, rScale(d.volume) * 2.2);
        sel.append("rect")
          .attr("x", -size / 2)
          .attr("y", -size / 2)
          .attr("width", size)
          .attr("height", size)
          .attr("rx", 6)
          .attr("fill", "rgba(59,130,246,0.18)")
          .attr("stroke", "#3b82f6")
          .attr("stroke-width", 1.5);
        sel.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("font-size", 11)
          .attr("font-family", "var(--font-geist-mono), monospace")
          .attr("fill", "#bcd2ff")
          .text(d.label);
      } else {
        const color = d.type === "agent" ? "#00ff88" : "#a855f7";
        sel.append("circle")
          .attr("r", rScale(d.volume))
          .attr("fill", color)
          .attr("fill-opacity", 0.55)
          .attr("stroke", color)
          .attr("stroke-width", 1.4);
      }
    });

    // Tick → reposition.
    sim.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0);
      node.attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
    });

    // Drag.
    const drag = d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    node.call(drag);

    // Hover tooltip.
    node
      .on("mouseenter", function (event: MouseEvent, d) {
        const rect = svgRef.current!.getBoundingClientRect();
        setTooltip({
          x: event.clientX - rect.left + 12,
          y: event.clientY - rect.top + 12,
          node: d,
        });
      })
      .on("mousemove", function (event: MouseEvent) {
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        setTooltip((t) => (t ? { ...t, x: event.clientX - rect.left + 12, y: event.clientY - rect.top + 12 } : t));
      })
      .on("mouseleave", () => setTooltip(null))
      .on("click", (_e, d) => {
        if (d.type === "agent")  router.push(`/agent/${d.id}`);
        if (d.type === "seller") router.push(`/seller/${d.id}`);
      });

    // Zoom + pan on the inner <g>.
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 4])
      .on("zoom", (event) => g.attr("transform", event.transform.toString()));
    svg.call(zoom);

    return () => {
      sim.stop();
      svg.on(".zoom", null);
    };
  }, [data, resetKey, router]);

  const stats = useMemo(() => {
    if (!data) return { agents: 0, sellers: 0, facilitators: 0 };
    let a = 0, s = 0, f = 0;
    for (const n of data.nodes) {
      if (n.type === "agent") a++;
      else if (n.type === "seller") s++;
      else f++;
    }
    return { agents: a, sellers: s, facilitators: f };
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-white/40">
          {data ? (
            <>
              {stats.agents} agents · {stats.facilitators} facilitators ·{" "}
              {stats.sellers} sellers · {data.edges.length} edges ·{" "}
              <span className="text-white/30">(addresses with &gt;{data.min_txns} txns)</span>
            </>
          ) : (
            "Loading graph…"
          )}
        </p>
        <button
          type="button"
          onClick={() => setResetKey((k) => k + 1)}
          className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/70 transition hover:border-brand/30 hover:text-brand"
        >
          Reset layout
        </button>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-white/5 bg-[#070707]">
        {/* Mobile: shorter so it doesn't dominate the viewport. Desktop: 560. */}
        <svg
          ref={svgRef}
          width="100%"
          className="block h-[380px] cursor-grab active:cursor-grabbing sm:h-[480px] lg:h-[560px]"
        >
          <g ref={gRef} />
        </svg>
        {tooltip && <Tooltip {...tooltip} />}
      </div>

      <Legend />
    </div>
  );
}

function Tooltip({ x, y, node }: TooltipState) {
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-xs rounded-lg border border-white/10 bg-bg/95 px-3 py-2 text-xs shadow-card backdrop-blur"
      style={{ left: x, top: y }}
    >
      <div className="font-mono text-white/90">{node.label}</div>
      <div className="mt-1 text-white/40">
        type{" "}
        <span className="text-white/80">{node.type}</span>{" "}
        · ${node.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })} ·{" "}
        {node.tx_count.toLocaleString()} txns
      </div>
      {node.type !== "facilitator" && (
        <div className="mt-1 text-[10px] text-white/30">Click to open profile</div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-white/40">
      <Swatch color="#00ff88"        label="agent" />
      <Swatch color="#3b82f6" square label="facilitator" />
      <Swatch color="#a855f7"        label="seller" />
      <span className="ml-auto text-white/30">
        scroll to zoom · drag to rearrange · click agent/seller to open
      </span>
    </div>
  );
}

function Swatch({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={square ? "h-3 w-3 rounded-sm" : "h-3 w-3 rounded-full"}
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}55` }}
      />
      <span className="uppercase tracking-wider">{label}</span>
    </span>
  );
}

/* ---------------- types ---------------- */

type SimNode = MapNode & d3.SimulationNodeDatum;
type SimEdge = Omit<MapEdge, "source" | "target"> & {
  source: string | SimNode;
  target: string | SimNode;
} & d3.SimulationLinkDatum<SimNode>;

type TooltipState = { x: number; y: number; node: MapNode };
