import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { RosterImport } from "@/components/RosterImport";
import { classroomRole, loadClassroom } from "@/lib/roles";
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
  searchParams: Promise<{ tab?: string }>;
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
    const assignments = await db
      .select()
      .from(t.assignments)
      .where(and(eq(t.assignments.classroomId, classroom.id), eq(t.assignments.status, "published")))
      .orderBy(asc(t.assignments.deadline));
    return (
      <div>
        {header}
        <h2 className="mb-3 text-lg font-semibold">My assignments</h2>
        {assignments.length === 0 ? (
          <p className="text-sm text-slate-500">No assignments have been published yet.</p>
        ) : (
          <ul className="space-y-2">
            {assignments.map((a) => (
              <li key={a.id} className="card flex items-center justify-between">
                <span className="font-medium">{a.title}</span>
                <span className="text-sm text-slate-500">Due {fmtTime(a.deadline)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const tab: Tab = TABS.includes((await searchParams).tab as Tab) ? ((await searchParams).tab as Tab) : "assignments";

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
      {tab === "assignments" && <AssignmentsTab classroomId={classroom.id} />}
      {tab === "roster" && <RosterTab classroomId={classroom.id} />}
      {tab === "settings" && <SettingsTab org={installation.orgLogin} graderRepo={classroom.graderRepo} />}
    </div>
  );
}

async function AssignmentsTab({ classroomId }: { classroomId: number }) {
  const assignments = await db
    .select()
    .from(t.assignments)
    .where(eq(t.assignments.classroomId, classroomId))
    .orderBy(asc(t.assignments.deadline));
  if (assignments.length === 0) return <p className="text-sm text-slate-500">No assignments yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500">
        <tr>
          <th className="py-2">Title</th>
          <th>Status</th>
          <th>Deadline</th>
        </tr>
      </thead>
      <tbody>
        {assignments.map((a) => (
          <tr key={a.id} className="border-t border-slate-200">
            <td className="py-2 font-medium">{a.title}</td>
            <td>{a.status}</td>
            <td>{fmtTime(a.deadline)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
