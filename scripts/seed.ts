/**
 * Seeds a demo classroom with a fake roster for local UI work. No GitHub calls are made,
 * so GitHub-backed actions (roster validation, grader seeding) won't work on this data.
 *
 *   npm run db:seed -- <your-github-login>
 *
 * Pass your GitHub login to be the demo classroom's owner (sign in once first so your user row exists).
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as t from "../src/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: t });
  const ownerLogin = process.argv[2];

  const [installation] = await db
    .insert(t.installations)
    .values({ githubInstallationId: 0, orgLogin: "demo-org", orgId: 0 })
    .onConflictDoUpdate({ target: t.installations.githubInstallationId, set: { orgLogin: "demo-org" } })
    .returning();

  let owner = ownerLogin
    ? (await db.select().from(t.users).where(eq(t.users.githubLogin, ownerLogin)))[0]
    : undefined;
  if (ownerLogin && !owner) console.warn(`No signed-in user "${ownerLogin}"; using a demo teacher instead.`);
  owner ??= (
    await db
      .insert(t.users)
      .values({ githubId: -1, githubLogin: "demo-teacher", name: "Demo Teacher" })
      .onConflictDoUpdate({ target: t.users.githubId, set: { name: "Demo Teacher" } })
      .returning()
  )[0];

  const [classroom] = await db
    .insert(t.classrooms)
    .values({
      installationId: installation.id,
      ownerUserId: owner.id,
      slug: "demo101",
      name: "Demo 101",
      term: "Fall 2026",
      graderRepo: "demo101-grader",
    })
    .onConflictDoUpdate({ target: t.classrooms.slug, set: { ownerUserId: owner.id } })
    .returning();

  const logins = ["kwame-dev", "ama-codes", "kofi-k", "efua-py", "yaw-builds", "akosua-js", "kojo-rs", "abena-go"];
  await db
    .insert(t.roster)
    .values(logins.map((githubLogin) => ({ classroomId: classroom.id, githubLogin })))
    .onConflictDoNothing();

  console.log(`Seeded classroom "${classroom.name}" (/c/${classroom.slug}) owned by ${owner.githubLogin} with ${logins.length} students.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
