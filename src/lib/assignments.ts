import { and, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { HttpError } from "./api";
import { env } from "./env";
import type { Gh } from "./github";
import { classroomRole, type Role } from "./roles";
import type { User } from "./session";

export type Assignment = typeof t.assignments.$inferSelect;

export function studentRepoName(classroomSlug: string, assignmentSlug: string, githubLogin: string) {
  return `${classroomSlug}-${assignmentSlug}-${githubLogin}`.toLowerCase();
}

export function testsDir(assignmentSlug: string) {
  return `assignments/${assignmentSlug}`;
}

export function inviteUrl(inviteCode: string) {
  return `${env().APP_URL}/a/${inviteCode}`;
}

const joined = () =>
  db
    .select({ assignment: t.assignments, classroom: t.classrooms, installation: t.installations })
    .from(t.assignments)
    .innerJoin(t.classrooms, eq(t.classrooms.id, t.assignments.classroomId))
    .innerJoin(t.installations, eq(t.installations.id, t.classrooms.installationId));

export async function loadAssignmentById(id: number) {
  if (!Number.isInteger(id)) return null;
  const [row] = await joined().where(eq(t.assignments.id, id));
  return row ?? null;
}

export async function loadAssignmentBySlugs(classroomSlug: string, assignmentSlug: string) {
  const [row] = await joined().where(and(eq(t.classrooms.slug, classroomSlug), eq(t.assignments.slug, assignmentSlug)));
  return row ?? null;
}

export async function loadAssignmentByInvite(inviteCode: string) {
  const [row] = await joined().where(eq(t.assignments.inviteCode, inviteCode));
  return row ?? null;
}

/** API guard for assignment routes: 404 for outsiders, 403 if the role is insufficient. */
export async function requireAssignmentRole(id: number, user: User, role: Role) {
  const row = await loadAssignmentById(id);
  if (!row) throw new HttpError(404, "Assignment not found");
  const actual = await classroomRole(row.classroom, user);
  if (!actual) throw new HttpError(404, "Assignment not found");
  if (role === "teacher" && actual !== "teacher") throw new HttpError(403, "Teachers only");
  return { ...row, role: actual };
}

/** Org repos marked as templates (only those the installation can see). */
export async function listTemplateRepos(gh: Gh, org: string): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await gh.request("GET /orgs/{org}/repos", { org, type: "all", per_page: 100, page });
    names.push(...data.filter((r) => r.is_template).map((r) => r.name));
    if (data.length < 100) break;
  }
  return names.sort((a, b) => a.localeCompare(b));
}
