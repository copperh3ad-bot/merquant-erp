import { describe, it, expect } from 'vitest';
import {
  canonical,
  isInCategory,
  allCanonicals,
  classify,
  CATEGORIES,
  directionForPart,
  productFamilyOf,
  PRODUCT_FAMILIES,
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

describe('directionForPart', () => {
  it('returns WXL for sheet-set parts', () => {
    expect(directionForPart('Flat Sheet')).toBe('WXL');
    expect(directionForPart('Fitted Sheet')).toBe('WXL');
    expect(directionForPart('Pillow Case')).toBe('WXL');
    expect(directionForPart('Top Fabric')).toBe('WXL');
  });

  it('returns LXW for skirt', () => {
    expect(directionForPart('Skirt')).toBe('LXW');
    expect(directionForPart('Border')).toBe('LXW');  // alias
  });

  it('returns null for parts without a conventional direction', () => {
    expect(directionForPart('Fabric Bag')).toBe(null);
    expect(directionForPart('Filling')).toBe(null);
    expect(directionForPart('Quilting')).toBe(null);
  });

  it('canonicalises aliases before looking up', () => {
    expect(directionForPart('Top Sheet')).toBe('WXL');             // alias for Flat Sheet
    expect(directionForPart('fitted sheet')).toBe('WXL');          // case-insensitive
    expect(directionForPart('Self Fabric Bag')).toBe(null);        // alias for Fabric Bag
  });

  it('returns null for unknown parts', () => {
    expect(directionForPart('Nonexistent Part')).toBe(null);
    expect(directionForPart('')).toBe(null);
    expect(directionForPart(null)).toBe(null);
  });
});

describe('productFamilyOf', () => {
  it('detects mattress protector codes', () => {
    expect(productFamilyOf('GPMP38')).toBe('Mattress Protector');
    expect(productFamilyOf('GPMP78')).toBe('Mattress Protector');
    expect(productFamilyOf('GPFRIOMP46')).toBe('Mattress Protector');
  });

  it('detects pillow protector codes', () => {
    expect(productFamilyOf('GPPPK')).toBe('Pillow Protector');
    expect(productFamilyOf('GPPPQ')).toBe('Pillow Protector');
    expect(productFamilyOf('GPFRIOPPK')).toBe('Pillow Protector');
    expect(productFamilyOf('XPP38')).toBe('Pillow Protector');
  });

  it('detects encasements', () => {
    expect(productFamilyOf('GPSE33')).toBe('Sleeper Encasement');
    expect(productFamilyOf('GPTE50')).toBe('Total Encasement');
  });

  it('detects sheet sets via known string markers', () => {
    expect(productFamilyOf('SLPCSS-K')).toBe('Sheet Set');         // ^SLP prefix
    expect(productFamilyOf('JFCSS-K')).toBe('Sheet Set');          // CSS substring
    expect(productFamilyOf('SHTSET-Q')).toBe('Sheet Set');
    expect(productFamilyOf('SS-100')).toBe('Sheet Set');
  });

  it('returns null for opaque codes (handled by AI fallback layer)', () => {
    // PCSJMO is a sheet-set family but its code doesn't contain CSS/SLP/etc.
    // Regex can't catch this — the AI-fallback classifyTermAI handles it.
    expect(productFamilyOf('PCSJMO-Q-WH')).toBe(null);
  });

  it('detects accent products', () => {
    expect(productFamilyOf('COMF-K')).toBe('Comforter');
    expect(productFamilyOf('DC100')).toBe('Duvet Cover');
    expect(productFamilyOf('DUVET-Q')).toBe('Duvet Cover');
    expect(productFamilyOf('TOPPER-K')).toBe('Mattress Topper');
    expect(productFamilyOf('THROW-50')).toBe('Throw');
  });

  it('returns null for unknown / empty input', () => {
    expect(productFamilyOf('')).toBe(null);
    expect(productFamilyOf(null)).toBe(null);
    expect(productFamilyOf('XYZ-RANDOM')).toBe(null);
  });

  it('PRODUCT_FAMILIES exposes the full enum', () => {
    expect(PRODUCT_FAMILIES.length).toBeGreaterThan(8);
    expect(PRODUCT_FAMILIES).toContain('Mattress Protector');
    expect(PRODUCT_FAMILIES).toContain('Sheet Set');
    expect(PRODUCT_FAMILIES).toContain('Comforter');
  });
});
