import { runCron } from "@/lib/cron";
import { reconcileSubmissions } from "@/lib/deadlines";

/** Nightly: create submissions for head commits whose push webhooks were missed. */
export async function POST(req: Request) {
  return runCron("reconcile", req, () => reconcileSubmissions());
}
