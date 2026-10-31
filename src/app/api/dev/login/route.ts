import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { getSession, safeReturnTo } from "@/lib/session";

/**
 * Development only: sign in as an existing user without GitHub, to preview the UI with seeded data.
 *
 *   /api/dev/login?as=demo-teacher   (or a seeded student, e.g. kwame-dev)
 *
 * Disabled whenever NODE_ENV is "production" (`next start`, Render, Vercel).
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const login = req.nextUrl.searchParams.get("as")?.toLowerCase();
  const [user] = login
    ? await db.select().from(t.users).where(eq(sql`lower(${t.users.githubLogin})`, login))
    : [];
  if (!user) {
    const users = await db.select({ login: t.users.githubLogin }).from(t.users).orderBy(t.users.githubLogin);
    return NextResponse.json(
      { error: login ? `no user "${login}" (run npm run db:seed)` : "pass ?as=<login>", users: users.map((u) => u.login) },
      { status: 400 },
    );
  }

  const session = await getSession();
  session.userId = user.id;
  session.githubLogin = user.githubLogin;
  await session.save();
  return NextResponse.redirect(new URL(safeReturnTo(req.nextUrl.searchParams.get("next")) ?? "/dashboard", req.url));
}
