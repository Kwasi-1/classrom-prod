import { and, eq, inArray, sql } from "drizzle-orm";
import { db, t } from "@/db";
import type { Gh } from "./github";

const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export type ParsedRoster = { logins: string[]; malformed: string[]; duplicatesInInput: number };

/**
 * Accepts pasted text or CSV: one username per line, first column only, optional
 * `github_username` header, optional leading "@". Returns lowercased, de-duplicated logins.
 */
export function parseRoster(text: string): ParsedRoster {
  const seen = new Set<string>();
  const malformed: string[] = [];
  let duplicatesInInput = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    let value = line.split(",")[0].trim().replace(/^["']|["']$/g, "").trim();
    if (!value) return;
    if (i === 0 && /^github[_ ]?(username|login)$/i.test(value)) return;
    value = value.replace(/^@/, "").toLowerCase();
    if (!LOGIN_RE.test(value)) {
      malformed.push(value);
      return;
    }
    if (seen.has(value)) duplicatesInInput++;
    else seen.add(value);
  });
  return { logins: [...seen], malformed, duplicatesInInput };
}

export type ImportResult = { added: string[]; duplicates: number; invalid: string[] };

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Adds valid, existing GitHub users to the roster. Invalid logins are reported, not fatal. */
export async function importRoster(gh: Gh, classroomId: number, text: string): Promise<ImportResult> {
  const parsed = parseRoster(text);
  const existing = parsed.logins.length
    ? await db
        .select({ login: t.roster.githubLogin })
        .from(t.roster)
        .where(and(eq(t.roster.classroomId, classroomId), inArray(t.roster.githubLogin, parsed.logins)))
    : [];
  const existingSet = new Set(existing.map((r) => r.login));
  const candidates = parsed.logins.filter((l) => !existingSet.has(l));

  const checks = await mapLimit(candidates, 5, async (login) => {
    try {
      await gh.request("GET /users/{username}", { username: login });
      return { login, ok: true };
    } catch (err) {
      if ((err as { status?: number }).status === 404) return { login, ok: false };
      throw err;
    }
  });
  const valid = checks.filter((c) => c.ok).map((c) => c.login);
  const invalid = [...parsed.malformed, ...checks.filter((c) => !c.ok).map((c) => c.login)];

  let added: string[] = [];
  if (valid.length) {
    // Link students who have already signed in.
    const known = await db
      .select({ id: t.users.id, login: sql<string>`lower(${t.users.githubLogin})` })
      .from(t.users)
      .where(inArray(sql`lower(${t.users.githubLogin})`, valid));
    const userByLogin = new Map(known.map((u) => [u.login, u.id]));
    const rows = await db
      .insert(t.roster)
      .values(valid.map((login) => ({ classroomId, githubLogin: login, userId: userByLogin.get(login) ?? null })))
      .onConflictDoNothing()
      .returning({ login: t.roster.githubLogin });
    added = rows.map((r) => r.login);
  }
  // Duplicates = already on the roster + repeated within the pasted input (+ lost insert races).
  const duplicates = existingSet.size + parsed.duplicatesInInput + (valid.length - added.length);
  return { added, duplicates, invalid };
}
