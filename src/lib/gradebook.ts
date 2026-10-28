import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, t } from "@/db";

export const FILTERS = ["all", "not-accepted", "not-submitted", "late"] as const;
export type Filter = (typeof FILTERS)[number];

export type LatestSubmission = {
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
  latest: LatestSubmission | null;
};

/** One row per roster student for an assignment, with their latest submission (by received_at). */
export async function gradebook(classroomId: number, assignmentId: number): Promise<GradebookRow[]> {
  const students = await db
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
    .orderBy(asc(t.roster.githubLogin));

  const latest = await db
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
    .where(eq(t.studentRepos.assignmentId, assignmentId))
    .orderBy(t.submissions.studentRepoId, desc(t.submissions.receivedAt), desc(t.submissions.id));
  const byRepo = new Map(latest.map(({ studentRepoId, ...s }) => [studentRepoId, s]));

  return students.map((s) => ({ ...s, latest: s.studentRepoId ? (byRepo.get(s.studentRepoId) ?? null) : null }));
}

export function applyFilter(rows: GradebookRow[], filter: Filter) {
  switch (filter) {
    case "not-accepted":
      return rows.filter((r) => !r.studentRepoId);
    case "not-submitted":
      return rows.filter((r) => !r.latest);
    case "late":
      return rows.filter((r) => r.latest?.isLate);
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
