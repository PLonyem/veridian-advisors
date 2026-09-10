import { defineConfig } from "drizzle-kit";

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
  migrations: { prefix: "timestamp" }
});
