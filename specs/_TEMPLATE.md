# Spec: <one-line title>

> **Spec ID:** YYYY-MM-DD-<slug>
> **Status:** Draft | Approved | Implemented | Superseded
> **Owner:** <name>
> **Related:** <links to other specs, HANDOVER sections, GitHub issues>

---

## 1. Problem statement

What's broken or missing today. What changes after this spec ships. One paragraph, no fluff.

## 2. Non-goals

What this spec explicitly does NOT do. Defer-list for adjacent work that will tempt scope creep.

## 3. Schema diff

DDL for new tables, columns, indexes, constraints. Both `migrations/up/` and `migrations/down/` files referenced by name.

```sql
-- migrations/up/00XX_<slug>.sql
...
```

## 4. RLS diff

Every new table needs RLS. Every modified table's policies are re-stated in full (not as a diff) so the implementation has the complete intended state.

```sql
alter table <table> enable row level security;
create policy ... ;
```

## 5. RPC contract

For each new/modified RPC: signature, input JSON shape, output JSON shape, error codes. If an edge function is involved, document its HTTP contract here too.

```sql
create or replace function fn_<name>(...) returns jsonb ...
```

Input:
```json
{...}
```

Output (success):
```json
{ "ok": true, ... }
```

Output (error):
```json
{ "ok": false, "user_message": "...", "code": "..." }
```

## 6. Validation rules

Deterministic rules that run before any DB write. Distinguish blocking errors from non-blocking warnings.

## 7. User-facing error strings

Table of error code → `user_message` (plain language) → `dev_detail` (technical). No stack traces in user-facing strings.

| Code | user_message | dev_detail |
|---|---|---|
| ... | ... | ... |

## 8. Test cases

Three tiers. All must pass before merge.

### Unit tests (`tests/unit/<slug>.test.js`)
- Test 1
- Test 2

### DB tests (`tests/db/<slug>.sql`)
- Test 1
- Test 2

### Integration tests (`tests/integration/<slug>.test.ts`)
- Test 1

## 9. Acceptance criteria

Numbered checklist. Spec is "done" when every item is true.

1. ...
2. ...

## 10. Rollback plan

How to back this out without data loss. Per-piece (frontend, RPC, edge function, schema).

## 11. Future work (out of scope)

What this spec deliberately defers, with rough triggers for when to revisit.
