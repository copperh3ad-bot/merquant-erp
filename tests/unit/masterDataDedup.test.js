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
    expect(summary.fabric).toEqual({ before: 0, after: 0 });
    expect(summary.accessory).toEqual({ before: 0, after: 0 });
  });

  it('collapses fabric_consumption duplicates by (item_code, component_type, color)', () => {
    const input = {
      fabric_consumption: [
        { item_code: 'SLPCSS-F-GY', component_type: 'Jersey Knit', color: 'Dove Gray', consumption_per_unit: 1.0 },
        { item_code: 'SLPCSS-F-GY', component_type: 'Jersey Knit', color: 'Dove Gray', consumption_per_unit: 0.5 },
        { item_code: 'SLPCSS-F-GY', component_type: 'Jersey Knit', color: 'Dove Gray', consumption_per_unit: 0.8 },
        { item_code: 'SLPCSS-F-GY', component_type: 'Jersey Knit', color: 'Dove Gray', consumption_per_unit: 0.1 },
        { item_code: 'SLPCSS-F-BL', component_type: 'Jersey Knit', color: 'Light Blue', consumption_per_unit: 2.4 },
      ],
    };
    const { data, summary } = dedupeMasterData(input);
    expect(summary.fabric).toEqual({ before: 5, after: 2 });
    expect(data.fabric_consumption).toHaveLength(2);
    const gy = data.fabric_consumption.find((r) => r.item_code === 'SLPCSS-F-GY');
    expect(gy.consumption_per_unit).toBeCloseTo(2.4, 4);
    const bl = data.fabric_consumption.find((r) => r.item_code === 'SLPCSS-F-BL');
    expect(bl.consumption_per_unit).toBeCloseTo(2.4, 4);
  });

  it('keeps wastage_percent as the MAX across duplicates', () => {
    const input = {
      fabric_consumption: [
        { item_code: 'A', component_type: 'X', color: 'red', consumption_per_unit: 1, wastage_percent: 2 },
        { item_code: 'A', component_type: 'X', color: 'red', consumption_per_unit: 1, wastage_percent: 5 },
        { item_code: 'A', component_type: 'X', color: 'red', consumption_per_unit: 1, wastage_percent: 3 },
      ],
    };
    const { data } = dedupeMasterData(input);
    expect(data.fabric_consumption).toHaveLength(1);
    expect(data.fabric_consumption[0].wastage_percent).toBe(5);
    expect(data.fabric_consumption[0].consumption_per_unit).toBe(3);
  });

  it('case-insensitive key matching', () => {
    const input = {
      fabric_consumption: [
        { item_code: 'SLPCSS-F-GY', component_type: 'Jersey Knit', color: 'Dove Gray', consumption_per_unit: 1 },
        { item_code: 'slpcss-f-gy', component_type: 'jersey knit', color: 'dove gray', consumption_per_unit: 1 },
      ],
    };
    const { data, summary } = dedupeMasterData(input);
    expect(summary.fabric).toEqual({ before: 2, after: 1 });
    expect(data.fabric_consumption).toHaveLength(1);
  });

  it('first non-null wins for non-key, non-numeric fields', () => {
    const input = {
      fabric_consumption: [
        { item_code: 'A', component_type: 'X', color: 'red', fabric_type: '85% Modal', consumption_per_unit: 1 },
        { item_code: 'A', component_type: 'X', color: 'red', fabric_type: null,        consumption_per_unit: 1, gsm: 170 },
      ],
    };
    const { data } = dedupeMasterData(input);
    expect(data.fabric_consumption[0].fabric_type).toBe('85% Modal');
    expect(data.fabric_consumption[0].gsm).toBe(170);
  });

  it('dedups accessory_consumption by (item_code, category, material)', () => {
    const input = {
      accessory_consumption: [
        { item_code: 'A', category: 'Care Label', material: 'Cotton', consumption_per_unit: 1 },
        { item_code: 'A', category: 'Care Label', material: 'Cotton', consumption_per_unit: 1 },
        { item_code: 'A', category: 'Hang Tag',   material: 'Paper',  consumption_per_unit: 1 },
      ],
    };
    const { summary } = dedupeMasterData(input);
    expect(summary.accessory).toEqual({ before: 3, after: 2 });
  });

  it('skips non-numeric consumption gracefully', () => {
    const input = {
      fabric_consumption: [
        { item_code: 'A', component_type: 'X', color: 'r', consumption_per_unit: 1 },
        { item_code: 'A', component_type: 'X', color: 'r', consumption_per_unit: '' },
        { item_code: 'A', component_type: 'X', color: 'r', consumption_per_unit: null },
        { item_code: 'A', component_type: 'X', color: 'r', consumption_per_unit: 'NaN' },
        { item_code: 'A', component_type: 'X', color: 'r', consumption_per_unit: 2 },
      ],
    };
    const { data } = dedupeMasterData(input);
    expect(data.fabric_consumption).toHaveLength(1);
    expect(data.fabric_consumption[0].consumption_per_unit).toBe(3);
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
