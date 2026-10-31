import { and, asc, eq, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { HttpError } from "./api";
import type { Gh } from "./github";
import type { Classroom } from "./roles";

const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export async function listStaff(classroomId: number) {
  return db
    .select({ id: t.users.id, login: t.users.githubLogin, name: t.users.name })
    .from(t.classroomStaff)
    .innerJoin(t.users, eq(t.users.id, t.classroomStaff.userId))
    .where(eq(t.classroomStaff.classroomId, classroomId))
    .orderBy(asc(t.users.githubLogin));
}

/**
 * Finds the user row for a login. Staff may be added before their first sign-in: unknown logins are
 * looked up on GitHub and stored, and the login callback later matches the same github_id.
 */
async function resolveUser(gh: () => Promise<Gh>, login: string) {
  const [known] = await db.select().from(t.users).where(eq(sql`lower(${t.users.githubLogin})`, login));
  if (known) return known;
  let data;
  try {
    ({ data } = await (await gh()).request("GET /users/{username}", { username: login }));
  } catch (err) {
    if ((err as { status?: number }).status === 404) throw new HttpError(404, `GitHub user "${login}" not found`);
    throw err;
  }
  const [user] = await db
    .insert(t.users)
    .values({ githubId: Number(data.id), githubLogin: data.login, name: data.name, avatarUrl: data.avatar_url })
    .onConflictDoUpdate({ target: t.users.githubId, set: { githubLogin: data.login } })
    .returning();
  return user;
}

export function parseLogin(value: unknown): string {
  const login = typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
  if (!LOGIN_RE.test(login)) throw new HttpError(400, "Enter a valid GitHub username");
  return login;
}

export async function addStaff(gh: () => Promise<Gh>, classroom: Classroom, login: string) {
  const user = await resolveUser(gh, login);
  if (user.id === classroom.ownerUserId) throw new HttpError(400, `${user.githubLogin} owns this classroom`);
  const inserted = await db
    .insert(t.classroomStaff)
    .values({ classroomId: classroom.id, userId: user.id })
    .onConflictDoNothing()
    .returning();
  return { login: user.githubLogin, added: inserted.length > 0 };
}

export async function removeStaff(classroom: Classroom, login: string) {
  const [user] = await db.select({ id: t.users.id }).from(t.users).where(eq(sql`lower(${t.users.githubLogin})`, login));
  const removed = user
    ? await db
        .delete(t.classroomStaff)
        .where(and(eq(t.classroomStaff.classroomId, classroom.id), eq(t.classroomStaff.userId, user.id)))
        .returning()
    : [];
  if (!removed.length) throw new HttpError(404, `${login} is not on the staff`);
}
