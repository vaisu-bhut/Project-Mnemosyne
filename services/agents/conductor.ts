import { sql } from "kysely";
import { listMind, type Db } from "../db/index.js";
import type { Embedder } from "../embeddings/index.js";
import type { TextGenerator } from "../llm/index.js";
import { ask } from "../memory/retrieve.js";
import { briefEntity } from "./briefer.js";
import { relationshipAlerts } from "./people.js";

export interface ConductorDeps {
  db: Db;
  queryEmbedder: Embedder;
  generator: TextGenerator;
}

export type Intent = "recall" | "briefing" | "people" | "nudges";

export interface RouteResult {
  intent: Intent;
  via: string;
  result: unknown;
}

const BRIEFING_RE = /\b(brief|briefing|prep|prepare|meeting with|about to (?:see|meet)|catch me up)\b/i;
const NUDGES_RE = /\b(nudge|on my mind|what should i|surface|what'?s up|to ?do|remind)\b/i;
const PEOPLE_RE = /\b(relationship|haven'?t (?:talked|spoken)|(?:out of|lost|in) touch|how long since|reconnect|fallen out|drifted)\b/i;
const PROPER_NOUN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;

function classify(query: string): Intent {
  if (BRIEFING_RE.test(query)) return "briefing";
  if (PEOPLE_RE.test(query)) return "people";
  if (NUDGES_RE.test(query)) return "nudges";
  return "recall";
}

async function findEntityByName(
  db: Db,
  userId: string,
  name: string,
): Promise<{ id: string } | undefined> {
  const res = await sql<{ id: string }>`
    SELECT id FROM entities
    WHERE user_id = ${userId}
      AND (lower(canonical_name) = lower(${name})
           OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(a) = lower(${name})))
    LIMIT 1
  `.execute(db);
  return res.rows[0];
}

/**
 * The Conductor: route a user's query to the right agent (or fall back to
 * recall). A deliberately simple keyword router for now — a drop-in LLM
 * classifier is the obvious upgrade. Agents never call each other directly; the
 * Conductor and the blackboard are the only coordination points.
 */
export async function route(
  deps: ConductorDeps,
  userId: string,
  query: string,
): Promise<RouteResult> {
  const intent = classify(query);

  if (intent === "nudges") {
    return { intent, via: "blackboard", result: await listMind(deps.db, userId, 10) };
  }

  if (intent === "people") {
    return { intent, via: "people", result: await relationshipAlerts(deps.db, userId) };
  }

  if (intent === "briefing") {
    for (const name of query.match(PROPER_NOUN) ?? []) {
      const entity = await findEntityByName(deps.db, userId, name);
      if (entity) {
        return { intent, via: "briefer", result: await briefEntity(deps, userId, entity.id) };
      }
    }
    // No known person named — fall back to recall.
    return {
      intent: "recall",
      via: "fallback",
      result: await ask(
        { db: deps.db, embedder: deps.queryEmbedder, generator: deps.generator },
        userId,
        query,
      ),
    };
  }

  return {
    intent: "recall",
    via: "librarian",
    result: await ask(
      { db: deps.db, embedder: deps.queryEmbedder, generator: deps.generator },
      userId,
      query,
    ),
  };
}
