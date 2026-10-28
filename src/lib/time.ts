export const DISPLAY_TZ = "Africa/Accra";

/** Formats a UTC timestamp for display in Africa/Accra. */
export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(d));
}

/** Offset (ms) of DISPLAY_TZ from UTC at the given instant. */
function tzOffsetMs(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: DISPLAY_TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Parses a `<input type="datetime-local">` value as wall-clock time in Africa/Accra; returns UTC. */
export function parseLocalDeadline(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return new Date(guess.getTime() - tzOffsetMs(guess));
}
