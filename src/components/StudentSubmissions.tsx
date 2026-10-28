import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { PostButton } from "./ActionButtons";
import { fmtTime } from "@/lib/time";

/** Teacher-only: every submission for one student repo, newest first, with per-test output. */
export async function StudentSubmissions({
  assignmentId,
  studentRepoId,
  login,
  repoUrl,
  closeHref,
}: {
  assignmentId: number;
  studentRepoId: number;
  login: string;
  repoUrl: string;
  closeHref: string;
}) {
  const subs = await db
    .select()
    .from(t.submissions)
    .where(eq(t.submissions.studentRepoId, studentRepoId))
    .orderBy(desc(t.submissions.receivedAt), desc(t.submissions.id));

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">
          Submissions by <span className="font-mono">{login}</span> ({subs.length})
        </h3>
        <div className="flex items-center gap-3">
          {subs.length > 0 && (
            <PostButton
              url={`/api/assignments/${assignmentId}/regrade`}
              body={{ student_repo_id: studentRepoId }}
              label="Regrade latest"
              busyLabel="Dispatching…"
              done="Regrading started"
            />
          )}
          <Link href={closeHref} className="text-sm text-slate-500 hover:underline">
            Close
          </Link>
        </div>
      </div>
      {subs.length === 0 && <p className="text-sm text-slate-500">No submissions yet.</p>}
      {subs.map((s) => (
        <details key={s.id} className="rounded-md border border-slate-200 p-3" open={s.id === subs[0]?.id}>
          <summary className="cursor-pointer text-sm">
            <a href={`${repoUrl}/commit/${s.sha}`} className="font-mono text-blue-700 hover:underline">
              {s.sha.slice(0, 7)}
            </a>{" "}
            · {fmtTime(s.receivedAt)} · <strong>{s.status}</strong>
            {s.score != null && ` · ${s.score}/${s.maxScore}`}
            {s.isLate && <span className="ml-1 text-amber-700">· late</span>}
            {s.results?.source === "reconcile" && <span className="ml-1 text-slate-500">· via reconcile</span>}
          </summary>
          {s.results?.error && (
            <pre className="mt-2 whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-700">{s.results.error}</pre>
          )}
          {s.results?.tests && s.results.tests.length > 0 && (
            <table className="mt-2 w-full text-sm">
              <tbody>
                {s.results.tests.map((test) => (
                  <tr key={test.name} className="border-t border-slate-100 align-top">
                    <td className="w-6 py-1">{test.passed ? "✅" : "❌"}</td>
                    <td className="py-1">
                      <div>{test.name}</div>
                      {test.output_excerpt && (
                        <details>
                          <summary className="cursor-pointer text-xs text-slate-500">output</summary>
                          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">
                            {test.output_excerpt}
                          </pre>
                        </details>
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {test.points}/{test.max_points}
                    </td>
                    <td className="py-1 pl-3 text-right text-xs text-slate-500 tabular-nums">{test.duration_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      ))}
    </div>
  );
}
