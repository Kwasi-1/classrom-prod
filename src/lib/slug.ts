const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CLASSROOM_SLUG_MAX = 40;
/** Repo names are `{classroom}-{assignment}-{login}`; GitHub caps names at 100 and logins at 39. */
export const COMBINED_SLUG_MAX = 60;

export function slugError(slug: string, max: number): string | null {
  if (!slug) return "Slug is required";
  if (slug.length > max) return `Slug must be at most ${max} characters`;
  if (!SLUG_RE.test(slug)) return "Use lowercase letters, digits and single hyphens (e.g. cs323-fall26)";
  return null;
}
