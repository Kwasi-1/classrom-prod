import { handler, requireApiUser } from "@/lib/api";
import { requireAssignmentRole } from "@/lib/assignments";
import { gradebook, gradebookCsv } from "@/lib/gradebook";

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { assignment, classroom, installation } = await requireAssignmentRole(Number((await ctx.params).id), user, "teacher");
  const rows = await gradebook(classroom.id, assignment.id, assignment.deadline);
  return new Response(gradebookCsv(rows, installation.orgLogin), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${classroom.slug}-${assignment.slug}-grades.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
