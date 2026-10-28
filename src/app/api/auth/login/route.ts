import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getSession, safeReturnTo } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await getSession();
  session.oauthState = randomBytes(16).toString("hex");
  session.returnTo = safeReturnTo(req.nextUrl.searchParams.get("next"));
  await session.save();

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env().GITHUB_APP_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${env().APP_URL}/api/auth/callback`);
  url.searchParams.set("state", session.oauthState);
  return NextResponse.redirect(url);
}
