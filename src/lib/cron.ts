import { NextResponse } from "next/server";
import { bearerMatches } from "./api";
import { env } from "./env";
import { safeError } from "./log";

const running = new Set<string>();

/** Runs a cron job behind `Authorization: Bearer CRON_SECRET`, skipping if the same job is still running. */
export async function runCron(name: string, req: Request, job: () => Promise<object>) {
  if (!bearerMatches(req.headers.get("authorization"), env().CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (running.has(name)) return NextResponse.json({ ok: true, skipped: "already running" });
  running.add(name);
  const started = Date.now();
  try {
    const summary = await job();
    console.info(`[cron] ${name} ${JSON.stringify(summary)} in ${Date.now() - started} ms`);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error(`[cron] ${name} failed: ${safeError(err)}`);
    return NextResponse.json({ error: "cron job failed" }, { status: 500 });
  } finally {
    running.delete(name);
  }
}
