import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// node-postgres over TCP works with Neon and keeps a warm pool on an always-on Render service.
const globalForDb = globalThis as unknown as { __db?: NodePgDatabase<typeof schema> };

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema });
}

export const db: NodePgDatabase<typeof schema> = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_t, prop) {
    const real = (globalForDb.__db ??= create());
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export * as t from "./schema";
