import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { env } from "./env";

export type SessionData = {
  userId?: number;
  githubLogin?: string;
  oauthState?: string;
  returnTo?: string;
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), {
    password: env().SESSION_SECRET,
    cookieName: "classroom_session",
    cookieOptions: {
      httpOnly: true,
      secure: env().APP_URL.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    },
  });
}

export async function currentUser() {
  const session = await getSession();
  if (!session.userId) return null;
  const [user] = await db.select().from(t.users).where(eq(t.users.id, session.userId));
  return user ?? null;
}

export type User = typeof t.users.$inferSelect;

/** Only allow same-site relative return paths (prevents open redirects). */
export function safeReturnTo(value: string | null | undefined): string | undefined {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : undefined;
}

/** For server components: the signed-in user, or redirect to login and come back. */
export async function requireUser(returnTo: string) {
  const user = await currentUser();
  if (!user) {
    redirect(`/api/auth/login?next=${encodeURIComponent(returnTo)}`);
  }
  return user;
}
