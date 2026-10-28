import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, t } from "@/db";
import { NewAssignmentForm } from "@/components/NewAssignmentForm";
import { RosterImport } from "@/components/RosterImport";
import { listTemplateRepos } from "@/lib/assignments";
import { assignmentCounts } from "@/lib/gradebook";
import { installationOctokit } from "@/lib/github";
import { safeError } from "@/lib/log";
import { classroomRole, loadClassroom, type Classroom } from "@/lib/roles";
import { COMBINED_SLUG_MAX } from "@/lib/slug";
import { requireUser } from "@/lib/session";
import { fmtTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const TABS = ["assignments", "roster", "settings"] as const;
type Tab = (typeof TABS)[number];

export default async function ClassroomPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; new?: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser(`/c/${slug}`);
  const row = await loadClassroom({ slug });
  if (!row) notFound();
  const role = await classroomRole(row.classroom, user);
  if (!role) notFound();
  const { classroom, installation } = row;

  const header = (
    <div className="mb-6">
      <div className="text-sm text-slate-500">
        {installation.orgLogin} · {classroom.term}
      </div>
      <h1 className="text-2xl font-bold">{classroom.name}</h1>
    </div>
  );

  if (role === "student") {
    const [me] = await db
      .select({ id: t.roster.id })
      .from(t.roster)
      .where(and(eq(t.roster.classroomId, classroom.id), eq(t.roster.githubLogin, user.githubLogin.toLowerCase())));
    const assignments = await db
      .select({ a: t.assignments, repoName: t.studentRepos.repoName })
      .from(t.assignments)
      .leftJoin(t.studentRepos, and(eq(t.studentRepos.assignmentId, t.assignments.id), eq(t.studentRepos.rosterId, me.id)))
      .where(and(eq(t.assignments.classroomId, classroom.id), inArray(t.assignments.status, ["published", "closed"])))
      .orderBy(asc(t.assignments.deadline));
    return (
      <div>
        {header}
        <h2 className="mb-3 text-lg font-semibold">My assignments</h2>
        {assignments.length === 0 ? (
          <p className="text-sm text-slate-500">No assignments have been published yet.</p>
        ) : (
          <ul className="space-y-2">
            {assignments.map(({ a, repoName }) => (
              <li key={a.id} className="card flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link href={`/c/${classroom.slug}/a/${a.slug}`} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                  <div className="text-sm text-slate-500">Due {fmtTime(a.deadline)}</div>
                </div>
                {repoName ? (
                  <a href={`https://github.com/${installation.orgLogin}/${repoName}`} className="font-mono text-sm text-blue-700 hover:underline">
                    {repoName}
                  </a>
                ) : a.status === "published" && a.inviteCode && a.deadline.getTime() > Date.now() ? (
                  <Link href={`/a/${a.inviteCode}`} className="btn">
                    Accept
                  </Link>
                ) : (
                  <span className="text-sm text-slate-400">Closed</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "assignments";

  return (
    <div>
      {header}
      <nav className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((name) => (
          <Link
            key={name}
            href={`/c/${classroom.slug}?tab=${name}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm capitalize ${
              tab === name ? "border-slate-900 font-medium" : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {name}
          </Link>
        ))}
      </nav>
      {tab === "assignments" && (
        <AssignmentsTab classroom={classroom} org={installation.orgLogin} installationId={installation.githubInstallationId} showNew={sp.new === "1"} />
      )}
      {tab === "roster" && <RosterTab classroomId={classroom.id} />}
      {tab === "settings" && <SettingsTab org={installation.orgLogin} graderRepo={classroom.graderRepo} />}
    </div>
  );
}

async function AssignmentsTab({
  classroom,
  org,
  installationId,
  showNew,
}: {
  classroom: Classroom;
  org: string;
  installationId: number;
  showNew: boolean;
}) {
  const assignments = await db
    .select()
    .from(t.assignments)
    .where(eq(t.assignments.classroomId, classroom.id))
    .orderBy(asc(t.assignments.deadline));
  const counts = await assignmentCounts(classroom.id);

  let newForm: React.ReactNode = null;
  if (showNew) {
    try {
      const templates = await listTemplateRepos(await installationOctokit(installationId), org);
      newForm = (
        <NewAssignmentForm
          classroomId={classroom.id}
          classroomSlug={classroom.slug}
          templates={templates}
          maxSlug={COMBINED_SLUG_MAX - classroom.slug.length}
        />
      );
    } catch (err) {
      newForm = <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Could not list template repos: {safeError(err)}</p>;
    }
  }

  return (
    <div className="space-y-4">
      {showNew ? (
        newForm
      ) : (
        <Link href={`/c/${classroom.slug}?tab=assignments&new=1`} className="btn">
          New assignment
        </Link>
      )}
      {assignments.length === 0 ? (
        <p className="text-sm text-slate-500">No assignments yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-2">Title</th>
              <th>Status</th>
              <th>Deadline</th>
              <th className="text-right">Accepted</th>
              <th className="text-right">Submitted</th>
              <th className="text-right">Graded</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id} className="border-t border-slate-200">
                <td className="py-2">
                  <Link href={`/c/${classroom.slug}/a/${a.slug}`} className="font-medium hover:underline">
                    {a.title}
                  </Link>{" "}
                  <span className="font-mono text-xs text-slate-400">{a.slug}</span>
                </td>
                <td>{a.status}</td>
                <td>{fmtTime(a.deadline)}</td>
                <td className="text-right tabular-nums">{counts.get(a.id)?.accepted ?? 0}</td>
                <td className="text-right tabular-nums">{counts.get(a.id)?.submitted ?? 0}</td>
                <td className="text-right tabular-nums">{counts.get(a.id)?.graded ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

async function RosterTab({ classroomId }: { classroomId: number }) {
  const students = await db
    .select({ login: t.roster.githubLogin, userId: t.roster.userId })
    .from(t.roster)
    .where(eq(t.roster.classroomId, classroomId))
    .orderBy(asc(t.roster.githubLogin));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <RosterImport classroomId={classroomId} />
      <div className="card">
        <h3 className="mb-3 font-medium">{students.length} students</h3>
        {students.length === 0 ? (
          <p className="text-sm text-slate-500">The roster is empty.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">GitHub username</th>
                <th>Signed in</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.login} className="border-t border-slate-100">
                  <td className="py-1.5">
                    <a href={`https://github.com/${s.login}`} className="font-mono hover:underline">
                      {s.login}
                    </a>
                  </td>
                  <td>{s.userId ? "yes" : <span className="text-slate-400">not yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SettingsTab({ org, graderRepo }: { org: string; graderRepo: string }) {
  const repoUrl = `https://github.com/${org}/${graderRepo}`;
  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="font-medium">Grader repository</h3>
        <p className="mt-1 text-sm">
          <a href={repoUrl} className="font-mono text-blue-700 hover:underline">
            {org}/{graderRepo}
          </a>{" "}
          (private). Hidden tests live here; students never get access.
        </p>
      </div>
      <div className="card">
        <h3 className="font-medium">Required: add the callback secret</h3>
        <p className="mt-1 text-sm text-slate-600">
          Grading results are posted back to this app using a shared secret. Without it, every submission ends in{" "}
          <em>error</em>.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          <li>
            Open{" "}
            <a href={`${repoUrl}/settings/secrets/actions/new`} className="text-blue-700 hover:underline">
              {graderRepo} → Settings → Secrets and variables → Actions → New repository secret
            </a>
            .
          </li>
          <li>
            Name: <code className="rounded bg-slate-100 px-1">GRADER_CALLBACK_SECRET</code>
          </li>
          <li>
            Secret: the value of <code className="rounded bg-slate-100 px-1">GRADER_CALLBACK_SECRET</code> from this
            app&apos;s environment (ask whoever deployed the app if you don&apos;t have it).
          </li>
          <li>Click <strong>Add secret</strong>.</li>
        </ol>
      </div>
    </div>
  );
}
