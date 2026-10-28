"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PublishButton({ assignmentId }: { assignmentId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/assignments/${assignmentId}/publish`, { method: "POST" });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) return setError(body.error ?? "Publish failed");
          router.refresh();
        }}
      >
        {busy ? "Publishing…" : "Publish"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={value} className="input font-mono" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn-secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

type Accepted = { repoUrl: string; invitationUrl: string; alreadyAccepted: boolean };

export function AcceptButton({ inviteCode }: { inviteCode: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/accept/${inviteCode}`, { method: "POST" });
          const body = (await res.json().catch(() => ({}))) as Partial<Accepted> & { error?: string };
          setBusy(false);
          if (!res.ok) return setError(body.error ?? "Could not accept the assignment");
          router.refresh();
        }}
      >
        {busy ? "Creating your repository…" : "Accept assignment"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
