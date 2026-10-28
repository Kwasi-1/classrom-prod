/** Error text safe for logs: message + HTTP status only, never request headers or bodies (which may hold tokens). */
export function safeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { status?: number; message?: string };
    const msg = (e.message ?? String(err)).replace(/gh[pousr]_[A-Za-z0-9]+/g, "[redacted]");
    return e.status ? `${e.status} ${msg}` : msg;
  }
  return String(err);
}
