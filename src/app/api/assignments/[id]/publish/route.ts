import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { handler, HttpError, requireApiUser } from "@/lib/api";
import { inviteUrl, requireAssignmentRole, testsDir } from "@/lib/assignments";
import { installationOctokit } from "@/lib/github";
import { readFileText } from "@/lib/grader";

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { assignment, classroom, installation } = await requireAssignmentRole(Number((await ctx.params).id), user, "teacher");

  if (assignment.status === "closed") throw new HttpError(409, "This assignment is closed");
  if (assignment.status === "published" && assignment.inviteCode) {
    return NextResponse.json({ status: "published", inviteUrl: inviteUrl(assignment.inviteCode) });
  }
  if (assignment.deadline.getTime() <= Date.now()) throw new HttpError(400, "The deadline has already passed");

  const gh = await installationOctokit(installation.githubInstallationId);
  const spec = await readFileText(gh, installation.orgLogin, classroom.graderRepo, `${testsDir(assignment.slug)}/tests.json`);
  if (!spec) throw new HttpError(400, "Upload tests.yml before publishing");

  const inviteCode = assignment.inviteCode ?? randomBytes(12).toString("base64url");
  await db.update(t.assignments).set({ status: "published", inviteCode }).where(eq(t.assignments.id, assignment.id));
  return NextResponse.json({ status: "published", inviteUrl: inviteUrl(inviteCode) });
});
