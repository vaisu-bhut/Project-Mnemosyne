"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * The Mnemosyne landing page — a pinned-scroll experience.
 *
 * The visible stage (canvas + text + label chips) is FIXED; only an invisible
 * tall track scrolls, producing a 0..1 progress that (a) drives the Three.js
 * scene and (b) cross-fades the six text panels in place. Text lives in a clean
 * LEFT column with a strong scrim; the labeled graph lives to the RIGHT. Label
 * chips are HTML, positioned each frame from the scene's projected node screen
 * coordinates — so the abstract graph reads as real, named data.
 */

const ACTS = 6;
const ACT_LABELS = ["Trust", "Reads", "Remembers", "Cites", "Interrupts", "Thesis"];

/** Mirrors MemoryScene.labels (same order) so chips can render before the scene
 * loads; positions come from scene.labelScreens by index at runtime. */
const LANDING_LABELS: { text: string; detail?: string; kind: "self" | "person" | "category" | "episode" | "fact" | "source" }[] = [
  { text: "You", detail: "Active Brain Context", kind: "self" },
  { text: "Work", detail: "Category · 48 episodes", kind: "category" },
  { text: "Friends", detail: "Category · 12 contacts", kind: "category" },
  { text: "Family", detail: "Category · 5 contacts", kind: "category" },
  { text: "Project Aurora", detail: "Topic · 3 active loops", kind: "category" },
  { text: "Personal AI", detail: "Topic · 15 references", kind: "category" },
  
  // People
  { text: "Sara Lin", detail: "Contact · Realtor · 2× reinforced", kind: "person" },
  { text: "Priya Shah", detail: "Contact · Product Manager", kind: "person" },
  { text: "Marcus Reyes", detail: "Contact · Lead Designer", kind: "person" },
  { text: "Jane Okafor", detail: "Contact · Attorney", kind: "person" },
  { text: "Raju Mehta", detail: "Contact · Software Lead", kind: "person" },
  { text: "Mom", detail: "Contact · Family Loop", kind: "person" },
  { text: "Dr. Alvarez", detail: "Contact · Cardiologist", kind: "person" },
  { text: "David Cho", detail: "Contact · Co-author", kind: "person" },
  { text: "Elena Rostova", detail: "Contact · Operations", kind: "person" },
  { text: "Tom Miller", detail: "Contact · Architect", kind: "person" },
  { text: "Amina Diop", detail: "Contact · Consultant", kind: "person" },
  { text: "Kofi Mensah", detail: "Contact · Investor", kind: "person" },
  
  // Sources / Connections
  { text: "Gmail Inbox", detail: "Connected · 1.2k emails", kind: "source" },
  { text: "GCal Sync", detail: "Connected · 85 meetings", kind: "source" },
  { text: "Outlook Mail", detail: "Linked · 420 items", kind: "source" },
  { text: "Local Notes", detail: "Syncing · 31 markdown files", kind: "source" },
  
  // Episodes
  { text: "Sync on Aurora", detail: "Meeting · 5 attendees · 12:15 PM", kind: "episode" },
  { text: "Dinner with Priya", detail: "Dinner · Aug 12 · 7:30 PM", kind: "episode" },
  { text: "Coffee w/ Marcus", detail: "Coffee · Aug 8 · 10:00 AM", kind: "episode" },
  { text: "Call w/ Elena", detail: "Call · Aug 14 · 11:30 AM", kind: "episode" },
  { text: "Weekly Review", detail: "Workspace Sync · Mondays", kind: "episode" },
  { text: "Design Handoff", detail: "Review · Wednesday", kind: "episode" },
  { text: "Gmail: Aurora Contract", detail: "Email ingestion · 2d ago", kind: "episode" },
  { text: "Cal: Dentist appt", detail: "Calendar Event · Aug 22", kind: "episode" },
  { text: "Drafting Memo", detail: "Local note ingestion · 1d ago", kind: "episode" },

  // Facts
  { text: "Aurora Due Wed", detail: "Commitment · confidence 0.88", kind: "fact" },
  { text: "Marcus = Realtor", detail: "Extracted fact · 5d ago", kind: "fact" },
  { text: "Sara's new phone", detail: "Updated contact attribute", kind: "fact" },
  { text: "Flight UA 244", detail: "Travel confirmation · Aug 24", kind: "fact" },
  { text: "Priya's new job", detail: "Extracted Fact · PM at Google", kind: "fact" },
  { text: "Owe Jane reply", detail: "Open loop · 3d overdue", kind: "fact" },
  { text: "Elena in Berlin", detail: "Extracted fact · Location", kind: "fact" },
  { text: "Rent due July 1", detail: "Commitment · Monthly loop", kind: "fact" },
  { text: "Aurora budget: $50k", detail: "Extracted Fact · Financial", kind: "fact" },
  { text: "Call Dr. A on Fri", detail: "Commitment · Pending call", kind: "fact" },
];

/** Mirrors MemoryScene's TOKEN_COUNT (12). Each travels an edge carrying a real
 * piece of memory — an episode, a fact, a briefing, a commitment, a conflict. */
const TOKEN_META: { text: string; kind: string }[] = [
  { text: "Lunch with Sara", kind: "episode" },
  { text: "Marcus → Sara's realtor", kind: "fact" },
  { text: "Prep: Aurora review", kind: "briefing" },
  { text: "Kickoff moved to Thu", kind: "fact" },
  { text: "Coffee with Raju", kind: "episode" },
  { text: "Draft due Wednesday", kind: "commitment" },
  { text: "Mom's birthday · Aug 14", kind: "fact" },
  { text: "Priya started a new role", kind: "episode" },
  { text: "Sara's number changed", kind: "conflict" },
  { text: "You owe Jane a reply", kind: "commitment" },
  { text: "Meeting in 15 min", kind: "briefing" },
  { text: "Call with Dr. Alvarez", kind: "episode" },
];

/** Mirrors MemoryScene.edgeLabels (same order) so edge relationship annotations
 * can float directly on the connecting lines in the 3D scene. */
const EDGE_LABELS_META: { text: string; kind: "email" | "meeting" | "system" | "conflict" }[] = [
  { text: "emailed", kind: "email" },
  { text: "met w/", kind: "meeting" },
  { text: "co-occurred", kind: "system" },
  { text: "owes draft", kind: "conflict" },
  { text: "calls", kind: "email" },
  { text: "referenced in", kind: "system" },
  { text: "collaborated", kind: "system" },
  { text: "contradicts", kind: "conflict" },
  { text: "shared file", kind: "system" },
  { text: "mentioned in", kind: "email" },
  { text: "assigned", kind: "system" },
  { text: "scheduled", kind: "meeting" },
  { text: "follows", kind: "system" },
  { text: "discussed", kind: "meeting" },
  { text: "works with", kind: "system" },
];

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function Landing() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const tokenRefs = useRef<Array<HTMLDivElement | null>>([]);
  const edgeLabelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);

  const { status } = useAuth();
  const isAuthed = status === "authenticated";
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(mq.matches);
    const onChange = () => setPrefersReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (prefersReduced || !canvasRef.current) return;
    let scene: import("./MemoryScene").MemoryScene | null = null;
    let raf = 0;
    let alive = true;
    let progress = 0;

    const readScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };

    const paint = () => {
      // Panels: cross-fade + slide.
      for (let i = 0; i < ACTS; i++) {
        const el = panelRefs.current[i];
        if (!el) continue;
        const local = (progress - i / ACTS) * ACTS;
        const fadeIn = i === 0 ? 1 : smoothstep(0, 0.3, local);
        const fadeOut = i === ACTS - 1 ? 1 : 1 - smoothstep(0.7, 1, local);
        const opacity = Math.max(0, Math.min(1, fadeIn * fadeOut));
        const ty = (0.5 - Math.max(0, Math.min(1, local))) * 64;
        const blur = (1 - opacity) * 5;
        el.style.opacity = String(opacity);
        el.style.transform = `translate3d(0, ${ty}px, 0)`;
        el.style.filter = blur > 0.05 ? `blur(${blur}px)` : "none";
        el.style.pointerEvents = opacity > 0.6 ? "auto" : "none";
      }
      // Graph label chips + traveling meaning-tokens from projected coords.
      if (scene) {
        const ls = scene.labelScreens;
        for (let i = 0; i < labelRefs.current.length; i++) {
          const el = labelRefs.current[i];
          const p = ls[i];
          if (!el || !p) continue;
          el.style.opacity = String(p.opacity);
          el.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        }
        const ts = scene.tokenScreens;
        for (let i = 0; i < tokenRefs.current.length; i++) {
          const el = tokenRefs.current[i];
          const p = ts[i];
          if (!el || !p) continue;
          el.style.opacity = String(p.opacity);
          el.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        }
        const els = scene.edgeLabelScreens;
        for (let i = 0; i < edgeLabelRefs.current.length; i++) {
          const el = edgeLabelRefs.current[i];
          const p = els[i];
          if (!el || !p) continue;
          el.style.opacity = String(p.opacity);
          el.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        }
      }
      // Dots.
      const activeAct = Math.min(ACTS - 1, Math.round(progress * ACTS - 0.001));
      for (let i = 0; i < ACTS; i++) {
        const d = dotRefs.current[i];
        if (d) d.dataset.active = String(i === activeAct);
      }
      // Chrome.
      if (hintRef.current) hintRef.current.style.opacity = String(Math.max(0, 1 - progress * 12));
      if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`;
      const show = smoothstep(0.34, 0.46, progress) * (1 - smoothstep(0.82, 0.92, progress));
      if (legendRef.current) {
        legendRef.current.style.opacity = String(show);
      }
    };

    const onResize = () => scene?.resize(window.innerWidth, window.innerHeight);
    const onScroll = () => readScroll();
    const onMouseMove = (e: MouseEvent) => {
      if (scene) {
        const x = (e.clientX / window.innerWidth) * 2 - 1;
        const y = -(e.clientY / window.innerHeight) * 2 + 1;
        scene.setMouse(x, y);
      }
    };

    (async () => {
      const { MemoryScene } = await import("./MemoryScene");
      if (!alive || !canvasRef.current) return;
      scene = new MemoryScene(canvasRef.current);
      scene.init();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize);
      window.addEventListener("mousemove", onMouseMove, { passive: true });
      readScroll();
      const loop = () => {
        if (!scene) return;
        scene.update(progress);
        scene.render();
        paint();
        raf = requestAnimationFrame(loop);
      };
      loop();
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      scene?.destroy();
    };
  }, [prefersReduced]);

  const jumpToAct = (i: number) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: (i / ACTS) * max + 1, behavior: "smooth" });
  };

  const ctaHref = isAuthed ? "/app" : "/register";
  const ctaLabel = isAuthed ? "Open Mnemosyne" : "Try it";
  const setPanel = (i: number) => (el: HTMLDivElement | null) => {
    panelRefs.current[i] = el;
  };
  const num = (n: number) => String(n).padStart(2, "0");

  return (
    <div className={prefersReduced ? "landing-root landing-stacked" : "landing-root landing-pinned"}>
      <canvas ref={canvasRef} aria-hidden className="landing-canvas" />
      <div aria-hidden className="landing-scrim" />

      {/* Top progress bar. */}
      <div aria-hidden className="landing-progress">
        <div ref={barRef} className="landing-progress-fill" />
      </div>

      {/* Top bar. */}
      <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-6 py-5 md:px-10">
        <span className="text-serif text-[18px] font-semibold italic tracking-tight">Mnemosyne</span>
        <Link
          href={isAuthed ? "/app" : "/login"}
          className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover-underline hover:text-foreground"
        >
          {isAuthed ? "Open" : "Sign in"}
        </Link>
      </header>

      {/* Projected graph label chips (HTML over the canvas). */}
      <div aria-hidden className="landing-labels">
        {LANDING_LABELS.map((l, i) => (
          <div
            key={l.text}
            ref={(el) => {
              labelRefs.current[i] = el;
            }}
            className={`landing-label landing-label--${l.kind}`}
          >
            <span className="landing-label-dot" />
            <div className="landing-label-content">
              <span className="landing-label-title">{l.text}</span>
              {l.detail && <span className="landing-label-details">{l.detail}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Traveling meaning-tokens (episodes / facts / briefings firing along edges). */}
      <div aria-hidden className="landing-tokens">
        {TOKEN_META.map((t, i) => (
          <div
            key={t.text}
            ref={(el) => {
              tokenRefs.current[i] = el;
            }}
            className="landing-token"
            data-kind={t.kind}
          >
            <span className="landing-token-dot" />
            <span className="landing-token-kind">{t.kind}</span>
            {t.text}
          </div>
        ))}
      </div>

      {/* Projected graph edge relationship labels. */}
      <div aria-hidden className="landing-edge-labels">
        {EDGE_LABELS_META.map((el, i) => (
          <div
            key={i}
            ref={(domEl) => {
              edgeLabelRefs.current[i] = domEl;
            }}
            className={`landing-edge-label landing-edge-label--${el.kind}`}
          >
            {el.text}
          </div>
        ))}
      </div>

      {/* Data legend (visible while the graph is on screen). */}
      <div ref={legendRef} aria-hidden className="landing-legend">
        <span><i className="lg-dot lg-people" /> People</span>
        <span><i className="lg-dot lg-episode" /> Episodes</span>
        <span><i className="lg-dot lg-fact" /> Facts</span>
      </div>

      {/* Right-rail act dots. */}
      <nav aria-label="Sections" className="fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 md:flex">
        {ACT_LABELS.map((label, i) => (
          <button
            key={label}
            ref={(el) => {
              dotRefs.current[i] = el;
            }}
            onClick={() => jumpToAct(i)}
            className="landing-dot"
            title={label}
            aria-label={label}
          />
        ))}
      </nav>

      <div className="landing-panels">
        {/* Act 1 */}
        <div ref={setPanel(0)} className="landing-panel">
          <div className="landing-col">
            <p className="landing-kicker">
              <span className="landing-num">{num(1)}</span>
              <span aria-hidden className="size-1.5 rounded-full bg-[var(--ochre)]" />
              A memory that earns your trust
            </p>
            <h1 className="landing-heading text-serif text-[44px] font-semibold italic leading-[1.04] tracking-tight md:text-[72px]">
              Your life is data.
              <br />
              It can&apos;t tell you what it knows.
            </h1>
            <p className="landing-sub">Mnemosyne can. Scroll to watch it remember.</p>
          </div>
          <div ref={hintRef} className="landing-hint">
            <span>Scroll</span>
            <span aria-hidden className="landing-hint-line" />
          </div>
        </div>

        {/* Act 2 */}
        <div ref={setPanel(1)} className="landing-panel">
          <div className="landing-col">
            <p className="landing-kicker">
              <span className="landing-num">{num(2)}</span> Reads
            </p>
            <h2 className="landing-heading text-serif text-[34px] font-semibold italic leading-[1.08] tracking-tight md:text-[54px]">
              Connect once.
              <br />
              The rest is invisible.
            </h2>
            <p className="landing-sub">
              Gmail, Calendar, Contacts — paced, retried, read-only. Nothing is ever written back.
              Each message becomes an <em>episode</em>; each person, a node.
            </p>
          </div>
        </div>

        {/* Act 3 */}
        <div ref={setPanel(2)} className="landing-panel">
          <div className="landing-col">
            <p className="landing-kicker">
              <span className="landing-num">{num(3)}</span> Remembers
            </p>
            <h2 className="landing-heading text-serif text-[34px] font-semibold italic leading-[1.08] tracking-tight md:text-[54px]">
              A graph, not a database.
            </h2>
            <p className="landing-sub">
              People, places, projects — clustered by how they relate to you. Episodes fire across
              the edges; facts settle onto the people they describe. This is the memory, alive.
            </p>
          </div>
        </div>

        {/* Act 4 */}
        <div ref={setPanel(3)} className="landing-panel">
          <div className="landing-split">
            <div className="landing-col">
              <p className="landing-kicker">
                <span className="landing-num">{num(4)}</span> Cites
              </p>
              <h2 className="landing-heading text-serif text-[32px] font-semibold italic leading-[1.08] tracking-tight md:text-[46px]">
                Every claim,
                <br />
                traceable to its sentence.
              </h2>
              <p className="landing-sub">
                No source — it says so. Provenance enforced at the schema level. The discipline to
                forget, made operable.
              </p>
            </div>
            <div className="trace-card">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
                Extraction trace · Sara Lin
              </p>
              <p className="mt-3 text-serif text-[18px] font-medium italic leading-snug text-foreground">
                &ldquo;send me the draft by Wednesday&rdquo;
              </p>
              <div className="my-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                <span aria-hidden className="h-px flex-1 bg-border" />
                derives
                <span aria-hidden className="h-px flex-1 bg-border" />
              </div>
              <p className="text-[14px] leading-snug text-foreground">
                owes Sara · a draft of <em>Project Aurora</em> · due Wednesday
              </p>
              <p className="mt-4 text-[11.5px] text-muted-foreground">
                Reinforced 2× · last seen 5 days ago · confidence 0.88
              </p>
            </div>
          </div>
        </div>

        {/* Act 5 */}
        <div ref={setPanel(4)} className="landing-panel">
          <div className="landing-split">
            <div className="landing-col">
              <p className="landing-kicker">
                <span className="landing-num">{num(5)}</span> Interrupts
              </p>
              <h2 className="landing-heading text-serif text-[32px] font-semibold italic leading-[1.08] tracking-tight md:text-[46px]">
                Rare. And right.
              </h2>
              <p className="landing-sub">
                Open loops going stale, commitments approaching, contradictions worth resolving —
                surfaced with reasoning, snoozable, quiet by default.
              </p>
            </div>
            <div className="nudge-card">
              <div className="flex items-start gap-3">
                <span aria-hidden className="mt-1 size-2 rounded-full bg-[var(--ochre)] shadow-[0_0_12px_var(--ochre)]" />
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-primary">
                    Commitment · due in 2 days
                  </p>
                  <p className="mt-1.5 text-[15px] font-medium leading-snug text-foreground">
                    You owe Sara: Aurora draft
                  </p>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    Surfaced because an email from Sara said &ldquo;send me the draft by Wednesday.&rdquo;
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Act 6 */}
        <div ref={setPanel(5)} className="landing-panel">
          <div className="landing-col landing-col--center">
            <p className="landing-kicker justify-center">
              <span className="landing-num">{num(6)}</span> The thesis
            </p>
            <h2 className="landing-heading text-serif text-[44px] font-semibold italic leading-[1.04] tracking-tight md:text-[68px]">
              Build the memory,
              <br />
              not the notebook.
            </h2>
            <p className="landing-sub mx-auto text-center">
              With the discipline to forget, the humility to cite, and the courage to interrupt.
            </p>
            <Link href={ctaHref} className="cta-button mt-10">
              {ctaLabel}
            </Link>
            <p className="mt-6 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Read-only · Cited · Built on Qwen
            </p>
          </div>
        </div>
      </div>

      {!prefersReduced && <div aria-hidden className="h-[600vh]" />}
    </div>
  );
}
