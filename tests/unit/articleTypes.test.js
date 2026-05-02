import { describe, it, expect } from 'vitest';
import {
  PRODUCT_TYPES,
  classifyArticle,
  applies,
  componentApplies,
  accessoryApplies,
  isSetProduct,
} from '@/lib/articleTypes';

describe('classifyArticle', () => {
  it('routes vocab-recognised SKU codes to the right PRODUCT_TYPES entry', () => {
    expect(classifyArticle({ article_code: 'GPMP38' })).toBe(PRODUCT_TYPES.MATTRESS_PROTECTOR);
    expect(classifyArticle({ article_code: 'GPSE50' })).toBe(PRODUCT_TYPES.SLEEPER_ENCASEMENT);
    expect(classifyArticle({ article_code: 'GPTE50' })).toBe(PRODUCT_TYPES.TOTAL_ENCASEMENT);
    expect(classifyArticle({ article_code: 'GPPPK' })).toBe(PRODUCT_TYPES.PILLOW_PROTECTOR);
    expect(classifyArticle({ article_code: 'PCSJMO-Q-WH' })).toBe(PRODUCT_TYPES.GENERIC); // opaque code
    expect(classifyArticle({ article_code: 'SLPCSS-K-GY' })).toBe(PRODUCT_TYPES.BED_SHEET_SET);
  });

  it('falls back to name keywords when SKU code is opaque', () => {
    expect(classifyArticle({ article_code: 'XYZ123', article_name: 'Bolster Protector Queen' }))
      .toBe(PRODUCT_TYPES.BOLSTER_PROTECTOR);
    expect(classifyArticle({ article_code: 'XYZ', article_name: 'Comforter Set King' }))
      .toBe(PRODUCT_TYPES.COMFORTER_SET);
  });

  it('returns GENERIC for completely unknown input', () => {
    expect(classifyArticle({ article_code: 'XYZ', article_name: 'Random Thing' }))
      .toBe(PRODUCT_TYPES.GENERIC);
  });
});

describe('applies — the key cross-contamination guard', () => {
  // The bug this protects against: a sheet-set tech pack's "Elastic"
  // accessory entry getting attached to a Pillow Case SKU because BOB
  // tech packs emit accessories at the whole-pack level. Without the
  // applies() filter, every SKU in the pack inherits every accessory.

  describe('Elastic (the original bug)', () => {
    it('belongs on Sheet Set, Mattress Protector, Mattress Topper (cap elastic / fitted-sheet construction)', () => {
      expect(applies(PRODUCT_TYPES.BED_SHEET_SET,      'Elastic')).toBe(true);
      expect(applies(PRODUCT_TYPES.MATTRESS_PROTECTOR, 'Elastic')).toBe(true);
      expect(applies(PRODUCT_TYPES.MATTRESS_TOPPER,    'Elastic')).toBe(true);
    });

    it('does NOT belong on Pillow Case, Pillow Protector, Throw, Comforter, Duvet Cover', () => {
      expect(applies(PRODUCT_TYPES.PILLOW_CASE,       'Elastic')).toBe(false);
      expect(applies(PRODUCT_TYPES.PILLOW_PROTECTOR,  'Elastic')).toBe(false);
      expect(applies(PRODUCT_TYPES.THROW,             'Elastic')).toBe(false);
      expect(applies(PRODUCT_TYPES.COMFORTER_SET,     'Elastic')).toBe(false);
      expect(applies(PRODUCT_TYPES.DUVET_COVER,       'Elastic')).toBe(false);
    });
  });

  describe('Zipper', () => {
    it('belongs on zippered closure products', () => {
      expect(applies(PRODUCT_TYPES.PILLOW_PROTECTOR,  'Zipper')).toBe(true);
      expect(applies(PRODUCT_TYPES.TOTAL_ENCASEMENT,  'Zipper')).toBe(true);
      expect(applies(PRODUCT_TYPES.SLEEPER_ENCASEMENT, 'Zipper')).toBe(true);
      expect(applies(PRODUCT_TYPES.BOLSTER_PROTECTOR, 'Zipper')).toBe(true);
      expect(applies(PRODUCT_TYPES.DUVET_COVER,       'Zipper')).toBe(true);
    });

    it('does NOT belong on flat-panel products', () => {
      expect(applies(PRODUCT_TYPES.BED_SHEET_SET,      'Zipper')).toBe(false);
      expect(applies(PRODUCT_TYPES.PILLOW_CASE,        'Zipper')).toBe(false);
      expect(applies(PRODUCT_TYPES.MATTRESS_PROTECTOR, 'Zipper')).toBe(false);
      expect(applies(PRODUCT_TYPES.THROW,              'Zipper')).toBe(false);
    });
  });

  describe('Sleeper Flap / Evalon Membrane (Sleeper-Encasement-only)', () => {
    it('belongs ONLY on Sleeper Encasement', () => {
      expect(applies(PRODUCT_TYPES.SLEEPER_ENCASEMENT, 'Sleeper Flap')).toBe(true);
      expect(applies(PRODUCT_TYPES.SLEEPER_ENCASEMENT, 'Evalon Membrane')).toBe(true);
    });

    it('does NOT belong anywhere else', () => {
      for (const family of ['MATTRESS_PROTECTOR','TOTAL_ENCASEMENT','PILLOW_PROTECTOR','BED_SHEET_SET','PILLOW_CASE','COMFORTER_SET','DUVET_COVER','MATTRESS_TOPPER','THROW']) {
        expect(applies(PRODUCT_TYPES[family], 'Sleeper Flap')).toBe(false);
        expect(applies(PRODUCT_TYPES[family], 'Evalon Membrane')).toBe(false);
      }
    });
  });

  describe('Universal accessories', () => {
    it('Care Label / Size Label / Polybag / Thread apply to every non-generic product type', () => {
      const families = ['MATTRESS_PROTECTOR','TOTAL_ENCASEMENT','SLEEPER_ENCASEMENT','PILLOW_PROTECTOR','BED_SHEET_SET','PILLOW_CASE','COMFORTER_SET','DUVET_COVER','MATTRESS_TOPPER','THROW'];
      for (const family of families) {
        expect(applies(PRODUCT_TYPES[family], 'Care Label')).toBe(true);
        expect(applies(PRODUCT_TYPES[family], 'Size Label')).toBe(true);
        expect(applies(PRODUCT_TYPES[family], 'Polybag')).toBe(true);
        expect(applies(PRODUCT_TYPES[family], 'Thread')).toBe(true);
      }
    });
  });

  describe('GENERIC + edge cases', () => {
    it('GENERIC product type accepts everything', () => {
      expect(applies(PRODUCT_TYPES.GENERIC, 'Elastic')).toBe(true);
      expect(applies(PRODUCT_TYPES.GENERIC, 'Sleeper Flap')).toBe(true);
      expect(applies(PRODUCT_TYPES.GENERIC, 'Some Made Up Thing')).toBe(true);
    });

    it('null product type is permissive (unknown family)', () => {
      expect(applies(null, 'Elastic')).toBe(true);
      expect(applies(undefined, 'Anything')).toBe(true);
    });

    it('empty/null name returns false on a constrained type', () => {
      expect(applies(PRODUCT_TYPES.PILLOW_CASE, '')).toBe(false);
      expect(applies(PRODUCT_TYPES.PILLOW_CASE, null)).toBe(false);
      expect(applies(PRODUCT_TYPES.PILLOW_CASE, undefined)).toBe(false);
    });

    it('matches with case + whitespace tolerance', () => {
      expect(applies(PRODUCT_TYPES.BED_SHEET_SET, 'ELASTIC')).toBe(true);
      expect(applies(PRODUCT_TYPES.BED_SHEET_SET, '  elastic  ')).toBe(true);
    });

    it('substring match catches "Cap Elastic" matching "Elastic"', () => {
      // "Cap Elastic" contains "Elastic" → matches
      expect(applies(PRODUCT_TYPES.MATTRESS_PROTECTOR, 'Cap Elastic')).toBe(true);
    });
  });
});

describe('componentApplies (back-compat, components-only)', () => {
  it('respects components list specifically', () => {
    expect(componentApplies(PRODUCT_TYPES.BED_SHEET_SET, 'Flat Sheet Fabric')).toBe(true);
    expect(componentApplies(PRODUCT_TYPES.BED_SHEET_SET, 'Polybag')).toBe(false);
    // Polybag IS in BED_SHEET_SET.accessories but componentApplies only
    // looks at components, so returns false. This is the legacy behavior.
  });
});

describe('accessoryApplies (back-compat, accessories-only)', () => {
  it('respects accessories list specifically', () => {
    expect(accessoryApplies(PRODUCT_TYPES.BED_SHEET_SET, 'Polybag')).toBe(true);
    expect(accessoryApplies(PRODUCT_TYPES.BED_SHEET_SET, 'Flat Sheet Fabric')).toBe(false);
  });

  it('returns true for Elastic on BED_SHEET_SET (now in accessories list, not just components)', () => {
    // This was the regression we just fixed: Elastic used to be in
    // BED_SHEET_SET.components only, so accessoryApplies returned false
    // for legitimate fitted-sheet elastic.
    expect(accessoryApplies(PRODUCT_TYPES.BED_SHEET_SET, 'Elastic')).toBe(true);
  });
});

describe('isSetProduct', () => {
  it('flags multi-piece products', () => {
    expect(isSetProduct(PRODUCT_TYPES.BED_SHEET_SET)).toBe(true);
    expect(isSetProduct(PRODUCT_TYPES.COMFORTER_SET)).toBe(true);
    expect(isSetProduct(PRODUCT_TYPES.PILLOW_CASE)).toBe(false);
    expect(isSetProduct(PRODUCT_TYPES.GENERIC)).toBe(false);
    expect(isSetProduct(null)).toBe(false);
  });
});
