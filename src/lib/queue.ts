import { safeError } from "./log";

// Minimal in-process serial queue: webhook work runs after the HTTP response is sent.
// Lost on restart by design; the nightly reconcile cron catches anything dropped.
let tail: Promise<void> = Promise.resolve();

export function enqueue(name: string, job: () => Promise<void>) {
  tail = tail.then(job).catch((err) => console.error(`[queue] ${name} failed: ${safeError(err)}`));
}
