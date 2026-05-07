// tests/unit/poApprovalAutomation.test.js
//
// Locks the post-RPC client surface added in migration 0029:
//   • db.purchaseOrders.approve(...) dispatches to supabase.rpc and
//     returns the structured JSONB summary verbatim.
//   • formatApprovalSummary turns that summary into a sensible alert
//     string for every documented tna_status / warning shape.
//
// We do NOT exercise the SQL function — that's covered by the manual
// smoke test at tests/db/po_approval_automation.sql.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub the env vars supabaseClient.js reads at import time. vi.hoisted
// runs before any imports (vi.mock is also hoisted, but its factories
// don't fire until module resolution — so we need this separate hoist
// to set process.env first).
vi.hoisted(() => {
  process.env.VITE_SUPABASE_URL = 'http://test.local';
  process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
});

// Capture the rpc mock from inside the @supabase/supabase-js stub so the
// test body can assert against it.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args) => rpcMock(...args),
    // Stubs for the other supabase methods supabaseClient.js touches at
    // module boundaries — none of which we exercise here.
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
    }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { db } from '@/api/supabaseClient';
import { formatApprovalSummary } from '@/lib/approvalSummary';

beforeEach(() => {
  rpcMock.mockReset();
});

describe('db.purchaseOrders.approve — RPC dispatch', () => {
  it('calls fn_approve_po_with_automation with the right args and returns the JSONB result', async () => {
    const fakeResult = {
      approval_status: 'approved',
      po_id: 'po-123',
      po_number: 'PO-001',
      costing_succeeded: 2,
      costing_skipped: 0,
      costing_failed: 0,
      tna_status: 'created',
      warnings: [],
    };
    rpcMock.mockResolvedValue({ data: fakeResult, error: null });

    const result = await db.purchaseOrders.approve('po-123', 'Owner User', 'looks good');

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('fn_approve_po_with_automation', {
      p_po_id: 'po-123',
      p_approved_by: 'Owner User',
      p_notes: 'looks good',
    });
    expect(result).toEqual(fakeResult);
  });

  it('passes p_notes=null when caller passes a falsy notes value', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await db.purchaseOrders.approve('po-1', 'X', '');
    expect(rpcMock.mock.calls[0][1].p_notes).toBeNull();
  });

  it('throws the supabase error when rpc returns one', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('42501: forbidden') });
    await expect(db.purchaseOrders.approve('po-x', 'Merch', null))
      .rejects.toThrow('42501: forbidden');
  });
});

describe('formatApprovalSummary — happy path', () => {
  it('renders a multi-line summary for the typical create-everything case', () => {
    const out = formatApprovalSummary({
      approval_status: 'approved',
      po_number: 'PO-001',
      costing_succeeded: 3,
      costing_skipped: 0,
      costing_failed: 0,
      tna_status: 'created',
      warnings: [],
    });
    expect(out).toContain('PO PO-001 approved.');
    expect(out).toContain('3 costing sheets created');
    expect(out).toContain('T&A calendar generated');
    expect(out).not.toContain('Warnings:');
  });

  it('singularises "1 costing sheet" (no trailing s)', () => {
    const out = formatApprovalSummary({
      po_number: 'PO-1',
      costing_succeeded: 1, costing_skipped: 0, costing_failed: 0,
      tna_status: 'created', warnings: [],
    });
    expect(out).toContain('1 costing sheet created');
    expect(out).not.toContain('1 costing sheets');
  });

  it('reports "no costing sheets to create" when all three counters are zero', () => {
    const out = formatApprovalSummary({
      po_number: 'PO-2',
      costing_succeeded: 0, costing_skipped: 0, costing_failed: 0,
      tna_status: 'skipped:exists', warnings: [],
    });
    expect(out).toContain('no costing sheets to create');
  });
});

describe('formatApprovalSummary — every documented tna_status', () => {
  const cases = [
    ['created',              'T&A calendar generated'],
    ['skipped:exists',       'T&A calendar already existed'],
    ['skipped:no_default',   'no default template configured'],
    ['skipped:no_ship_date', 'PO has no ship-by date'],
    ['failed',               'T&A calendar failed to generate'],
  ];
  it.each(cases)('renders a human-readable label for tna_status=%s', (status, expected) => {
    const out = formatApprovalSummary({
      po_number: 'PO-X',
      costing_succeeded: 0, costing_skipped: 0, costing_failed: 0,
      tna_status: status, warnings: [],
    });
    expect(out).toContain(expected);
  });
});

describe('formatApprovalSummary — warnings', () => {
  it('lists each warning under a "Warnings:" heading with the article_code prefix when present', () => {
    const out = formatApprovalSummary({
      po_number: 'PO-W',
      costing_succeeded: 1, costing_skipped: 0, costing_failed: 1,
      tna_status: 'created',
      warnings: [
        { article_id: 'a1', article_code: 'ART-A', reason: 'COSTING_INSERT_FAILED: bad input' },
        { reason: 'T&A_NO_SHIP_DATE' },
      ],
    });
    expect(out).toContain('Warnings:');
    expect(out).toContain('[ART-A] COSTING_INSERT_FAILED: bad input');
    expect(out).toContain('T&A_NO_SHIP_DATE');
  });

  it('falls back gracefully on a malformed/missing result', () => {
    expect(formatApprovalSummary(null)).toBe('PO approved.');
    expect(formatApprovalSummary(undefined)).toBe('PO approved.');
    expect(formatApprovalSummary('not-an-object')).toBe('PO approved.');
  });
});
