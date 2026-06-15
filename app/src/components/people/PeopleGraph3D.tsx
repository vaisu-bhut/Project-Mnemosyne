"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { PeopleGraph } from "@/lib/api/types";

/** Circle → node color. `_` is the fallback for people with no derived circle. */
export const CIRCLE_COLOR: Record<string, string> = {
  work: "#3b82f6",
  personal: "#10b981",
  health: "#ef4444",
  shareable: "#f59e0b",
  _: "#94a3b8",
};

interface GNode {
  id: string;
  name: string;
  closeness: number | null;
  circle: string | null;
  interactions: number;
}
interface GLink {
  source: string;
  target: string;
  weight: number;
}

// Minimal structural type for the 3d-force-graph instance (avoids `any` and the
// library's heavy generics). Only the methods we use are declared.
interface ForceGraphInstance {
  (el: HTMLElement): ForceGraphInstance;
  graphData(data: { nodes: GNode[]; links: GLink[] }): ForceGraphInstance;
  backgroundColor(c: string): ForceGraphInstance;
  nodeLabel(fn: (n: GNode) => string): ForceGraphInstance;
  nodeColor(fn: (n: GNode) => string): ForceGraphInstance;
  nodeVal(fn: (n: GNode) => number): ForceGraphInstance;
  nodeOpacity(o: number): ForceGraphInstance;
  linkColor(fn: (l: GLink) => string): ForceGraphInstance;
  linkWidth(fn: (l: GLink) => number): ForceGraphInstance;
  linkOpacity(o: number): ForceGraphInstance;
  onNodeClick(fn: (n: GNode) => void): ForceGraphInstance;
  width(w: number): ForceGraphInstance;
  height(h: number): ForceGraphInstance;
  _destructor?: () => void;
}

/** Fresh copies each render — 3d-force-graph mutates nodes/links (adds x/y/z and
 * replaces link endpoints with node refs), so reusing arrays corrupts them. */
function clone(data: PeopleGraph): { nodes: GNode[]; links: GLink[] } {
  return {
    nodes: data.nodes.map((n) => ({ ...n })),
    links: data.links.map((l) => ({ source: l.source, target: l.target, weight: l.weight })),
  };
}

/** Interactive 3D people graph: spheres sized by closeness, colored by circle,
 * linked by co-occurrence weight. Click a node to open that person. */
export function PeopleGraph3D({ data }: { data: PeopleGraph }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphInstance | null>(null);
  const dataRef = useRef<PeopleGraph>(data);
  const router = useRouter();

  // Keep the latest data available to the (mount-once) initializer.
  dataRef.current = data;

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;

    void (async () => {
      const factory = (await import("3d-force-graph")).default as unknown as () => ForceGraphInstance;
      const el = containerRef.current;
      if (disposed || !el) return;

      const g = factory()(el)
        .backgroundColor("#0b1020")
        .nodeLabel((n) => `${n.name}${n.circle ? ` · ${n.circle}` : ""}`)
        .nodeColor((n) => CIRCLE_COLOR[n.circle ?? "_"] ?? CIRCLE_COLOR._!)
        .nodeVal((n) => 1 + (n.closeness ?? 0.1) * 10)
        .nodeOpacity(0.9)
        .linkColor(() => "rgba(148,163,184,0.4)")
        .linkWidth((l) => Math.min(6, Math.max(0.5, l.weight)))
        .linkOpacity(0.5)
        .onNodeClick((n) => router.push(`/people/${n.id}`))
        .width(el.clientWidth)
        .height(el.clientHeight);

      g.graphData(clone(dataRef.current));
      graphRef.current = g;

      ro = new ResizeObserver(() => {
        if (graphRef.current) graphRef.current.width(el.clientWidth).height(el.clientHeight);
      });
      ro.observe(el);
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      graphRef.current?._destructor?.();
      graphRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [router]);

  // Push data updates into the existing instance (don't re-init / reset camera).
  useEffect(() => {
    graphRef.current?.graphData(clone(data));
  }, [data]);

  return <div ref={containerRef} className="h-[560px] w-full overflow-hidden rounded-lg border" />;
}
