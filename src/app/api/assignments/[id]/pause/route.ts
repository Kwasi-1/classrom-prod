import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { handler, requireApiUser } from "@/lib/api";
import { requireAssignmentRole } from "@/lib/assignments";

/** Pushes keep being recorded, but are not dispatched for grading until resumed. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { assignment } = await requireAssignmentRole(Number((await ctx.params).id), user, "teacher");
  await db.update(t.assignments).set({ autogradePaused: true }).where(eq(t.assignments.id, assignment.id));
  return NextResponse.json({ ok: true, autogradePaused: true });
});
