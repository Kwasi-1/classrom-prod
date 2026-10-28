import { and, eq, isNull } from "drizzle-orm";
import { db, t } from "@/db";
import { HttpError } from "./api";
import { loadAssignmentByInvite, studentRepoName } from "./assignments";
import { installationOctokit, type Gh } from "./github";
import type { User } from "./session";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (err: unknown) => (err as { status?: number }).status;

export type AcceptContext = NonNullable<Awaited<ReturnType<typeof loadAcceptContext>>>;

/** Everything the accept page/route needs; `problem` is a user-facing reason acceptance is not possible. */
export async function loadAcceptContext(inviteCode: string, user: User) {
  const row = await loadAssignmentByInvite(inviteCode);
  if (!row) return null;
  const [rosterRow] = await db
    .select()
    .from(t.roster)
    .where(and(eq(t.roster.classroomId, row.classroom.id), eq(t.roster.githubLogin, user.githubLogin.toLowerCase())));
  const [existing] = rosterRow
    ? await db
        .select()
        .from(t.studentRepos)
        .where(and(eq(t.studentRepos.assignmentId, row.assignment.id), eq(t.studentRepos.rosterId, rosterRow.id)))
    : [];

  let problem: string | null = null;
  if (!rosterRow) {
    problem = `Your GitHub account (${user.githubLogin}) is not on the roster for ${row.classroom.name}. Ask your teacher to add you.`;
  } else if (!existing && row.assignment.status !== "published") {
    problem = "This assignment is not open for acceptance.";
  } else if (!existing && row.assignment.deadline.getTime() <= Date.now()) {
    problem = "The deadline for this assignment has passed.";
  }
  return { ...row, rosterRow: rosterRow ?? null, existing: existing ?? null, problem };
}

export function repoUrls(org: string, repoName: string) {
  return {
    repoUrl: `https://github.com/${org}/${repoName}`,
    invitationUrl: `https://github.com/${org}/${repoName}/invitations`,
  };
}

/** Generates from the template, or adopts the repo if a previous attempt already created it. */
async function generateRepo(gh: Gh, org: string, template: string, name: string, description: string) {
  try {
    await gh.request("POST /repos/{template_owner}/{template_repo}/generate", {
      template_owner: org,
      template_repo: template,
      owner: org,
      name,
      private: true,
      include_all_branches: false,
      description,
    });
  } catch (err) {
    if (status(err) !== 422) throw err; // 422 = name already exists → adopt it below
  }
  // Template generation is async; wait for the repo (max ~10s).
  for (let i = 0; i < 10; i++) {
    try {
      const { data } = await gh.request("GET /repos/{owner}/{repo}", { owner: org, repo: name });
      return data;
    } catch (err) {
      if (status(err) !== 404) throw err;
      await sleep(1000);
    }
  }
  throw new HttpError(504, "GitHub is still creating your repository. Please try again in a minute.");
}

/** Idempotent: returns the existing repo if this student already accepted. */
export async function acceptAssignment(inviteCode: string, user: User) {
  const ctx = await loadAcceptContext(inviteCode, user);
  if (!ctx) throw new HttpError(404, "Invite link not found");
  const { assignment, classroom, installation, rosterRow } = ctx;
  const org = installation.orgLogin;
  if (ctx.existing) return { ...repoUrls(org, ctx.existing.repoName), alreadyAccepted: true };
  if (ctx.problem || !rosterRow) throw new HttpError(403, ctx.problem ?? "Not allowed");

  const repoName = studentRepoName(classroom.slug, assignment.slug, rosterRow.githubLogin);
  const gh = await installationOctokit(installation.githubInstallationId);
  const repo = await generateRepo(gh, org, assignment.templateRepo, repoName, `${assignment.title} — ${rosterRow.githubLogin}`);

  // Students are outside collaborators with push access; they never join the org.
  await gh.request("PUT /repos/{owner}/{repo}/collaborators/{username}", {
    owner: org,
    repo: repoName,
    username: rosterRow.githubLogin,
    permission: "push",
  });

  await db
    .insert(t.studentRepos)
    .values({ assignmentId: assignment.id, rosterId: rosterRow.id, repoName, repoId: Number(repo.id) })
    .onConflictDoNothing();
  await db.update(t.roster).set({ userId: user.id }).where(and(eq(t.roster.id, rosterRow.id), isNull(t.roster.userId)));

  return { ...repoUrls(org, repoName), alreadyAccepted: false };
}
