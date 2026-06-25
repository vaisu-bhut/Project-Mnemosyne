"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import type { PeopleGraph } from "@/lib/api/types";

/** Circle → node color. `_` is the fallback for people with no derived circle. */
export const CIRCLE_COLOR: Record<string, string> = {
  work: "#3b82f6",
  personal: "#10b981",
  health: "#ef4444",
  shareable: "#f59e0b",
  episode: "#a855f7",
  _: "#94a3b8",
};

interface GNode {
  id: string;
  name: string;
  closeness: number | null;
  circle: string | null;
  interactions: number;
  type?: string;
  __threeObj?: THREE.Object3D; // Internal ref from 3d-force-graph
}
interface GLink {
  source: string;
  target: string;
  weight: number;
}

// Minimal structural type for the 3d-force-graph instance.
interface ForceGraphInstance {
  (el: HTMLElement): ForceGraphInstance;
  graphData(data: { nodes: GNode[]; links: GLink[] }): ForceGraphInstance;
  backgroundColor(c: string): ForceGraphInstance;
  nodeLabel(fn: (n: GNode) => string): ForceGraphInstance;
  nodeColor(fn: (n: GNode) => string): ForceGraphInstance;
  nodeVal(fn: (n: GNode) => number): ForceGraphInstance;
  nodeOpacity(o: number): ForceGraphInstance;
  nodeThreeObject(fn: (n: GNode) => THREE.Object3D): ForceGraphInstance;
  linkColor(fn: (l: GLink) => string): ForceGraphInstance;
  linkWidth(fn: (l: GLink) => number): ForceGraphInstance;
  linkOpacity(o: number): ForceGraphInstance;
  linkDirectionalParticles(fn: (l: GLink) => number): ForceGraphInstance;
  linkDirectionalParticleSpeed(fn: (l: GLink) => number): ForceGraphInstance;
  linkDirectionalParticleWidth(w: number): ForceGraphInstance;
  linkDirectionalParticleColor(fn: () => string): ForceGraphInstance;
  onNodeClick(fn: (n: GNode) => void): ForceGraphInstance;
  onNodeHover(fn: (n: GNode | null, prevN: GNode | null) => void): ForceGraphInstance;
  width(w: number): ForceGraphInstance;
  height(h: number): ForceGraphInstance;
  scene(): THREE.Scene;
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
        .nodeThreeObject((node) => {
          const n = node as GNode;
          const isEpisode = n.type === "episode";
          const radius = isEpisode ? 4.5 : 3.5 + (n.closeness ?? 0.1) * 9;
          
          const geometry = new THREE.SphereGeometry(radius, 32, 32);
          const colorVal = CIRCLE_COLOR[n.circle ?? "_"] ?? CIRCLE_COLOR._!;
          
          // Glowing physical material (glassmorphism/translucent)
          const material = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(colorVal),
            emissive: new THREE.Color(colorVal),
            emissiveIntensity: isEpisode ? 0.35 : 0.15,
            roughness: 0.1,
            metalness: 0.2,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
            transmission: 0.8,
            thickness: 1.5,
            ior: 1.5,
          });
          
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = n.id;
          
          // Store references to manipulate during hover events
          mesh.userData = { material, originalEmissive: material.emissiveIntensity };
          return mesh;
        })
        .nodeOpacity(0.9)
        .linkColor(() => "rgba(148,163,184,0.15)")
        .linkWidth((l) => Math.min(2.5, Math.max(0.5, l.weight * 0.4)))
        .linkOpacity(0.3)
        // Dynamic flowing particle stream
        .linkDirectionalParticles((l) => Math.min(5, Math.ceil(l.weight / 2.5)))
        .linkDirectionalParticleSpeed((l) => 0.003 + l.weight * 0.001)
        .linkDirectionalParticleWidth(2.2)
        .linkDirectionalParticleColor(() => "#c084fc") // Glowing purple particles
        .onNodeHover((node, prevNode) => {
          // Reset highlight on previous node
          if (prevNode?.__threeObj) {
            const mesh = prevNode.__threeObj as THREE.Mesh;
            const data = mesh.userData as { material?: THREE.MeshPhysicalMaterial; originalEmissive?: number };
            if (data.material && data.originalEmissive !== undefined) {
              data.material.emissiveIntensity = data.originalEmissive;
            }
          }
          // Boost highlight on currently hovered node
          if (node?.__threeObj) {
            const mesh = node.__threeObj as THREE.Mesh;
            const data = mesh.userData as { material?: THREE.MeshPhysicalMaterial; originalEmissive?: number };
            if (data.material && data.originalEmissive !== undefined) {
              data.material.emissiveIntensity = data.originalEmissive * 2.8;
            }
          }
        })
        .onNodeClick((n) => {
          if (n.type === "episode") {
            router.push("/app/memory");
          } else {
            router.push(`/app/people/${n.id}`);
          }
        })
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

  return (
    <div
      ref={containerRef}
      className="relative h-[600px] w-full overflow-hidden rounded-xl border border-slate-800 bg-[#0b1020] shadow-inner"
    />
  );
}
