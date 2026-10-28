import { App } from "@octokit/app";
import { Octokit } from "@octokit/core";
import { env } from "./env";

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries 5xx and secondary-rate-limit responses (honouring retry-after), max 3 attempts total.
 */
function retryPlugin(octokit: Octokit) {
  octokit.hook.wrap("request", async (request, options) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request(options);
      } catch (err) {
        const e = err as { status?: number; message?: string; response?: { headers?: Record<string, string> } };
        const status = e.status ?? 0;
        const headers = e.response?.headers ?? {};
        const secondaryLimit =
          (status === 403 || status === 429) &&
          (headers["retry-after"] !== undefined || /secondary rate limit/i.test(e.message ?? ""));
        if (!(status >= 500 || secondaryLimit) || attempt >= MAX_ATTEMPTS) throw err;
        const retryAfter = Number(headers["retry-after"]);
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  });
}

export const GhOctokit = Octokit.plugin(retryPlugin);
export type Gh = InstanceType<typeof GhOctokit>;

const globalForGh = globalThis as unknown as {
  __ghApp?: App<{ Octokit: typeof GhOctokit }>;
  __ghTokens?: Map<string, { token: string; expiresAt: number }>;
  __ghAppInfo?: { slug: string; htmlUrl: string; botLogin: string };
};

export function githubApp() {
  if (!globalForGh.__ghApp) {
    const e = env();
    globalForGh.__ghApp = new App({
      appId: e.GITHUB_APP_ID,
      privateKey: e.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
      oauth: { clientId: e.GITHUB_APP_CLIENT_ID, clientSecret: e.GITHUB_APP_CLIENT_SECRET },
      webhooks: { secret: e.GITHUB_WEBHOOK_SECRET },
      Octokit: GhOctokit,
    });
  }
  return globalForGh.__ghApp;
}

/** App-level (JWT) client. */
export function appOctokit(): Gh {
  return githubApp().octokit as unknown as Gh;
}

export async function getAppInfo() {
  if (!globalForGh.__ghAppInfo) {
    const { data } = await appOctokit().request("GET /app");
    if (!data) throw new Error("GET /app returned no data");
    const slug = data.slug ?? String(data.id);
    globalForGh.__ghAppInfo = { slug, htmlUrl: data.html_url, botLogin: `${slug}[bot]` };
  }
  return globalForGh.__ghAppInfo;
}

type TokenScope = {
  repositories?: string[];
  permissions?: Record<string, "read" | "write">;
};

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Installation access token, cached until 5 minutes before expiry.
 * Pass `scope` to mint a token restricted to specific repos/permissions (e.g. for the grader).
 */
export async function installationToken(installationId: number, scope?: TokenScope): Promise<string> {
  const tokens = (globalForGh.__ghTokens ??= new Map());
  const key = `${installationId}:${JSON.stringify(scope ?? {})}`;
  const hit = tokens.get(key);
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > Date.now()) return hit.token;

  const { data } = await appOctokit().request("POST /app/installations/{installation_id}/access_tokens", {
    installation_id: installationId,
    ...(scope?.repositories ? { repositories: scope.repositories } : {}),
    ...(scope?.permissions ? { permissions: scope.permissions } : {}),
  });
  tokens.set(key, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

export async function installationOctokit(installationId: number): Promise<Gh> {
  return new GhOctokit({ auth: await installationToken(installationId) });
}

/** True if `login` is an active admin (owner) of `org`. Uses the installation token (needs Members: read). */
export async function isOrgAdmin(installationId: number, org: string, login: string): Promise<boolean> {
  const gh = await installationOctokit(installationId);
  try {
    const { data } = await gh.request("GET /orgs/{org}/memberships/{username}", { org, username: login });
    return data.role === "admin" && data.state === "active";
  } catch (err) {
    if ((err as { status?: number }).status === 404) return false;
    throw err;
  }
}
