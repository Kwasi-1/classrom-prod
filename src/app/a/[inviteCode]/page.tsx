import { notFound } from "next/navigation";
import { AcceptButton } from "@/components/ActionButtons";
import { loadAcceptContext, repoUrls } from "@/lib/accept";
import { requireUser } from "@/lib/session";
import { fmtTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AcceptPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params;
  const user = await requireUser(`/a/${inviteCode}`);
  const ctx = await loadAcceptContext(inviteCode, user);
  if (!ctx) notFound();
  const { assignment, classroom, installation, existing, problem } = ctx;

  return (
    <div className="mx-auto max-w-xl">
      <div className="card space-y-4">
        <div>
          <div className="text-sm text-slate-500">
            {classroom.name} · {classroom.term}
          </div>
          <h1 className="text-xl font-bold">{assignment.title}</h1>
          <div className="text-sm text-slate-500">Due {fmtTime(assignment.deadline)} (Africa/Accra)</div>
        </div>

        {existing ? (
          <Accepted org={installation.orgLogin} repoName={existing.repoName} />
        ) : problem ? (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{problem}</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Accepting creates a private repository for you in <strong>{installation.orgLogin}</strong>, starting from the
              assignment template. Push your work there; every push is graded automatically.
            </p>
            <AcceptButton inviteCode={inviteCode} />
          </div>
        )}
      </div>
    </div>
  );
}

function Accepted({ org, repoName }: { org: string; repoName: string }) {
  const { repoUrl, invitationUrl } = repoUrls(org, repoName);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-green-700">You have accepted this assignment.</p>
      <p>
        Your repository:{" "}
        <a href={repoUrl} className="font-mono text-blue-700 hover:underline">
          {org}/{repoName}
        </a>
      </p>
      <div className="rounded-md bg-slate-50 p-3">
        <strong>Next step:</strong> GitHub has sent you a collaborator invitation (by email and in your GitHub notifications).
        You must accept it before you can see or push to the repository:{" "}
        <a href={invitationUrl} className="text-blue-700 hover:underline">
          open the invitation
        </a>
        .
      </div>
    </div>
  );
}
