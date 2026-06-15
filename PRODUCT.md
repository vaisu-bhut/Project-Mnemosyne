# Mnemosyne — The Product

> This document is the **north star**. It defines the final product Mnemosyne is meant to
> become, then maps the current build against it honestly: what exists, what's missing, and
> how far the gap is. When a decision is ambiguous, this file wins over convenience.

---

## The one sentence

**A memory that earns your trust: it ingests your work and life, remembers what matters,
forgets on purpose, cites every claim, and interrupts you only when it should.**

## The shape of it

A web app you sign into, connect accounts to, and then mostly stop visiting. The real product
is what happens when you **ask it something** or when it **pings you**. The UI exists to make
the memory legible, not to be lived in.

### Five surfaces (in order of how much the user touches them)

1. **Ask** — one conversational input, available *everywhere*. Every sentence in its reply has
   a citation chip. Clicking a chip opens the source episode in a side panel **with the
   extraction trace underneath** ("from this sentence, I derived this fact, last reinforced 4
   days ago"). This is the heart. If a user only ever uses Ask, the product has succeeded.
2. **Briefings** — before every meeting on your calendar, a briefing already exists: who's
   attending, what you last discussed with each, open loops between you, topical recent email.
   Generated proactively, **waiting** for you ~15 min before — in the app *and as a
   notification*. You never request it.
3. **Nudges** — a small inbox of "things you should know right now": open loops going stale,
   relationship decay, contradictions worth resolving, commitments approaching. Each is
   dismissible, **snoozable**, and shows its reasoning. Must be **rare and right**.
4. **People** — one page per person who matters: last interaction, recent shared context, open
   loops, **sentiment trajectory**, relationship health (how often you used to talk vs. now).
   Not a CRM — a memory of the relationship.
5. **Memory browser** — episodes and facts, searchable, filterable, editable. Where you audit
   and correct: mark a fact stale, retract it, force-forget an episode, **merge two entities**
   the system wrongly split. "The discipline to forget," made operable by the user.

That's the whole product. Five surfaces. Nothing else.

### What feeds it

Capture is **invisible**. Once accounts are connected, ingestion happens; the user never thinks
about it again except in Settings. For v1: **Gmail, Google Calendar, Google Contacts, Outlook
Mail, Outlook Calendar, Outlook Contacts** — all six already wired. (Post-hackathon: Slack,
Notion, GitHub, mobile voice notes. Not now.)

### Three felt behaviors

- **It forgets.** Low-salience facts decay. The user *sees* this — stale markers, decay scores,
  consolidation surfacing a Jan-vs-last-week contradiction and asking which is current.
  Forgetting is visible and consensual, not silent rot.
- **It connects.** Ask about a project and it pulls in the people, meetings, documents, and open
  loops — as a *synthesized answer with the connections drawn*, not a list of search hits.
- **It defers to evidence.** No source → it says so. It does not hallucinate to be helpful.
  Provenance discipline felt as honesty.

### What it explicitly is NOT

- **Not a notes app.** You never write into it. It reads what you already produced.
- **Not a search engine over your data.** "Find emails mentioning Sara" vs. "what's the state of
  my relationship with Sara" — the second is the entire point.
- **Not a chatbot with vector retrieval bolted on.** The episodes/facts/entities/edges
  separation, consolidation, contradiction tracking, provenance enforcement, and Guardian
  compartments *are* the product.
- **Not an assistant that acts.** Read-only on the world. No sending, booking, or editing. The
  **Drafter is cut from v1** — a deliberate trust constraint, stated as a principle, not a TODO.
- **Not ambient.** No mic, screen capture, clipboard, or extension. You bring your existing
  digital exhaust; it makes sense of it.
- **Not multi-user.** One person, their memory. Multi-tenancy is a hosting detail, not sharing.

### The judging-day artifact (the 90 seconds)

Real inbox connected → a question asked → a paragraph answer with four citation chips → one chip
clicked → source email shown **with extraction trace** → back to the dashboard where a **Nudge**
has appeared because the demo email contained a commitment with a deadline. Everything else is in
service of that 90 seconds being undeniable.

---

## Where we are — the honest map

**Structurally, the build is close.** The hard parts (the data model, ingestion across all six
connectors, consolidation, Guardian, the agent mesh, provenance-enforced facts) already exist.
The gap to the vision is mostly **presentational and subtractive** — making provenance and
forgetting the *heroes* of the UI, completing two nudge types, adding notifications, and
publicly cutting the Drafter.

### Scorecard

| # | Surface / behavior | State | ~% | The gap in one line |
|---|--------------------|-------|----|---------------------|
| 1 | **Ask** | Strong, incomplete | **70%** | Inline citation chips → source drawer work; **no extraction trace**; launcher only on 3 pages, not everywhere; no-evidence refusal is *prompted*, not enforced. |
| 2 | **Briefings** | Half | **60%** | Proactive generation + rich content exist; **no notification** ("it pings you" half is absent); briefings are per-attendee, not per-meeting. |
| 3 | **Nudges** | Half | **60%** | Dashboard section, dismiss + reasoning work; **no snooze**, **no dedicated inbox**; only 2 of 4 types (open-loops + decay; **no contradictions, no approaching commitments**); scheduler default-off. |
| 4 | **People** | Strong, incomplete | **70%** | Per-person page with closeness, open loops, recent context; **no sentiment trajectory**; health is a number, not a *trend over time*. (Graph viz intentionally deferred → Phase B.) |
| 5 | **Memory browser** | Strong, incomplete | **65%** | Mark-stale / retract / force-forget all wired; **no entity-merge UI**; decay scores hidden; retention buried in drawer; contradictions only in Settings, not the browser. |
| A | *Behavior:* **It forgets** | Partial | **50%** | Decay→stale + badges exist; decay scores invisible, contradiction-resolution flow not user-facing. |
| B | *Behavior:* **It connects** | Partial | **50%** | Graph traversal + multi-fact retrieval exist; answers aren't visibly "connections drawn"; no graph in UI. |
| C | *Behavior:* **It defers to evidence** | Partial | **60%** | Provenance mandatory in schema (facts require source episode); refusal is prompt-instructed, not guaranteed. |
| — | *Constraint:* **Drafter cut** | **Not yet** | — | Permissions UI still advertises "write/delete coming soon"; vision says remove it and state read-only as principle. |
| — | *Constraint:* **Search demoted** | **Done** | 100% | No top-level Search; lives inside Memory + Ask. ✅ |
| — | *Capture: all six connectors* | **Done** | 100% | Gmail/GCal/GContacts + Outlook mail/cal/contacts wired, paced, retrying. ✅ |

**Rough overall: ~65% of the *product*, ~85% of the *plumbing*.** The remaining 35% is almost
entirely UI/UX surfacing and two backend nudge types — not new architecture.

---

## Per-surface detail

### 1. Ask — the heart (70%)
**Have:** A right-side chat slide-over (`ChatPanel`) with a floating launcher; the assistant's
answer carries inline `[episode:<id>]` markers parsed into **clickable citation chips**
(`lib/citations`, `AnswerText`); clicking a chip opens the **source episode drawer** (the
original email/event/note). Scoped retrieval (`/ask` accepts entity/source/kind + history),
Guardian-filtered.

**Missing vs. vision:**
- **The extraction trace** — the signature interaction. Today a chip → the raw episode. The
  vision wants: *this sentence → this derived fact → last reinforced N days ago*. The data
  exists (facts carry `source_episode`, reinforcement/decay timestamps) but is **not surfaced**.
  This is the single highest-leverage UI to build.
- **Ubiquity** — the launcher is on Dashboard, Memory, and Person pages only. Vision: *available
  everywhere*. Promote it to the app shell.
- **Citation granularity** — markers are placed by the LLM, roughly per-fact, not guaranteed
  per-sentence.
- **Evidence discipline is soft** — the prompt says "if not in context, say you don't have it,"
  but nothing *enforces* it. For "defers to evidence" to be felt as honesty, consider a
  hard guard: if retrieval returns nothing above a threshold, return a fixed "no source in
  memory" answer without calling the generator.

### 2. Briefings (60%)
**Have:** `briefer.ts` proactively builds briefings for upcoming calendar events within a
look-ahead window, writes them to the blackboard with `expiresAt = meeting start`; `/briefings/upcoming`
+ `BriefingView` render attendees, closeness, days-since-contact, recent interactions (with
citations), open threads, recent facts, and suggested questions. Genuinely rich.

**Missing vs. vision:**
- **Notifications.** Nothing pings the user ~15 min before. A briefing only exists if you visit.
  This is the defining property of the surface ("it is just there… and as a notification"). Needs
  a delivery channel — web push / browser notification / email — fired on a schedule.
- **Per-meeting framing.** Today briefings are per-attendee. The vision frames one briefing *per
  meeting* (all attendees + topical email together). Mostly a presentation/aggregation change.
- The scheduled job that posts briefings is gated behind `NUDGER_INTERVAL_MS` (default 0 = off).

### 3. Nudges (60%)
**Have:** Dashboard "On your mind" section renders salience-sorted blackboard entries as cards
with **reasoning** (title + body + agent badge) and a working **dismiss**. Two nudge types:
open-loops (with overdue/ due-soon salience bumps) and relationship decay (>30 days silent,
salience ramps with staleness). Already **precision-tuned** — no speculative spam. Good.

**Missing vs. vision:**
- **Snooze** — dismiss only; no "remind me later."
- **A dedicated inbox** — nudges live as a dashboard section, not the small standalone inbox the
  vision describes (alongside Open Loops, this is close but not framed as *the* nudge surface).
- **Two of four types absent:** **contradictions worth resolving** (the data exists in
  consolidation + `/contradictions`, just not surfaced as nudges) and **approaching commitments**
  (deadline-aware nudges from loops/calendar).
- **Off by default** — `NUDGER_INTERVAL_MS=0`. For the demo it must run.

### 4. People (70%)
**Have:** One page per person (`/people/[id]`) showing last interaction, days-since-contact,
recent shared context (episodes with snippets + citations), open loops by direction, and a
**closeness** health metric + interaction count. List page with cards.

**Missing vs. vision:**
- **Sentiment trajectory** — not implemented anywhere (no sentiment field, calc, or UI). Would
  need lightweight per-episode sentiment during extraction, aggregated over time.
- **Health as a *trend*** — today closeness is a single number. Vision wants "how often you used
  to talk vs. now" — a cadence/trajectory, not a snapshot.
- Graph visualization is **intentionally deferred** to Phase B (already designed; not a gap
  against v1's five surfaces).

### 5. Memory browser (65%)
**Have:** `/memory` with Episodes + Facts tabs. Per-fact **mark-stale**, **edit**, and
**delete/retract** wired; **force-forget episode** from the episode drawer; status filter +
**stale badges** as first-class UI. Retention tier selectable inside the episode drawer.

**Missing vs. vision:**
- **Entity merge** — backend `mergeEntities()` runs only during automatic consolidation. No way
  for the user to say "these two are the same person" (or split a bad merge). The vision calls
  this out explicitly.
- **Decay scores invisible** — facts show status but not *why* (salience/decay). Surfacing a
  decay score makes "it forgets" felt.
- **Contradictions are hidden** — only in Settings, not in the browser where curation happens.
  They should appear as a resolvable item in Memory (and as a nudge — see #3).
- Retention actions are buried one click deep in the drawer.

---

## The changes to land this (subtractive + presentational, mostly)

These are the deltas from "current build" to "the vision," roughly in priority order for the
90-second demo:

1. **Build the extraction-trace panel** (Ask). Chip → source episode → *underneath*: the
   sentence, the fact derived, when last reinforced. This is the signature interaction and the
   conversion moment. **Highest leverage.**
2. **Make Ask ubiquitous.** Move the launcher into the app shell so it's on every page.
3. **Add a notification channel for Briefings + Nudges.** Browser/web push (or email fallback)
   fired on a schedule; turn the scheduler on. Without this, "it pings you" is just "you visit."
4. **Add the two missing nudge types** — contradictions (data already exists) and approaching
   commitments — and add **snooze**.
5. **Cut the Drafter, publicly.** Remove write/delete + "coming soon" from the permissions UI;
   restate read-only as a *principle* in README/Settings, not a limitation. (Keep the schema
   column dormant if useful, but stop advertising it.)
6. **Surface forgetting as first-class UI.** Decay scores on facts, contradictions in the Memory
   browser (resolvable), retention actions one click shallower.
7. **Entity-merge UI** in the Memory browser (merge + split).
8. **Harden evidence discipline.** Hard "no source in memory" path when retrieval is empty,
   instead of trusting the prompt.
9. **People: sentiment + cadence trend** (after the above; lighter priority for the demo).

What's *already* aligned and needs no work: all six connectors, paced rate-limited ingestion,
Search demoted out of top-level nav, provenance enforced at the schema level, Guardian
compartments, the consolidation/decay engine.

---

## Suggestions (where I'd deviate or sequence deliberately)

- **Demo order should mirror the artifact, not the architecture.** Build #1–#3 first; they *are*
  the 90 seconds. #6–#9 deepen the story but won't be on screen in the pitch.
- **Notifications: start with the browser Notifications API + a poll**, not real infra (web-push
  service worker, VAPID, email). It's enough to make "it pings you" true for a logged-in tab in
  the demo, and avoids a day lost to push plumbing. Upgrade later.
- **Extraction trace can reuse what exists.** Facts already link `source_episode` and carry
  reinforcement/decay timestamps — the panel is a *read* over data you have, not new modeling.
  Resist adding new columns before shipping the view.
- **Contradiction nudges are nearly free** — consolidation already flags them; the only work is
  writing them to the blackboard with reasoning. Do this before the harder "approaching
  commitments."
- **Sentiment trajectory is the riskiest small feature.** It's easy to do badly (noisy per-email
  sentiment reads as a gimmick). I'd scope it to a coarse 3-point trend (warming / steady /
  cooling) over a window, or defer it — it's the least load-bearing item in the vision.
- **Drafter: cut it *loudly*.** The trust thesis is stronger as a stated refusal than as an
  unfinished feature. The "write/delete coming soon" badge currently *undercuts* the read-only
  promise. Removing it is a one-screen change with outsized narrative payoff.
- **For the two pitches (AWS vs. Qwen):** keep one codebase, two framings — multi-tenancy
  *in the story* for AWS (production-grade), *hidden* for Qwen (the agent is the point). No code
  fork needed; it's a deck/README decision.

---

*Keep this file in sync with the vision, not the implementation. `CODEBASE_STATE.md` tracks what
the code is; `PRODUCT.md` tracks what it's for.*
