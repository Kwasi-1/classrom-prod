import { NextResponse } from "next/server";
import { handler, requireApiUser } from "@/lib/api";
import { env } from "@/lib/env";
import { installationOctokit } from "@/lib/github";
import { seedGraderRepo } from "@/lib/grader";
import { requireClassroomRole } from "@/lib/roles";

/** Re-commits the grader workflow/runner/README (e.g. after APP_URL changes or the template is updated). */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { classroom, installation } = await requireClassroomRole(Number((await ctx.params).id), user, "teacher");
  const gh = await installationOctokit(installation.githubInstallationId);
  await seedGraderRepo(gh, installation.orgLogin, classroom.slug, classroom.name);
  return NextResponse.json({ ok: true, callbackUrl: `${env().APP_URL}/api/grader/callback` });
});
