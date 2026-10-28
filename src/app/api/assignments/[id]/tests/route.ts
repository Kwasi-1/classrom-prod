import { NextResponse } from "next/server";
import { handler, HttpError, requireApiUser } from "@/lib/api";
import { requireAssignmentRole, testsDir } from "@/lib/assignments";
import { installationOctokit } from "@/lib/github";
import { commitFiles, listFiles, type FileChange } from "@/lib/grader";
import { maxScore, parseTestsYaml } from "@/lib/tests-spec";

const MAX_SPEC_BYTES = 100_000;
const MAX_FILES = 50;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 5_000_000;

/** Normalizes a relative upload path; rejects traversal, absolute paths and .git. */
function cleanPath(raw: string): string {
  const segments = raw.replace(/\\/g, "/").replace(/^\.\//, "").split("/");
  const ok =
    raw.length <= 200 &&
    segments.length <= 10 &&
    segments.every((s) => s !== "" && s !== "." && s !== ".." && s.toLowerCase() !== ".git" && /^[\w.\- ]+$/.test(s));
  if (!ok) throw new HttpError(400, `Invalid file path: ${raw}`);
  return segments.join("/");
}

/**
 * multipart/form-data:
 *   tests | testsFile  tests.yml as text, or as an uploaded file
 *   files + paths      hidden test files, with paths[i] the relative path of files[i]
 *   removeFiles        "true" deletes all existing hidden files when none are uploaded
 * Uploading any files replaces the whole hidden-file set; uploading none keeps the existing set.
 */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { assignment, classroom, installation } = await requireAssignmentRole(Number((await ctx.params).id), user, "teacher");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Expected multipart/form-data");
  }
  const testsFile = form.get("testsFile");
  const yamlText = testsFile instanceof File && testsFile.size > 0 ? await testsFile.text() : String(form.get("tests") ?? "");
  if (!yamlText.trim()) throw new HttpError(400, "tests.yml is required");
  if (yamlText.length > MAX_SPEC_BYTES) throw new HttpError(413, "tests.yml is too large");

  const result = parseTestsYaml(yamlText);
  if (!result.ok) throw new HttpError(422, "tests.yml is invalid", { errors: result.errors });

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.name !== "");
  const paths = form.getAll("paths").map(String);
  if (files.length > MAX_FILES) throw new HttpError(413, `At most ${MAX_FILES} hidden files`);
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) throw new HttpError(413, "Hidden files exceed 5 MB in total");
  const uploads = await Promise.all(
    files.map(async (file, i) => {
      if (file.size > MAX_FILE_BYTES) throw new HttpError(413, `${file.name} is larger than 1 MB`);
      return { path: cleanPath(paths[i] || file.name), content: Buffer.from(await file.arrayBuffer()) };
    }),
  );
  if (new Set(uploads.map((u) => u.path)).size !== uploads.length) throw new HttpError(400, "Duplicate file paths");

  const dir = testsDir(assignment.slug);
  const org = installation.orgLogin;
  const gh = await installationOctokit(installation.githubInstallationId);
  const changes: FileChange[] = [
    { path: `${dir}/tests.yml`, content: yamlText },
    { path: `${dir}/tests.json`, content: JSON.stringify(result.spec, null, 2) + "\n" },
  ];
  const replaceFiles = uploads.length > 0 || form.get("removeFiles") === "true";
  if (replaceFiles) {
    const keep = new Set(uploads.map((u) => `${dir}/files/${u.path}`));
    for (const existing of await listFiles(gh, org, classroom.graderRepo, `${dir}/files`)) {
      if (!keep.has(existing)) changes.push({ path: existing, delete: true });
    }
    for (const u of uploads) changes.push({ path: `${dir}/files/${u.path}`, content: u.content });
  }

  const commit = await commitFiles(gh, org, classroom.graderRepo, changes, `Update tests for ${assignment.slug}`);
  return NextResponse.json({
    commit,
    tests: result.spec.tests.map((test) => ({ name: test.name, type: test.type, points: test.points })),
    maxScore: maxScore(result.spec),
    files: replaceFiles ? uploads.map((u) => u.path) : null,
  });
});
