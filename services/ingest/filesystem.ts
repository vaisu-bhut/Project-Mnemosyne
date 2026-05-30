import { promises as fs } from "node:fs";
import path from "node:path";
import type { Connector, PullResult, RawItem } from "./connector.js";

export interface FilesystemConnectorOptions {
  /** Directory to read notes from (recursively). */
  dir: string;
  /** File extensions to include. */
  extensions?: string[];
}

interface Frontmatter {
  title?: string;
  date?: string;
}

/** Parse optional `---`-delimited YAML-ish frontmatter (title/date only). */
function parseFrontmatter(text: string): { fm: Frontmatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { fm: {}, body: text };
  const fm: Frontmatter = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const val = kv[2]!.replace(/^["']|["']$/g, "").trim();
    if (key === "title") fm.title = val;
    if (key === "date") fm.date = val;
  }
  return { fm, body: m[2]! };
}

async function walk(dir: string, exts: string[]): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, exts)));
    else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

/**
 * Reads a directory of notes (Obsidian/journal-style). Each file becomes one
 * episode. occurredAt comes from frontmatter `date:` if present, else the
 * file's mtime; title from frontmatter, first `# heading`, or the filename.
 * Fully local — the reference connector until the OAuth-backed ones land.
 */
export function createFilesystemConnector(
  opts: FilesystemConnectorOptions,
): Connector {
  const baseDir = path.resolve(opts.dir);
  const exts = (opts.extensions ?? [".md", ".txt"]).map((e) => e.toLowerCase());

  return {
    name: "filesystem",
    async pull(): Promise<PullResult> {
      const files = await walk(baseDir, exts);
      const items: RawItem[] = [];
      for (const file of files.sort()) {
        const raw = await fs.readFile(file);
        const stat = await fs.stat(file);
        const { fm, body } = parseFrontmatter(raw.toString("utf8"));
        const rel = path.relative(baseDir, file).split(path.sep).join("/");

        const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
        const title = fm.title ?? heading ?? path.basename(file, path.extname(file));
        const occurredAt =
          fm.date && !Number.isNaN(Date.parse(fm.date))
            ? new Date(fm.date)
            : stat.mtime;

        items.push({
          externalId: rel,
          occurredAt,
          kind: "note",
          title,
          body: body.trim(),
          raw,
          contentType: "text/markdown",
          meta: { path: rel },
        });
      }
      return { items };
    },
  };
}
