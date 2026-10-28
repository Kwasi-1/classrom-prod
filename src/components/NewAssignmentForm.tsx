"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewAssignmentForm({
  classroomId,
  classroomSlug,
  templates,
  maxSlug,
}: {
  classroomId: number;
  classroomSlug: string;
  templates: string[];
  maxSlug: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/classrooms/${classroomId}/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Could not create assignment");
    router.push(`/c/${classroomSlug}/a/${body.slug}`);
  }

  if (templates.length === 0) {
    return (
      <div className="card text-sm text-slate-600">
        No template repositories found. In your organization, open a starter repo&apos;s <strong>Settings</strong> and tick{" "}
        <strong>Template repository</strong>, and make sure the app&apos;s installation has access to it.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label">Title</label>
        <input name="title" className="input" placeholder="Homework 1: Hello Python" required maxLength={200} />
      </div>
      <div>
        <label className="label">Slug</label>
        <input
          name="slug"
          className="input font-mono"
          placeholder="hw1"
          required
          maxLength={maxSlug}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
        />
        <p className="mt-1 text-xs text-slate-500">
          Student repos: <span className="font-mono">{classroomSlug}-{slug || "slug"}-username</span>. Max {maxSlug} characters.
        </p>
      </div>
      <div>
        <label className="label">Template repository</label>
        <select name="templateRepo" className="input" required>
          {templates.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Deadline (Africa/Accra)</label>
        <input name="deadline" type="datetime-local" className="input" required />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn" disabled={busy}>
          {busy ? "Creating…" : "Create draft"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  );
}
