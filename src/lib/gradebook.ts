import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db, t } from "@/db";

export const FILTERS = ["all", "not-accepted", "not-submitted", "late"] as const;
export type Filter = (typeof FILTERS)[number];

export type SubmissionSummary = {
  id: number;
  sha: string;
  receivedAt: Date;
  status: (typeof t.submissionStatus.enumValues)[number];
  score: number | null;
  maxScore: number | null;
  isLate: boolean;
};

export type GradebookRow = {
  rosterId: number;
  login: string;
  studentRepoId: number | null;
  repoName: string | null;
  acceptedAt: Date | null;
  lockedAt: Date | null;
  latest: SubmissionSummary | null;
  /** Final = latest submission with received_at <= deadline; null is shown as "—". */
  final: SubmissionSummary | null;
  lateAttempts: number;
};

/** Latest submission per student repo of an assignment, optionally only those received by `deadline`. */
function latestPerRepo(assignmentId: number, deadline?: Date) {
  return db
    .selectDistinctOn([t.submissions.studentRepoId], {
      studentRepoId: t.submissions.studentRepoId,
      id: t.submissions.id,
      sha: t.submissions.sha,
      receivedAt: t.submissions.receivedAt,
      status: t.submissions.status,
      score: t.submissions.score,
      maxScore: t.submissions.maxScore,
      isLate: t.submissions.isLate,
    })
    .from(t.submissions)
    .innerJoin(t.studentRepos, eq(t.studentRepos.id, t.submissions.studentRepoId))
    .where(
      deadline
        ? and(eq(t.studentRepos.assignmentId, assignmentId), lte(t.submissions.receivedAt, deadline))
        : eq(t.studentRepos.assignmentId, assignmentId),
    )
    .orderBy(t.submissions.studentRepoId, desc(t.submissions.receivedAt), desc(t.submissions.id));
}

function byRepo(rows: Awaited<ReturnType<typeof latestPerRepo>>) {
  return new Map<number, SubmissionSummary>(rows.map(({ studentRepoId, ...s }) => [studentRepoId, s]));
}

/** One row per roster student for an assignment: latest submission, final submission, late attempts. */
export async function gradebook(classroomId: number, assignmentId: number, deadline: Date): Promise<GradebookRow[]> {
  const [students, latest, final, late] = await Promise.all([
    db
      .select({
        rosterId: t.roster.id,
        login: t.roster.githubLogin,
        studentRepoId: t.studentRepos.id,
        repoName: t.studentRepos.repoName,
        acceptedAt: t.studentRepos.acceptedAt,
        lockedAt: t.studentRepos.lockedAt,
      })
      .from(t.roster)
      .leftJoin(t.studentRepos, and(eq(t.studentRepos.rosterId, t.roster.id), eq(t.studentRepos.assignmentId, assignmentId)))
      .where(eq(t.roster.classroomId, classroomId))
      .orderBy(asc(t.roster.githubLogin)),
    latestPerRepo(assignmentId).then(byRepo),
    latestPerRepo(assignmentId, deadline).then(byRepo),
    db
      .select({ studentRepoId: t.submissions.studentRepoId, n: sql<number>`count(*)::int` })
      .from(t.submissions)
      .innerJoin(t.studentRepos, eq(t.studentRepos.id, t.submissions.studentRepoId))
      .where(and(eq(t.studentRepos.assignmentId, assignmentId), eq(t.submissions.isLate, true)))
      .groupBy(t.submissions.studentRepoId)
      .then((rows) => new Map(rows.map((r) => [r.studentRepoId, r.n]))),
  ]);

  return students.map((s) => ({
    ...s,
    latest: s.studentRepoId ? (latest.get(s.studentRepoId) ?? null) : null,
    final: s.studentRepoId ? (final.get(s.studentRepoId) ?? null) : null,
    lateAttempts: s.studentRepoId ? (late.get(s.studentRepoId) ?? 0) : 0,
  }));
}

export function applyFilter(rows: GradebookRow[], filter: Filter) {
  switch (filter) {
    case "not-accepted":
      return rows.filter((r) => !r.studentRepoId);
    case "not-submitted":
      return rows.filter((r) => !r.latest);
    case "late":
      return rows.filter((r) => r.lateAttempts > 0);
    default:
      return rows;
  }
}

/** accepted / submitted / graded counts per assignment in a classroom. */
export async function assignmentCounts(classroomId: number) {
  const rows = await db
    .select({
      assignmentId: t.assignments.id,
      accepted: sql<number>`count(distinct ${t.studentRepos.id})::int`,
      submitted: sql<number>`count(distinct ${t.submissions.studentRepoId})::int`,
      graded: sql<number>`count(distinct case when ${t.submissions.status} = 'graded' then ${t.submissions.studentRepoId} end)::int`,
    })
    .from(t.assignments)
    .leftJoin(t.studentRepos, eq(t.studentRepos.assignmentId, t.assignments.id))
    .leftJoin(t.submissions, eq(t.submissions.studentRepoId, t.studentRepos.id))
    .where(eq(t.assignments.classroomId, classroomId))
    .groupBy(t.assignments.id);
  return new Map(rows.map((r) => [r.assignmentId, r]));
}

function csvCell(value: string | number | null | undefined) {
  const s = value == null ? "" : String(value);
  // Quote when needed; prefix formula-looking cells so spreadsheets don't evaluate them.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV: github_login, repo, final_sha, final_score, max_score, submitted_at, late_attempts. */
export function gradebookCsv(rows: GradebookRow[], org: string) {
  const header = ["github_login", "repo", "final_sha", "final_score", "max_score", "submitted_at", "late_attempts"];
  const lines = rows.map((r) =>
    [
      r.login,
      r.repoName ? `${org}/${r.repoName}` : "",
      r.final?.sha ?? "",
      r.final?.score ?? "",
      r.final?.maxScore ?? "",
      r.final ? r.final.receivedAt.toISOString() : "",
      r.lateAttempts,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
