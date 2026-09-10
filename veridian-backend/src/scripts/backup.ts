import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { config } from "../config.js";

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)));
  });
}

if (!config.BACKUP_ENCRYPTION_KEY) throw new Error("BACKUP_ENCRYPTION_KEY is required");
const key = Buffer.from(config.BACKUP_ENCRYPTION_KEY, "base64");
if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must decode to 32 bytes");
const action = process.argv[2];
await mkdir("backups", { recursive: true });
if (action === "create") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const plainPath = resolve("backups", `veridian-${stamp}.dump`);
  const encryptedPath = `${plainPath}.enc`;
  await run("pg_dump", ["--format=custom", "--no-owner", "--file", plainPath, config.DATABASE_URL]);
  const plain = await readFile(plainPath);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  await writeFile(encryptedPath, Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
  await unlink(plainPath);
  process.stdout.write(`Encrypted backup created: ${basename(encryptedPath)}\n`);
} else if (action === "verify") {
  const fileArg = process.argv.find((item) => item.startsWith("--file="));
  const restoreUrl = process.env.RESTORE_DATABASE_URL;
  if (!fileArg || !restoreUrl || restoreUrl === config.DATABASE_URL || !new URL(restoreUrl).pathname.toLowerCase().includes("restore")) throw new Error("Provide --file and a distinct RESTORE_DATABASE_URL whose name contains 'restore'");
  const encrypted = await readFile(resolve(fileArg.slice(7)));
  const nonce = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]);
  const tempPath = resolve("backups", `restore-${process.pid}.dump`);
  await writeFile(tempPath, Buffer.from(plain), { mode: 0o600 });
  try { await run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", restoreUrl, tempPath]); }
  finally { await unlink(tempPath); }
  process.stdout.write("Backup restored to isolated verification database. Reconcile deletion_ledger before acceptance.\n");
} else {
  throw new Error("Use backup:create or backup:verify");
}
