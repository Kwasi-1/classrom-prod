import Link from "next/link";
import { applyFilter, FILTERS, type Filter, type GradebookRow } from "@/lib/gradebook";
import { fmtTime } from "@/lib/time";

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  "not-accepted": "Not accepted",
  "not-submitted": "Not submitted",
  late: "Late",
};

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-800",
  graded: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

export function SubmissionsTable({
  rows,
  org,
  filter,
  baseHref,
}: {
  rows: GradebookRow[];
  org: string;
  filter: Filter;
  baseHref: string;
}) {
  const shown = applyFilter(rows, filter);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, applyFilter(rows, f).length])) as Record<Filter, number>;

  return (
    <div className="card overflow-x-auto">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="mr-2 font-medium">Submissions</h3>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? baseHref : `${baseHref}${baseHref.includes("?") ? "&" : "?"}filter=${f}`}
            className={`rounded-full px-3 py-1 text-xs ${
              f === filter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {FILTER_LABELS[f]} ({counts[f]})
          </Link>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">No students match this filter.</p>
      ) : (
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Student</th>
              <th>Repository</th>
              <th>Accepted</th>
              <th>Latest SHA</th>
              <th>Received</th>
              <th>Score</th>
              <th title="Latest submission received by the deadline">Final</th>
              <th>Late</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const repoUrl = r.repoName ? `https://github.com/${org}/${r.repoName}` : null;
              return (
                <tr key={r.rosterId} className="border-t border-slate-100">
                  <td className="py-1.5 font-mono">
                    {r.studentRepoId ? (
                      <Link href={`${baseHref}${baseHref.includes("?") ? "&" : "?"}student=${r.login}`} className="hover:underline">
                        {r.login}
                      </Link>
                    ) : (
                      r.login
                    )}
                  </td>
                  <td>
                    {repoUrl ? (
                      <a href={repoUrl} className="font-mono text-blue-700 hover:underline">
                        {r.repoName}
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                    {r.lockedAt && <span className="ml-1 text-xs text-amber-700">locked</span>}
                  </td>
                  <td>{r.acceptedAt ? "yes" : <span className="text-slate-400">no</span>}</td>
                  <td>
                    {r.latest && repoUrl ? (
                      <a href={`${repoUrl}/commit/${r.latest.sha}`} className="font-mono text-blue-700 hover:underline">
                        {r.latest.sha.slice(0, 7)}
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td>{r.latest ? fmtTime(r.latest.receivedAt) : <span className="text-slate-400">—</span>}</td>
                  <td>
                    {r.latest?.score != null ? (
                      `${r.latest.score}/${r.latest.maxScore ?? "?"}`
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="font-medium">
                    {r.final ? (
                      r.final.score != null ? `${r.final.score}/${r.final.maxScore ?? "?"}` : <span className="text-slate-400">{r.final.status}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td>
                    {r.lateAttempts > 0 ? (
                      <span className="text-amber-700" title="Late submissions">
                        {r.latest?.isLate ? "late" : ""} ({r.lateAttempts})
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td>
                    {r.latest ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[r.latest.status]}`}>{r.latest.status}</span>
                    ) : (
                      ""
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
