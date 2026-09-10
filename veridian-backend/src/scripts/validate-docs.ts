import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

for (const relativePath of ["render.yaml", "docs/openapi.yaml"]) {
  const path = resolve("..", relativePath);
  const parsed = YAML.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") throw new Error(`${relativePath} did not parse as an object`);
  if (relativePath.endsWith("openapi.yaml") && parsed.openapi !== "3.1.0") throw new Error("OpenAPI version must be 3.1.0");
  if (relativePath === "render.yaml" && !Array.isArray(parsed.services)) throw new Error("Render blueprint has no services");
  process.stdout.write(`${relativePath}: YAML syntax and root contract OK\n`);
}
