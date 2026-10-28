import Link from "next/link";
import { eq, or, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { CreateClassroomForm } from "@/components/CreateClassroomForm";
import { isOrgAdmin } from "@/lib/github";
import { safeError } from "@/lib/log";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireUser("/dashboard");

  const installs = await db.select().from(t.installations);
  const adminOf = (
    await Promise.all(
      installs.map(async (i) => {
        try {
          return (await isOrgAdmin(i.githubInstallationId, i.orgLogin, user.githubLogin)) ? i : null;
        } catch (err) {
          console.error(`[dashboard] admin check ${i.orgLogin}: ${safeError(err)}`);
          return null;
        }
      }),
    )
  ).filter((i) => i !== null);

  const teaching = await db
    .selectDistinct({ c: t.classrooms, org: t.installations.orgLogin })
    .from(t.classrooms)
    .innerJoin(t.installations, eq(t.installations.id, t.classrooms.installationId))
    .leftJoin(t.classroomStaff, eq(t.classroomStaff.classroomId, t.classrooms.id))
    .where(or(eq(t.classrooms.ownerUserId, user.id), eq(t.classroomStaff.userId, user.id)));

  const enrolled = await db
    .select({ c: t.classrooms, org: t.installations.orgLogin })
    .from(t.roster)
    .innerJoin(t.classrooms, eq(t.classrooms.id, t.roster.classroomId))
    .innerJoin(t.installations, eq(t.installations.id, t.classrooms.installationId))
    .where(eq(t.roster.githubLogin, sql`lower(${user.githubLogin})`));

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Organizations</h2>
          <a href="/api/auth/install" className="btn-secondary">
            Install on organization
          </a>
        </div>
        {adminOf.length === 0 ? (
          <p className="text-sm text-slate-500">
            No organizations where you are an admin have the app installed yet.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {adminOf.map((i) => (
              <li key={i.id} className="card flex items-center justify-between">
                <span className="font-medium">{i.orgLogin}</span>
                <span className="text-xs text-slate-500">installation {i.githubInstallationId}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {adminOf.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">New classroom</h2>
          <CreateClassroomForm orgs={adminOf.map((i) => ({ id: i.id, login: i.orgLogin }))} />
        </section>
      )}

      <ClassroomList title="Teaching" rows={teaching} empty="You are not teaching any classrooms." />
      <ClassroomList title="Enrolled" rows={enrolled} empty="You are not on any classroom roster." />
    </div>
  );
}

function ClassroomList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { c: typeof t.classrooms.$inferSelect; org: string }[];
  empty: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map(({ c, org }) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}`} className="card block hover:border-slate-400">
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-slate-500">
                  {org} · {c.term}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
