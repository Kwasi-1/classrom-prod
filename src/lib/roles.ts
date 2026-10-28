import { and, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { HttpError } from "./api";
import type { User } from "./session";

export type Role = "teacher" | "student";
export type Classroom = typeof t.classrooms.$inferSelect;
export type Installation = typeof t.installations.$inferSelect;

/** Teacher if owner or staff; student if on the roster; otherwise null. */
export async function classroomRole(classroom: Classroom, user: User): Promise<Role | null> {
  if (classroom.ownerUserId === user.id) return "teacher";
  const staff = await db
    .select()
    .from(t.classroomStaff)
    .where(and(eq(t.classroomStaff.classroomId, classroom.id), eq(t.classroomStaff.userId, user.id)));
  if (staff.length) return "teacher";
  const onRoster = await db
    .select({ id: t.roster.id })
    .from(t.roster)
    .where(and(eq(t.roster.classroomId, classroom.id), eq(t.roster.githubLogin, user.githubLogin.toLowerCase())));
  return onRoster.length ? "student" : null;
}

export async function loadClassroom(where: { id: number } | { slug: string }) {
  const [row] = await db
    .select({ classroom: t.classrooms, installation: t.installations })
    .from(t.classrooms)
    .innerJoin(t.installations, eq(t.installations.id, t.classrooms.installationId))
    .where("id" in where ? eq(t.classrooms.id, where.id) : eq(t.classrooms.slug, where.slug));
  return row ?? null;
}

/** API guard: loads the classroom and requires the given role (teachers pass student checks too). */
export async function requireClassroomRole(classroomId: number, user: User, role: Role) {
  const row = Number.isInteger(classroomId) ? await loadClassroom({ id: classroomId }) : null;
  // 404 rather than 403 for outsiders, so classroom ids can't be probed.
  if (!row) throw new HttpError(404, "Classroom not found");
  const actual = await classroomRole(row.classroom, user);
  if (!actual) throw new HttpError(404, "Classroom not found");
  if (role === "teacher" && actual !== "teacher") throw new HttpError(403, "Teachers only");
  return { ...row, role: actual };
}
