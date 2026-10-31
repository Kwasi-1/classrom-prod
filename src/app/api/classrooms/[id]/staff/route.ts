import { NextResponse } from "next/server";
import { handler, HttpError, readJson, requireApiUser } from "@/lib/api";
import { installationOctokit } from "@/lib/github";
import { requireClassroomRole } from "@/lib/roles";
import type { User } from "@/lib/session";
import { addStaff, parseLogin, removeStaff } from "@/lib/staff";

/** Staff get full teacher access; only the classroom owner may change who is on the staff. */
async function requireOwner(ctx: { params: Promise<{ id: string }> }, user: User) {
  const row = await requireClassroomRole(Number((await ctx.params).id), user, "teacher");
  if (row.classroom.ownerUserId !== user.id) throw new HttpError(403, "Only the classroom owner can manage staff");
  return row;
}

/** Body: `{ login }`. Adds a GitHub user as staff (they need not have signed in yet). */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { classroom, installation } = await requireOwner(ctx, user);
  const login = parseLogin((await readJson(req)).login);
  const result = await addStaff(() => installationOctokit(installation.githubInstallationId), classroom, login);
  return NextResponse.json({ ok: true, ...result });
});

/** Body: `{ login }`. Removes a staff member. */
export const DELETE = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { classroom } = await requireOwner(ctx, user);
  await removeStaff(classroom, parseLogin((await readJson(req)).login));
  return NextResponse.json({ ok: true });
});
