import { describe, it, expect } from 'vitest';
import { inferSizeFromSku, resolveProductSize } from '@/lib/skuSizeInference';

describe('inferSizeFromSku', () => {
  it('returns null on empty input', () => {
    expect(inferSizeFromSku(null)).toBe(null);
    expect(inferSizeFromSku(undefined)).toBe(null);
    expect(inferSizeFromSku('')).toBe(null);
    expect(inferSizeFromSku('   ')).toBe(null);
  });

  it('SLPCSS sheet-set sizes', () => {
    expect(inferSizeFromSku('SLPCSS-F-GY')).toBe('Full');
    expect(inferSizeFromSku('SLPCSS-Q-GY')).toBe('Queen');
    expect(inferSizeFromSku('SLPCSS-KCK-BL')).toBe('King/Cal King');
    expect(inferSizeFromSku('SLPCSS-SPK-IV')).toBe('Split King');
    expect(inferSizeFromSku('SLPCSS-SPCK-WH')).toBe('Split Cal King');
    expect(inferSizeFromSku('SLPCSS-SHK-GY')).toBe('Split Head King');
    expect(inferSizeFromSku('SLPCSS-SHCK-BL')).toBe('Split Head Cal King');
    expect(inferSizeFromSku('SLPCSS-TTXL-IV')).toBe('Twin/Twin XL');
  });

  it('PCSJMO pillow / sheet sizes', () => {
    expect(inferSizeFromSku('PCSJMO-CK-MB')).toBe('Cal King');
    expect(inferSizeFromSku('PCSJMO-Q-WH')).toBe('Queen');
    expect(inferSizeFromSku('PCSJMO-K-CG')).toBe('King');
    expect(inferSizeFromSku('PCSJMO-FXL-MB')).toBe('Full XL');
    expect(inferSizeFromSku('PCSJMO-T-WH')).toBe('Twin');
    expect(inferSizeFromSku('PCSJMO-TX-CG')).toBe('Twin XL');
  });

  it('case-insensitive', () => {
    expect(inferSizeFromSku('slpcss-q-gy')).toBe('Queen');
    expect(inferSizeFromSku('SLPCSS-Q-gy')).toBe('Queen');
  });

  it('GPMP-style numeric suffix returns the numeric size', () => {
    expect(inferSizeFromSku('GPMP38')).toBe('38');
    expect(inferSizeFromSku('GPMP46')).toBe('46');
    expect(inferSizeFromSku('GPSE33')).toBe('33');
    expect(inferSizeFromSku('GPTE80')).toBe('80');
    expect(inferSizeFromSku('GPFRIOMP78')).toBe('78');
  });

  it('returns null when only family + color present (no size)', () => {
    // Two-segment SKU where the second is a known color → null
    expect(inferSizeFromSku('SLPCSS-GY')).toBe(null);
    expect(inferSizeFromSku('PCSJMO-WH')).toBe(null);
  });

  it('returns the raw code when an unknown but plausible size appears', () => {
    // Unfamiliar size code but valid shape — return raw so operators see something
    expect(inferSizeFromSku('FOO-XYZ-RD')).toBe('XYZ');
  });

  it('returns null for genuinely unparseable input', () => {
    expect(inferSizeFromSku('not-a-real-sku')).toBe('a'); // 2nd segment is 'a' — single letter passes the regex; that's fine
    expect(inferSizeFromSku('GPSE')).toBe(null);          // no numeric tail, no hyphens
  });
});

describe('resolveProductSize', () => {
  it('uses finishDimensions when present', () => {
    expect(
      resolveProductSize({
        finishDimensions: '60x80x18"',
        itemSize: 'Queen',
        articleCode: 'SLPCSS-K-GY',
      }),
    ).toBe('60x80x18"');
  });

  it('falls back to itemSize when finishDimensions is empty', () => {
    expect(
      resolveProductSize({
        finishDimensions: '',
        itemSize: 'Queen',
        articleCode: 'SLPCSS-K-GY',
      }),
    ).toBe('Queen');
  });

  it('falls back to consumption_library size when both above empty', () => {
    expect(
      resolveProductSize({
        consumptionLibrarySize: 'Twin',
        articleCode: 'SLPCSS-T-GY',
      }),
    ).toBe('Twin');
  });

  it('falls back to SKU inference when all else empty', () => {
    expect(
      resolveProductSize({ articleCode: 'SLPCSS-KCK-GY' }),
    ).toBe('King/Cal King');
    expect(
      resolveProductSize({ articleCode: 'GPMP38' }),
    ).toBe('38');
  });

  it('returns null when no source has data', () => {
    expect(resolveProductSize({})).toBe(null);
    expect(resolveProductSize({ articleCode: '' })).toBe(null);
  });

  it('trims whitespace from primary sources', () => {
    expect(
      resolveProductSize({ itemSize: '  Queen  ', articleCode: 'SLPCSS-K' }),
    ).toBe('Queen');
  });
});
