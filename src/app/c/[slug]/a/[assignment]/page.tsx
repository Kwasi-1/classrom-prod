import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { CopyField, PublishButton } from "@/components/ActionButtons";
import { TestsUpload } from "@/components/TestsUpload";
import { inviteUrl, loadAssignmentBySlugs, testsDir } from "@/lib/assignments";
import { installationOctokit } from "@/lib/github";
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

export default async function AssignmentPage({ params }: { params: Promise<{ slug: string; assignment: string }> }) {
  const { slug, assignment: assignmentSlug } = await params;
  const user = await requireUser(`/c/${slug}/a/${assignmentSlug}`);
  const row = await loadAssignmentBySlugs(slug, assignmentSlug);
  if (!row) notFound();
  const role = await classroomRole(row.classroom, user);
  if (!role) notFound();
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
      .select({ repoName: t.studentRepos.repoName, acceptedAt: t.studentRepos.acceptedAt })
      .from(t.studentRepos)
      .innerJoin(t.roster, eq(t.roster.id, t.studentRepos.rosterId))
      .where(and(eq(t.studentRepos.assignmentId, assignment.id), eq(t.roster.githubLogin, user.githubLogin.toLowerCase())));
    return (
      <div>
        {header}
        <div className="card">
          {mine ? (
            <p className="text-sm">
              Your repository:{" "}
              <a href={`https://github.com/${org}/${mine.repoName}`} className="font-mono text-blue-700 hover:underline">
                {org}/{mine.repoName}
              </a>
            </p>
          ) : assignment.status === "published" && assignment.inviteCode ? (
            <Link href={`/a/${assignment.inviteCode}`} className="btn">
              Accept assignment
            </Link>
          ) : (
            <p className="text-sm text-slate-500">This assignment is not open for acceptance.</p>
          )}
        </div>
      </div>
    );
  }

  // Teacher view: tests live in the grader repo, so read them from GitHub.
  const dir = testsDir(assignment.slug);
  let testsYaml = "";
  let hiddenFiles: string[] = [];
  let ghError: string | null = null;
  try {
    const gh = await installationOctokit(installation.githubInstallationId);
    [testsYaml, hiddenFiles] = await Promise.all([
      readFileText(gh, org, classroom.graderRepo, `${dir}/tests.yml`).then((s) => s ?? ""),
      listFiles(gh, org, classroom.graderRepo, `${dir}/files`).then((paths) => paths.map((p) => p.slice(`${dir}/files/`.length))),
    ]);
  } catch (err) {
    ghError = safeError(err);
  }

  const accepted = await db
    .select({ login: t.roster.githubLogin, repoName: t.studentRepos.repoName, acceptedAt: t.studentRepos.acceptedAt })
    .from(t.studentRepos)
    .innerJoin(t.roster, eq(t.roster.id, t.studentRepos.rosterId))
    .where(eq(t.studentRepos.assignmentId, assignment.id))
    .orderBy(asc(t.roster.githubLogin));

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
        {assignment.inviteCode && assignment.status !== "draft" && (
          <div>
            <label className="label">Invite link (share with students)</label>
            <CopyField value={inviteUrl(assignment.inviteCode)} />
          </div>
        )}
      </div>

      {ghError ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Could not read the grader repo: {ghError}</p>
      ) : (
        <TestsUpload assignmentId={assignment.id} initialYaml={testsYaml} existingFiles={hiddenFiles} />
      )}

      <div className="card">
        <h3 className="mb-3 font-medium">Accepted ({accepted.length})</h3>
        {accepted.length === 0 ? (
          <p className="text-sm text-slate-500">No students have accepted yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">Student</th>
                <th>Repository</th>
                <th>Accepted</th>
              </tr>
            </thead>
            <tbody>
              {accepted.map((a) => (
                <tr key={a.login} className="border-t border-slate-100">
                  <td className="py-1.5 font-mono">{a.login}</td>
                  <td>
                    <a href={`https://github.com/${org}/${a.repoName}`} className="font-mono text-blue-700 hover:underline">
                      {a.repoName}
                    </a>
                  </td>
                  <td>{fmtTime(a.acceptedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
