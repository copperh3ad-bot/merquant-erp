import { describe, it, expect } from 'vitest';
import {
  buildBulkTemplate,
  buildPerProgramTemplate,
  BULK_COLUMNS,
  PER_PROGRAM_COLUMNS,
  PER_PROGRAM_SKU_LIMIT,
} from '@/lib/masterDataTemplates';

// We don't pull SheetJS into the test runtime — it's loaded from a CDN at
// runtime in the browser. Instead we use a minimal stub that captures the
// calls the builder makes, so the test verifies SHAPE without depending on
// the real implementation.
function stubXLSX() {
  const captured = { sheets: [], wbAppends: [], writes: [] };
  const utils = {
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    aoa_to_sheet: (rows) => {
      const sheet = { __rows: rows };
      captured.sheets.push(sheet);
      return sheet;
    },
    book_append_sheet: (wb, sheet, name) => {
      wb.SheetNames.push(name);
      wb.Sheets[name] = sheet;
      captured.wbAppends.push({ name, sheet });
    },
  };
  const write = (wb, opts) => {
    captured.writes.push({ wb, opts });
    return new Uint8Array([0x50, 0x4b]); // bare "PK" header bytes — enough to look like an xlsx
  };
  return { XLSX: { utils, write }, captured };
}

describe('column configs', () => {
  it('covers the eight named sheets in both templates', () => {
    const expected = [
      '1. Articles (SKUs)',
      '2. SKU Fabric Consumption',
      '3. SKU Accessory Consumption',
      '4. Carton Master',
      '5. Price List',
      '6. Suppliers',
      '7. Seasons',
      '8. Production Lines',
    ];
    expect(Object.keys(BULK_COLUMNS)).toEqual(expected);
    expect(Object.keys(PER_PROGRAM_COLUMNS)).toEqual(expected);
  });

  it('per-program columns are a subset of bulk columns for every sheet', () => {
    for (const sheetName of Object.keys(PER_PROGRAM_COLUMNS)) {
      const bulkCols = new Set(BULK_COLUMNS[sheetName]);
      for (const col of PER_PROGRAM_COLUMNS[sheetName]) {
        expect(bulkCols.has(col), `${sheetName}: per-program column "${col}" must exist in bulk columns`).toBe(true);
      }
    }
  });

  it('every required field per sheet is present in both templates', () => {
    // Mirrors the importer's `required` config in MasterDataImport.jsx.
    const required = {
      '1. Articles (SKUs)':            ['item_code'],
      '2. SKU Fabric Consumption':     ['item_code', 'component_type'],
      '3. SKU Accessory Consumption':  ['item_code', 'category'],
      '4. Carton Master':              ['item_code'],
      '5. Price List':                 ['item_code'],
      '6. Suppliers':                  ['name'],
      '7. Seasons':                    ['name'],
      '8. Production Lines':           ['name', 'line_type', 'daily_capacity'],
    };
    for (const [sheet, cols] of Object.entries(required)) {
      const bulk = new Set(BULK_COLUMNS[sheet]);
      const perProgram = new Set(PER_PROGRAM_COLUMNS[sheet]);
      for (const col of cols) {
        expect(bulk.has(col), `bulk ${sheet}: missing required col ${col}`).toBe(true);
        expect(perProgram.has(col), `per-program ${sheet}: missing required col ${col}`).toBe(true);
      }
    }
  });

  it('per-program SKU limit is documented and reasonable', () => {
    expect(PER_PROGRAM_SKU_LIMIT).toBe(50);
  });
});

describe('buildBulkTemplate', () => {
  it('writes a Read Me sheet plus 8 data sheets', () => {
    const { XLSX, captured } = stubXLSX();
    const out = buildBulkTemplate(XLSX);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(captured.wbAppends.map(s => s.name)).toEqual([
      'Read Me',
      '1. Articles (SKUs)',
      '2. SKU Fabric Consumption',
      '3. SKU Accessory Consumption',
      '4. Carton Master',
      '5. Price List',
      '6. Suppliers',
      '7. Seasons',
      '8. Production Lines',
    ]);
  });

  it('Read Me content mentions the deterministic importer path', () => {
    const { XLSX, captured } = stubXLSX();
    buildBulkTemplate(XLSX);
    const readMe = captured.wbAppends.find(s => s.name === 'Read Me').sheet.__rows;
    const flat = readMe.map(r => r.join(' ')).join('\n');
    expect(flat).toMatch(/Choose XLSX/i);
    expect(flat).toMatch(/no size limit/i);
  });

  it('every data sheet has its column header row', () => {
    const { XLSX, captured } = stubXLSX();
    buildBulkTemplate(XLSX);
    for (const { name, sheet } of captured.wbAppends) {
      if (name === 'Read Me') continue;
      const headerRow = sheet.__rows[0];
      expect(headerRow).toEqual(BULK_COLUMNS[name]);
      // Only the header — no example rows that would import garbage.
      expect(sheet.__rows).toHaveLength(1);
    }
  });
});

describe('buildPerProgramTemplate', () => {
  it('writes a Read Me sheet plus 8 data sheets', () => {
    const { XLSX, captured } = stubXLSX();
    const out = buildPerProgramTemplate(XLSX);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(captured.wbAppends).toHaveLength(9);
  });

  it('Read Me content mentions the SKU cap and AI extraction path', () => {
    const { XLSX, captured } = stubXLSX();
    buildPerProgramTemplate(XLSX);
    const readMe = captured.wbAppends.find(s => s.name === 'Read Me').sheet.__rows;
    const flat = readMe.map(r => r.join(' ')).join('\n');
    expect(flat).toMatch(new RegExp(`${PER_PROGRAM_SKU_LIMIT}`));
    expect(flat).toMatch(/Try AI Extraction/i);
    expect(flat).toMatch(/ONE program per file/i);
  });

  it('uses the slimmer per-program column set on each data sheet', () => {
    const { XLSX, captured } = stubXLSX();
    buildPerProgramTemplate(XLSX);
    for (const { name, sheet } of captured.wbAppends) {
      if (name === 'Read Me') continue;
      const headerRow = sheet.__rows[0];
      expect(headerRow).toEqual(PER_PROGRAM_COLUMNS[name]);
    }
  });
});
