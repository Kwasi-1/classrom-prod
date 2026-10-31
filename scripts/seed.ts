/**
 * Seeds a demo classroom for local UI work: a fake roster, three assignments (closed / published / draft),
 * student repos and submissions in every state. No GitHub calls are made, so GitHub-backed actions
 * (roster validation, grader seeding, regrade, accept) won't work on this data.
 *
 *   npm run db:seed -- [your-github-login]
 *
 * Pass your GitHub login to be the demo classroom's owner (sign in once first so your user row exists);
 * otherwise a "demo-teacher" user owns it. In development, sign in as any seeded user with
 * /api/dev/login?as=demo-teacher (or a student, e.g. kwame-dev). Re-running resets the demo assignments.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as t from "../src/db/schema";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

type TestDef = { name: string; points: number; failure: string };

const HW1_TESTS: TestDef[] = [
  { name: "adds two numbers", points: 10, failure: "NotImplementedError" },
  { name: "adds negative numbers", points: 10, failure: "expected -3, got 5" },
  { name: "unit tests", points: 30, failure: "2 failed, 3 passed in 0.12s" },
];
const HW2_TESTS: TestDef[] = [
  { name: "sum of list", points: 10, failure: "expected 15, got 0" },
  { name: "reverses a list", points: 10, failure: "IndexError: list index out of range" },
  { name: "counts vowels", points: 10, failure: "[timed out after 5s]" },
  { name: "unit tests", points: 30, failure: "4 failed, 2 passed in 0.31s" },
];

/** A scripted submission: which tests pass, and when it arrived relative to the deadline. */
type Sub = {
  pass?: boolean[];
  at: number;
  status?: "queued" | "running" | "error";
  source?: "reconcile";
};
type Scenario = { accepted: boolean; locked?: boolean; subs: Sub[] };

function results(tests: TestDef[], pass: boolean[]): t.SubmissionResults {
  return {
    tests: tests.map((test, i) => ({
      name: test.name,
      passed: pass[i],
      points: pass[i] ? test.points : 0,
      max_points: test.points,
      duration_ms: 150 + i * 220,
      output_excerpt: pass[i] ? "" : test.failure,
    })),
    error: null,
  };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: t });
  const ownerLogin = process.argv[2];
  const now = Date.now();

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

  const [ta] = await db
    .insert(t.users)
    .values({ githubId: -2, githubLogin: "demo-ta", name: "Demo TA" })
    .onConflictDoUpdate({ target: t.users.githubId, set: { name: "Demo TA" } })
    .returning();
  await db.insert(t.classroomStaff).values({ classroomId: classroom.id, userId: ta.id }).onConflictDoNothing();

  // Every student except the last has signed in once, so they have a user row (and can use the dev login).
  const logins = ["kwame-dev", "ama-codes", "kofi-k", "efua-py", "yaw-builds", "akosua-js", "kojo-rs", "abena-go"];
  const rosterIds = new Map<string, number>();
  for (const [i, githubLogin] of logins.entries()) {
    let userId: number | null = null;
    if (i < logins.length - 1) {
      const [user] = await db
        .insert(t.users)
        .values({ githubId: -100 - i, githubLogin, name: githubLogin })
        .onConflictDoUpdate({ target: t.users.githubId, set: { githubLogin } })
        .returning();
      userId = user.id;
    }
    const [r] = await db
      .insert(t.roster)
      .values({ classroomId: classroom.id, githubLogin, userId })
      .onConflictDoUpdate({ target: [t.roster.classroomId, t.roster.githubLogin], set: { userId } })
      .returning();
    rosterIds.set(githubLogin, r.id);
  }

  // Reset the demo assignments; student repos and submissions cascade.
  await db.delete(t.assignments).where(eq(t.assignments.classroomId, classroom.id));

  const all = (n: number) => Array<boolean>(n).fill(true);
  const assignments: {
    slug: string;
    title: string;
    deadline: number;
    status: "draft" | "published" | "closed";
    tests: TestDef[];
    scenarios: Record<string, Scenario>;
  }[] = [
    {
      slug: "hw1",
      title: "Hello, Python",
      deadline: now - 10 * DAY,
      status: "closed",
      tests: HW1_TESTS,
      scenarios: {
        "kwame-dev": {
          accepted: true,
          locked: true,
          subs: [
            { pass: [false, false, false], at: -3 * DAY },
            { pass: [true, false, true], at: -2 * DAY },
            { pass: all(3), at: -1 * DAY },
          ],
        },
        "ama-codes": {
          accepted: true,
          locked: true,
          subs: [
            { pass: all(3), at: -2 * DAY },
            { pass: all(3), at: 2 * MIN }, // late, after a fix-up push
          ],
        },
        "kofi-k": {
          accepted: true,
          locked: true,
          subs: [
            { pass: [true, false, false], at: -30 * MIN },
            { pass: all(3), at: 1 * MIN }, // late: final score stays 10
          ],
        },
        "efua-py": { accepted: true, locked: true, subs: [{ pass: [false, false, true], at: -5 * DAY }] },
        "yaw-builds": { accepted: true, locked: true, subs: [] },
        "akosua-js": { accepted: true, locked: true, subs: [{ at: -1 * DAY, status: "error" }] },
        "kojo-rs": { accepted: true, locked: true, subs: [{ pass: all(3), at: -4 * 60 * MIN, source: "reconcile" }] },
      },
    },
    {
      slug: "hw2",
      title: "Lists and loops",
      deadline: now + 5 * DAY,
      status: "published",
      tests: HW2_TESTS,
      scenarios: {
        "kwame-dev": {
          accepted: true,
          subs: [
            { pass: [true, true, false, false], at: -7 * DAY },
            { pass: [true, true, true, true], at: -5 * DAY - 2 * MIN, status: "running" },
          ],
        },
        "ama-codes": { accepted: true, subs: [{ pass: all(4), at: -6 * DAY }] },
        "kofi-k": { accepted: true, subs: [{ at: -5 * DAY - 1 * MIN, status: "queued" }] },
        "efua-py": { accepted: true, subs: [{ pass: [true, false, false, true], at: -6 * DAY }] },
        "yaw-builds": { accepted: true, subs: [] },
      },
    },
    { slug: "hw3", title: "Recursion", deadline: now + 21 * DAY, status: "draft", tests: [], scenarios: {} },
  ];

  let repoId = 900_000;
  for (const a of assignments) {
    const deadline = new Date(a.deadline);
    const [assignment] = await db
      .insert(t.assignments)
      .values({
        classroomId: classroom.id,
        slug: a.slug,
        title: a.title,
        templateRepo: "hello-python",
        deadline,
        status: a.status,
        inviteCode: a.status === "draft" ? null : `demo-${randomBytes(6).toString("hex")}`,
        createdAt: new Date(a.deadline - 14 * DAY),
      })
      .returning();

    for (const [login, s] of Object.entries(a.scenarios)) {
      if (!s.accepted) continue;
      const [repo] = await db
        .insert(t.studentRepos)
        .values({
          assignmentId: assignment.id,
          rosterId: rosterIds.get(login)!,
          repoName: `${classroom.slug}-${a.slug}-${login}`,
          repoId: repoId++,
          acceptedAt: new Date(Math.min(a.deadline - 8 * DAY, now - DAY)),
          lockedAt: s.locked ? new Date(a.deadline + 3 * MIN) : null,
        })
        .returning();

      for (const sub of s.subs) {
        const receivedAt = new Date(a.deadline + sub.at);
        const graded = !sub.status && sub.pass;
        const res: t.SubmissionResults | null = graded
          ? results(a.tests, sub.pass!)
          : sub.status === "error"
            ? { tests: [], error: "grader did not produce results (test job: failure)" }
            : null;
        if (res && sub.source) res.source = sub.source;
        await db.insert(t.submissions).values({
          studentRepoId: repo.id,
          sha: randomBytes(20).toString("hex"),
          receivedAt,
          status: sub.status ?? "graded",
          score: graded ? res!.tests!.reduce((n, x) => n + x.points, 0) : null,
          maxScore: graded ? a.tests.reduce((n, x) => n + x.points, 0) : null,
          results: res,
          isLate: receivedAt.getTime() > a.deadline,
        });
      }
    }
  }

  console.log(`Seeded classroom "${classroom.name}" (/c/${classroom.slug}) owned by ${owner.githubLogin}:`);
  console.log(`  ${logins.length} students, staff demo-ta, assignments hw1 (closed), hw2 (published), hw3 (draft).`);
  console.log(`  Dev sign-in: http://localhost:3000/api/dev/login?as=${owner.githubLogin}  (TA: ?as=demo-ta, student: ?as=kwame-dev)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
