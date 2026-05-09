// src/lib/xlsxChunker.js
//
// Shared client-side chunking helpers for large XLSX files.
//
// Two distinct strategies:
//   1. splitXlsxBySheet — for large *row-content* files (master-data Excels).
//      Breaks the workbook into per-sheet sub-files; further row-chunks any
//      sheet whose CSV exceeds the threshold. Each sub-file is its own valid
//      .xlsx that can be sent independently to extract-document.
//      Originally lived in src/pages/FileFeeder.jsx; lifted here so TechPacks
//      can reuse it without diverging copies.
//
//   2. extractImagesFromXlsx + chunkImagesForBatching — for files where the
//      bulk is *embedded images* (BOB-format tech packs). XLSX files are zip
//      archives; the images live at xl/media/* and xl/embeddings/*. Pulling
//      them out client-side and sending only the images skips the Supabase
//      edge-function 6 MB payload cap entirely (a Purecare-style tech pack
//      with 90 embedded images at 81.5 MB total reduces to N batches of
//      <5 MB each).
//
// Both helpers are pure browser code — no server roundtrip needed for the
// chunking itself.

import * as XLSX from "xlsx";
import JSZip   from "jszip";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Convert a Uint8Array to base64 in 32 KB slices to avoid Function.apply
 *  argument-count limits on big files. */
export function uint8ToBase64(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(s);
}

/** Sanitise a sheet/file name into a filename-safe slug. */
export function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "sheet";
}

function mediaTypeForPath(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png")  return "image/png";
  if (ext === "gif")  return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

// ---------------------------------------------------------------------------
// 1. splitXlsxBySheet — for row-content-heavy XLSX files
// ---------------------------------------------------------------------------

/**
 * Split an XLSX into N per-sheet sub-uploads. Each sub-upload has a
 * fresh single-sheet workbook so its bytes (and SHA-256) differ from
 * every other sub-upload — required for extract-document's dedup path
 * to NOT block siblings of the same batch.
 *
 * If a single sheet's CSV exceeds `chunkThresholdChars`, the sheet is
 * further row-chunked into `rowsPerChunk`-row sub-sheets with the first
 * `headerRows` rows repeated on each chunk so each sub-sheet is
 * self-describing.
 *
 * @param {File} file - Browser File object
 * @param {object} [opts]
 * @param {number} [opts.chunkThresholdChars=50000] - CSV-size threshold
 *   above which a sheet gets row-chunked.
 * @param {number} [opts.rowsPerChunk=80] - Rows per chunk when a sheet
 *   exceeds chunkThresholdChars.
 * @param {number} [opts.headerRows=1] - Number of header rows to repeat
 *   on each chunk.
 * @returns {Promise<Array<{
 *   sheetName: string,
 *   syntheticFileName: string,
 *   base64: string,
 *   sizeBytes: number,
 *   preParsedText: string,
 * }>>}
 */
export async function splitXlsxBySheet(file, opts = {}) {
  const {
    chunkThresholdChars = 50_000,
    rowsPerChunk        = 80,
    headerRows          = 1,
  } = opts;

  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "array" });
  const baseName = (file.name || "upload.xlsx").replace(/\.xlsx?$/i, "");
  const out = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (!csv) continue;

    // Single-shot path: small sheet, emit as one part.
    if (csv.length <= chunkThresholdChars) {
      out.push(_packSheet(sheet, sheetName, csv, baseName));
      continue;
    }

    // Row-chunk: read sheet as 2D array, peel off header, slice the body.
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
    if (aoa.length <= headerRows) {
      // Header-only — emit as one part.
      out.push(_packSheet(sheet, sheetName, csv, baseName));
      continue;
    }
    const header = aoa.slice(0, headerRows);
    const body   = aoa.slice(headerRows);
    const totalChunks = Math.ceil(body.length / rowsPerChunk);
    for (let i = 0; i < totalChunks; i++) {
      const slice    = body.slice(i * rowsPerChunk, (i + 1) * rowsPerChunk);
      const chunkAoa = [...header, ...slice];
      const chunkSheet = XLSX.utils.aoa_to_sheet(chunkAoa);
      const chunkCsv   = XLSX.utils.sheet_to_csv(chunkSheet, { blankrows: false }).trim();
      const subWb     = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(subWb, chunkSheet, sheetName);
      const subBytes  = new Uint8Array(XLSX.write(subWb, { type: "array", bookType: "xlsx" }));
      out.push({
        sheetName:         `${sheetName} (part ${i + 1}/${totalChunks})`,
        syntheticFileName: `${baseName}__${slugify(sheetName)}_part${i + 1}of${totalChunks}.xlsx`,
        base64:            uint8ToBase64(subBytes),
        sizeBytes:         subBytes.length,
        preParsedText:
          `=== Sheet: "${sheetName}" (rows ${i * rowsPerChunk + 1}–${i * rowsPerChunk + slice.length} of ${body.length}) ===\n${chunkCsv}`,
      });
    }
  }
  return out;
}

function _packSheet(sheet, sheetName, csv, baseName) {
  const subWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(subWb, sheet, sheetName);
  const subBytes = new Uint8Array(XLSX.write(subWb, { type: "array", bookType: "xlsx" }));
  return {
    sheetName,
    syntheticFileName: `${baseName}__${slugify(sheetName)}.xlsx`,
    base64:            uint8ToBase64(subBytes),
    sizeBytes:         subBytes.length,
    preParsedText:     `=== Sheet: "${sheetName}" ===\n${csv}`,
  };
}

// ---------------------------------------------------------------------------
// 2. extractImagesFromXlsx + chunkImagesForBatching — for image-heavy XLSX
// ---------------------------------------------------------------------------

/**
 * Extract embedded images from an .xlsx file (which is a zip archive).
 * Reads xl/media/* and xl/embeddings/* entries and returns one record per
 * image with base64 content ready to ship to extract-barcodes.
 *
 * @param {File | ArrayBuffer | Uint8Array} fileOrBytes
 * @returns {Promise<Array<{ path: string, mediaType: string, base64: string, sizeBytes: number }>>}
 */
export async function extractImagesFromXlsx(fileOrBytes) {
  let buf;
  if (fileOrBytes instanceof Uint8Array)        buf = fileOrBytes;
  else if (fileOrBytes instanceof ArrayBuffer)  buf = new Uint8Array(fileOrBytes);
  else if (fileOrBytes && typeof fileOrBytes.arrayBuffer === "function")
    buf = new Uint8Array(await fileOrBytes.arrayBuffer());
  else throw new Error("extractImagesFromXlsx: expected File, ArrayBuffer, or Uint8Array");

  const zip = await JSZip.loadAsync(buf);
  const out = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (!/^xl\/(media|embeddings)\/.+\.(png|jpe?g|gif|webp)$/i.test(path)) continue;
    const base64 = await entry.async("base64");
    out.push({
      path,
      mediaType: mediaTypeForPath(path),
      base64,
      sizeBytes: Math.floor(base64.length * 0.75),  // base64 ≈ 4/3 of binary
    });
  }
  // Deterministic order (image_index in the response will follow this).
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Group images into batches that satisfy both per-call image-count cap
 * and total-byte budget. Each batch is safe to send to extract-barcodes
 * via Supabase edge functions (which reject payloads >6 MB).
 *
 * @param {Array<{ base64: string }>} images
 * @param {object} [opts]
 * @param {number} [opts.maxImagesPerBatch=20] - Anthropic's per-request image cap.
 * @param {number} [opts.maxBytesPerBatch=4500000] - 4.5 MB total to stay
 *   safely under Supabase's 6 MB edge-fn payload cap (header overhead +
 *   JSON envelope leave headroom).
 * @returns {Array<Array<{ base64: string }>>}
 */
export function chunkImagesForBatching(images, opts = {}) {
  const {
    maxImagesPerBatch = 20,
    maxBytesPerBatch  = 4_500_000,
  } = opts;
  const batches = [];
  let cur = [];
  let curBytes = 0;
  for (const img of images) {
    const wouldExceedCount = cur.length >= maxImagesPerBatch;
    const wouldExceedBytes = curBytes + (img.base64?.length ?? 0) > maxBytesPerBatch;
    if (cur.length > 0 && (wouldExceedCount || wouldExceedBytes)) {
      batches.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(img);
    curBytes += img.base64?.length ?? 0;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}
