import { NextResponse } from "next/server";
import { z } from "zod";
import { db, t } from "@/db";
import { handler, HttpError, readJson, requireApiUser } from "@/lib/api";
import { installationOctokit } from "@/lib/github";
import { requireClassroomRole } from "@/lib/roles";
import { COMBINED_SLUG_MAX, slugError } from "@/lib/slug";
import { parseLocalDeadline } from "@/lib/time";

const Body = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  slug: z.string().trim().toLowerCase(),
  templateRepo: z.string().trim().min(1, "Choose a template repository"),
  deadline: z.string().trim(), // datetime-local, interpreted in Africa/Accra
});

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { classroom, installation } = await requireClassroomRole(Number((await ctx.params).id), user, "teacher");

  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  const { title, slug, templateRepo } = parsed.data;
  const bad = slugError(slug, COMBINED_SLUG_MAX - classroom.slug.length);
  if (bad) throw new HttpError(400, bad);
  const deadline = parseLocalDeadline(parsed.data.deadline);
  if (!deadline) throw new HttpError(400, "Deadline is required");
  if (deadline.getTime() <= Date.now()) throw new HttpError(400, "Deadline must be in the future");

  const gh = await installationOctokit(installation.githubInstallationId);
  let isTemplate = false;
  try {
    const { data } = await gh.request("GET /repos/{owner}/{repo}", { owner: installation.orgLogin, repo: templateRepo });
    isTemplate = Boolean(data.is_template);
  } catch (err) {
    if ((err as { status?: number }).status !== 404) throw err;
    throw new HttpError(400, `Template ${templateRepo} not found in ${installation.orgLogin}`);
  }
  if (!isTemplate) throw new HttpError(400, `${templateRepo} is not a template repository`);

  try {
    const [assignment] = await db
      .insert(t.assignments)
      .values({ classroomId: classroom.id, slug, title, templateRepo, deadline })
      .returning();
    return NextResponse.json({ id: assignment.id, slug: assignment.slug }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new HttpError(409, `Slug "${slug}" is already used in this classroom`);
    throw err;
  }
});
