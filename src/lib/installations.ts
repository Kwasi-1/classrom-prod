import { db, t } from "@/db";
import { appOctokit } from "./github";

/** Fetches an installation via the app JWT and upserts it. Only organization installs are stored. */
export async function storeInstallation(githubInstallationId: number) {
  const { data } = await appOctokit().request("GET /app/installations/{installation_id}", {
    installation_id: githubInstallationId,
  });
  const account = data.account as { login?: string; id: number; type?: string } | null;
  if (!account?.login || account.type !== "Organization") return null;
  const [row] = await db
    .insert(t.installations)
    .values({ githubInstallationId, orgLogin: account.login, orgId: account.id })
    .onConflictDoUpdate({
      target: t.installations.githubInstallationId,
      set: { orgLogin: account.login, orgId: account.id },
    })
    .returning();
  return row;
}
