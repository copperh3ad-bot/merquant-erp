import { describe, it, expect } from 'vitest';
import { validateExtraction } from '@/lib/validators/extractionValidator';

// Reused fixture builders ---------------------------------------------------

const validSku = (overrides = {}) => ({
  item_code: 'PCSJMO-T-WH',
  size: 'Twin',
  color: 'white',
  units_per_carton: 12,
  ...overrides,
});

const validTechPack = (overrides = {}) => ({
  header: { brand: 'BrandX', product_no: 'P12345', product_type: 'Pillow', product_name: 'Cool Pillow' },
  fabric_specs: [],
  skus: [validSku()],
  _confidence: { overall: 0.85 },
  ...overrides,
});

// ---------------------------------------------------------------------------

describe('validateExtraction (tech_pack)', () => {
  it('1. empty skus[] -> failed with SKUS_EMPTY error', () => {
    const r = validateExtraction('tech_pack', validTechPack({ skus: [] }));
    expect(r.status).toBe('failed');
    expect(r.issues.find((i) => i.code === 'SKUS_EMPTY')).toBeTruthy();
  });

  it('2. SKU missing item_code -> error at correct path', () => {
    const r = validateExtraction('tech_pack', validTechPack({ skus: [validSku({ item_code: '' })] }));
    expect(r.status).toBe('failed');
    const miss = r.issues.find((i) => i.code === 'MISSING_REQUIRED' && i.path === 'skus[0].item_code');
    expect(miss).toBeTruthy();
    expect(miss.severity).toBe('error');
  });

  it('3. duplicate skus[].item_code -> DUPLICATE_KEY error', () => {
    const r = validateExtraction('tech_pack', validTechPack({
      skus: [validSku({ item_code: 'X1' }), validSku({ item_code: 'X1' })],
    }));
    expect(r.status).toBe('failed');
    expect(r.issues.find((i) => i.code === 'DUPLICATE_KEY' && i.path === 'skus[1]')).toBeTruthy();
  });

  it('4. _confidence.overall = 0.2 -> warned, no errors', () => {
    const r = validateExtraction('tech_pack', validTechPack({ _confidence: { overall: 0.2 } }));
    expect(r.status).toBe('warned');
    expect(r.issues.some((i) => i.severity === 'error')).toBe(false);
    expect(r.issues.find((i) => i.code === 'LOW_CONFIDENCE')).toBeTruthy();
  });

  it('5. fabric_specs[].gsm = 800 -> OUT_OF_RANGE warn', () => {
    const r = validateExtraction('tech_pack', validTechPack({
      fabric_specs: [{ component_type: 'shell', gsm: 800 }],
    }));
    expect(r.status).toBe('warned');
    expect(r.issues.find((i) => i.code === 'OUT_OF_RANGE' && i.path === 'fabric_specs[0].gsm')).toBeTruthy();
  });

  it('header.product_no missing -> warn (not error)', () => {
    const r = validateExtraction('tech_pack', validTechPack({
      header: { brand: 'BrandX', product_no: null, product_type: 'Pillow', product_name: 'X' },
    }));
    expect(r.status).toBe('warned');
    expect(r.issues.find((i) => i.code === 'MISSING_PRODUCT_NO')).toBeTruthy();
  });

  it('all-clean tech pack -> passed', () => {
    const r = validateExtraction('tech_pack', validTechPack());
    expect(r.status).toBe('passed');
    expect(r.issues).toHaveLength(0);
  });

  it('SKU units_per_carton = 9999 -> warn', () => {
    const r = validateExtraction('tech_pack', validTechPack({
      skus: [validSku({ units_per_carton: 9999 })],
    }));
    expect(r.status).toBe('warned');
    expect(r.issues.find((i) => i.code === 'OUT_OF_RANGE' && i.path === 'skus[0].units_per_carton')).toBeTruthy();
  });
});

describe('validateExtraction (master_data)', () => {
  it('6. no sections present -> passed', () => {
    const r = validateExtraction('master_data', { _confidence: { overall: 0.9 } });
    expect(r.status).toBe('passed');
    expect(r.issues).toHaveLength(0);
  });

  it('7. articles[] row missing item_code -> error', () => {
    const r = validateExtraction('master_data', {
      articles: [{ item_code: '', brand: 'B' }],
      _confidence: { overall: 0.9 },
    });
    expect(r.status).toBe('failed');
    expect(r.issues.find((i) => i.code === 'MISSING_REQUIRED' && i.path === 'articles[0].item_code')).toBeTruthy();
  });

  it('8. duplicate articles.item_code -> DUPLICATE_KEY error', () => {
    const r = validateExtraction('master_data', {
      articles: [
        { item_code: 'A1', brand: 'B', product_type: 'P', size: 'S' },
        { item_code: 'A1', brand: 'B', product_type: 'P', size: 'M' },
      ],
      _confidence: { overall: 0.9 },
    });
    expect(r.status).toBe('failed');
    expect(r.issues.find((i) => i.code === 'DUPLICATE_KEY' && i.path === 'articles[1]')).toBeTruthy();
  });

  it('9. fabric_consumption row referencing item_code not in articles -> ORPHAN_ITEM_CODE warn', () => {
    const r = validateExtraction('master_data', {
      articles: [{ item_code: 'A1', brand: 'B', product_type: 'P', size: 'S' }],
      fabric_consumption: [{ item_code: 'A2', component_type: 'shell', consumption_per_unit: 1.2 }],
      _confidence: { overall: 0.9 },
    });
    expect(r.status).toBe('warned');
    expect(r.issues.find((i) => i.code === 'ORPHAN_ITEM_CODE' && i.path === 'fabric_consumption[0].item_code')).toBeTruthy();
    expect(r.issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('10. accessory_consumption.consumption_per_unit = 200 -> warn', () => {
    const r = validateExtraction('master_data', {
      articles: [{ item_code: 'A1', brand: 'B', product_type: 'P', size: 'S' }],
      accessory_consumption: [{ item_code: 'A1', category: 'label', consumption_per_unit: 200 }],
      _confidence: { overall: 0.9 },
    });
    expect(r.status).toBe('warned');
    expect(r.issues.find((i) => i.code === 'OUT_OF_RANGE' && i.path === 'accessory_consumption[0].consumption_per_unit')).toBeTruthy();
  });

  it('production_lines requires name + line_type + daily_capacity', () => {
    const r = validateExtraction('master_data', {
      production_lines: [{ name: 'Line A' }],
      _confidence: { overall: 0.9 },
    });
    expect(r.status).toBe('failed');
    expect(r.issues.filter((i) => i.code === 'MISSING_REQUIRED').length).toBeGreaterThanOrEqual(2);
  });

  it('all-clean master_data -> passed', () => {
    const r = validateExtraction('master_data', {
      articles: [{ item_code: 'A1', brand: 'B', product_type: 'P', size: 'S' }],
      fabric_consumption: [{ item_code: 'A1', component_type: 'shell', consumption_per_unit: 1.2 }],
      _confidence: { overall: 0.9 },
    });
    expect(r.status).toBe('passed');
    expect(r.issues).toHaveLength(0);
  });
});

describe('validateExtraction (dispatch)', () => {
  it('throws on unknown kind', () => {
    expect(() => validateExtraction('po_document', {})).toThrow(/Unknown kind/);
  });

  it('handles null payload as failed', () => {
    const r = validateExtraction('tech_pack', null);
    expect(r.status).toBe('failed');
    expect(r.issues[0].code).toBe('INVALID_PAYLOAD');
  });
});
