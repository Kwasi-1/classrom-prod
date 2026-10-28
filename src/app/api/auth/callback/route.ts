import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, t } from "@/db";
import { env } from "@/lib/env";
import { GhOctokit } from "@/lib/github";
import { storeInstallation } from "@/lib/installations";
import { safeError } from "@/lib/log";
import { getSession } from "@/lib/session";

function fail(message: string) {
  const url = new URL("/", env().APP_URL);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const installationId = Number(params.get("installation_id")) || null;
  const session = await getSession();

  if (!code) return fail("Missing OAuth code");
  if (!state || state !== session.oauthState) return fail("Login expired, please try again");
  session.oauthState = undefined;

  // Exchange the code for a user-to-server token (used only here, never stored).
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env().GITHUB_APP_CLIENT_ID,
      client_secret: env().GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: `${env().APP_URL}/api/auth/callback`,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!tokenJson.access_token) return fail(tokenJson.error_description ?? "GitHub login failed");

  const userGh = new GhOctokit({ auth: tokenJson.access_token });
  const { data: ghUser } = await userGh.request("GET /user");

  const [user] = await db
    .insert(t.users)
    .values({ githubId: Number(ghUser.id), githubLogin: ghUser.login, name: ghUser.name, avatarUrl: ghUser.avatar_url })
    .onConflictDoUpdate({
      target: t.users.githubId,
      set: { githubLogin: ghUser.login, name: ghUser.name, avatarUrl: ghUser.avatar_url },
    })
    .returning();

  // Link any roster entries waiting for this login.
  await db
    .update(t.roster)
    .set({ userId: user.id })
    .where(and(eq(t.roster.githubLogin, ghUser.login.toLowerCase()), isNull(t.roster.userId)));

  // Returning from an app install: store it, but only if this user can actually see that installation.
  if (installationId) {
    try {
      const { data } = await userGh.request("GET /user/installations", { per_page: 100 });
      if (data.installations.some((i) => i.id === installationId)) await storeInstallation(installationId);
    } catch (err) {
      console.error(`[auth] storing installation failed: ${safeError(err)}`);
    }
  }

  session.userId = user.id;
  session.githubLogin = user.githubLogin;
  const returnTo = session.returnTo ?? "/dashboard";
  session.returnTo = undefined;
  await session.save();
  return NextResponse.redirect(new URL(returnTo, env().APP_URL));
}
