"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { added: number; duplicates: number; invalid: number; invalidLogins: string[] };

export function RosterImport({ classroomId }: { classroomId: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch(`/api/classrooms/${classroomId}/roster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Import failed");
    setResult(body);
    setText("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Import students</h3>
        <label className="btn-secondary cursor-pointer">
          Upload CSV
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={onFile} />
        </label>
      </div>
      <textarea
        className="input h-32 font-mono"
        placeholder={"github_username\nkwame-dev\nama123"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="text-xs text-slate-500">
        One GitHub username per line (CSV: first column). An optional <code>github_username</code> header is ignored.
      </p>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={busy || !text.trim()}>
          {busy ? "Checking usernames…" : "Import"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      {result && (
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <span className="text-green-700">{result.added} added</span> ·{" "}
          <span className="text-slate-600">{result.duplicates} duplicates</span> ·{" "}
          <span className="text-red-600">{result.invalid} invalid</span>
          {result.invalidLogins.length > 0 && (
            <div className="mt-1 font-mono text-xs text-red-600">{result.invalidLogins.join(", ")}</div>
          )}
        </div>
      )}
    </form>
  );
}
