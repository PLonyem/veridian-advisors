import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;
const migrationUrl = config.MIGRATION_DATABASE_URL ?? config.DATABASE_URL;
if (config.NODE_ENV === "production" && migrationUrl === config.DATABASE_URL) {
  throw new Error("Production migrations require a separate MIGRATION_DATABASE_URL");
}

const migrationPool = new Pool({ connectionString: migrationUrl, max: 1, application_name: "veridian-migrator" });
try {
  await migrate(drizzle(migrationPool), { migrationsFolder: "drizzle" });
  process.stdout.write("Migrations applied successfully.\n");
} finally {
  await migrationPool.end();
}
