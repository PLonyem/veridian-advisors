import pg from "pg";
import { config } from "../config.js";

if (config.NODE_ENV !== "test" || !config.TEST_DATABASE_URL) {
  throw new Error("Refusing reset: NODE_ENV=test and TEST_DATABASE_URL are required");
}
const target = new URL(config.TEST_DATABASE_URL);
const production = new URL(config.DATABASE_URL);
if (target.href === production.href || !target.pathname.toLowerCase().includes("test")) {
  throw new Error("Refusing reset: target must be a distinct database whose name contains 'test'");
}

const { Pool } = pg;
const testPool = new Pool({ connectionString: config.TEST_DATABASE_URL, max: 1 });
try {
  await testPool.query("drop schema public cascade; create schema public");
  process.stdout.write(`Reset isolated test database ${target.pathname.slice(1)}.\n`);
} finally {
  await testPool.end();
}
