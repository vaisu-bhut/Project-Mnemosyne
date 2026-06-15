# Mnemosyne — Implementation Plan

> From **current code state** (`CODEBASE_STATE.md`) to the **final product** (`PRODUCT.md`).
> The gap is ~35% of the product and mostly **presentational + subtractive** — ~85% of the
> plumbing already exists. Build in **demo order, not architecture order**: Phases 1–3 *are*
> the 90-second pitch; Phases 4–6 deepen the story but are off-screen.

---

## The 90-second artifact we're building toward
Real inbox connected → a question asked → a paragraph answer with citation chips → one chip
clicked → source episode shown **with extraction trace underneath** → back to the dashboard
where a **Nudge** has appeared because the demo email carried a commitment with a deadline.

---

## Phase 1 — The heart: Ask + extraction trace *(highest leverage)*
*Surfaces #1 (Ask); behaviors B (connects) & C (defers to evidence).*

**1.1 Extraction-trace panel — the signature interaction.**
- Backend: add `GET /episodes/:id/trace` in `services/api/server.ts` returning the facts derived
  from an episode (`facts.source_episode`) + each fact's reinforcement/decay timestamps and
  salience. **Pure read over existing columns — add no schema.**
- Frontend: extend the source-episode drawer (`app/src/components/chat/`) to render *underneath*
  the raw episode: *this sentence → this derived fact → last reinforced N days ago*. Reuse
  `lib/citations`.

**1.2 Make Ask ubiquitous.**
- Promote `AskLauncher` from per-page (Dashboard/Memory/People) into the app shell
  (`app/src/app/(app)/layout.tsx`) so it's available on every page.

**1.3 Harden evidence discipline.**
- In `services/memory/retrieve.ts` `ask()`: if scoped retrieval returns nothing above a
  relevance threshold, **short-circuit** with a fixed "no source in memory" answer *without*
  calling the generator. Makes "defers to evidence" a guarantee, not a prompt suggestion.

---

## Phase 2 — Notifications via PWA *(makes "it pings you" true)*  ← **PWA is the default**
*The defining half of Briefings (#2) and Nudges (#3).*

**Decision: ship the app as a PWA from the start.** The demo runs on **browser notifications**
fired from a client poller; the PWA shell (manifest + service worker) is in place from day one so
upgrading to real background Push later is incremental, not a retrofit.

**2.1 PWA shell (default).**
- Add `manifest.webmanifest` (name, icons, theme, `display: standalone`) and register a service
  worker in the Next app (`app/`). Installable; app-shell cached.

**2.2 Browser notifications (demo delivery channel).**
- Request `Notification` permission on first load (post-login).
- A react-query poller (new hook in `app/src/hooks/`) against existing `/briefings/upcoming` and
  `/mind` (blackboard) fires `Notification(...)` for: new briefings (~15 min pre-meeting) and new
  high-salience nudges. De-dupe by id so each fires once.

**2.3 Turn the scheduler on.**
- Set `NUDGER_INTERVAL_MS > 0` (and enable the briefing-posting job) in `services/worker/index.ts`
  config. Currently `0 = off`.

**Deferred (not v1):** real background Push (service-worker `push` + VAPID keys + subscription
store). The PWA shell from 2.1 makes this a clean later addition.

---

## Phase 3 — Nudges: complete the surface
*Nudges (#3) to ~100%.*

- **3.1 Contradiction nudges (nearly free).** Consolidation already flags contradictions
  (`services/consolidate/contradictions.ts`, `/contradictions`). Write them to the blackboard with
  reasoning so they surface as nudges. Do this first.
- **3.2 Approaching-commitment nudges.** Deadline-aware nudges from `open_loops` + calendar
  episodes — new logic in `services/agents/nudger.ts`.
- **3.3 Snooze.** Add alongside dismiss: `/blackboard/:id/snooze` (a `snoozed_until` timestamp on
  the blackboard row) + a UI control on the nudge card.
- **3.4 Dedicated nudge inbox.** Promote the dashboard "On your mind" section into a standalone
  inbox surface.

---

## Phase 4 — Cut the Drafter, loudly *(one-screen change, outsized narrative payoff)*
*The trust constraint.*

- Remove write/delete toggles + "coming soon" from `app/src/components/sources/PermissionsEditor`.
- Restate read-only as a **principle** in README + Settings ("Mnemosyne never writes to your
  accounts").
- Keep dormant schema columns (`permissions.write/delete`) if useful — just stop advertising them.

---

## Phase 5 — Surface forgetting as first-class UI
*Memory browser (#5) and behavior A (it forgets).*

- **Decay scores on facts** — surface salience/decay in `FactsTab` (data exists; hidden today).
- **Contradictions in the Memory browser** — render `/contradictions` as resolvable items in
  `/memory`, not just Settings.
- **Retention one click shallower** — lift retention-tier actions out of the episode drawer.
- **Entity-merge UI** — expose backend `mergeEntities()` (consolidation-only today) as a user
  action in the Memory browser (merge + split a bad merge).

---

## Phase 6 — People depth *(lightest demo priority)*
*People (#4). Scope: ego-centric + temporal depth — NOT a multi-person social graph (see Phase B).*

- **Per-meeting briefing framing** — aggregate per-attendee briefings into one briefing per
  calendar event (`services/agents/briefer.ts` — mostly presentation).
- **Sentiment trajectory (riskiest small feature)** — coarse 3-point trend (warming / steady /
  cooling) over a window, computed during extraction (`services/extract/index.ts`) and aggregated
  on the Person page. **Defer if time-constrained** — least load-bearing item.
- **Health as a trend** — show cadence (used-to-talk vs. now), not a single closeness number.

---

## Already aligned — zero work
All six connectors (Gmail/GCal/GContacts + Outlook mail/cal/contacts), rate-limited ingestion,
Search demoted from top-level nav, schema-level provenance enforcement, Guardian compartments, the
consolidation/decay engine.

---

## Phase B (post-hackathon) — Multi-dimensional people graph
> Parked deliberately. v1 People is **ego-centric and single-dimension**: one scalar `closeness`
> (interaction volume × recency, `services/agents/people.ts`), and edges are **person → your
> episodes** (`rel='mentioned_in'`), not person → person. The richer vision below is *additive* —
> the generic `edges (src,dst,rel,props)` table + depth-1–3 `getNeighbors` traversal already
> support it — but it competes with the trust/provenance story and reads as "CRM," so it waits.

What "multi-dimensional graph" would add, when we build it:
- **Person ↔ person edges** — materialize co-occurrence (two people in one episode) as
  `insertEdge(rel='co_occurs', props={count, lastSeen})` via a consolidation pass.
- **Relation type** (work / family / friends) — LLM classification at extraction, or inferred from
  source/Guardian compartment; stored on `entities` or in `props`.
- **Interests / topic affinity** — promote topics to first-class entities; weighted person → topic
  edges.
- **Multi-dimensional closeness** — replace the single scalar with named sub-scores (frequency,
  recency, reciprocity, topical overlap).
- **Graph visualization** — the deferred Phase-B viz finally has something rich to render.

---

## Open future ideas (not scheduled)
- **Voice-Ask (push-to-talk, read-only)** — speech-to-text on input + text-to-speech on output
  wrapped around the existing `/ask` pipeline. Architecturally free (the memory engine is
  untouched) and on-thesis **as long as it's explicitly invoked, never an always-on mic**
  (the "Not ambient" constraint). Good post-hackathon feature.
- **Voice notes as a source** — a voice note → transcript → episode, like any other connector.
  Named "Not now" in `PRODUCT.md`; fits the model cleanly.
- **Voice-driven drafting / email composition** — reintroduces the **Drafter**, which v1
  deliberately cuts as a trust principle. Defer until the Drafter is intentionally brought back.
  (Read-only "summarize this meeting" via Ask is fine and already in scope.)

---

*Sequencing note: build #1.1 → #1.2 → Phase 2 first; they are the 90 seconds. Phases 4–6 and B
deepen the story but won't be on screen in the pitch.*
