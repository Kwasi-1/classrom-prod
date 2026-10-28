import { readFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./api";
import { env } from "./env";
import type { Gh } from "./github";

const TEMPLATE_DIR = path.join(process.cwd(), "grader-template");
const TEMPLATE_FILES = [".github/workflows/grade.yml", "grader/run_tests.py", "README.md"];
/** Top-level entries a repo may contain for us to adopt it as an existing grader repo. */
const ADOPTABLE_ENTRIES = new Set(["README.md", ".github", "grader", "assignments"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (err: unknown) => (err as { status?: number }).status;

export function graderRepoName(classroomSlug: string) {
  return `${classroomSlug}-grader`;
}

/** Creates or updates one file via the Contents API (one commit per file). */
export async function putFile(gh: Gh, owner: string, repo: string, filePath: string, content: string | Buffer, message: string) {
  let sha: string | undefined;
  try {
    const { data } = await gh.request("GET /repos/{owner}/{repo}/contents/{path}", { owner, repo, path: filePath });
    if (!Array.isArray(data)) sha = data.sha;
  } catch (err) {
    if (status(err) !== 404) throw err;
  }
  await gh.request("PUT /repos/{owner}/{repo}/contents/{path}", {
    owner,
    repo,
    path: filePath,
    message,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  });
}

async function renderTemplate(file: string, vars: Record<string, string>) {
  let text = await readFile(path.join(TEMPLATE_DIR, file), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(k, v);
  return text;
}

/** Creates the private grader repo, or adopts it if it exists and only holds grader files. */
async function ensureRepo(gh: Gh, org: string, name: string, classroomName: string) {
  try {
    await gh.request("POST /orgs/{org}/repos", {
      org,
      name,
      private: true,
      auto_init: true,
      description: `Autograder for ${classroomName} (hidden tests — keep private)`,
      has_issues: false,
      has_wiki: false,
      has_projects: false,
    });
  } catch (err) {
    if (status(err) !== 422) throw err;
    const { data: repo } = await gh.request("GET /repos/{owner}/{repo}", { owner: org, repo: name });
    const { data: root } = await gh.request("GET /repos/{owner}/{repo}/contents/{path}", { owner: org, repo: name, path: "" });
    const entries = Array.isArray(root) ? root.map((e) => e.name) : [];
    if (!repo.private || entries.some((e) => !ADOPTABLE_ENTRIES.has(e))) {
      throw new HttpError(409, `Repository ${org}/${name} already exists and is not a grader repo. Pick another slug.`);
    }
  }
  // auto_init commits asynchronously; wait until the default branch is readable (max ~10s).
  for (let i = 0; i < 10; i++) {
    try {
      await gh.request("GET /repos/{owner}/{repo}/commits", { owner: org, repo: name, per_page: 1 });
      return;
    } catch (err) {
      if (status(err) !== 404 && status(err) !== 409) throw err;
      await sleep(1000);
    }
  }
  throw new Error(`grader repo ${org}/${name} not ready after 10s`);
}

/** Creates `{slug}-grader` in the org and commits the workflow, runner and README. Returns the repo name. */
export async function seedGraderRepo(gh: Gh, org: string, classroomSlug: string, classroomName: string) {
  const name = graderRepoName(classroomSlug);
  await ensureRepo(gh, org, name, classroomName);
  const vars = { __APP_URL__: env().APP_URL, __CLASSROOM__: classroomName };
  for (const file of TEMPLATE_FILES) {
    await putFile(gh, org, name, file, await renderTemplate(file, vars), `Seed ${file}`);
  }
  return name;
}

export type FileChange = { path: string; content: string | Buffer } | { path: string; delete: true };

/**
 * Commits many file additions/deletions as a single commit on the default branch (Git Data API),
 * so a tests upload is atomic: the grader never sees a half-updated assignment.
 */
export async function commitFiles(gh: Gh, owner: string, repo: string, changes: FileChange[], message: string) {
  const { data: repoData } = await gh.request("GET /repos/{owner}/{repo}", { owner, repo });
  const branch = repoData.default_branch;
  const { data: ref } = await gh.request("GET /repos/{owner}/{repo}/git/ref/{ref}", { owner, repo, ref: `heads/${branch}` });
  const { data: head } = await gh.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
    owner,
    repo,
    commit_sha: ref.object.sha,
  });

  const tree = [];
  for (const change of changes) {
    if ("delete" in change) {
      tree.push({ path: change.path, mode: "100644" as const, type: "blob" as const, sha: null });
    } else {
      const { data: blob } = await gh.request("POST /repos/{owner}/{repo}/git/blobs", {
        owner,
        repo,
        content: Buffer.from(change.content).toString("base64"),
        encoding: "base64",
      });
      tree.push({ path: change.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha });
    }
  }
  const { data: newTree } = await gh.request("POST /repos/{owner}/{repo}/git/trees", {
    owner,
    repo,
    base_tree: head.tree.sha,
    tree,
  });
  const { data: commit } = await gh.request("POST /repos/{owner}/{repo}/git/commits", {
    owner,
    repo,
    message,
    tree: newTree.sha,
    parents: [head.sha],
  });
  await gh.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", { owner, repo, ref: `heads/${branch}`, sha: commit.sha });
  return commit.sha;
}

/** Paths of all files under `prefix/` on the default branch. */
export async function listFiles(gh: Gh, owner: string, repo: string, prefix: string): Promise<string[]> {
  const { data } = await gh.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
    owner,
    repo,
    tree_sha: "HEAD",
    recursive: "1",
  });
  return data.tree.filter((e) => e.type === "blob" && e.path?.startsWith(`${prefix}/`)).map((e) => e.path!);
}

/** Text content of a file, or null if it doesn't exist. */
export async function readFileText(gh: Gh, owner: string, repo: string, filePath: string): Promise<string | null> {
  try {
    const { data } = await gh.request("GET /repos/{owner}/{repo}/contents/{path}", { owner, repo, path: filePath });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (err) {
    if (status(err) === 404) return null;
    throw err;
  }
}
