import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/api";
import { env } from "@/lib/env";
import { applyCallback, CallbackBody } from "@/lib/grading";
import { safeError } from "@/lib/log";

/** Called only by the grader workflow's trusted `report` job. */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), env().GRADER_CALLBACK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = CallbackBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  try {
    const outcome = await applyCallback(parsed.data);
    if (outcome === "not_found") return NextResponse.json({ error: "submission not found" }, { status: 404 });
    if (outcome === "sha_mismatch") return NextResponse.json({ error: "sha does not match submission" }, { status: 409 });
    return NextResponse.json({ ok: true, status: outcome });
  } catch (err) {
    console.error(`[grader-callback] ${safeError(err)}`);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
