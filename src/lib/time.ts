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
