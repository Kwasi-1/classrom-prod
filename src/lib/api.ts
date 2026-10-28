import { NextResponse } from "next/server";
import { safeError } from "./log";
import { currentUser, type User } from "./session";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Wraps a route handler: HttpError → JSON error; anything else → 500 without leaking details. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
      }
      console.error(`[api] ${safeError(err)}`);
      // Octokit RequestErrors carry the HTTP status; surface GitHub's message so teachers can act on it.
      if (err && typeof err === "object" && "status" in err && "request" in err) {
        return NextResponse.json({ error: `GitHub API error: ${safeError(err)}` }, { status: 502 });
      }
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export async function requireApiUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
