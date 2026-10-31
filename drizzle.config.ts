import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// `npm run db:migrate` targets the local dev database (.env.development.local) when that file exists;
// `npm run db:migrate:neon` reads only .env (Neon). On Render no env files exist and the service's
// own variables are used.
const neon = process.env.npm_lifecycle_event === "db:migrate:neon";
config({ path: neon ? [".env"] : [".env.development.local", ".env"], quiet: true });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Migrations use Neon's direct (unpooled) connection when available; the app uses the pooled DATABASE_URL.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL! },
});
