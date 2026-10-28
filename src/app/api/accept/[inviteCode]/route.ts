import { NextResponse } from "next/server";
import { acceptAssignment } from "@/lib/accept";
import { handler, requireApiUser } from "@/lib/api";

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ inviteCode: string }> }) => {
  const user = await requireApiUser();
  const result = await acceptAssignment((await ctx.params).inviteCode, user);
  return NextResponse.json(result);
});
