import { describe, it, expect } from 'vitest';
import {
  detectFabricConsumptionAnomalies,
  detectAccessoryConsumptionAnomalies,
  detectAndAutoFix,
  _internal,
} from '@/lib/extractionAnomalyDetector';

const { classifyComponentType, looksLikeFabricDescription } = _internal;

describe('classifyComponentType', () => {
  it('recognises canonical part names as ok', () => {
    expect(classifyComponentType('Flat Sheet')).toBe('ok');
    expect(classifyComponentType('FITTED SHEET')).toBe('ok');
    expect(classifyComponentType('pillow case')).toBe('ok');
    expect(classifyComponentType('Skirt')).toBe('ok');
    expect(classifyComponentType('Top Fabric')).toBe('ok');
    expect(classifyComponentType('Fabric Bag')).toBe('ok');
  });

  it('flags fabric descriptors as fabric', () => {
    expect(classifyComponentType('Jersey Knit')).toBe('fabric');
    expect(classifyComponentType('85% Modal & 10% Cotton')).toBe('fabric');
    expect(classifyComponentType('100% Cotton, 170 GSM')).toBe('fabric');
    expect(classifyComponentType('Polyester Microfiber')).toBe('fabric');
    expect(classifyComponentType('Sateen 300 TC')).toBe('fabric');
  });

  it('returns unknown for empty / unfamiliar values', () => {
    expect(classifyComponentType('')).toBe('unknown');
    expect(classifyComponentType(null)).toBe('unknown');
    expect(classifyComponentType('Custom Part Name')).toBe('unknown');
  });
});

describe('looksLikeFabricDescription', () => {
  it('detects multi-feature fabric descriptions', () => {
    expect(looksLikeFabricDescription('85% Modal & 10% Egyptian Cotton, 170 GSM Jersey Knit')).toBe(true);
    expect(looksLikeFabricDescription('100% Cotton Sateen, 300 TC')).toBe(true);
    expect(looksLikeFabricDescription('Polyester Microfiber, 90 GSM')).toBe(true);
  });

  it('rejects part names', () => {
    expect(looksLikeFabricDescription('Flat Sheet')).toBe(false);
    expect(looksLikeFabricDescription('Pillow Case')).toBe(false);
    expect(looksLikeFabricDescription('')).toBe(false);
  });

  it('needs 2+ markers (single-keyword strings are not fabric)', () => {
    expect(looksLikeFabricDescription('Cotton')).toBe(false);
    expect(looksLikeFabricDescription('170 GSM')).toBe(false);
  });
});

describe('detectFabricConsumptionAnomalies', () => {
  it('auto-fixes when ALL rows show component/fabric swap', () => {
    // The MFRM SLPCSS pattern: AI put fabric description in component_type
    // for every row.
    const rows = [
      { item_code: 'A', component_type: '85% Modal Jersey Knit, 170 GSM', fabric_type: 'Flat Sheet', consumption_per_unit: 1 },
      { item_code: 'A', component_type: '85% Modal Jersey Knit, 170 GSM', fabric_type: 'Fitted Sheet', consumption_per_unit: 1 },
      { item_code: 'A', component_type: '85% Modal Jersey Knit, 170 GSM', fabric_type: 'Pillow Case', consumption_per_unit: 1 },
    ];
    const { anomalies, autoFixed } = detectFabricConsumptionAnomalies(rows);
    const fix = anomalies.find((a) => a.code === 'AUTO_FIXED_COMPONENT_FABRIC_SWAP');
    expect(fix).toBeDefined();
    expect(autoFixed[0].component_type).toBe('Flat Sheet');
    expect(autoFixed[0].fabric_type).toBe('85% Modal Jersey Knit, 170 GSM');
  });

  it('flags but does NOT auto-fix when only some rows show the swap', () => {
    const rows = [
      { item_code: 'A', component_type: 'Flat Sheet',                  fabric_type: '85% Modal Jersey Knit, 170 GSM', consumption_per_unit: 1 },
      { item_code: 'A', component_type: '85% Modal Jersey Knit, 170 GSM', fabric_type: 'Fitted Sheet',                consumption_per_unit: 1 },
    ];
    const { anomalies, autoFixed } = detectFabricConsumptionAnomalies(rows);
    expect(anomalies.find((a) => a.code === 'POSSIBLE_COMPONENT_FABRIC_SWAP')).toBeDefined();
    expect(anomalies.find((a) => a.code === 'AUTO_FIXED_COMPONENT_FABRIC_SWAP')).toBeUndefined();
    // Data unchanged
    expect(autoFixed[0].component_type).toBe('Flat Sheet');
  });

  it('flags missing item_code as error', () => {
    const rows = [{ component_type: 'Flat Sheet', fabric_type: 'Cotton 170 GSM' }];
    const { anomalies } = detectFabricConsumptionAnomalies(rows);
    expect(anomalies.find((a) => a.code === 'MISSING_ITEM_CODE' && a.severity === 'error')).toBeDefined();
  });

  it('does not flag clean canonical data', () => {
    const rows = [
      { item_code: 'A', component_type: 'Flat Sheet',   fabric_type: '85% Modal Jersey Knit, 170 GSM' },
      { item_code: 'A', component_type: 'Fitted Sheet', fabric_type: '85% Modal Jersey Knit, 170 GSM' },
    ];
    const { anomalies } = detectFabricConsumptionAnomalies(rows);
    expect(anomalies.filter((a) => a.severity === 'error' || a.severity === 'warn')).toEqual([]);
  });

  it('does not crash on empty / null input', () => {
    expect(detectFabricConsumptionAnomalies([]).anomalies).toEqual([]);
    expect(detectFabricConsumptionAnomalies(null).anomalies).toEqual([]);
    expect(detectFabricConsumptionAnomalies(undefined).anomalies).toEqual([]);
  });
});

describe('detectAccessoryConsumptionAnomalies', () => {
  it('flags missing item_code', () => {
    const rows = [{ category: 'Care Label' }];
    const { anomalies } = detectAccessoryConsumptionAnomalies(rows);
    expect(anomalies.find((a) => a.code === 'MISSING_ITEM_CODE')).toBeDefined();
  });

  it('does not flag known categories', () => {
    const rows = [
      { item_code: 'A', category: 'Care Label' },
      { item_code: 'A', category: 'Hang Tag' },
      { item_code: 'A', category: 'Polybag' },
    ];
    const { anomalies } = detectAccessoryConsumptionAnomalies(rows);
    expect(anomalies.filter((a) => a.severity !== 'info')).toEqual([]);
  });
});

describe('detectAndAutoFix', () => {
  it('runs end-to-end on a realistic master_data shape', () => {
    const data = {
      articles: [{ item_code: 'A' }],
      fabric_consumption: [
        { item_code: 'A', component_type: '85% Modal Jersey Knit, 170 GSM', fabric_type: 'Flat Sheet' },
        { item_code: 'A', component_type: '85% Modal Jersey Knit, 170 GSM', fabric_type: 'Fitted Sheet' },
      ],
      accessory_consumption: [
        { item_code: 'A', category: 'Care Label' },
      ],
    };
    const { anomalies, patchedData, summary } = detectAndAutoFix(data);
    expect(summary.auto_fixed).toBeGreaterThan(0);
    expect(patchedData.fabric_consumption[0].component_type).toBe('Flat Sheet');
    expect(patchedData.articles[0].item_code).toBe('A');  // untouched
  });

  it('returns input unchanged when no anomalies', () => {
    const data = {
      fabric_consumption: [
        { item_code: 'A', component_type: 'Flat Sheet', fabric_type: '85% Modal Jersey Knit, 170 GSM' },
      ],
    };
    const { summary } = detectAndAutoFix(data);
    expect(summary.errors).toBe(0);
    expect(summary.warnings).toBe(0);
  });
});
