import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import * as authSchema from "./auth-schema.js";
import * as appSchema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.NODE_ENV === "test" ? 5 : 15,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  application_name: "veridian-api"
});

pool.on("error", (error) => {
  process.stderr.write(`Database pool error: ${error.message}\n`);
});

export const db = drizzle(pool, { schema: { ...authSchema, ...appSchema } });

export async function checkDatabaseReady(): Promise<void> {
  const result = await pool.query<{ value: string }>(
    "select value from app_meta where key = 'schema_version'"
  );
  if (result.rows[0]?.value !== "1") throw new Error("Database schema is not compatible");
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
