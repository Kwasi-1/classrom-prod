import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import type { SubmissionResults } from "@/db/schema";
import { getAppInfo } from "./github";
import { dispatchGrading } from "./grading";
import { safeError } from "./log";

export type PushPayload = {
  ref: string;
  after: string;
  deleted?: boolean;
  installation?: { id: number };
  repository: { id: number; default_branch: string; full_name: string };
  sender?: { login: string; type: string };
  pusher?: { name?: string };
};

const ZERO_SHA = /^0+$/;

export async function loadStudentRepoByGithubId(repoId: number) {
  const [row] = await db
    .select({ studentRepo: t.studentRepos, assignment: t.assignments, installation: t.installations })
    .from(t.studentRepos)
    .innerJoin(t.assignments, eq(t.assignments.id, t.studentRepos.assignmentId))
    .innerJoin(t.classrooms, eq(t.classrooms.id, t.assignments.classroomId))
    .innerJoin(t.installations, eq(t.installations.id, t.classrooms.installationId))
    .where(eq(t.studentRepos.repoId, repoId));
  return row ?? null;
}

/** True if the push was made by this GitHub App (e.g. the initial commit from template generation). */
async function pushedByApp(p: PushPayload): Promise<boolean> {
  if (p.sender?.type !== "Bot") return false;
  try {
    const { botLogin } = await getAppInfo();
    return p.sender.login === botLogin || p.pusher?.name === botLogin;
  } catch (err) {
    console.error(`[push] could not load app info: ${safeError(err)}`);
    return false;
  }
}

/**
 * Records a submission for (repo, sha). received_at is server time, never the commit timestamp.
 * Returns the new row, or null if this SHA was already recorded.
 */
export async function recordSubmission(
  studentRepoId: number,
  deadline: Date,
  sha: string,
  source: NonNullable<SubmissionResults["source"]>,
) {
  const receivedAt = new Date();
  const [row] = await db
    .insert(t.submissions)
    .values({
      studentRepoId,
      sha,
      receivedAt,
      status: "queued",
      isLate: receivedAt.getTime() > deadline.getTime(),
      results: { source },
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function handlePush(p: PushPayload) {
  const repoName = p.repository.full_name;
  if (p.deleted || ZERO_SHA.test(p.after)) return;
  if (p.ref !== `refs/heads/${p.repository.default_branch}`) return;

  const row = await loadStudentRepoByGithubId(p.repository.id);
  if (!row) return; // not a student repo (e.g. the grader repo or a template)
  if (p.installation && p.installation.id !== row.installation.githubInstallationId) return;
  if (row.studentRepo.lockedAt) {
    console.info(`[push] ${repoName} is locked; ignoring ${p.after.slice(0, 7)}`);
    return;
  }
  if (await pushedByApp(p)) return;

  const submission = await recordSubmission(row.studentRepo.id, row.assignment.deadline, p.after, "webhook");
  if (!submission) return;
  console.info(`[push] ${repoName}@${p.after.slice(0, 7)} → submission ${submission.id}${submission.isLate ? " (late)" : ""}`);
  if (!row.assignment.autogradePaused) await dispatchGrading(submission.id);
}
