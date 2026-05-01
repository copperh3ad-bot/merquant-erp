import { describe, it, expect } from 'vitest';
import { dedupeMasterData } from '@/lib/masterDataDedup';

describe('dedupeMasterData', () => {
  it('returns input unchanged when null/empty', () => {
    expect(dedupeMasterData(null).data).toBe(null);
    expect(dedupeMasterData(undefined).data).toBe(undefined);
    expect(dedupeMasterData({}).data).toEqual({});
  });

  it('reports zero before/after when section is missing', () => {
    const { summary } = dedupeMasterData({ articles: [{}, {}] });
    expect(summary.fabric.before).toBe(0);
    expect(summary.fabric.after).toBe(0);
    expect(summary.fabric.flagged).toEqual([]);
  });

  it('collapses EXACT duplicates safely (every field identical)', () => {
    const input = {
      fabric_consumption: [
        { item_code: 'A', component_type: 'Flat Sheet', color: 'red', fabric_type: 'Jersey', gsm: 170, width_cm: 112, consumption_per_unit: 2, wastage_percent: 0.2 },
        { item_code: 'A', component_type: 'Flat Sheet', color: 'red', fabric_type: 'Jersey', gsm: 170, width_cm: 112, consumption_per_unit: 2, wastage_percent: 0.2 },
      ],
    };
    const { data, summary } = dedupeMasterData(input);
    expect(summary.fabric.before).toBe(2);
    expect(summary.fabric.after).toBe(1);
    expect(summary.fabric.flagged).toEqual([]);
    expect(data.fabric_consumption[0].consumption_per_unit).toBe(2); // not summed
  });

  it('FLAGS key-duplicates with different consumption (does NOT sum)', () => {
    // The bug we're protecting against: AI mis-extracted 4 parts of a
    // sheet set all under component_type="Jersey Knit". The dedup must
    // NOT silently sum — that loses per-part info.
    const input = {
      fabric_consumption: [
        { item_code: 'SLPCSS-F-GY', component_type: 'Jersey Knit', color: 'Dove Gray', consumption_per_unit: 2.387 },
        { item_code: 'SLPCSS-F-GY', component_type: 'Jersey Knit', color: 'Dove Gray', consumption_per_unit: 2.286 },
        { item_code: 'SLPCSS-F-GY', component_type: 'Jersey Knit', color: 'Dove Gray', consumption_per_unit: 0.741 },
        { item_code: 'SLPCSS-F-GY', component_type: 'Jersey Knit', color: 'Dove Gray', consumption_per_unit: 0.15 },
      ],
    };
    const { data, summary } = dedupeMasterData(input);
    expect(summary.fabric.before).toBe(4);
    expect(summary.fabric.after).toBe(1); // can't keep duplicates due to DB unique constraint
    expect(summary.fabric.flagged).toHaveLength(1);
    expect(summary.fabric.flagged[0].key).toMatch(/SLPCSS-F-GY/);
    expect(summary.fabric.flagged[0].rowCount).toBe(4);
    expect(summary.fabric.flagged[0].consumptionValues).toHaveLength(4);
    // Importantly, the kept row's consumption is the FIRST one, not a sum.
    expect(data.fabric_consumption[0].consumption_per_unit).toBeCloseTo(2.387, 3);
  });

  it('does not flag when keys are distinct (per-part rows)', () => {
    // The CORRECT case: AI correctly extracted 4 different component_types.
    const input = {
      fabric_consumption: [
        { item_code: 'A', component_type: 'Flat Sheet',   color: 'red', consumption_per_unit: 2.4 },
        { item_code: 'A', component_type: 'Fitted Sheet', color: 'red', consumption_per_unit: 2.3 },
        { item_code: 'A', component_type: 'Pillow Case',  color: 'red', consumption_per_unit: 0.7 },
        { item_code: 'A', component_type: 'Fabric Bag',   color: 'red', consumption_per_unit: 0.15 },
      ],
    };
    const { data, summary } = dedupeMasterData(input);
    expect(summary.fabric.before).toBe(4);
    expect(summary.fabric.after).toBe(4);
    expect(summary.fabric.flagged).toEqual([]);
    expect(data.fabric_consumption).toHaveLength(4);
  });

  it('case-insensitive key matching for exact dups', () => {
    const input = {
      fabric_consumption: [
        { item_code: 'A', component_type: 'Flat Sheet', color: 'Red', consumption_per_unit: 1, wastage_percent: 0.2 },
        { item_code: 'a', component_type: 'flat sheet', color: 'red', consumption_per_unit: 1, wastage_percent: 0.2 },
      ],
    };
    const { summary } = dedupeMasterData(input);
    expect(summary.fabric.before).toBe(2);
    expect(summary.fabric.after).toBe(1);
    expect(summary.fabric.flagged).toEqual([]);
  });

  it('treats different gsm as non-exact (flags)', () => {
    const input = {
      fabric_consumption: [
        { item_code: 'A', component_type: 'X', color: 'r', consumption_per_unit: 1, gsm: 170 },
        { item_code: 'A', component_type: 'X', color: 'r', consumption_per_unit: 1, gsm: 200 },
      ],
    };
    const { summary } = dedupeMasterData(input);
    expect(summary.fabric.flagged).toHaveLength(1);
  });

  it('dedups accessory_consumption by (item_code, category, material) — exact only', () => {
    const input = {
      accessory_consumption: [
        { item_code: 'A', category: 'Care Label', material: 'Cotton', consumption_per_unit: 1 },
        { item_code: 'A', category: 'Care Label', material: 'Cotton', consumption_per_unit: 1 },     // exact dup → collapse
        { item_code: 'A', category: 'Hang Tag',   material: 'Paper',  consumption_per_unit: 1 },     // distinct → keep
        { item_code: 'B', category: 'Care Label', material: 'Cotton', consumption_per_unit: 1 },     // distinct (B) → keep
        { item_code: 'B', category: 'Care Label', material: 'Cotton', consumption_per_unit: 2 },     // key-dup, different cpu → flag
      ],
    };
    const { summary } = dedupeMasterData(input);
    expect(summary.accessory.before).toBe(5);
    expect(summary.accessory.after).toBe(3); // A/CL/Cotton + A/HT/Paper + B/CL/Cotton
    expect(summary.accessory.flagged).toHaveLength(1);
    expect(summary.accessory.flagged[0].key).toMatch(/^B/);
  });

  it('exact-dup detection is tolerant to null vs missing fields', () => {
    const input = {
      fabric_consumption: [
        { item_code: 'A', component_type: 'X', color: 'r', consumption_per_unit: 1 },                       // gsm not set
        { item_code: 'A', component_type: 'X', color: 'r', consumption_per_unit: 1, gsm: null },            // gsm explicitly null
      ],
    };
    const { summary } = dedupeMasterData(input);
    expect(summary.fabric.after).toBe(1);
    expect(summary.fabric.flagged).toEqual([]);
  });

  it('does not modify articles or other sections', () => {
    const input = {
      articles: [{ item_code: 'A' }, { item_code: 'B' }],
      fabric_consumption: [],
    };
    const { data } = dedupeMasterData(input);
    expect(data.articles).toHaveLength(2);
  });
});
