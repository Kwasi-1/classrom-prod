import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";
import type { SubmissionResults, TestResult } from "@/db/schema";
import { installationOctokit, installationToken } from "./github";
import { safeError } from "./log";

const EXCERPT_MAX = 2000;

async function loadSubmission(submissionId: number) {
  const [row] = await db
    .select({
      submission: t.submissions,
      studentRepo: t.studentRepos,
      assignment: t.assignments,
      classroom: t.classrooms,
      installation: t.installations,
    })
    .from(t.submissions)
    .innerJoin(t.studentRepos, eq(t.studentRepos.id, t.submissions.studentRepoId))
    .innerJoin(t.assignments, eq(t.assignments.id, t.studentRepos.assignmentId))
    .innerJoin(t.classrooms, eq(t.classrooms.id, t.assignments.classroomId))
    .innerJoin(t.installations, eq(t.installations.id, t.classrooms.installationId))
    .where(eq(t.submissions.id, submissionId));
  return row ?? null;
}

/**
 * Sends a repository_dispatch to the classroom's grader repo. The payload carries a fresh installation
 * token scoped to the single student repo with contents:read, so the untrusted test job can only
 * check out that one repo. Marks the submission queued (or error if the dispatch fails).
 */
export async function dispatchGrading(submissionId: number) {
  const row = await loadSubmission(submissionId);
  if (!row) throw new Error(`submission ${submissionId} not found`);
  const { submission, studentRepo, assignment, classroom, installation } = row;
  const org = installation.orgLogin;
  const source = submission.results?.source;

  try {
    const token = await installationToken(installation.githubInstallationId, {
      repositories: [studentRepo.repoName],
      permissions: { contents: "read" },
      fresh: true,
    });
    const gh = await installationOctokit(installation.githubInstallationId);
    await gh.request("POST /repos/{owner}/{repo}/dispatches", {
      owner: org,
      repo: classroom.graderRepo,
      event_type: "grade",
      client_payload: {
        submission_id: submission.id,
        assignment: assignment.slug,
        repo: `${org}/${studentRepo.repoName}`,
        sha: submission.sha,
        token,
      },
    });
    await db
      .update(t.submissions)
      .set({ status: "queued", score: null, maxScore: null, results: { source } })
      .where(eq(t.submissions.id, submission.id));
  } catch (err) {
    const message = `dispatch failed: ${safeError(err)}`;
    console.error(`[grading] submission ${submission.id}: ${message}`);
    // A failed regrade must not wipe a score the student already has.
    if (submission.status === "graded") return;
    await db
      .update(t.submissions)
      .set({ status: "error", results: { source, tests: [], error: message } })
      .where(eq(t.submissions.id, submission.id));
  }
}

// ------------------------------------------------------------------ callback

const TestResultSchema = z.object({
  name: z.string().max(500),
  passed: z.boolean(),
  points: z.number().nonnegative(),
  max_points: z.number().nonnegative(),
  duration_ms: z.number().nonnegative(),
  output_excerpt: z.string().transform((s) => s.slice(0, EXCERPT_MAX)),
});

export const CallbackBody = z.object({
  submission_id: z.number().int().positive(),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  results: z.object({
    tests: z.array(TestResultSchema).max(500),
    error: z.string().max(5000).nullable().optional(),
  }),
});

export type CallbackBody = z.infer<typeof CallbackBody>;

/** score = sum of max_points over passed tests (the runner's own `points` field is not trusted). */
export function scoreResults(tests: TestResult[]) {
  return {
    score: tests.reduce((sum, test) => sum + (test.passed ? test.max_points : 0), 0),
    maxScore: tests.reduce((sum, test) => sum + test.max_points, 0),
  };
}

export type CallbackOutcome = "graded" | "error" | "not_found" | "sha_mismatch";

export async function applyCallback(body: CallbackBody): Promise<CallbackOutcome> {
  const [submission] = await db.select().from(t.submissions).where(eq(t.submissions.id, body.submission_id));
  if (!submission) return "not_found";
  if (submission.sha !== body.sha) return "sha_mismatch";

  const tests: TestResult[] = body.results.tests.map((test) => ({ ...test, points: test.passed ? test.max_points : 0 }));
  const error = body.results.error ?? null;
  const status = error || tests.length === 0 ? "error" : "graded";
  const { score, maxScore } = scoreResults(tests);
  const results: SubmissionResults = {
    source: submission.results?.source,
    tests,
    error: error ?? (tests.length === 0 ? "grader returned no test results" : null),
  };
  await db
    .update(t.submissions)
    .set({ status, score: status === "graded" ? score : null, maxScore: tests.length ? maxScore : null, results })
    .where(eq(t.submissions.id, submission.id));
  return status;
}
