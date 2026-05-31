import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSource, upsertEntity, type Source } from "../db/index.js";
import { createEmbedder, createQueryEmbedder } from "../embeddings/index.js";
import { recordEntity, recordEpisode, recordFact } from "../memory/encode.js";
import { searchMemory } from "../memory/retrieve.js";
import { devConfig, seedUser, testDb, truncateAll } from "./helpers.js";

const db = testDb();
const embedder = createEmbedder(devConfig);
const queryEmbedder = createQueryEmbedder(devConfig);
const QUERY = "QGUARD";

let userId: string;
let subjectId: string;

beforeEach(async () => {
  await truncateAll(db);
  userId = await seedUser(db);
  const subject = await upsertEntity(db, { userId, type: "person", canonicalName: "Subj" });
  subjectId = subject.id;
});
afterAll(() => db.destroy());

async function sourceWithFact(props: {
  displayName: string;
  scope: string;
  sensitive: boolean;
}): Promise<Source> {
  const src = await createSource(db, { userId, kind: "test", ...props });
  const ep = await recordEpisode(
    { db, embedder },
    { userId, occurredAt: new Date(), sourceId: src.id, externalId: "e", kind: "note", body: "b", embedText: QUERY },
  );
  await recordFact(
    { db, embedder },
    { userId, subjectId, statement: `fact from ${props.displayName}`, sourceEpisode: ep.id, sourceId: src.id, embedText: QUERY },
  );
  return src;
}

describe("Guardian — privacy compartments", () => {
  let personal: Source;
  let work: Source;
  let health: Source;

  beforeEach(async () => {
    personal = await sourceWithFact({ displayName: "Personal", scope: "personal", sensitive: false });
    work = await sourceWithFact({ displayName: "Work", scope: "work", sensitive: false });
    health = await sourceWithFact({ displayName: "Therapy", scope: "health", sensitive: true });
  });

  async function visibleSources(ctx: Parameters<typeof searchMemory>[4]): Promise<Set<string | null>> {
    const r = await searchMemory({ db, embedder: queryEmbedder }, userId, QUERY, 10, ctx);
    return new Set(r.facts.map((f) => f.citation.sourceId));
  }

  it("default mode sees every source", async () => {
    const ids = await visibleSources({});
    expect(ids).toEqual(new Set([personal.id, work.id, health.id]));
  });

  it("guest mode hides sensitive sources", async () => {
    const ids = await visibleSources({ mode: "guest" });
    expect(ids.has(health.id)).toBe(false);
    expect(ids).toEqual(new Set([personal.id, work.id]));
  });

  it("work mode firewalls everything not scoped 'work'", async () => {
    const ids = await visibleSources({ mode: "work" });
    expect(ids).toEqual(new Set([work.id]));
  });

  it("default mode can opt out of sensitive sources", async () => {
    const ids = await visibleSources({ includeSensitive: false });
    expect(ids).toEqual(new Set([personal.id, work.id]));
  });

  it("external mode shares only sources scoped 'shareable'", async () => {
    const shareable = await sourceWithFact({ displayName: "Public", scope: "shareable", sensitive: false });
    const ids = await visibleSources({ mode: "external" });
    expect(ids).toEqual(new Set([shareable.id]));
  });

  it("masks entities whose only provenance is a hidden source", async () => {
    const priv = await recordEntity({ db, embedder }, { userId, type: "person", canonicalName: "PrivatePerson", embedText: QUERY });
    const ep = await recordEpisode(
      { db, embedder },
      { userId, occurredAt: new Date(), sourceId: health.id, externalId: "h2", kind: "note", body: "b", embedText: QUERY },
    );
    await recordFact(
      { db, embedder },
      { userId, subjectId: priv.id, statement: "private fact", sourceEpisode: ep.id, sourceId: health.id, embedText: QUERY },
    );

    const def = await searchMemory({ db, embedder: queryEmbedder }, userId, QUERY, 10, {});
    expect(def.entities.some((e) => e.id === priv.id)).toBe(true);

    const guest = await searchMemory({ db, embedder: queryEmbedder }, userId, QUERY, 10, { mode: "guest" });
    expect(guest.entities.some((e) => e.id === priv.id)).toBe(false);
  });
});
