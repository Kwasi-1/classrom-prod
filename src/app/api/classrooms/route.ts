import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";
import { handler, HttpError, readJson, requireApiUser } from "@/lib/api";
import { installationOctokit, isOrgAdmin } from "@/lib/github";
import { seedGraderRepo } from "@/lib/grader";
import { CLASSROOM_SLUG_MAX, slugError } from "@/lib/slug";

const Body = z.object({
  installationId: z.number().int(),
  name: z.string().trim().min(1, "Name is required").max(100),
  slug: z.string().trim().toLowerCase(),
  term: z.string().trim().min(1, "Term is required").max(50),
});

export const POST = handler(async (req: Request) => {
  const user = await requireApiUser();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  const { installationId, name, slug, term } = parsed.data;
  const bad = slugError(slug, CLASSROOM_SLUG_MAX);
  if (bad) throw new HttpError(400, bad);

  const [installation] = await db.select().from(t.installations).where(eq(t.installations.id, installationId));
  if (!installation) throw new HttpError(404, "Organization not found");
  if (!(await isOrgAdmin(installation.githubInstallationId, installation.orgLogin, user.githubLogin))) {
    throw new HttpError(403, `Only admins of ${installation.orgLogin} can create classrooms`);
  }

  const taken = await db.select({ id: t.classrooms.id }).from(t.classrooms).where(eq(t.classrooms.slug, slug));
  if (taken.length) throw new HttpError(409, `The slug "${slug}" is already in use`);

  const gh = await installationOctokit(installation.githubInstallationId);
  const graderRepo = await seedGraderRepo(gh, installation.orgLogin, slug, name);

  try {
    const [classroom] = await db
      .insert(t.classrooms)
      .values({ installationId: installation.id, ownerUserId: user.id, slug, name, term, graderRepo })
      .returning();
    return NextResponse.json({ id: classroom.id, slug: classroom.slug }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new HttpError(409, `The slug "${slug}" is already in use`);
    throw err;
  }
});
