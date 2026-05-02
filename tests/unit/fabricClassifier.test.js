import { describe, it, expect } from 'vitest';
import {
  isFabricComponent,
  isFabricComponentWithWarn,
  FABRIC_PART_NAMES,
} from '@/lib/fabricClassifier';

describe('isFabricComponent — explicit kind', () => {
  it('INCLUDES anything with kind=fabric', () => {
    expect(isFabricComponent({ kind: 'fabric', component_type: 'anything' })).toBe(true);
    expect(isFabricComponent({ kind: 'fabric', component_type: '' })).toBe(true);
  });

  it('EXCLUDES anything with kind=accessory|trim|packaging regardless of component_type', () => {
    expect(isFabricComponent({ kind: 'accessory', component_type: 'flat sheet' })).toBe(false);
    expect(isFabricComponent({ kind: 'trim', component_type: 'top fabric' })).toBe(false);
    expect(isFabricComponent({ kind: 'packaging', component_type: 'fabric bag' })).toBe(false);
  });
});

describe('isFabricComponent — legacy rows by component_type', () => {
  it('INCLUDES canonical fabric parts', () => {
    expect(isFabricComponent({ component_type: 'flat sheet' })).toBe(true);
    expect(isFabricComponent({ component_type: 'Fitted Sheet' })).toBe(true);
    expect(isFabricComponent({ component_type: 'Top Fabric' })).toBe(true);
    expect(isFabricComponent({ component_type: 'pillow case' })).toBe(true);
    expect(isFabricComponent({ component_type: 'skirt' })).toBe(true);
    expect(isFabricComponent({ component_type: 'platform' })).toBe(true);
    expect(isFabricComponent({ component_type: 'piping' })).toBe(true);
    expect(isFabricComponent({ component_type: 'binding' })).toBe(true);
    expect(isFabricComponent({ component_type: 'fabric bag' })).toBe(true);
    expect(isFabricComponent({ component_type: 'sleeper flap' })).toBe(true);
    expect(isFabricComponent({ component_type: 'evalon membrane' })).toBe(true);
    expect(isFabricComponent({ component_type: 'filling' })).toBe(true);
    expect(isFabricComponent({ component_type: 'lamination' })).toBe(true);
    expect(isFabricComponent({ component_type: 'front' })).toBe(true);
    expect(isFabricComponent({ component_type: 'back' })).toBe(true);
  });

  it('INCLUDES variants that strip to a canonical fabric part', () => {
    expect(isFabricComponent({ component_type: 'Fitted Sheet (Split Head)' })).toBe(true);
    expect(isFabricComponent({ component_type: 'Fitted Sheet (2pc Split)' })).toBe(true);
    expect(isFabricComponent({ component_type: 'Pillow Case (1pc)' })).toBe(true);
    expect(isFabricComponent({ component_type: 'Pillow Case (2pc)' })).toBe(true);
  });

  it('INCLUDES aliases via the central vocabulary', () => {
    expect(isFabricComponent({ component_type: 'Top Sheet' })).toBe(true);    // alias for Flat Sheet
    expect(isFabricComponent({ component_type: 'pillowcase' })).toBe(true);   // alias for Pillow Case
    expect(isFabricComponent({ component_type: 'border' })).toBe(true);       // alias for Skirt
    expect(isFabricComponent({ component_type: 'top panel' })).toBe(true);    // alias for Top Fabric
    expect(isFabricComponent({ component_type: 'self fabric bag' })).toBe(true);
  });

  it('INCLUDES the legacy compound "bottom + skirt"', () => {
    expect(isFabricComponent({ component_type: 'bottom + skirt' })).toBe(true);
    expect(isFabricComponent({ component_type: 'Bottom + Skirt' })).toBe(true);
  });

  it('EXCLUDES accessory categories', () => {
    expect(isFabricComponent({ component_type: 'zipper' })).toBe(false);
    expect(isFabricComponent({ component_type: 'thread' })).toBe(false);
    expect(isFabricComponent({ component_type: 'elastic' })).toBe(false);
    expect(isFabricComponent({ component_type: 'law tag' })).toBe(false);
    expect(isFabricComponent({ component_type: 'size label' })).toBe(false);
    expect(isFabricComponent({ component_type: 'label' })).toBe(false);
    expect(isFabricComponent({ component_type: 'pvc bag' })).toBe(false);
    expect(isFabricComponent({ component_type: 'insert card' })).toBe(false);
    expect(isFabricComponent({ component_type: 'stiffener' })).toBe(false);
    expect(isFabricComponent({ component_type: 'stiffener size' })).toBe(false);
    expect(isFabricComponent({ component_type: 'size sticker' })).toBe(false);
    expect(isFabricComponent({ component_type: 'barcode sticker' })).toBe(false);
    expect(isFabricComponent({ component_type: 'barcode sticker size' })).toBe(false);
    expect(isFabricComponent({ component_type: 'packaging' })).toBe(false);
    expect(isFabricComponent({ component_type: 'care label' })).toBe(false);
    expect(isFabricComponent({ component_type: 'hang tag' })).toBe(false);
    expect(isFabricComponent({ component_type: 'poly bag' })).toBe(false);
  });

  it('EXCLUDES non-fabric vocabulary parts (Outer, Quilting, etc.)', () => {
    // These are valid canonical parts but aren't on the fabric whitelist.
    expect(isFabricComponent({ component_type: 'Outer' })).toBe(false);
    expect(isFabricComponent({ component_type: 'Inner' })).toBe(false);
    expect(isFabricComponent({ component_type: 'Quilting' })).toBe(false);
    expect(isFabricComponent({ component_type: 'Pillow Compression' })).toBe(false);
  });

  it('EXCLUDES unknown component_type values (fail-closed)', () => {
    expect(isFabricComponent({ component_type: 'mystery thing' })).toBe(false);
    expect(isFabricComponent({ component_type: '' })).toBe(false);
    expect(isFabricComponent({ component_type: null })).toBe(false);
    expect(isFabricComponent({ })).toBe(false);
  });

  it('returns false for null/undefined component', () => {
    expect(isFabricComponent(null)).toBe(false);
    expect(isFabricComponent(undefined)).toBe(false);
  });
});

describe('isFabricComponent — onUnknown callback', () => {
  it('fires only on the fail-closed unknown branch, not on known accessories', () => {
    const seen = [];
    const cb = (info) => seen.push(info);

    isFabricComponent({ component_type: 'zipper', __article_code: 'A1' }, { onUnknown: cb });
    isFabricComponent({ component_type: 'flat sheet', __article_code: 'A2' }, { onUnknown: cb });
    expect(seen).toEqual([]);

    isFabricComponent({ component_type: 'mystery type', __article_code: 'A3' }, { onUnknown: cb });
    expect(seen).toHaveLength(1);
    expect(seen[0].component_type).toBe('mystery type');
    expect(seen[0].article_code).toBe('A3');
  });

  it('does not fire for vocabulary non-fabric parts (Outer, Quilting)', () => {
    const seen = [];
    isFabricComponent({ component_type: 'Outer' }, { onUnknown: (i) => seen.push(i) });
    isFabricComponent({ component_type: 'Quilting' }, { onUnknown: (i) => seen.push(i) });
    expect(seen).toEqual([]);
  });

  it('swallows callback errors silently', () => {
    const cb = () => { throw new Error('boom'); };
    expect(() => isFabricComponent({ component_type: 'mystery' }, { onUnknown: cb })).not.toThrow();
  });
});

describe('isFabricComponentWithWarn', () => {
  it('returns the same answer as isFabricComponent', () => {
    expect(isFabricComponentWithWarn({ component_type: 'flat sheet' })).toBe(true);
    expect(isFabricComponentWithWarn({ component_type: 'zipper' })).toBe(false);
    expect(isFabricComponentWithWarn(null)).toBe(false);
  });
});

describe('FABRIC_PART_NAMES export', () => {
  it('contains the expected canonical names', () => {
    expect(FABRIC_PART_NAMES.has('Flat Sheet')).toBe(true);
    expect(FABRIC_PART_NAMES.has('Fitted Sheet')).toBe(true);
    expect(FABRIC_PART_NAMES.has('Pillow Case')).toBe(true);
    expect(FABRIC_PART_NAMES.size).toBeGreaterThan(10);
  });

  it('does not include non-fabric parts', () => {
    expect(FABRIC_PART_NAMES.has('Outer')).toBe(false);
    expect(FABRIC_PART_NAMES.has('Quilting')).toBe(false);
    expect(FABRIC_PART_NAMES.has('Sham')).toBe(false);
  });
});
