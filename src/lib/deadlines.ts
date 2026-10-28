import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { db, t } from "@/db";
import { installationOctokit, type Gh } from "./github";
import { dispatchGrading } from "./grading";
import { safeError } from "./log";
import { recordSubmission } from "./submissions";

const status = (err: unknown) => (err as { status?: number }).status;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Downgrades the student to read-only, including a still-pending collaborator invitation. */
async function lockRepo(gh: Gh, org: string, repo: string, login: string) {
  await gh.request("PUT /repos/{owner}/{repo}/collaborators/{username}", {
    owner: org,
    repo,
    username: login,
    permission: "pull",
  });
  const { data: invitations } = await gh.request("GET /repos/{owner}/{repo}/invitations", { owner: org, repo, per_page: 100 });
  for (const inv of invitations) {
    if (inv.invitee?.login.toLowerCase() === login && inv.permissions !== "read") {
      await gh.request("PATCH /repos/{owner}/{repo}/invitations/{invitation_id}", {
        owner: org,
        repo,
        invitation_id: Number(inv.id),
        permissions: "read",
      });
    }
  }
}

export type LockSummary = { assignments: number; locked: number; failed: number; closed: number };

/**
 * For published assignments past their deadline: set every unlocked student repo to read-only and
 * stamp locked_at; close the assignment once all its repos are locked. Failures are retried next run.
 */
export async function lockExpiredAssignments(now = new Date()): Promise<LockSummary> {
  const due = await db
    .select({ assignment: t.assignments, installation: t.installations })
    .from(t.assignments)
    .innerJoin(t.classrooms, eq(t.classrooms.id, t.assignments.classroomId))
    .innerJoin(t.installations, eq(t.installations.id, t.classrooms.installationId))
    .where(and(eq(t.assignments.status, "published"), lte(t.assignments.deadline, now)));

  const summary: LockSummary = { assignments: due.length, locked: 0, failed: 0, closed: 0 };
  for (const { assignment, installation } of due) {
    const repos = await db
      .select({ id: t.studentRepos.id, repoName: t.studentRepos.repoName, login: t.roster.githubLogin })
      .from(t.studentRepos)
      .innerJoin(t.roster, eq(t.roster.id, t.studentRepos.rosterId))
      .where(and(eq(t.studentRepos.assignmentId, assignment.id), isNull(t.studentRepos.lockedAt)));

    let failures = 0;
    if (repos.length) {
      const gh = await installationOctokit(installation.githubInstallationId);
      for (const repo of repos) {
        try {
          await lockRepo(gh, installation.orgLogin, repo.repoName, repo.login);
        } catch (err) {
          if (status(err) !== 404) {
            // 404 = repo deleted; nothing left to lock, so mark it locked anyway.
            failures++;
            console.error(`[lock] ${installation.orgLogin}/${repo.repoName}: ${safeError(err)}`);
            continue;
          }
        }
        await db.update(t.studentRepos).set({ lockedAt: new Date() }).where(eq(t.studentRepos.id, repo.id));
        summary.locked++;
      }
    }
    summary.failed += failures;
    if (failures === 0) {
      await db.update(t.assignments).set({ status: "closed" }).where(eq(t.assignments.id, assignment.id));
      summary.closed++;
    }
  }
  return summary;
}

export type ReconcileSummary = { repos: number; created: number; failed: number };

/**
 * Catches pushes whose webhooks were lost: for open assignments (and closed ones within 24h of their
 * deadline), records the default branch head as a submission if it has none, and dispatches grading.
 */
export async function reconcileSubmissions(now = new Date()): Promise<ReconcileSummary> {
  const rows = await db
    .select({ studentRepo: t.studentRepos, assignment: t.assignments, installation: t.installations })
    .from(t.studentRepos)
    .innerJoin(t.assignments, eq(t.assignments.id, t.studentRepos.assignmentId))
    .innerJoin(t.classrooms, eq(t.classrooms.id, t.assignments.classroomId))
    .innerJoin(t.installations, eq(t.installations.id, t.classrooms.installationId))
    .where(
      or(
        eq(t.assignments.status, "published"),
        and(eq(t.assignments.status, "closed"), gt(t.assignments.deadline, new Date(now.getTime() - DAY_MS))),
      ),
    );

  const summary: ReconcileSummary = { repos: rows.length, created: 0, failed: 0 };
  const clients = new Map<number, Gh>();
  for (const { studentRepo, assignment, installation } of rows) {
    try {
      let gh = clients.get(installation.githubInstallationId);
      if (!gh) clients.set(installation.githubInstallationId, (gh = await installationOctokit(installation.githubInstallationId)));
      let sha: string;
      try {
        // "HEAD" resolves to the default branch.
        const { data } = await gh.request("GET /repos/{owner}/{repo}/commits/{ref}", {
          owner: installation.orgLogin,
          repo: studentRepo.repoName,
          ref: "HEAD",
        });
        sha = data.sha;
      } catch (err) {
        if (status(err) === 404 || status(err) === 409) continue; // deleted or empty repo
        throw err;
      }
      const submission = await recordSubmission(studentRepo.id, assignment.deadline, sha, "reconcile");
      if (!submission) continue; // already have this SHA
      summary.created++;
      console.info(`[reconcile] ${studentRepo.repoName}@${sha.slice(0, 7)} → submission ${submission.id}`);
      if (!assignment.autogradePaused) await dispatchGrading(submission.id);
    } catch (err) {
      summary.failed++;
      console.error(`[reconcile] ${studentRepo.repoName}: ${safeError(err)}`);
    }
  }
  return summary;
}

/** Ids of the latest submission of one student repo, or of every repo in the assignment. */
export async function submissionsToRegrade(assignmentId: number, studentRepoId?: number) {
  const repos = await db
    .select({ id: t.studentRepos.id })
    .from(t.studentRepos)
    .where(
      studentRepoId
        ? and(eq(t.studentRepos.assignmentId, assignmentId), eq(t.studentRepos.id, studentRepoId))
        : eq(t.studentRepos.assignmentId, assignmentId),
    );
  return latestSubmissionIds(repos.map((r) => r.id));
}

/** Latest submission id per repo (optionally only those in the given statuses). */
export async function latestSubmissionIds(studentRepoIds: number[], statuses?: ("queued" | "running" | "graded" | "error")[]) {
  if (studentRepoIds.length === 0) return [];
  const rows = await db
    .selectDistinctOn([t.submissions.studentRepoId], { id: t.submissions.id, status: t.submissions.status })
    .from(t.submissions)
    .where(inArray(t.submissions.studentRepoId, studentRepoIds))
    .orderBy(t.submissions.studentRepoId, desc(t.submissions.receivedAt), desc(t.submissions.id));
  return rows.filter((r) => !statuses || statuses.includes(r.status)).map((r) => r.id);
}
