import { describe, it, expect } from 'vitest';
import { bobToTechPackShape } from '../../supabase/functions/extract-document/bobAdapter.js';

// Phase E2 — bobAdapter maps the BOB parser's output shape to the AI
// tech_pack tool schema so downstream code (validator, apply RPC, review UI)
// doesn't care which path produced the data.

describe('bobToTechPackShape', () => {
  it('returns a valid empty shape when input is null/undefined', () => {
    const out = bobToTechPackShape(null);
    expect(out.skus).toEqual([]);
    expect(out._confidence.overall).toBe(0);
    expect(out._notes).toMatch(/no data/i);
  });

  it('maps a minimal BOB row through to the AI shape', () => {
    const bob = {
      header: { brand: 'BOB', product_type: 'Pillow', product_no: 'P12345', product_name: 'Cool Pillow' },
      fabric_specs: [],
      skus: [{ item_code: 'PCSJMO-T-WH', size: 'Twin', color: 'white', units_per_carton: 12 }],
      labels: [],
      accessories: [],
      packaging: [],
      zipper: { length: '50cm', type: 'YKK', color: 'white' },
    };
    const out = bobToTechPackShape(bob);
    expect(out.header.brand).toBe('BOB');
    expect(out.header.product_no).toBe('P12345');
    expect(out.skus).toHaveLength(1);
    expect(out.skus[0].item_code).toBe('PCSJMO-T-WH');
    expect(out.skus[0].units_per_carton).toBe(12);
    expect(out.zipper.length).toBe('50cm');
    expect(out._confidence.overall).toBeGreaterThan(0.9);
    expect(out._notes).toMatch(/BOB/);
  });

  it('falls back to product_sku when product_no is missing on header', () => {
    const out = bobToTechPackShape({ header: { product_sku: 'SKU-X' }, skus: [{ item_code: 'A1' }] });
    expect(out.header.product_no).toBe('SKU-X');
  });

  it('coerces numeric strings to numbers and leaves nulls null', () => {
    const out = bobToTechPackShape({
      header: {},
      fabric_specs: [{ component_type: 'shell', gsm: '150' }],
      skus: [{ item_code: 'A1', units_per_carton: '12' }],
    });
    expect(out.fabric_specs[0].gsm).toBe(150);
    expect(out.skus[0].units_per_carton).toBe(12);
  });

  it('emits null for empty/missing scalar fields rather than undefined', () => {
    const out = bobToTechPackShape({
      header: {},
      fabric_specs: [{ component_type: 'shell' }],
      skus: [{ item_code: 'A1' }],
    });
    expect(out.fabric_specs[0].fabric_type).toBeNull();
    expect(out.fabric_specs[0].gsm).toBeNull();
    expect(out.skus[0].size).toBeNull();
    expect(out.skus[0].units_per_carton).toBeNull();
  });

  it('confidence drops to a low value when skus is empty', () => {
    const out = bobToTechPackShape({ header: { product_no: 'P' }, skus: [] });
    expect(out._confidence.overall).toBeLessThan(0.5);
    expect(out._confidence.per_section.skus).toBe(0);
  });

  it('falls back finish to treatment when finish is missing', () => {
    const out = bobToTechPackShape({
      header: {},
      fabric_specs: [{ component_type: 'shell', treatment: 'laminated' }],
      skus: [{ item_code: 'A1' }],
    });
    expect(out.fabric_specs[0].finish).toBe('laminated');
  });

  it('preserves array sections (labels/accessories/packaging) with field renames', () => {
    const out = bobToTechPackShape({
      header: {},
      skus: [{ item_code: 'A1' }],
      labels: [{ section: 'main', type: 'woven', material: 'satin' }],
      accessories: [{ accessory_type: 'zipper', description: 'YKK' }],
      packaging: [{ category: 'bag', value: 'PVC' }],
    });
    expect(out.labels).toHaveLength(1);
    expect(out.labels[0].section).toBe('main');
    expect(out.accessories[0].accessory_type).toBe('zipper');
    expect(out.packaging[0].category).toBe('bag');
  });
});
