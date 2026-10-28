import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppInfo } from "@/lib/github";
import { getSession } from "@/lib/session";

/**
 * Sends the teacher to the GitHub App install page. With "Request user authorization during
 * installation" enabled, GitHub then redirects to /api/auth/callback with code + installation_id.
 */
export async function GET() {
  const session = await getSession();
  session.oauthState = randomBytes(16).toString("hex");
  session.returnTo = "/dashboard";
  await session.save();

  const { htmlUrl } = await getAppInfo();
  const url = new URL(`${htmlUrl}/installations/new`);
  url.searchParams.set("state", session.oauthState);
  return NextResponse.redirect(url);
}
