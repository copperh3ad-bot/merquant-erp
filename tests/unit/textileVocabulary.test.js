import { describe, it, expect } from 'vitest';
import {
  canonical,
  isInCategory,
  allCanonicals,
  classify,
  CATEGORIES,
} from '@/lib/textileVocabulary';

describe('canonical', () => {
  describe('parts', () => {
    it('canonicalises bare names', () => {
      expect(canonical('part', 'Flat Sheet')).toBe('Flat Sheet');
      expect(canonical('part', 'flat sheet')).toBe('Flat Sheet');
      expect(canonical('part', 'FLAT SHEET')).toBe('Flat Sheet');
    });
    it('resolves common aliases', () => {
      expect(canonical('part', 'Top Sheet')).toBe('Flat Sheet');
      expect(canonical('part', 'Self Fabric Bag')).toBe('Fabric Bag');
      expect(canonical('part', 'Drawstring Bag')).toBe('Fabric Bag');
      expect(canonical('part', 'Pillow Sham')).toBe('Sham');
      expect(canonical('part', 'Border')).toBe('Skirt');
    });
    it('returns null for unknown input', () => {
      expect(canonical('part', 'Custom Widget')).toBe(null);
      expect(canonical('part', '')).toBe(null);
      expect(canonical('part', null)).toBe(null);
    });
  });

  describe('fabric_type', () => {
    it('maps construction names', () => {
      expect(canonical('fabric_type', 'Jersey Knit')).toBe('Jersey Knit');
      expect(canonical('fabric_type', 'jersey')).toBe('Jersey Knit');
      expect(canonical('fabric_type', 'Sateen Weave')).toBe('Sateen');
      expect(canonical('fabric_type', 'microfibre')).toBe('Microfiber');
    });
  });

  describe('fibre', () => {
    it('maps composition aliases', () => {
      expect(canonical('fibre', 'Modal')).toBe('Modal');
      expect(canonical('fibre', 'Egyptian Cotton')).toBe('Egyptian Cotton');
      expect(canonical('fibre', 'Tencel')).toBe('Lyocell');
      expect(canonical('fibre', 'Lycra')).toBe('Spandex');
      expect(canonical('fibre', 'Viscose')).toBe('Rayon');
    });
  });

  describe('size', () => {
    it('maps size codes and full names', () => {
      expect(canonical('size', 'Q')).toBe('Queen');
      expect(canonical('size', 'queen')).toBe('Queen');
      expect(canonical('size', 'KCK')).toBe('King/Cal King');
      expect(canonical('size', 'k/ck')).toBe('King/Cal King');
      expect(canonical('size', 'CK')).toBe('Cal King');
      expect(canonical('size', 'California King')).toBe('Cal King');
      expect(canonical('size', 'TTXL')).toBe('Twin/Twin XL');
      expect(canonical('size', 'SHQ')).toBe('Split Head Queen');
    });
  });

  describe('accessory', () => {
    it('maps category aliases', () => {
      expect(canonical('accessory', 'wash label')).toBe('Care Label');
      expect(canonical('accessory', 'main label')).toBe('Brand Label');
      expect(canonical('accessory', 'swing tag')).toBe('Hang Tag');
      expect(canonical('accessory', 'PP Bag')).toBe('Polybag');
      expect(canonical('accessory', 'YKK Zipper')).toBe('Zipper');
      expect(canonical('accessory', 'cardboard insert')).toBe('Stiffener');
    });
  });

  describe('direction', () => {
    it('maps direction codes', () => {
      expect(canonical('direction', 'WXL')).toBe('WXL');
      expect(canonical('direction', 'w x l')).toBe('WXL');
      expect(canonical('direction', 'width x length')).toBe('WXL');
      expect(canonical('direction', 'lxw')).toBe('LXW');
      expect(canonical('direction', 'bias')).toBe('Bias');
    });
  });

  describe('treatment', () => {
    it('maps treatment names', () => {
      expect(canonical('treatment', 'Silvadur')).toBe('Antimicrobial');
      expect(canonical('treatment', 'Scotchgard')).toBe('Stain Repellent');
      expect(canonical('treatment', 'DWR')).toBe('Water Resistant');
      expect(canonical('treatment', 'Stretch Cool')).toBe('Cooling');
    });
  });

  describe('colour', () => {
    it('maps colour codes', () => {
      expect(canonical('colour', 'GY')).toBe('Grey');
      expect(canonical('colour', 'gray')).toBe('Grey');
      expect(canonical('colour', 'BL')).toBe('Blue');
      expect(canonical('colour', 'Light Blue')).toBe('Light Blue');
      expect(canonical('colour', 'IV')).toBe('Ivory');
      expect(canonical('colour', 'CG')).toBe('Cloud Gray');
      expect(canonical('colour', 'MB')).toBe('Misty Blue');
    });
  });
});

describe('isInCategory', () => {
  it('true for canonicals + aliases, false otherwise', () => {
    expect(isInCategory('part', 'Flat Sheet')).toBe(true);
    expect(isInCategory('part', 'top sheet')).toBe(true);
    expect(isInCategory('part', 'Random String')).toBe(false);
    expect(isInCategory('size', 'Queen')).toBe(true);
    expect(isInCategory('size', 'q')).toBe(true);
  });

  it('handles bad inputs gracefully', () => {
    expect(isInCategory('part', null)).toBe(false);
    expect(isInCategory('part', '')).toBe(false);
    expect(isInCategory('nonexistent_category', 'Flat Sheet')).toBe(false);
  });
});

describe('allCanonicals', () => {
  it('returns the canonical names for a category', () => {
    const parts = allCanonicals('part');
    expect(parts).toContain('Flat Sheet');
    expect(parts).toContain('Fitted Sheet');
    expect(parts.length).toBeGreaterThan(15);
  });

  it('returns empty for unknown category', () => {
    expect(allCanonicals('nonexistent')).toEqual([]);
  });
});

describe('classify', () => {
  it('finds the category that contains a term', () => {
    expect(classify('Flat Sheet')).toEqual({ category: 'part', canonical: 'Flat Sheet' });
    expect(classify('Modal')).toEqual({ category: 'fibre', canonical: 'Modal' });
    expect(classify('queen')).toEqual({ category: 'size', canonical: 'Queen' });
    expect(classify('jersey knit')).toEqual({ category: 'fabric_type', canonical: 'Jersey Knit' });
  });

  it('returns null for unrecognised input', () => {
    expect(classify('completely unknown thing')).toBe(null);
  });
});

describe('CATEGORIES', () => {
  it('exposes the full list', () => {
    expect(CATEGORIES).toContain('part');
    expect(CATEGORIES).toContain('fabric_type');
    expect(CATEGORIES).toContain('fibre');
    expect(CATEGORIES).toContain('accessory');
    expect(CATEGORIES).toContain('size');
    expect(CATEGORIES).toContain('direction');
    expect(CATEGORIES).toContain('treatment');
    expect(CATEGORIES).toContain('colour');
  });
});
