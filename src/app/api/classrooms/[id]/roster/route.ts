import { NextResponse } from "next/server";
import { handler, HttpError, requireApiUser } from "@/lib/api";
import { installationOctokit } from "@/lib/github";
import { requireClassroomRole } from "@/lib/roles";
import { importRoster } from "@/lib/roster";

const MAX_BYTES = 200_000;

/** Accepts multipart (`file` CSV upload or `text` field), JSON `{ text }`, or a plain-text body. */
async function readRosterText(req: Request): Promise<string> {
  const type = req.headers.get("content-type") ?? "";
  let text: string;
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    text = file instanceof File && file.size > 0 ? await file.text() : String(form.get("text") ?? "");
  } else if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { text?: unknown };
    text = typeof body.text === "string" ? body.text : "";
  } else {
    text = await req.text();
  }
  if (text.length > MAX_BYTES) throw new HttpError(413, "Roster is too large");
  if (!text.trim()) throw new HttpError(400, "No usernames provided");
  return text;
}

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { classroom, installation } = await requireClassroomRole(Number((await ctx.params).id), user, "teacher");
  const text = await readRosterText(req);
  const gh = await installationOctokit(installation.githubInstallationId);
  const result = await importRoster(gh, classroom.id, text);
  return NextResponse.json({
    added: result.added.length,
    duplicates: result.duplicates,
    invalid: result.invalid.length,
    addedLogins: result.added,
    invalidLogins: result.invalid,
  });
});
