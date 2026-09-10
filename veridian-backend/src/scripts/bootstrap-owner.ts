import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { auth, closeAuthDatabase } from "../auth.js";
import { pool, closeDatabase } from "../db/client.js";

async function hiddenPassword(): Promise<string> {
  if (!stdin.isTTY) {
    if (!process.argv.includes("--password-stdin")) throw new Error("Use an interactive terminal or explicitly pass --password-stdin");
    let value = "";
    for await (const chunk of stdin) value += String(chunk);
    return value.trimEnd();
  }
  stdout.write("Owner password (12-128 characters): ");
  stdin.setRawMode(true);
  stdin.resume();
  let password = "";
  return new Promise((resolve, reject) => {
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      stdin.off("data", onData);
      resolve(password);
    };
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") { stdin.setRawMode(false); reject(new Error("Cancelled")); return; }
      if (text === "\r" || text === "\n") { finish(); return; }
      if (text === "\u007f" || text === "\b") { password = password.slice(0, -1); return; }
      password += text;
    };
    stdin.on("data", onData);
  });
}

const existing = await pool.query("select 1 from staff_profiles where role='OWNER' limit 1");
if (existing.rowCount) throw new Error("An owner already exists; use the owner-only staff provisioning API");
const reader = createInterface({ input: stdin, output: stdout });
const email = (process.env.OWNER_EMAIL ?? await reader.question("Owner email: ")).trim().toLowerCase();
const name = (process.env.OWNER_NAME ?? await reader.question("Owner name: ")).trim();
reader.close();
const password = await hiddenPassword();
if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2 || password.length < 12 || password.length > 128) throw new Error("Email, name, or password does not meet requirements");
const created = await auth.api.createUser({ body: { email, name, password, role: "admin" } });
try {
  await pool.query("insert into staff_profiles (user_id,role) values ($1,'OWNER')", [created.user.id]);
  stdout.write("Owner created. Enroll MFA immediately after first sign-in.\n");
} catch (error) {
  await pool.query("delete from \"user\" where id=$1", [created.user.id]);
  throw error;
} finally {
  await Promise.allSettled([closeDatabase(), closeAuthDatabase()]);
}
