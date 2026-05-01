import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = "migrations/up";
const out = "scripts/clean-migrations-tmp";
mkdirSync(out, { recursive: true });

for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
  const txt = readFileSync(join(dir, f), "utf8");
  const lines = txt.split(/\r?\n/);
  const cleaned = lines
    .filter((l) => !/^\\(restrict|unrestrict)\b/.test(l))
    .join("\n");
  writeFileSync(join(out, f), cleaned);
  console.log(`${f}: ${lines.length} -> ${cleaned.split("\n").length} lines`);
}
