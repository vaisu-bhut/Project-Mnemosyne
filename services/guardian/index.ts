import { listSources, type Db } from "../db/index.js";

/**
 * The Guardian: privacy compartments. It decides which sources' content may be
 * surfaced in a given context, enforcing the dossier's "some sources are sacred"
 * rule and work/guest modes. v1 gates *retrieval* (facts + episodes, which carry
 * source_id); action-level vetoes arrive with the Drafter.
 */
export type Mode = "default" | "work" | "guest" | "external";

export interface AccessContext {
  mode?: Mode;
  /** In default mode, set false to also hide sensitive sources. */
  includeSensitive?: boolean;
}

export interface Visibility {
  mode: Mode;
  /** Source ids whose content must be hidden in this context. */
  deniedSourceIds: string[];
}

/**
 * Resolve which of a user's sources are off-limits for this context:
 *   - guest:    hide every sensitive source (a visitor sees only safe context).
 *   - work:     firewall everything not scoped 'work' (no personal/health leakage).
 *   - external: the consent layer — deny everything by default; only sources the
 *               user explicitly scoped 'shareable' may leave the system. Ingested
 *               third-party content (a friend's email) is non-shareable unless
 *               opted in.
 *   - default:  show all, unless includeSensitive === false.
 */
export async function resolveVisibility(
  db: Db,
  userId: string,
  ctx: AccessContext = {},
): Promise<Visibility> {
  const mode = ctx.mode ?? "default";
  const sources = await listSources(db, userId);

  const denied = sources
    .filter((s) => {
      if (mode === "guest") return s.sensitive;
      if (mode === "work") return s.scope !== "work";
      if (mode === "external") return s.scope !== "shareable";
      return ctx.includeSensitive === false ? s.sensitive : false;
    })
    .map((s) => s.id);

  return { mode, deniedSourceIds: denied };
}
