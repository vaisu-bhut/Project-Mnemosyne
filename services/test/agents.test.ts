import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createOpenLoop,
  createSource,
  insertEdge,
  insertEpisode,
  insertFact,
  listMind,
  upsertEntity,
  type Source,
} from "../db/index.js";
import { createQueryEmbedder } from "../embeddings/index.js";
import { createGenerator } from "../llm/index.js";
import {
  briefEntity,
  relationshipAlerts,
  relationshipHealth,
  route,
  runNudger,
  upcomingBriefings,
} from "../agents/index.js";
import { devConfig, seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
const queryEmbedder = createQueryEmbedder(devConfig);
const generator = createGenerator(devConfig);

let userId: string;
beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
});
afterAll(() => db.destroy());

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

/** Person entity with `n` interactions, the most recent `recentDays` ago. */
async function person(source: Source, name: string, n: number, recentDays: number) {
  const e = await upsertEntity(db, { userId, type: "person", canonicalName: name });
  for (let i = 0; i < n; i++) {
    const ep = await insertEpisode(db, {
      userId,
      occurredAt: daysAgo(recentDays + i * 7),
      sourceId: source.id,
      externalId: `${name}-${i}`,
      kind: "note",
      title: `note ${i}`,
      body: `talked with ${name}`,
    });
    await insertEdge(db, { userId, srcId: e.id, dstId: ep.id, rel: "mentioned_in" });
  }
  return e;
}

describe("People agent", () => {
  it("computes relationship health and flags stale contacts", async () => {
    const source = await createSource(db, { userId, kind: "test", displayName: "t" });
    const recent = await person(source, "Recent Rita", 2, 2);
    const stale = await person(source, "Stale Sam", 3, 60);

    const ritaHealth = await relationshipHealth(db, userId, recent.id);
    expect(ritaHealth.interactions).toBe(2);
    expect(ritaHealth.daysSinceContact).toBeLessThan(10);

    const alerts = await relationshipAlerts(db, userId, { staleDays: 30 });
    expect(alerts.map((a) => a.entityId)).toContain(stale.id);
    expect(alerts.map((a) => a.entityId)).not.toContain(recent.id);
  });
});

describe("Nudger", () => {
  it("writes salient open-loop and relationship entries to the blackboard", async () => {
    const source = await createSource(db, { userId, kind: "test", displayName: "t" });
    const stale = await person(source, "Cold Casey", 2, 90);
    await createOpenLoop(db, { userId, description: "send Casey the deck", direction: "i_owe", counterparty: stale.id });

    const r = await runNudger(db, userId, { staleDays: 30 });
    expect(r.openLoopNudges).toBe(1);
    expect(r.relationshipAlerts).toBe(1);

    const mind = await listMind(db, userId, 10);
    expect(mind.length).toBe(2);
    expect(new Set(mind.map((m) => m.kind))).toEqual(new Set(["nudge", "alert"]));

    // Idempotent: re-running replaces, doesn't pile up.
    await runNudger(db, userId, { staleDays: 30 });
    expect((await listMind(db, userId, 10)).length).toBe(2);
  });
});

describe("Briefer", () => {
  it("assembles a briefing with interactions, threads, and suggested questions", async () => {
    const source = await createSource(db, { userId, kind: "test", displayName: "t" });
    const sara = await person(source, "Sara Lin", 2, 5);
    const ep = await insertEpisode(db, { userId, occurredAt: daysAgo(5), sourceId: source.id, externalId: "fct", kind: "note" });
    await insertFact(db, { userId, subjectId: sara.id, statement: "Sara is training for a marathon.", sourceEpisode: ep.id, sourceId: source.id });
    await createOpenLoop(db, { userId, description: "send Sara the PT name", direction: "i_owe", counterparty: sara.id });

    const brief = await briefEntity({ db, generator }, userId, sara.id);
    expect(brief.name).toBe("Sara Lin");
    expect(brief.interactions).toBeGreaterThanOrEqual(2);
    expect(brief.recentFacts.some((f) => f.statement.includes("marathon"))).toBe(true);
    expect(brief.openThreads).toHaveLength(1);
    expect(brief.suggestedQuestions.length).toBeGreaterThan(0);
  });
});

describe("Briefer — time-triggered (calendar)", () => {
  it("briefs attendees of upcoming calendar events and posts to the blackboard", async () => {
    const source = await createSource(db, { userId, kind: "gcal", displayName: "Calendar" });
    const sara = await upsertEntity(db, { userId, type: "person", canonicalName: "Sara Lin" });

    // An upcoming event (2h out) with Sara as an attendee.
    const start = new Date(Date.now() + 2 * 3_600_000);
    const ev = await insertEpisode(db, {
      userId,
      occurredAt: start,
      sourceId: source.id,
      externalId: "ev1",
      kind: "calendar_event",
      title: "1:1 with Sara",
    });
    await insertEdge(db, { userId, srcId: sara.id, dstId: ev.id, rel: "mentioned_in" });
    const factEp = await insertEpisode(db, { userId, occurredAt: daysAgo(3), sourceId: source.id, externalId: "p", kind: "note" });
    await insertFact(db, { userId, subjectId: sara.id, statement: "Sara is training for a marathon.", sourceEpisode: factEp.id, sourceId: source.id });

    const briefings = await upcomingBriefings({ db, generator }, userId, { withinHours: 24, post: true });
    expect(briefings).toHaveLength(1);
    expect(briefings[0]!.briefing.name).toBe("Sara Lin");

    const mind = await listMind(db, userId, 10);
    expect(mind.some((m) => m.kind === "briefing" && m.title.includes("1:1 with Sara"))).toBe(true);
  });
});

describe("Conductor", () => {
  it("routes by intent", async () => {
    const source = await createSource(db, { userId, kind: "test", displayName: "t" });
    const sara = await person(source, "Sara Lin", 1, 100);
    await createOpenLoop(db, { userId, description: "x", direction: "i_owe", counterparty: sara.id });

    expect((await route({ db, queryEmbedder, generator }, userId, "prep me for my meeting with Sara Lin")).intent).toBe("briefing");
    expect((await route({ db, queryEmbedder, generator }, userId, "who have I lost touch with?")).intent).toBe("people");
    expect((await route({ db, queryEmbedder, generator }, userId, "what's on my mind?")).intent).toBe("nudges");
    expect((await route({ db, queryEmbedder, generator }, userId, "what did Sara say about Iceland?")).intent).toBe("recall");
  });

  it("falls back to recall when briefing names an unknown person", async () => {
    const r = await route({ db, queryEmbedder, generator }, userId, "brief me on Zxqq Nobody");
    expect(r.intent).toBe("recall");
    expect(r.via).toBe("fallback");
  });
});
