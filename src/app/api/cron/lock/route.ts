import { runCron } from "@/lib/cron";
import { lockExpiredAssignments } from "@/lib/deadlines";

/** Every 5 minutes: lock student repos of assignments past their deadline. */
export async function POST(req: Request) {
  return runCron("lock", req, () => lockExpiredAssignments());
}
