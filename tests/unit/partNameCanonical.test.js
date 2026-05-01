import { describe, it, expect } from 'vitest';
import { canonicalisePart, canonicalPartName, partsEquivalent } from '@/lib/partNameCanonical';

describe('canonicalisePart', () => {
  it('returns empty for null/empty input', () => {
    expect(canonicalisePart(null)).toEqual({ canonical: '', variant: null, raw: '' });
    expect(canonicalisePart('')).toEqual({ canonical: '', variant: null, raw: '' });
    expect(canonicalisePart('   ')).toEqual({ canonical: '', variant: null, raw: '' });
  });

  it('canonicalises bare canonical names case-insensitively', () => {
    expect(canonicalisePart('Flat Sheet').canonical).toBe('Flat Sheet');
    expect(canonicalisePart('flat sheet').canonical).toBe('Flat Sheet');
    expect(canonicalisePart('FLAT SHEET').canonical).toBe('Flat Sheet');
  });

  it('strips a trailing (qualifier) and stores it as variant', () => {
    expect(canonicalisePart('Fitted Sheet (Split Head)')).toEqual({
      canonical: 'Fitted Sheet',
      variant: 'split head',
      raw: 'Fitted Sheet (Split Head)',
    });
    expect(canonicalisePart('Pillow Case (2pc)')).toEqual({
      canonical: 'Pillow Case',
      variant: '2pc',
      raw: 'Pillow Case (2pc)',
    });
  });

  it('handles common aliases', () => {
    expect(canonicalPartName('Top Sheet')).toBe('Flat Sheet');
    expect(canonicalPartName('Self Fabric Bag')).toBe('Fabric Bag');
    expect(canonicalPartName('Drawstring Bag')).toBe('Fabric Bag');
    expect(canonicalPartName('Pillow Sham')).toBe('Sham');
    expect(canonicalPartName('Border')).toBe('Skirt');
  });

  it('handles long-form descriptors that the AI might emit verbatim', () => {
    expect(canonicalPartName('Fitted sheet and Split top fitted sheet')).toBe('Fitted Sheet');
  });

  it('falls back to title-case for unknown inputs', () => {
    expect(canonicalPartName('custom widget')).toBe('Custom Widget');
    expect(canonicalPartName('SOMETHING WEIRD')).toBe('Something Weird');
  });

  it('falls back to title-cased stripped form when alias not found', () => {
    expect(canonicalisePart('Custom Part (red variant)')).toEqual({
      canonical: 'Custom Part',
      variant: 'red variant',
      raw: 'Custom Part (red variant)',
    });
  });
});

describe('partsEquivalent', () => {
  it('matches across variants', () => {
    expect(partsEquivalent('Fitted Sheet', 'Fitted Sheet (Split Head)')).toBe(true);
    expect(partsEquivalent('Pillow Case', 'Pillow Case (1pc)')).toBe(true);
    expect(partsEquivalent('Pillow Case (1pc)', 'Pillow Case (2pc)')).toBe(true);
    expect(partsEquivalent('Top Sheet', 'Flat Sheet')).toBe(true);
  });

  it('rejects different parts', () => {
    expect(partsEquivalent('Flat Sheet', 'Pillow Case')).toBe(false);
    expect(partsEquivalent('Skirt', 'Top Fabric')).toBe(false);
  });

  it('case-insensitive', () => {
    expect(partsEquivalent('FLAT SHEET', 'flat sheet')).toBe(true);
  });

  it('handles null/empty without crash', () => {
    expect(partsEquivalent(null, 'Flat Sheet')).toBe(false);
    expect(partsEquivalent('', '')).toBe(true);  // both empty → equal
  });
});
