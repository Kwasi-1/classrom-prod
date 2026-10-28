import { NextResponse } from "next/server";
import { handler, HttpError, requireApiUser } from "@/lib/api";
import { requireAssignmentRole } from "@/lib/assignments";
import { submissionsToRegrade } from "@/lib/deadlines";
import { dispatchGrading } from "@/lib/grading";
import { enqueue } from "@/lib/queue";

/** Re-dispatches the latest SHA of one student (`{ student_repo_id }`) or of every student. Works while paused. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { assignment } = await requireAssignmentRole(Number((await ctx.params).id), user, "teacher");
  const body = (await req.json().catch(() => ({}))) as { student_repo_id?: unknown };
  const studentRepoId = body.student_repo_id == null ? undefined : Number(body.student_repo_id);
  if (studentRepoId !== undefined && !Number.isInteger(studentRepoId)) throw new HttpError(400, "student_repo_id must be an integer");

  const ids = await submissionsToRegrade(assignment.id, studentRepoId);
  if (studentRepoId !== undefined && ids.length === 0) throw new HttpError(404, "No submission to regrade for that student");
  enqueue(`regrade:${assignment.id}`, async () => {
    for (const id of ids) await dispatchGrading(id);
  });
  return NextResponse.json({ ok: true, dispatching: ids.length }, { status: 202 });
});
