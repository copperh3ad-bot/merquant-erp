// Diagnostic: dump the structure of the user's MFRM Stretch Cool Modal
// XLSX to see what the AI saw / missed.
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const path = "scripts/mfrm.xlsx";
const buf = readFileSync(path);
const wb = XLSX.read(buf, { type: "buffer" });

console.log(`Workbook sheets: ${wb.SheetNames.length}`);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws["!ref"];
  if (!ref) { console.log(`\n=== ${name} (empty) ===`); continue; }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
  console.log(`\n=== ${name} (${rows.length} rows × ${Math.max(...rows.map(r=>r.length))} cols) ===`);
  // Show first 25 rows
  rows.slice(0, 25).forEach((r, i) => {
    const cells = r.map((c) => String(c).slice(0, 40)).slice(0, 10);
    console.log(`  ${i+1}: ${cells.join(" │ ")}`);
  });
  if (rows.length > 25) console.log(`  ... +${rows.length - 25} more rows`);
}
