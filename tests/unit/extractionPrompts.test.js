import { describe, it, expect } from 'vitest';
import {
  getPromptForKind,
  PROMPT_VERSION_BY_KIND,
  MODEL_BY_KIND,
  MODEL_CHAIN_BY_KIND,
} from '../../supabase/functions/extract-document/prompts.ts';

// Spec §8 unit tests 12-14 + drift detection.
// Snapshots fail loudly on any prompt change so reviewers can confirm intent
// before bumping the snapshot with `npm run test:unit -- -u`.

describe('getPromptForKind (drift detection)', () => {
  it('tech_pack system prompt matches snapshot', () => {
    const { systemPrompt } = getPromptForKind('tech_pack');
    expect(systemPrompt).toMatchSnapshot();
  });

  it('master_data system prompt matches snapshot', () => {
    const { systemPrompt } = getPromptForKind('master_data');
    expect(systemPrompt).toMatchSnapshot();
  });

  it('tech_pack tool schema matches snapshot', () => {
    const { tool } = getPromptForKind('tech_pack');
    expect(tool).toMatchSnapshot();
  });

  it('master_data tool schema matches snapshot', () => {
    const { tool } = getPromptForKind('master_data');
    expect(tool).toMatchSnapshot();
  });
});

describe('getPromptForKind (structural sanity)', () => {
  it('returns a tool with name and input_schema for tech_pack', () => {
    const { tool, systemPrompt, version, models } = getPromptForKind('tech_pack');
    expect(tool.name).toBe('extract_tech_pack');
    expect(tool.input_schema).toBeDefined();
    expect(tool.input_schema.type).toBe('object');
    expect(tool.input_schema.required).toContain('skus');
    expect(typeof systemPrompt).toBe('string');
    expect(systemPrompt.length).toBeGreaterThan(100);
    expect(version).toBe('tech_pack.v1');
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThanOrEqual(1);
  });

  it('returns a tool with name and input_schema for master_data', () => {
    const { tool, systemPrompt, version, models } = getPromptForKind('master_data');
    expect(tool.name).toBe('extract_master_data');
    expect(tool.input_schema).toBeDefined();
    expect(tool.input_schema.type).toBe('object');
    // master_data sections are all optional — no required at the top level
    expect(systemPrompt.length).toBeGreaterThan(100);
    expect(version).toBe('master_data.v1');
    expect(models.length).toBeGreaterThanOrEqual(1);
  });

  it('every kind in PROMPT_VERSION_BY_KIND has a matching MODEL_BY_KIND entry', () => {
    for (const kind of Object.keys(PROMPT_VERSION_BY_KIND)) {
      expect(MODEL_BY_KIND[kind]).toBeDefined();
      expect(MODEL_CHAIN_BY_KIND[kind]).toBeDefined();
      expect(MODEL_CHAIN_BY_KIND[kind][0]).toBe(MODEL_BY_KIND[kind]);
    }
  });

  it('Haiku-first / Sonnet fallback chain shape', () => {
    for (const chain of Object.values(MODEL_CHAIN_BY_KIND)) {
      expect(chain[0]).toMatch(/haiku/i);
      if (chain.length > 1) {
        expect(chain[chain.length - 1]).toMatch(/sonnet|opus/i);
      }
    }
  });
});

describe('getPromptForKind (rejected inputs)', () => {
  it('does not throw on the two known kinds', () => {
    expect(() => getPromptForKind('tech_pack')).not.toThrow();
    expect(() => getPromptForKind('master_data')).not.toThrow();
  });
});
