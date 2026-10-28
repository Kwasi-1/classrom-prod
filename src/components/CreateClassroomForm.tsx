"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateClassroomForm({ orgs }: { orgs: { id: number; login: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installationId: Number(form.get("installationId")),
        name: form.get("name"),
        slug: form.get("slug"),
        term: form.get("term"),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Could not create classroom");
    router.push(`/c/${body.slug}?tab=settings`);
  }

  return (
    <form onSubmit={onSubmit} className="card grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label">Organization</label>
        <select name="installationId" className="input" required>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.login}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Name</label>
        <input name="name" className="input" placeholder="Data Structures" required maxLength={100} />
      </div>
      <div>
        <label className="label">Slug</label>
        <input
          name="slug"
          className="input font-mono"
          placeholder="cs323"
          required
          maxLength={40}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
        />
        <p className="mt-1 text-xs text-slate-500">
          Grader repo: <span className="font-mono">{slug || "slug"}-grader</span>. Lowercase, digits, hyphens; max 40.
        </p>
      </div>
      <div>
        <label className="label">Term</label>
        <input name="term" className="input" placeholder="Fall 2026" required maxLength={50} />
      </div>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button className="btn" disabled={busy}>
          {busy ? "Creating grader repo…" : "Create classroom"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  );
}
