import { describe, it, expect } from 'vitest';
import {
  articleHasFabricBag,
  getFabricBagComponent,
  resolveFabricBagDimension,
  findArticlesMissingFabricBagDimension,
} from '@/lib/fabricBagDimensionCheck';

describe('articleHasFabricBag', () => {
  it('returns true when components include a Fabric Bag', () => {
    const a = { components: [{ component_type: 'Flat Sheet' }, { component_type: 'Fabric Bag' }] };
    expect(articleHasFabricBag(a)).toBe(true);
  });

  it('case-insensitive match', () => {
    expect(articleHasFabricBag({ components: [{ component_type: 'fabric bag' }] })).toBe(true);
    expect(articleHasFabricBag({ components: [{ component_type: 'FABRIC BAG' }] })).toBe(true);
  });

  it('returns false when no Fabric Bag component', () => {
    expect(articleHasFabricBag({ components: [{ component_type: 'Flat Sheet' }] })).toBe(false);
  });

  it('handles null/empty input safely', () => {
    expect(articleHasFabricBag(null)).toBe(false);
    expect(articleHasFabricBag({})).toBe(false);
    expect(articleHasFabricBag({ components: null })).toBe(false);
    expect(articleHasFabricBag({ components: [] })).toBe(false);
  });
});

describe('getFabricBagComponent', () => {
  it('returns the Fabric Bag component object', () => {
    const fb = { component_type: 'Fabric Bag', dimensions: '12x16' };
    const a = { components: [{ component_type: 'Flat Sheet' }, fb] };
    expect(getFabricBagComponent(a)).toBe(fb);
  });

  it('returns null when no Fabric Bag', () => {
    expect(getFabricBagComponent({ components: [{ component_type: 'Flat Sheet' }] })).toBe(null);
  });
});

describe('resolveFabricBagDimension', () => {
  it('Layer 0: returns component.dimensions when set', () => {
    const a = {
      product_dimensions: '108"x106"',
      components: [{ component_type: 'Fabric Bag', dimensions: '12"x16"' }],
    };
    // Even though article-level and tech-pack data are present, component-level wins.
    expect(resolveFabricBagDimension(a, { 'Fabric Bag': '14"x18"' })).toBe('12"x16"');
  });

  it('Layer 1: falls back to article.product_dimensions when component dim is blank', () => {
    const a = {
      product_dimensions: '108"x106"',
      components: [{ component_type: 'Fabric Bag' }],
    };
    expect(resolveFabricBagDimension(a, null)).toBe('108"x106"');
  });

  it('Layer 2: falls back to tech pack part_dimensions["Fabric Bag"]', () => {
    const a = { components: [{ component_type: 'Fabric Bag' }] };
    expect(resolveFabricBagDimension(a, { 'Fabric Bag': '14"x18"' })).toBe('14"x18"');
  });

  it('Layer 2 is case-insensitive on the part key', () => {
    const a = { components: [{ component_type: 'Fabric Bag' }] };
    expect(resolveFabricBagDimension(a, { 'fabric bag': '14"x18"' })).toBe('14"x18"');
    expect(resolveFabricBagDimension(a, { 'FABRIC BAG': '14"x18"' })).toBe('14"x18"');
  });

  it('does NOT fall through to whole-SKU dimension via tech pack', () => {
    // This is the bug we fixed: tech pack has flat-sheet dimension as
    // product_dimensions, but we must not return it for fabric bag.
    const a = { components: [{ component_type: 'Fabric Bag' }] };
    // Imagine a partDims that has Flat Sheet but no Fabric Bag.
    const partDims = { 'Flat Sheet': '108"x106"', 'Fitted Sheet': '72"x84"' };
    expect(resolveFabricBagDimension(a, partDims)).toBe('');
  });

  it('returns "" when no Fabric Bag component exists', () => {
    const a = { components: [{ component_type: 'Flat Sheet' }] };
    expect(resolveFabricBagDimension(a, null)).toBe('');
  });

  it('returns "" when nothing is known', () => {
    const a = { components: [{ component_type: 'Fabric Bag' }] };
    expect(resolveFabricBagDimension(a, null)).toBe('');
  });
});

describe('findArticlesMissingFabricBagDimension', () => {
  it('returns only articles with a Fabric Bag and no resolved dimension', () => {
    const articles = [
      // Has FB, has component-level dim → resolved
      { article_code: 'A', components: [{ component_type: 'Fabric Bag', dimensions: '12x16' }] },
      // Has FB, no dim anywhere → MISSING
      { article_code: 'B', components: [{ component_type: 'Fabric Bag' }] },
      // No FB → skipped
      { article_code: 'C', components: [{ component_type: 'Flat Sheet' }] },
      // Has FB, tech pack supplies dim → resolved
      { article_code: 'D', components: [{ component_type: 'Fabric Bag' }] },
    ];
    const partDimsByCode = new Map([
      ['D', { 'Fabric Bag': '14x18' }],
    ]);
    const result = findArticlesMissingFabricBagDimension(articles, partDimsByCode);
    expect(result.map(a => a.article_code)).toEqual(['B']);
  });

  it('handles missing index gracefully', () => {
    const articles = [{ article_code: 'X', components: [{ component_type: 'Fabric Bag' }] }];
    expect(findArticlesMissingFabricBagDimension(articles, null).map(a => a.article_code)).toEqual(['X']);
    expect(findArticlesMissingFabricBagDimension(articles).map(a => a.article_code)).toEqual(['X']);
  });

  it('returns empty array for non-array input', () => {
    expect(findArticlesMissingFabricBagDimension(null)).toEqual([]);
    expect(findArticlesMissingFabricBagDimension(undefined)).toEqual([]);
  });
});
