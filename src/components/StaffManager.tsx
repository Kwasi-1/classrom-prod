"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Member = { login: string; name: string | null };

/** Staff list for the classroom settings; add/remove controls only render for the owner. */
export function StaffManager({
  classroomId,
  owner,
  staff,
  canManage,
}: {
  classroomId: number;
  owner: Member;
  staff: Member[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(method: "POST" | "DELETE", who: string) {
    setBusy(who);
    setMessage(null);
    const res = await fetch(`/api/classrooms/${classroomId}/staff`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: who }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMessage({ ok: false, text: body.error ?? "Failed" });
    if (method === "POST") {
      setLogin("");
      setMessage({ ok: true, text: body.added ? `${body.login} added` : `${body.login} is already on the staff` });
    } else {
      setMessage({ ok: true, text: `${who} removed` });
    }
    router.refresh();
  }

  return (
    <div className="card">
      <h3 className="font-medium">Staff</h3>
      <p className="mt-1 text-sm text-slate-600">
        Staff have the same access as the owner: assignments, tests, roster, grades and exports.
        {canManage ? " They can be added before they first sign in." : " Only the owner can change the staff."}
      </p>
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        <li className="flex items-center justify-between py-1.5">
          <span>
            <span className="font-mono">{owner.login}</span>
            {owner.name && owner.name !== owner.login && <span className="ml-2 text-slate-500">{owner.name}</span>}
          </span>
          <span className="text-xs text-slate-500">owner</span>
        </li>
        {staff.map((m) => (
          <li key={m.login} className="flex items-center justify-between py-1.5">
            <span>
              <span className="font-mono">{m.login}</span>
              {m.name && m.name !== m.login && <span className="ml-2 text-slate-500">{m.name}</span>}
            </span>
            {canManage && (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => window.confirm(`Remove ${m.login} from the staff?`) && send("DELETE", m.login)}
              >
                {busy === m.login ? "Removing…" : "Remove"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send("POST", login);
          }}
        >
          <input
            className="input font-mono"
            placeholder="GitHub username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
          <button className="btn shrink-0" disabled={busy !== null || !login.trim()}>
            {busy === login ? "Adding…" : "Add staff"}
          </button>
        </form>
      )}
      {message && <p className={`mt-2 text-sm ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}
    </div>
  );
}
