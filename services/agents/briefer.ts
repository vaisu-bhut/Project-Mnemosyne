import { sql } from "kysely";
import { clearAgentEntries, writeBlackboard, type Db } from "../db/index.js";
import type { TextGenerator } from "../llm/index.js";
import { decryptText } from "../auth/crypto.js";
import { relationshipHealth, type OpenThread } from "./people.js";

export interface BrieferDeps {
  db: Db;
  generator: TextGenerator;
  /** Key to decrypt sensitive-tier episode bodies at rest (optional). */
  encKey?: string;
}

export interface BriefInteraction {
  episodeId: string;
  title: string | null;
  occurredAt: Date;
  snippet: string | null;
}

export interface BriefFact {
  statement: string;
  episodeId: string;
}

export interface Briefing {
  entityId: string;
  name: string;
  aliases: string[];
  summary: string | null;
  closeness: number | null;
  lastContactAt: Date | null;
  daysSinceContact: number | null;
  interactions: number;
  recentInteractions: BriefInteraction[];
  openThreads: OpenThread[];
  recentFacts: BriefFact[];
  suggestedQuestions: string[];
}

function snippet(body: string | null, max = 160): string | null {
  if (!body) return null;
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Pre-meeting briefing for a person: who they are, your last interactions,
 * open threads, recent facts, and suggested questions. The killer feature from
 * the dossier, here triggered by entity (calendar-triggered comes with the
 * calendar connector).
 */
export async function briefEntity(
  deps: BrieferDeps,
  userId: string,
  entityId: string,
  now = new Date(),
): Promise<Briefing> {
  const { db } = deps;

  const entity = await db
    .selectFrom("entities")
    .select(["id", "canonical_name", "aliases", "attrs", "closeness"])
    .where("id", "=", entityId)
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();

  const health = await relationshipHealth(db, userId, entityId, now);

  const interactions = await sql<{
    id: string;
    title: string | null;
    occurred_at: Date;
    body: string | null;
    meta: Record<string, unknown>;
  }>`
    SELECT DISTINCT ON (ep.id) ep.id, ep.title, ep.occurred_at, ep.body, ep.meta
    FROM edges e
    JOIN episodes ep ON ep.id = e.dst_id
    WHERE e.user_id = ${userId} AND e.src_id = ${entityId} AND e.rel = 'mentioned_in'
    ORDER BY ep.id, ep.occurred_at DESC
  `.execute(db);
  const readBody = (body: string | null, meta: Record<string, unknown>): string | null => {
    if (body == null) return null;
    if (meta.encrypted !== true) return body;
    if (!deps.encKey) return null;
    try {
      return decryptText(body, deps.encKey);
    } catch {
      return null;
    }
  };
  const recentInteractions = interactions.rows
    .sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime())
    .slice(0, 3)
    .map((r) => ({ episodeId: r.id, title: r.title, occurredAt: r.occurred_at, snippet: snippet(readBody(r.body, r.meta)) }));

  const facts = await db
    .selectFrom("facts")
    .select(["statement", "source_episode"])
    .where("user_id", "=", userId)
    .where("subject_id", "=", entityId)
    .where("status", "=", "active")
    .orderBy("reinforced", "desc")
    .orderBy("learned_at", "desc")
    .limit(5)
    .execute();
  const recentFacts = facts.map((f) => ({ statement: f.statement, episodeId: f.source_episode }));

  const summary =
    typeof entity.attrs.summary === "string" ? entity.attrs.summary : null;

  const suggestedQuestions = await suggestQuestions(deps, entity.canonical_name, health.openThreads, recentFacts, summary);

  return {
    entityId: entity.id,
    name: entity.canonical_name,
    aliases: entity.aliases,
    summary,
    closeness: entity.closeness,
    lastContactAt: health.lastContactAt,
    daysSinceContact: health.daysSinceContact,
    interactions: health.interactions,
    recentInteractions,
    openThreads: health.openThreads,
    recentFacts,
    suggestedQuestions,
  };
}

export interface UpcomingBriefing {
  eventId: string;
  eventTitle: string | null;
  eventStart: Date;
  briefing: Briefing;
}

/**
 * Time-triggered pre-meeting briefings. Finds upcoming `calendar_event`
 * episodes within `withinHours`, and for each attendee (a linked person)
 * assembles a briefing. With `post`, writes each to the blackboard as a salient
 * "briefing" entry that expires when the meeting starts — the dossier's
 * auto-generated pre-meeting brief.
 */
export async function upcomingBriefings(
  deps: BrieferDeps,
  userId: string,
  opts: { withinHours?: number; now?: Date; post?: boolean } = {},
): Promise<UpcomingBriefing[]> {
  const now = opts.now ?? new Date();
  const until = new Date(now.getTime() + (opts.withinHours ?? 24) * 3_600_000);

  const events = await deps.db
    .selectFrom("episodes")
    .select(["id", "title", "occurred_at"])
    .where("user_id", "=", userId)
    .where("kind", "=", "calendar_event")
    .where("occurred_at", ">=", now)
    .where("occurred_at", "<=", until)
    .orderBy("occurred_at", "asc")
    .execute();

  if (opts.post) await clearAgentEntries(deps.db, userId, "briefer");

  const out: UpcomingBriefing[] = [];
  for (const ev of events) {
    const attendees = await deps.db
      .selectFrom("edges")
      .innerJoin("entities", "entities.id", "edges.src_id")
      .select(["entities.id as id", "entities.canonical_name as name"])
      .where("edges.user_id", "=", userId)
      .where("edges.dst_id", "=", ev.id)
      .where("edges.rel", "=", "mentioned_in")
      .where("entities.type", "=", "person")
      .execute();

    for (const a of attendees) {
      const briefing = await briefEntity(deps, userId, a.id, now);
      out.push({ eventId: ev.id, eventTitle: ev.title, eventStart: ev.occurred_at, briefing });
      if (opts.post) {
        await writeBlackboard(deps.db, {
          userId,
          kind: "briefing",
          agent: "briefer",
          title: `Prep for "${ev.title}" with ${a.name}`,
          body: briefing.suggestedQuestions.map((q) => `• ${q}`).join("\n"),
          entityId: a.id,
          salience: 0.85,
          payload: { eventId: ev.id, eventTitle: ev.title, eventStart: ev.occurred_at },
          expiresAt: ev.occurred_at,
        });
      }
    }
  }
  return out;
}

async function suggestQuestions(
  deps: BrieferDeps,
  name: string,
  threads: OpenThread[],
  facts: BriefFact[],
  summary: string | null,
): Promise<string[]> {
  if (deps.generator.available) {
    const context = [
      summary ? `About ${name}: ${summary}` : "",
      ...threads.map((t) => `Open thread (${t.direction}): ${t.description}`),
      ...facts.map((f) => `Fact: ${f.statement}`),
    ]
      .filter(Boolean)
      .join("\n");
    const raw = await deps.generator.generateText(
      `You're prepping me to see ${name}. From this context, suggest 3 short, specific questions I could ask them. One per line, no numbering.\n\n${context || "(little is known)"}`,
    );
    const qs = raw
      .split("\n")
      .map((l) => l.replace(/^[\s\-*\d.]+/, "").trim())
      .filter(Boolean);
    if (qs.length) return qs.slice(0, 5);
  }

  // Deterministic fallback.
  const qs: string[] = [];
  for (const t of threads) {
    qs.push(t.direction === "i_owe" ? `Did I follow up on: ${t.description}?` : `Any update on: ${t.description}?`);
  }
  for (const f of facts.slice(0, 3)) qs.push(`Ask about: ${f.statement}`);
  return qs.length ? qs : [`What's new with ${name}?`];
}
