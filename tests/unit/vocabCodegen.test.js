// Verifies that the codegen'd vocab snapshot under supabase/functions/
// is in sync with src/lib/textileVocabulary.js. If this test fails, run
// `npm run codegen:vocab` and commit the regenerated file.
//
// The check imports both sources (the generated TS file is parsed as text
// since vitest doesn't run TypeScript edge-function imports in this env)
// and asserts the canonical lists match exactly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATEGORIES, allCanonicals } from '@/lib/textileVocabulary';

const here = dirname(fileURLToPath(import.meta.url));
const generatedPath = join(here, '../../supabase/functions/extract-document/_vocab.generated.ts');

describe('vocab codegen — supabase/functions/extract-document/_vocab.generated.ts', () => {
  const generated = readFileSync(generatedPath, 'utf8');

  it('exposes the same CATEGORIES list', () => {
    const m = generated.match(/export const CATEGORIES = (\[[^\]]+\])/);
    expect(m, 'CATEGORIES export not found').not.toBeNull();
    const cats = JSON.parse(m[1]);
    expect(cats).toEqual([...CATEGORIES]);
  });

  it.each(['part', 'fabric_type', 'fibre', 'accessory', 'trim', 'size', 'colour'])(
    'exposes %s canonicals matching textileVocabulary',
    (cat) => {
      const upper = cat.toUpperCase();
      const re = new RegExp(`export const ${upper}_CANONICALS = (\\[[^\\]]+\\])`);
      const m = generated.match(re);
      expect(m, `${upper}_CANONICALS export not found`).not.toBeNull();
      const canonicals = JSON.parse(m[1]);
      const expected = [...allCanonicals(cat)].sort();
      expect(canonicals).toEqual(expected);
    },
  );

  it('exposes label_type / polybag_type / sticker_type / etc sub-registries', () => {
    for (const sub of [
      'label_type', 'polybag_type', 'sticker_type', 'zipper_type',
      'stiffener_type', 'insert_card_type', 'carton_type', 'trim_detail_type',
    ]) {
      const upper = sub.toUpperCase();
      const re = new RegExp(`export const ${upper}_CANONICALS = (\\[[^\\]]+\\])`);
      const m = generated.match(re);
      expect(m, `${upper}_CANONICALS export not found — run npm run codegen:vocab`).not.toBeNull();
      const canonicals = JSON.parse(m[1]);
      const expected = [...allCanonicals(sub)].sort();
      expect(canonicals).toEqual(expected);
    }
  });

  it('header reminds developers not to edit by hand', () => {
    expect(generated).toContain('AUTO-GENERATED');
    expect(generated).toContain('DO NOT EDIT BY HAND');
    expect(generated).toContain('scripts/generate-vocab-edge.mjs');
  });
});
