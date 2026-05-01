# Chatbot Data-Input — Prototype Proposal

**Goal:** Replace template-bound data entry with a conversational chatbot that accepts files, pasted spreadsheets, or free-form descriptions; uses Claude to parse, classify, and dedupe; presents proposed writes for human approval; then commits to existing tables.

**Scope:** UI layer + glue logic only. **Zero schema changes.** Reuses existing AI extraction infrastructure end-to-end.

---

## What's already built (don't rebuild)

The audit (`docs/ai-extraction-audit-2026-05-01.md`) confirms a complete extraction pipeline already exists. The new chatbot is essentially an alternative front door for the same pipeline.

| Layer | Existing piece | Role in new chatbot |
|---|---|---|
| **Auth + Claude calls** | `src/lib/aiProxy.js` (`callClaude`, `askClaude`) | Direct reuse |
| **File parsing** | `extract-document` edge fn (Haiku→Sonnet, BOB fast-path) | Direct reuse via existing tool |
| **Component classification** | `classify-components` edge fn + `componentClassifier.js` | Direct reuse for ambiguous trims/accessories |
| **Header normalization** | `headerNormalizer.js` | Direct reuse for pasted spreadsheets |
| **Dimension normalization** | `dimensionNormalizer.js` | Direct reuse for free-form sizes |
| **Staging table** | `ai_extractions` (raw + extracted JSONB, review_status) | Direct reuse |
| **Apply / reject** | `fn_apply_tech_pack_extraction`, `fn_apply_master_data_extraction`, `fn_reject_extraction` | Direct reuse |
| **Review UI** | `src/pages/AIExtractionReview.jsx` | Linked to from chatbot for "open in full review" |

**Conclusion:** the chatbot is roughly ~1500 lines of new React + 1 small edge function tweak + a few new RPCs for cross-document dedup. The hard work is already done.

---

## What's new

### 1. New page: `src/pages/AIDataInput.jsx` (working title)

A focused chat interface — distinct from `AIAssistant.jsx` (which stays as the developer tool for SQL queries).

```
┌────────────────────────────────────────────────────┐
│  AI Data Input                                     │
├────────────────────────────────────────────────────┤
│  💬 What would you like to add?                    │
│                                                    │
│  • Drop a file (XLSX, PDF, CSV, image)             │
│  • Paste a spreadsheet from Excel                  │
│  • Or just type — "add 5 PureCare King articles    │
│    at $42 each"                                    │
│                                                    │
│  [chat history scrolls here]                       │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ Type a message or paste data...    [📎] [➤] │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

### 2. New edge function: `chat-parse` (or extend `ai-proxy`)

Handles free-form text (no file). Claude with tool-use, given:
- A summary of the database schema (which entities exist)
- The user's message
- Tools to: classify entity type, lookup existing data, stage proposed writes

For files, the chatbot delegates to the existing `extract-document` function — no rewrite needed.

### 3. New RPCs for cross-document dedup

Two small SQL functions that the chatbot calls before staging:

```sql
-- Existing names that conflict with new candidates
fn_find_duplicate_articles(p_codes text[]) RETURNS TABLE(article_code text, ...)
fn_find_duplicate_suppliers(p_names text[]) RETURNS TABLE(name text, ...)
```

Used to surface "5 of the 8 articles already exist — review changes" rather than blindly staging.

### 4. Inline lightweight review

Instead of routing to the full `AIExtractionReview.jsx` page (which is great for big imports), small proposed-writes appear as cards inline in the chat. User clicks "Looks good" or "Edit" or "Reject" without leaving.

For larger imports (50+ rows), chatbot says "this is a big batch — opening it in the review page" and routes accordingly.

---

## Conversation flow examples

### Example 1: File upload

```
User: [drops Tech Pack — Pillow Protector (FT2).xlsx]
AI:   I see a tech pack for FT2 mattress protectors. Parsing...
      
      Found 6 SKUs (Twin, Full, Queen, King, CK, FXL),
      24 fabric components, 12 trims, 8 packaging items.
      
      ✓ All article codes match the existing PureCare program
      ⚠ 2 SKUs (GPMP38, GPMP46) already exist — this is a revision
        Diff: GPMP38 zipper length changed from 60" to 72"
      
      [Review changes]  [Apply all]  [Reject]
```

### Example 2: Pasted text

```
User: Add 3 new suppliers:
      - Silk Mills, Karachi, sales@silkmills.pk, +92 21 1234567
      - YKK Pakistan (zippers), Lahore  
      - Avery Dennison, ireland office for labels

AI:   I'll add 3 suppliers. Some details look incomplete:
      
      • Silk Mills — Karachi, sales@silkmills.pk, +92 21 1234567 ✓
      • YKK Pakistan — Lahore, no contact info. OK to leave blank?
      • Avery Dennison — what's the email?
      
      [Yes proceed]  [Cancel]  [Provide more info]

User: yes proceed, leave blank where unknown

AI:   Done. 3 suppliers staged for your review:
      [card with the 3 rows + Apply / Edit / Reject]
```

### Example 3: Ambiguous component

```
User: Set the binding for GPMP38 to 1" satin tape, gold

AI:   Updating GPMP38. Note: 1" satin tape is usually classified
      as either "Trim → Binding" or "Accessory → Tape".
      For mattress protectors, the consumption library shows
      "Trim → Binding" (4 prior entries). Use that?
      
      [Yes use Trim → Binding]  [Use Accessory → Tape]  [Other]
```

---

## Phased delivery (4 phases, ~2 weeks of focused work)

### Phase 1 — Tech pack chatbot (3–4 days)

- New page in nav
- File-only intake (drag/drop XLSX/PDF)
- Calls existing `extract-document`
- Inline review card for ≤10 SKUs, route to `AIExtractionReview.jsx` for bigger
- Wire to existing `fn_apply_tech_pack_extraction`
- **No** free-form text yet, **no** dedup yet

This proves the pattern with minimal new code.

### Phase 2 — Master data + paste-in (3–4 days)

- Accept pasted spreadsheets (CSV-like text)
- Calls `headerNormalizer` to map "Article Code", "article_code", "ItemCode" all to `article_code`
- Routes to `fn_apply_master_data_extraction`
- Free-form text for short lists ("add these 5 suppliers")

### Phase 3 — Cross-document dedup + multi-turn (3 days)

- New `fn_find_duplicates_*` SQL functions
- Chatbot proactively asks "I see GPMP38 already exists, this looks like a revision — confirm?"
- Multi-turn refinement: chatbot can ask follow-up questions before committing

### Phase 4 — Polish & broaden (2–3 days)

- Streaming responses (nicer feel)
- Add quick-add for accessories, trims, packaging
- Maybe a floating "Quick Add" button on every page that opens the chatbot in a drawer
- Optionally: WhatsApp paste-in flow ("here's what the buyer said, parse it")

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Chatbot proposes wrong writes | All writes go through `ai_extractions` review step — nothing lands in live tables without explicit user approval |
| Claude API cost | Reuse existing prompt-caching (already set up); track per-conversation usage; default to Haiku 4.5, escalate to Sonnet only when needed |
| User confusion with existing `AIAssistant.jsx` | Name them differently in nav: `AIAssistant` → "AI Programmer (advanced)", new one → "AI Data Input" |
| Free-form text is ambiguous | Chatbot asks clarifying questions instead of guessing; if confidence < 0.7, defer to user |
| Schema mismatch over time | Chatbot reads schema from `information_schema` at boot, so it adapts when you add columns |

---

## Decisions I need from you before Phase 1

1. **Page name?** Options: "AI Data Input", "Quick Add", "Smart Input", "Add via AI", or something else?
2. **Where in the left nav?** Top-level? Under Master Data?
3. **Phase 1 first target — tech packs or master data?** Tech packs are more painful (template is rigid, lots of data) — recommend starting there.
4. **Floating button on every page later, or just a dedicated page?** I'd start with a dedicated page for Phase 1, add the floating button in Phase 4.
5. **Permission gate?** Limit to Manager+Owner roles? Or open to all signed-in users?

---

## What I will NOT do without explicit approval

- Modify the schema (you already said all tables are useful — this is locked)
- Touch the existing `AIAssistant.jsx` page
- Touch the existing upload dialogs (they keep working as-is during Phase 1)
- Deploy edge functions to production until you sign off on the new ones
- Commit any code until each phase is reviewed

Once Phase 1 ships and you've used it for a day or two, we decide whether to proceed to Phase 2.
