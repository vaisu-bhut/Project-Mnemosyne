import { sql } from "kysely";
import { clearAgentEntries, writeBlackboard, type Db } from "../db/index.js";
import type { TextGenerator } from "../llm/index.js";
import { relationshipHealth, type OpenThread, type RelationshipTrend } from "./people.js";

export interface BrieferDeps {
  db: Db;
  generator: TextGenerator;
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
  /** Contact cadence (used-to-talk vs. now). */
  trend: RelationshipTrend;
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
  }>`
    SELECT DISTINCT ON (ep.id) ep.id, ep.title, ep.occurred_at, ep.body
    FROM edges e
    JOIN episodes ep ON ep.id = e.dst_id
    WHERE e.user_id = ${userId} AND e.src_id = ${entityId} AND e.rel = 'mentioned_in'
    ORDER BY ep.id, ep.occurred_at DESC
  `.execute(db);
  const recentInteractions = interactions.rows
    .sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime())
    .slice(0, 3)
    .map((r) => ({ episodeId: r.id, title: r.title, occurredAt: r.occurred_at, snippet: snippet(r.body) }));

  // Facts about this person — whether they're the subject OR the object, so
  // "Raju said Sarah needs help with her car" surfaces in Sarah's briefing too.
  const facts = await db
    .selectFrom("facts")
    .select(["statement", "source_episode"])
    .where("user_id", "=", userId)
    .where((eb) => eb.or([eb("subject_id", "=", entityId), eb("object_id", "=", entityId)]))
    .where("status", "=", "active")
    .orderBy("reinforced", "desc")
    .orderBy("learned_at", "desc")
    .limit(5)
    .execute();
  const recentFacts = facts.map((f) => ({ statement: f.statement, episodeId: f.source_episode }));

  const summary =
    typeof entity.attrs.summary === "string" ? entity.attrs.summary : null;

  const suggestedQuestions = Array.isArray(entity.attrs.suggestedQuestions)
    ? (entity.attrs.suggestedQuestions as string[])
    : suggestQuestionsFallback(entity.canonical_name, health.openThreads, recentFacts);

  return {
    entityId: entity.id,
    name: entity.canonical_name,
    aliases: entity.aliases,
    summary,
    closeness: entity.closeness,
    lastContactAt: health.lastContactAt,
    daysSinceContact: health.daysSinceContact,
    interactions: health.interactions,
    trend: health.trend,
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
  /** One briefing per attendee who resolves to a person — the whole meeting. */
  attendees: Briefing[];
}

/**
 * Time-triggered pre-meeting briefings, framed per meeting. Finds upcoming
 * `calendar_event` episodes within `withinHours`, and for each assembles a
 * briefing for every attendee who resolves to a person. With `post`, writes one
 * salient "briefing" entry per meeting (all attendees together) that expires
 * when the meeting starts — the dossier's auto-generated pre-meeting brief.
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
    const people = await deps.db
      .selectFrom("edges")
      .innerJoin("entities", "entities.id", "edges.src_id")
      .select(["entities.id as id", "entities.canonical_name as name"])
      .where("edges.user_id", "=", userId)
      .where("edges.dst_id", "=", ev.id)
      .where("edges.rel", "=", "mentioned_in")
      .where("entities.type", "=", "person")
      .execute();

    if (people.length === 0) continue; // a meeting with no known attendees has nothing to brief

    const attendees: Briefing[] = [];
    for (const p of people) {
      attendees.push(await briefEntity(deps, userId, p.id, now));
    }
    out.push({ eventId: ev.id, eventTitle: ev.title, eventStart: ev.occurred_at, attendees });

    if (opts.post) {
      const names = attendees.map((a) => a.name);
      const who = names.length <= 2 ? names.join(" & ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
      // Lead with each attendee's top suggested question.
      const body = attendees
        .map((a) => `${a.name}: ${a.suggestedQuestions[0] ?? "What's new?"}`)
        .join("\n");
      await writeBlackboard(deps.db, {
        userId,
        kind: "briefing",
        agent: "briefer",
        title: `Prep for "${ev.title}" with ${who}`,
        body,
        // Link to the single attendee when there's only one; ambiguous otherwise.
        entityId: attendees.length === 1 ? attendees[0]!.entityId : null,
        salience: 0.85,
        payload: {
          eventId: ev.id,
          eventTitle: ev.title,
          eventStart: ev.occurred_at,
          attendeeIds: attendees.map((a) => a.entityId),
        },
        expiresAt: ev.occurred_at,
      });
    }
  }
  return out;
}

function suggestQuestionsFallback(
  name: string,
  threads: OpenThread[],
  facts: BriefFact[],
): string[] {
  // Deterministic fallback.
  const qs: string[] = [];
  for (const t of threads) {
    qs.push(t.direction === "i_owe" ? `Did I follow up on: ${t.description}?` : `Any update on: ${t.description}?`);
  }
  for (const f of facts.slice(0, 3)) qs.push(`Ask about: ${f.statement}`);
  return qs.length ? qs : [`What's new with ${name}?`];
}
