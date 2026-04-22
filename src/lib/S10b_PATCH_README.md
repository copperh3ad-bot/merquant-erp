# MerQuant Session 10b — FabricWorking PDF rewrite

**Incremental patch. Requires Session 10 (`patch-s10-apply.ps1`) already applied.**

Replaces the PDF export in `src/pages/FabricWorking.jsx` with an
A4-landscape, line-wrap version. Fixes three bugs in the original S10 ship:

1. **Header cells past the first column were invisible.** jsPDF 4.x state
   (fill color, text color, font) does not reliably persist across
   consecutive `rect`/`text` calls inside a loop. Setting it once before
   the loop left only the first cell rendered. Verified empirically with
   a minimal two-rect test. Fix: re-set those three on every iteration
   inside header and data-row loops.
2. **"SLEEPER - QUEEN XL" was truncated to "SLEEPER - QU...".** Prod Size
   column was 20mm, needs 25mm at 6pt. Width moved from Fabrication
   (which had 5mm of slack).
3. **"%İ" garbage in place of the color bullet.** jsPDF's default
   helvetica uses WinAnsi encoding, which does not include U+25CF. Fix:
   a small white `rect()` drawn as the bullet instead of the Unicode
   character.

## Also in this patch

- Column definitions are now self-describing (`{ label, width, align, mode }`)
  instead of parallel arrays of column names and widths. Adding or resizing
  a column is a one-line change.
- Variable-height rows: long `fabric_type` values wrap across 2+ lines and
  the row grows to fit. Pagination works correctly with variable heights
  because each row is probed before drawing.
- Summary table is no longer hardcoded at absolute X-positions (the
  `x=15/90/110/140` pattern that caused "180cm14-4102TC" style collisions).
  Uses the same column-def pattern as the body tables.
- Grand Total row added to the summary.
- Scope footer continues to appear on every PDF as in S10.

## What's NOT in this patch

- No changes to `fabricClassifier.js`.
- No changes to the on-screen rendering (HTML tables are unchanged).
- No changes to the CSV export (still includes the scope footer from S10).
- No changes to the Print button (browser print uses the HTML tables,
  unrelated to jsPDF).

## Smoke tests after apply

Open a PO on Fabric Working Sheet and click the PDF button. Verify:

**Combined view:**
- A4 landscape orientation
- All 12 column headers have blue fill and white labels
- "SLEEPER - QUEEN XL" fits in Prod. Size column
- Long fabric types (e.g. "110gsm - 100% Polyester terry knitted fabric
  with 0.02mm TPU white 200gsm") wrap onto 2 lines; row height grows
- No text bleeding across column boundaries
- Summary table has Fabric Type / Width / Net Mtrs / Total Mtrs column
  headers all visible
- Grand Total row at the bottom of the summary
- Italic scope footer on the last line

**Separate view:**
- Color banner shows a small white square as a bullet (not the garbled
  "%İ" from the S10 version)
- Everything else as combined

## Rollback

```powershell
# Restore the S10 (pre-PDF-rewrite) version of FabricWorking.jsx:
Copy-Item -Force src\pages\FabricWorking.jsx.s10b.bak src\pages\FabricWorking.jsx

# If you want to also roll back the classifier to pre-S10:
Copy-Item -Force src\pages\FabricWorking.jsx.s10.bak src\pages\FabricWorking.jsx
Remove-Item src\lib\fabricClassifier.js
```

The `.s10b.bak` is made only on the first run; subsequent runs skip the
backup to avoid clobbering it.
