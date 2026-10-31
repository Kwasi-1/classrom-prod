import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { CopyField, PostButton, PublishButton } from "@/components/ActionButtons";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StudentSubmissions } from "@/components/StudentSubmissions";
import { SubmissionsTable } from "@/components/SubmissionsTable";
import { TestsUpload } from "@/components/TestsUpload";
import { inviteUrl, loadAssignmentBySlugs, testsDir } from "@/lib/assignments";
import { installationOctokit } from "@/lib/github";
import { FILTERS, gradebook, type Filter } from "@/lib/gradebook";
import { listFiles, readFileText } from "@/lib/grader";
import { safeError } from "@/lib/log";
import { classroomRole } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { fmtTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS_STYLE = {
  draft: "bg-slate-100 text-slate-700",
  published: "bg-green-100 text-green-800",
  closed: "bg-amber-100 text-amber-800",
} as const;

export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; assignment: string }>;
  searchParams: Promise<{ filter?: string; tab?: string; student?: string }>;
}) {
  const { slug, assignment: assignmentSlug } = await params;
  const sp = await searchParams;
  const filterParam = sp.filter as Filter;
  const filter: Filter = FILTERS.includes(filterParam) ? filterParam : "all";
  const user = await requireUser(`/c/${slug}/a/${assignmentSlug}`);
  const row = await loadAssignmentBySlugs(slug, assignmentSlug);
  if (!row) notFound();
  const role = await classroomRole(row.classroom, user);
  if (!role) notFound();
  // Drafts are invisible to students, matching the classroom page's assignment list.
  if (role === "student" && row.assignment.status === "draft") notFound();
  const { assignment, classroom, installation } = row;
  const org = installation.orgLogin;

  const header = (
    <div className="mb-6">
      <Link href={`/c/${classroom.slug}`} className="text-sm text-slate-500 hover:underline">
        ← {classroom.name}
      </Link>
      <div className="mt-1 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{assignment.title}</h1>
        {role === "teacher" && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[assignment.status]}`}>{assignment.status}</span>
        )}
      </div>
      <div className="text-sm text-slate-500">Due {fmtTime(assignment.deadline)} (Africa/Accra)</div>
    </div>
  );

  if (role === "student") {
    const [mine] = await db
      .select({ id: t.studentRepos.id, repoName: t.studentRepos.repoName, lockedAt: t.studentRepos.lockedAt })
      .from(t.studentRepos)
      .innerJoin(t.roster, eq(t.roster.id, t.studentRepos.rosterId))
      .where(and(eq(t.studentRepos.assignmentId, assignment.id), eq(t.roster.githubLogin, user.githubLogin.toLowerCase())));
    const [latest] = mine
      ? await db
          .select()
          .from(t.submissions)
          .where(eq(t.submissions.studentRepoId, mine.id))
          .orderBy(desc(t.submissions.receivedAt), desc(t.submissions.id))
          .limit(1)
      : [];
    return (
      <div className="space-y-4">
        {header}
        <div className="card space-y-2 text-sm">
          {mine ? (
            <>
              <p>
                Your repository:{" "}
                <a href={`https://github.com/${org}/${mine.repoName}`} className="font-mono text-blue-700 hover:underline">
                  {org}/{mine.repoName}
                </a>
                {mine.lockedAt && <span className="ml-2 text-amber-700">(read-only since the deadline)</span>}
              </p>
              <p className="text-slate-600">Push to the default branch to submit. Every push is graded automatically.</p>
            </>
          ) : assignment.status === "published" && assignment.inviteCode && assignment.deadline.getTime() > Date.now() ? (
            <Link href={`/a/${assignment.inviteCode}`} className="btn">
              Accept assignment
            </Link>
          ) : (
            <p className="text-slate-500">This assignment is not open for acceptance.</p>
          )}
        </div>
        {mine && latest && <StudentResult submission={latest} repoUrl={`https://github.com/${org}/${mine.repoName}`} />}
        {mine && !latest && <p className="text-sm text-slate-500">No submissions yet.</p>}
        {mine && <AutoRefresh seconds={15} />}
      </div>
    );
  }

  // Teacher view. Submissions come from the DB (auto-refreshed); tests are read from GitHub only on their tab.
  const tab = sp.tab === "tests" || (sp.tab !== "submissions" && assignment.status === "draft") ? "tests" : "submissions";
  const base = `/c/${classroom.slug}/a/${assignment.slug}`;
  const dir = testsDir(assignment.slug);

  return (
    <div className="space-y-6">
      {header}

      <div className="card space-y-3">
        <div className="text-sm">
          Template:{" "}
          <a href={`https://github.com/${org}/${assignment.templateRepo}`} className="font-mono text-blue-700 hover:underline">
            {org}/{assignment.templateRepo}
          </a>{" "}
          · Tests:{" "}
          <a href={`https://github.com/${org}/${classroom.graderRepo}/tree/HEAD/${dir}`} className="font-mono text-blue-700 hover:underline">
            {classroom.graderRepo}/{dir}
          </a>
        </div>
        {assignment.status === "draft" && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Upload <code>tests.yml</code> below, then publish to get the invite link.
            </p>
            <PublishButton assignmentId={assignment.id} />
          </div>
        )}
        {assignment.inviteCode && assignment.status === "published" && (
          <div>
            <label className="label">Invite link (share with students)</label>
            <CopyField value={inviteUrl(assignment.inviteCode)} />
          </div>
        )}
        {assignment.status !== "draft" && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            {assignment.autogradePaused ? (
              <>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Autograding paused</span>
                <PostButton url={`/api/assignments/${assignment.id}/resume`} label="Resume autograding" busyLabel="Resuming…" done="Resumed" />
              </>
            ) : (
              <PostButton url={`/api/assignments/${assignment.id}/pause`} label="Pause autograding" busyLabel="Pausing…" done="Paused" />
            )}
            <PostButton
              url={`/api/assignments/${assignment.id}/regrade`}
              label="Regrade all"
              busyLabel="Dispatching…"
              done="Regrading started"
              confirm="Re-run grading for the latest submission of every student?"
            />
            <a href={`/api/assignments/${assignment.id}/export.csv`} className="btn-secondary">
              Export CSV
            </a>
          </div>
        )}
      </div>

      <nav className="flex gap-1 border-b border-slate-200">
        {(["submissions", "tests"] as const).map((name) => (
          <Link
            key={name}
            href={`${base}?tab=${name}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm capitalize ${
              tab === name ? "border-slate-900 font-medium" : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {name}
          </Link>
        ))}
      </nav>

      {tab === "submissions" ? (
        <SubmissionsTab
          classroomId={classroom.id}
          assignmentId={assignment.id}
          deadline={assignment.deadline}
          org={org}
          filter={filter}
          student={sp.student}
          base={`${base}?tab=submissions`}
        />
      ) : (
        <TestsTab
          assignmentId={assignment.id}
          dir={dir}
          org={org}
          graderRepo={classroom.graderRepo}
          installationId={installation.githubInstallationId}
        />
      )}
    </div>
  );
}

async function TestsTab(props: { assignmentId: number; dir: string; org: string; graderRepo: string; installationId: number }) {
  const { assignmentId, dir, org, graderRepo, installationId } = props;
  try {
    const gh = await installationOctokit(installationId);
    const [testsYaml, hiddenFiles] = await Promise.all([
      readFileText(gh, org, graderRepo, `${dir}/tests.yml`).then((s) => s ?? ""),
      listFiles(gh, org, graderRepo, `${dir}/files`).then((paths) => paths.map((p) => p.slice(`${dir}/files/`.length))),
    ]);
    return <TestsUpload assignmentId={assignmentId} initialYaml={testsYaml} existingFiles={hiddenFiles} />;
  } catch (err) {
    return <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Could not read the grader repo: {safeError(err)}</p>;
  }
}

async function SubmissionsTab(props: {
  classroomId: number;
  assignmentId: number;
  deadline: Date;
  org: string;
  filter: Filter;
  student?: string;
  base: string;
}) {
  const { classroomId, assignmentId, deadline, org, filter, student, base } = props;
  const rows = await gradebook(classroomId, assignmentId, deadline);
  const selected = student ? rows.find((r) => r.login === student.toLowerCase() && r.studentRepoId) : undefined;
  const listHref = filter === "all" ? base : `${base}&filter=${filter}`;
  return (
    <>
      <AutoRefresh seconds={10} />
      {selected?.studentRepoId && (
        <StudentSubmissions
          assignmentId={assignmentId}
          studentRepoId={selected.studentRepoId}
          login={selected.login}
          repoUrl={`https://github.com/${org}/${selected.repoName}`}
          closeHref={listHref}
        />
      )}
      <SubmissionsTable rows={rows} org={org} filter={filter} baseHref={base} />
    </>
  );
}

type Submission = typeof t.submissions.$inferSelect;

/** Student-facing result: test names and pass/fail only. No output, so hidden test details never leak. */
function StudentResult({ submission, repoUrl }: { submission: Submission; repoUrl: string }) {
  const tests = submission.results?.tests ?? [];
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Latest submission</h3>
        <div className="text-sm text-slate-600">
          <a href={`${repoUrl}/commit/${submission.sha}`} className="font-mono text-blue-700 hover:underline">
            {submission.sha.slice(0, 7)}
          </a>{" "}
          · {fmtTime(submission.receivedAt)}
          {submission.isLate && <span className="ml-1 text-amber-700">· late</span>}
        </div>
      </div>
      {submission.status === "graded" ? (
        <p className="text-2xl font-bold">
          {submission.score}/{submission.maxScore}
        </p>
      ) : submission.status === "error" ? (
        <p className="text-sm text-red-700">Grading failed for this commit. Your teacher can see the details.</p>
      ) : (
        <p className="text-sm text-slate-600">Grading in progress…</p>
      )}
      {tests.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {tests.map((test) => (
            <li key={test.name} className="flex items-center justify-between py-1.5">
              <span>
                {test.passed ? "✅" : "❌"} {test.name}
              </span>
              <span className="tabular-nums text-slate-500">
                {test.points}/{test.max_points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
