// Splits 0001_init.sql into ~3 chunks at safe statement boundaries (between
// `--` separator comments that pg_dump writes between every object). Each
// chunk can then be applied independently via Supabase apply_migration MCP.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "scripts/clean-migrations-tmp/0001_init.sql";
const OUT_DIR = "scripts/init-chunks";
mkdirSync(OUT_DIR, { recursive: true });

// Wipe any previous chunks
for (const f of readdirSync(OUT_DIR)) unlinkSync(join(OUT_DIR, f));

const text = readFileSync(SOURCE, "utf8");
const lines = text.split("\n");

// pg_dump uses `--` (alone on a line) as a separator before each object.
// We split between objects so no statement is cut.
const TARGET_CHUNK_LINES = 1200; // ~20k tokens per chunk; under Read tool's 25k limit
const chunks = [];
let buf = [];
let lineCount = 0;

for (let i = 0; i < lines.length; i++) {
  buf.push(lines[i]);
  lineCount++;

  // After we've collected at least the target number of lines, look for a
  // safe break: a blank line followed by `--` (the pg_dump section header).
  if (
    lineCount >= TARGET_CHUNK_LINES &&
    lines[i] === "" &&
    lines[i + 1] === "--" &&
    lines[i + 2]?.startsWith("-- Name:")
  ) {
    chunks.push(buf.join("\n"));
    buf = [];
    lineCount = 0;
  }
}
if (buf.length > 0) chunks.push(buf.join("\n"));

console.log(`Split into ${chunks.length} chunks:`);
chunks.forEach((c, i) => {
  const file = join(OUT_DIR, `0001_init_part${String(i + 1).padStart(2, "0")}.sql`);
  writeFileSync(file, c);
  const lc = c.split("\n").length;
  const kb = (c.length / 1024).toFixed(1);
  console.log(`  part ${i + 1}: ${lc} lines, ${kb} KB → ${file}`);
});
