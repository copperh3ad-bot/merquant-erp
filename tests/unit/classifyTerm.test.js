import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage if not present (Node test environment may have it via jsdom)
beforeEach(() => {
  // Reset localStorage between tests
  if (typeof localStorage !== 'undefined') localStorage.clear();
  vi.clearAllMocks();
});

// Mock the aiProxy.callClaude before importing classifyTerm
vi.mock('@/lib/aiProxy', () => ({
  callClaude: vi.fn(),
}));

import { classifyTerm, classifyProductFamily, _internals } from '@/lib/classifyTerm';
import { callClaude } from '@/lib/aiProxy';

describe('classifyTerm — vocabulary fast path', () => {
  it('returns vocab hit immediately, never calls AI', async () => {
    const result = await classifyTerm('part', 'Top Sheet');
    expect(result.canonical).toBe('Flat Sheet');
    expect(result.source).toBe('vocab');
    expect(result.confidence).toBe(1);
    expect(callClaude).not.toHaveBeenCalled();
  });

  it('vocab works for fibre, size, accessory categories', async () => {
    expect((await classifyTerm('fibre',     'Lycra')).canonical).toBe('Spandex');
    expect((await classifyTerm('size',      'KCK')).canonical).toBe('King/Cal King');
    expect((await classifyTerm('accessory', 'main label')).canonical).toBe('Brand Label');
    expect(callClaude).not.toHaveBeenCalled();
  });
});

describe('classifyTerm — AI fallback', () => {
  it('calls Claude when vocab misses, accepts result above MIN_CONFIDENCE', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":"Flat Sheet","confidence":0.92,"reason":"customer term for flat sheet"}' }],
    });

    const result = await classifyTerm('part', 'Linen Cover');
    expect(callClaude).toHaveBeenCalledOnce();
    expect(result.canonical).toBe('Flat Sheet');
    expect(result.source).toBe('ai');
    expect(result.confidence).toBeCloseTo(0.92, 2);
  });

  it('returns null when AI confidence is below threshold', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":"Flat Sheet","confidence":0.3,"reason":"unsure"}' }],
    });

    const result = await classifyTerm('part', 'Mystery Thing');
    expect(result.canonical).toBe(null);
    expect(result.source).toBe('ai');
  });

  it('returns null when AI returns canonical=null', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":null,"confidence":0.0,"reason":"no match"}' }],
    });

    const result = await classifyTerm('part', 'Total Garbage');
    expect(result.canonical).toBe(null);
  });

  it('returns null when AI proposes a value not in the allowed set', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":"Custom Made Up Part","confidence":0.99,"reason":"hallucinated"}' }],
    });

    const result = await classifyTerm('part', 'Whatever');
    expect(result.canonical).toBe(null);
  });

  it('handles AI returning malformed JSON gracefully', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: 'this is not json at all' }],
    });

    const result = await classifyTerm('part', 'Whatever');
    expect(result.canonical).toBe(null);
  });

  it('handles AI returning JSON wrapped in code fences', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '```json\n{"canonical":"Pillow Case","confidence":0.85,"reason":"x"}\n```' }],
    });

    const result = await classifyTerm('part', 'Customer Term');
    expect(result.canonical).toBe('Pillow Case');
  });

  it('handles AI fetch error gracefully', async () => {
    callClaude.mockRejectedValue(new Error('network failure'));

    const result = await classifyTerm('part', 'Whatever');
    expect(result.canonical).toBe(null);
    expect(result.source).toBe('none');
  });

  it('respects useAI=false flag (skips AI call)', async () => {
    const result = await classifyTerm('part', 'Unknown Thing', { useAI: false });
    expect(callClaude).not.toHaveBeenCalled();
    expect(result.canonical).toBe(null);
  });
});

describe('classifyTerm — cache', () => {
  it('AI result cached, second call same input does NOT hit AI', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":"Pillow Case","confidence":0.9,"reason":"x"}' }],
    });

    await classifyTerm('part', 'Some Customer Term');
    expect(callClaude).toHaveBeenCalledOnce();

    callClaude.mockClear();
    const second = await classifyTerm('part', 'Some Customer Term');
    expect(callClaude).not.toHaveBeenCalled();
    expect(second.canonical).toBe('Pillow Case');
    expect(second.source).toBe('cache');
  });

  it('cache normalizes whitespace + case', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":"Pillow Case","confidence":0.9,"reason":"x"}' }],
    });
    await classifyTerm('part', 'My Term');
    callClaude.mockClear();

    const second = await classifyTerm('part', '  my   term  ');
    expect(callClaude).not.toHaveBeenCalled();
    expect(second.canonical).toBe('Pillow Case');
  });

  it('cache is per-category', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":"Pillow Case","confidence":0.9,"reason":"x"}' }],
    });
    await classifyTerm('part', 'foo');
    expect(callClaude).toHaveBeenCalledOnce();

    callClaude.mockClear();
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":"Queen","confidence":0.9,"reason":"x"}' }],
    });
    const sizeResult = await classifyTerm('size', 'foo');
    expect(callClaude).toHaveBeenCalledOnce();
    expect(sizeResult.canonical).toBe('Queen');
  });
});

describe('classifyTerm — input validation', () => {
  it('returns null on empty/null input', async () => {
    expect((await classifyTerm('part', '')).canonical).toBe(null);
    expect((await classifyTerm('part', null)).canonical).toBe(null);
    expect((await classifyTerm('part', '   ')).canonical).toBe(null);
    expect(callClaude).not.toHaveBeenCalled();
  });

  it('returns null for unknown category', async () => {
    expect((await classifyTerm('not_a_category', 'foo')).canonical).toBe(null);
    expect(callClaude).not.toHaveBeenCalled();
  });
});

describe('classifyProductFamily', () => {
  it('regex hits for known SKUs without AI', async () => {
    const result = await classifyProductFamily('GPMP38');
    expect(result.canonical).toBe('Mattress Protector');
    expect(result.source).toBe('vocab');
    expect(callClaude).not.toHaveBeenCalled();
  });

  it('AI handles opaque codes that regex misses', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":"Sheet Set","confidence":0.88,"reason":"PCSJMO is PureCare Sheet Jersey Modal — sheet set family"}' }],
    });
    const result = await classifyProductFamily('PCSJMO-Q-WH', { productName: 'PureCare Modal Jersey Sheet Set Queen' });
    expect(result.canonical).toBe('Sheet Set');
    expect(result.source).toBe('ai');
    expect(callClaude).toHaveBeenCalledOnce();
  });

  it('caches AI product family answers', async () => {
    callClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"canonical":"Sheet Set","confidence":0.88,"reason":"x"}' }],
    });
    await classifyProductFamily('SOMETHING-Q-WH');
    callClaude.mockClear();
    const second = await classifyProductFamily('SOMETHING-Q-WH');
    expect(callClaude).not.toHaveBeenCalled();
    expect(second.source).toBe('cache');
  });
});

describe('parseJsonLoose', () => {
  it('parses bare JSON', () => {
    expect(_internals.parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses code-fenced JSON', () => {
    expect(_internals.parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(_internals.parseJsonLoose('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('extracts first { ... } block from prose', () => {
    expect(_internals.parseJsonLoose('Sure! Here is the answer: {"a":1}. Hope that helps.')).toEqual({ a: 1 });
  });
  it('returns null on garbage', () => {
    expect(_internals.parseJsonLoose('hello world')).toBe(null);
    expect(_internals.parseJsonLoose('')).toBe(null);
  });
});
