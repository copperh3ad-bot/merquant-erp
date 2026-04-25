import { describe, it, expect } from 'vitest';
import { getBaseCode, getColorLabel } from '@/lib/articleUtils';

describe('getBaseCode', () => {
  it('strips known color suffix', () => {
    expect(getBaseCode({ article_code: 'GP-KIMONO-WHT-M-CG' })).toBe('GP-KIMONO-WHT-M');
  });

  it('preserves size suffixes that are NOT colors (regression: PCSJMO-CK bug)', () => {
    expect(getBaseCode({ article_code: 'PCSJMO-CK' })).toBe('PCSJMO-CK');
    expect(getBaseCode({ article_code: 'PCSJMO-SCK' })).toBe('PCSJMO-SCK');
    expect(getBaseCode({ article_code: 'PCSJMO-SHK' })).toBe('PCSJMO-SHK');
    expect(getBaseCode({ article_code: 'PCSJMO-TX' })).toBe('PCSJMO-TX');
    expect(getBaseCode({ article_code: 'PCSJMO-FXL' })).toBe('PCSJMO-FXL');
  });

  it('preserves single-letter size suffixes', () => {
    expect(getBaseCode({ article_code: 'PCSJMO-T' })).toBe('PCSJMO-T');
  });

  it('returns empty string when article is null', () => {
    expect(getBaseCode(null)).toBe('');
  });

  it('falls back to article_name with color words stripped when no article_code', () => {
    expect(getBaseCode({ article_name: 'Modal Sheet Cloud Gray' })).toBe('Modal Sheet');
  });
});

describe('getColorLabel', () => {
  it('returns explicit color field when present', () => {
    expect(getColorLabel({ color: 'Navy', article_code: 'X-CG' })).toBe('Navy');
  });

  it('maps known color suffix to label', () => {
    expect(getColorLabel({ article_code: 'PCSJMO-CG' })).toBe('Cloud Gray');
  });

  it('does NOT treat size suffix as color (regression)', () => {
    expect(getColorLabel({ article_code: 'PCSJMO-CK', article_name: 'Cal King Sheet' }))
      .toBe('Cal King Sheet');
  });

  it('returns em-dash placeholder when nothing available', () => {
    expect(getColorLabel(null)).toBe('—');
  });
});
