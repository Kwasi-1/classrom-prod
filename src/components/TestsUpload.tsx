"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Picked = { file: File; path: string };

export function TestsUpload({ assignmentId, initialYaml, existingFiles }: { assignmentId: number; initialYaml: string; existingFiles: string[] }) {
  const router = useRouter();
  const [yaml, setYaml] = useState(initialYaml);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [removeFiles, setRemoveFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  function onPick(list: FileList | null, keepFolders: boolean) {
    if (!list) return;
    setPicked(
      Array.from(list).map((file) => {
        // For a folder pick, drop the top-level folder name: tests/test_x.py stays tests/test_x.py inside files/.
        const rel = keepFolders && file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
        return { file, path: rel };
      }),
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    setSaved(null);
    const form = new FormData();
    form.set("tests", yaml);
    for (const p of picked) {
      form.append("files", p.file);
      form.append("paths", p.path);
    }
    if (removeFiles) form.set("removeFiles", "true");
    const res = await fetch(`/api/assignments/${assignmentId}/tests`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErrors(body.details?.errors ?? [body.error ?? "Upload failed"]);
    setSaved(`Saved ${body.tests.length} tests (${body.maxScore} points) to the grader repo.`);
    setPicked([]);
    setRemoveFiles(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">tests.yml</h3>
        <label className="btn-secondary cursor-pointer">
          Load file
          <input
            type="file"
            accept=".yml,.yaml"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setYaml(await f.text());
            }}
          />
        </label>
      </div>
      <textarea
        className="input h-72 font-mono text-xs"
        spellCheck={false}
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        placeholder={"image: python:3.12-slim\ntests:\n  - name: adds two numbers\n    type: io\n    run: python main.py\n    input: \"2 3\"\n    expected: \"5\"\n    points: 10"}
      />

      <div>
        <h3 className="font-medium">Hidden test files</h3>
        <p className="mt-1 text-xs text-slate-500">
          Copied into the student&apos;s repo before tests run, replacing any student file at the same path. Uploading
          replaces the whole set.
        </p>
        {existingFiles.length > 0 && (
          <div className="mt-2 font-mono text-xs text-slate-600">Current: {existingFiles.join(", ")}</div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="btn-secondary cursor-pointer">
            Choose files
            <input type="file" multiple className="hidden" onChange={(e) => onPick(e.target.files, false)} />
          </label>
          <button type="button" className="btn-secondary" onClick={() => folderInput.current?.click()}>
            Choose folder
          </button>
          <input
            ref={(el) => {
              folderInput.current = el;
              el?.setAttribute("webkitdirectory", "");
            }}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onPick(e.target.files, true)}
          />
          {existingFiles.length > 0 && picked.length === 0 && (
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={removeFiles} onChange={(e) => setRemoveFiles(e.target.checked)} />
              Remove all hidden files
            </label>
          )}
        </div>
        {picked.length > 0 && <div className="mt-2 font-mono text-xs">New: {picked.map((p) => p.path).join(", ")}</div>}
      </div>

      <div className="flex items-center gap-3">
        <button className="btn" disabled={busy || !yaml.trim()}>
          {busy ? "Validating & committing…" : "Validate & save"}
        </button>
        {saved && <span className="text-sm text-green-700">{saved}</span>}
      </div>
      {errors.length > 0 && (
        <ul className="list-disc space-y-1 rounded-md bg-red-50 p-3 pl-8 font-mono text-xs text-red-700">
          {errors.map((err, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {err}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
