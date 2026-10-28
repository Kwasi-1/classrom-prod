import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { handler, requireApiUser } from "@/lib/api";
import { requireAssignmentRole } from "@/lib/assignments";
import { latestSubmissionIds } from "@/lib/deadlines";
import { dispatchGrading } from "@/lib/grading";
import { enqueue } from "@/lib/queue";

/** Resumes autograding and dispatches each repo's latest submission that is still waiting (queued). */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { assignment } = await requireAssignmentRole(Number((await ctx.params).id), user, "teacher");
  await db.update(t.assignments).set({ autogradePaused: false }).where(eq(t.assignments.id, assignment.id));
  const repos = await db.select({ id: t.studentRepos.id }).from(t.studentRepos).where(eq(t.studentRepos.assignmentId, assignment.id));
  const ids = await latestSubmissionIds(repos.map((r) => r.id), ["queued"]);
  enqueue(`resume:${assignment.id}`, async () => {
    for (const id of ids) await dispatchGrading(id);
  });
  return NextResponse.json({ ok: true, autogradePaused: false, dispatching: ids.length });
});
