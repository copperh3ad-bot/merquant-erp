/**
 * EmailPOAgent.jsx
 * Email-to-PO Agent page for MerQuant ERP
 *
 * Stack: React 18 + Tailwind CSS + shadcn/ui + lucide-react
 * Place at: src/pages/EmailPOAgent.jsx
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail, Sparkles, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, Loader2, Plus, Trash2,
  ClipboardPaste, RotateCcw, ArrowRight, Package,
  AlertCircle, Info, FileCheck
} from 'lucide-react';
import {
  runEmailPOAgent,
  saveEmailPODraft,
  confirmEmailPODraft,
  rejectEmailPODraft,
  getConfidenceLevel,
  getConfidenceColor,
} from '../api/emailPoAgent';

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------
function ConfidenceBadge({ score }) {
  if (score == null) return null;
  const level = getConfidenceLevel(score);
  const pct = Math.round(score * 100);
  const styles = {
    high:   'bg-green-50 text-green-700 border border-green-200',
    medium: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
    low:    'bg-red-50 text-red-700 border border-red-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${styles[level]}`}>
      {level === 'high' && <CheckCircle2 className="w-3 h-3" />}
      {level === 'medium' && <AlertTriangle className="w-3 h-3" />}
      {level === 'low' && <XCircle className="w-3 h-3" />}
      {pct}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Editable field with confidence colouring
// ---------------------------------------------------------------------------
function DraftField({ label, fieldKey, value, onChange, score, type = 'text', placeholder }) {
  const level = score != null ? getConfidenceLevel(score) : null;
  const borderColor = {
    high:   'border-green-300 focus:ring-green-400',
    medium: 'border-yellow-300 focus:ring-yellow-400',
    low:    'border-red-300 focus:ring-red-400',
  }[level] ?? 'border-gray-200 focus:ring-blue-400';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
        {score != null && <ConfidenceBadge score={score} />}
      </div>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        placeholder={placeholder ?? `Enter ${label.toLowerCase()}`}
        className={`w-full px-3 py-2 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 transition-colors ${borderColor}`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line item row
// ---------------------------------------------------------------------------
function LineItemRow({ item, index, fieldScores, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const overallScore = fieldScores?.[`item_${index}`] ?? item.confidence;

  return (
    <div className={`rounded-xl border bg-white overflow-hidden transition-all ${
      item.matched === false ? 'border-red-200 bg-red-50/30' : 'border-gray-200'
    }`}>
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold shrink-0">
          {index + 1}
        </div>

        {/* SKU */}
        <input
          value={item.sku ?? ''}
          onChange={(e) => onChange(index, 'sku', e.target.value)}
          placeholder="SKU / Article"
          className="w-28 px-2 py-1 text-xs font-mono rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
        />

        {/* Description */}
        <input
          value={item.description ?? ''}
          onChange={(e) => onChange(index, 'description', e.target.value)}
          placeholder="Description"
          className="flex-1 px-2 py-1 text-sm rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
        />

        {/* Qty */}
        <input
          type="number"
          value={item.quantity ?? ''}
          onChange={(e) => onChange(index, 'quantity', parseFloat(e.target.value))}
          placeholder="Qty"
          className="w-20 px-2 py-1 text-sm text-right rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
        />

        {/* Unit price */}
        <input
          type="number"
          value={item.unit_price ?? ''}
          onChange={(e) => onChange(index, 'unit_price', parseFloat(e.target.value))}
          placeholder="Price"
          className="w-20 px-2 py-1 text-sm text-right rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
        />

        <ConfidenceBadge score={overallScore} />

        {item.matched === false && (
          <span className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
            Unmatched
          </span>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        <button
          onClick={() => onRemove(index)}
          className="text-gray-300 hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 grid grid-cols-3 gap-3 bg-gray-50/50">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Colour</label>
            <input
              value={item.colour ?? ''}
              onChange={(e) => onChange(index, 'colour', e.target.value)}
              placeholder="Colour / code"
              className="px-2 py-1.5 text-sm rounded border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Fabric</label>
            <input
              value={item.fabric_composition ?? ''}
              onChange={(e) => onChange(index, 'fabric_composition', e.target.value)}
              placeholder="e.g. 100% Cotton"
              className="px-2 py-1.5 text-sm rounded border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Size Breakdown (JSON)</label>
            <input
              value={item.size_breakdown ? JSON.stringify(item.size_breakdown) : ''}
              onChange={(e) => {
                try { onChange(index, 'size_breakdown', JSON.parse(e.target.value)); }
                catch { onChange(index, 'size_breakdown', e.target.value); }
              }}
              placeholder='{"S":100,"M":200,"L":150}'
              className="px-2 py-1.5 text-sm font-mono rounded border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ambiguity / warning banner
// ---------------------------------------------------------------------------
function AmbiguityBanner({ ambiguities, missingFields }) {
  if (!ambiguities?.length && !missingFields?.length) return null;
  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 space-y-2">
      <div className="flex items-center gap-2 text-yellow-800 font-semibold text-sm">
        <AlertTriangle className="w-4 h-4" />
        Agent flagged {(ambiguities?.length ?? 0) + (missingFields?.length ?? 0)} issue(s) — review before confirming
      </div>
      {missingFields?.length > 0 && (
        <div className="text-xs text-yellow-700">
          <span className="font-medium">Missing critical fields: </span>
          {missingFields.join(', ')}
        </div>
      )}
      {ambiguities?.map((a, i) => (
        <div key={i} className="text-xs text-yellow-700">
          <span className="font-medium">{a.field}: </span>{a.issue}
          {a.suggestion && <span className="text-yellow-600"> → {a.suggestion}</span>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overall confidence meter
// ---------------------------------------------------------------------------
function ConfidenceMeter({ score }) {
  const pct = Math.round((score ?? 0) * 100);
  const color = pct >= 85 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-500';
  const label = pct >= 85 ? 'High confidence' : pct >= 60 ? 'Medium confidence' : 'Low confidence — review carefully';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 font-medium">Extraction confidence</span>
        <span className="font-bold text-gray-800">{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function EmailPOAgent() {
  const navigate = useNavigate();

  // Input state
  const [emailSubject, setEmailSubject] = useState('');
  const [emailSender, setEmailSender] = useState('');
  const [emailBody, setEmailBody] = useState('');

  // Agent state
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const [savedDraftId, setSavedDraftId] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [createdPO, setCreatedPO] = useState(null);

  // Step: 'input' | 'review' | 'done'
  const [step, setStep] = useState('input');

  // Run agent
  const handleRun = useCallback(async () => {
    if (!emailBody.trim()) return;
    setRunning(true);
    setError(null);
    setDraft(null);
    setSaved(false);
    setSavedDraftId(null);

    try {
      const result = await runEmailPOAgent({
        subject: emailSubject,
        body: emailBody,
        sender: emailSender,
      });

      if (!result.success) throw new Error(result.error ?? 'Agent failed');

      if (!result.draft.is_po_email) {
        setError('This email does not appear to be a purchase order. No PO data was extracted.');
        setRunning(false);
        return;
      }

      setDraft(result.draft);
      setStep('review');
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }, [emailSubject, emailBody, emailSender]);

  // Edit draft field
  const handleFieldChange = useCallback((key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  // Edit line item
  const handleItemChange = useCallback((index, key, value) => {
    setDraft((d) => {
      const items = [...d.items];
      items[index] = { ...items[index], [key]: value };
      return { ...d, items };
    });
  }, []);

  // Remove line item
  const handleRemoveItem = useCallback((index) => {
    setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== index) }));
  }, []);

  // Add blank line item
  const handleAddItem = useCallback(() => {
    setDraft((d) => ({
      ...d,
      items: [...d.items, { description: '', sku: '', quantity: 0, unit_price: null, matched: true, confidence: 1 }],
    }));
  }, []);

  // Save draft to DB
  const handleSaveDraft = useCallback(async () => {
    try {
      const saved = await saveEmailPODraft({ ...draft, raw_email_text: emailBody });
      setSavedDraftId(saved.id);
      setSaved(true);
    } catch (e) {
      setError(`Save failed: ${e.message}`);
    }
  }, [draft, emailBody]);

  // Confirm → create PO
  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    setError(null);
    try {
      let draftId = savedDraftId;
      if (!draftId) {
        const s = await saveEmailPODraft({ ...draft, raw_email_text: emailBody });
        draftId = s.id;
        setSavedDraftId(draftId);
      }
      const po = await confirmEmailPODraft(draftId, draft);
      setCreatedPO(po);
      setConfirmed(true);
      setStep('done');
    } catch (e) {
      setError(`Confirm failed: ${e.message}`);
    } finally {
      setConfirming(false);
    }
  }, [draft, savedDraftId, emailBody]);

  // Reject
  const handleReject = useCallback(async () => {
    if (!savedDraftId) return;
    try {
      await rejectEmailPODraft(savedDraftId, 'Rejected by user');
      handleReset();
    } catch (e) {
      setError(`Reject failed: ${e.message}`);
    }
  }, [savedDraftId]);

  // Reset
  const handleReset = useCallback(() => {
    setDraft(null);
    setError(null);
    setSaved(false);
    setSavedDraftId(null);
    setConfirmed(false);
    setCreatedPO(null);
    setStep('input');
  }, []);

  // ---------------------------------------------------------------------------
  // Render: Done state
  // ---------------------------------------------------------------------------
  if (step === 'done') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <FileCheck className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">PO Draft Created</h2>
            <p className="text-sm text-gray-500 mt-1">
              Purchase order has been created and is pending submission for approval.
            </p>
          </div>
          {createdPO && (
            <div className="bg-gray-50 rounded-xl p-4 text-left space-y-1">
              <div className="text-xs text-gray-500">PO Number</div>
              <div className="font-mono font-bold text-gray-900">{createdPO.po_number ?? '—'}</div>
              <div className="text-xs text-gray-500 mt-2">Buyer</div>
              <div className="text-sm font-medium text-gray-800">{createdPO.buyer_name}</div>
            </div>
          )}
          <div className="flex gap-3">
            {createdPO && (
              <button
                onClick={() => navigate(`/purchase-orders/${createdPO.id}`)}
                className="flex-1 bg-gray-900 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
              >
                View PO <ArrowRight className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={handleReset}
              className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Process Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Input + Review (side-by-side when draft exists)
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">Email → PO Agent</h1>
              <p className="text-xs text-gray-500">AI extracts purchase orders from buyer emails</p>
            </div>
          </div>
          {step === 'review' && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Start over
            </button>
          )}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-6">
        <div className={`grid gap-6 ${step === 'review' ? 'grid-cols-2' : 'grid-cols-1 max-w-2xl mx-auto'}`}>

          {/* ----------------------------------------------------------------
              LEFT: Email input panel
          ---------------------------------------------------------------- */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
                <Mail className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-700">Paste Buyer Email</span>
              </div>

              <div className="p-5 space-y-3">
                {/* Sender */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">From</label>
                  <input
                    value={emailSender}
                    onChange={(e) => setEmailSender(e.target.value)}
                    placeholder="buyer@company.com"
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
                  />
                </div>

                {/* Subject */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Subject</label>
                  <input
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="PO #12345 — Spring 2026 Bedding Order"
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
                  />
                </div>

                {/* Body */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email Body</label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder={`Paste the full email text here...\n\nExample:\nDear Team,\nPlease find our PO #SS26-001 for the following items:\n- Style BED-001 / Queen Fitted Sheet / White / 500 pcs @ $4.50\n- Style BED-002 / King Pillow Case / Blue / 200 pcs @ $2.80\n\nDelivery required by: 15 Aug 2026\nShip to: Los Angeles, USA\nTerms: FOB Karachi, TT 30 days`}
                    rows={14}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white resize-none font-mono leading-relaxed"
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}

                {/* Run button */}
                <button
                  onClick={handleRun}
                  disabled={running || !emailBody.trim()}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400 text-white py-3 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  {running ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Agent running…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Extract PO with AI
                    </>
                  )}
                </button>

                {running && (
                  <div className="text-center text-xs text-gray-400 space-y-1">
                    <p>Running agentic extraction loop…</p>
                    <p className="text-gray-300">extract_po_data → assess_confidence → flag_unmatched_items</p>
                  </div>
                )}
              </div>
            </div>

            {/* Info box when no draft yet */}
            {step === 'input' && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-xs">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">How this works</p>
                  <p>The AI agent reads the email and calls three tools in sequence: extract PO fields, score confidence, and flag unmatched SKUs. You review the extracted draft, edit any fields, then confirm to create the PO.</p>
                </div>
              </div>
            )}
          </div>

          {/* ----------------------------------------------------------------
              RIGHT: Extracted draft review panel (only when draft exists)
          ---------------------------------------------------------------- */}
          {step === 'review' && draft && (
            <div className="space-y-4">
              {/* Confidence + warnings */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                <ConfidenceMeter score={draft.overall_confidence} />
                <AmbiguityBanner
                  ambiguities={draft.ambiguities}
                  missingFields={draft.missing_critical_fields}
                />
              </div>

              {/* PO Header fields */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
                  <Package className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-semibold text-gray-700">PO Header</span>
                  <span className="ml-auto text-xs text-gray-400">Edit any field before confirming</span>
                </div>
                <div className="p-5 grid grid-cols-2 gap-4">
                  <DraftField
                    label="Buyer Name"
                    fieldKey="buyer_name"
                    value={draft.buyer_name}
                    onChange={handleFieldChange}
                    score={draft.field_scores?.buyer_name}
                  />
                  <DraftField
                    label="PO Number"
                    fieldKey="po_number"
                    value={draft.po_number}
                    onChange={handleFieldChange}
                    score={draft.field_scores?.po_number}
                  />
                  <DraftField
                    label="Order Date"
                    fieldKey="order_date"
                    value={draft.order_date}
                    onChange={handleFieldChange}
                    score={draft.field_scores?.order_date}
                    type="date"
                  />
                  <DraftField
                    label="Delivery Date"
                    fieldKey="delivery_date"
                    value={draft.delivery_date}
                    onChange={handleFieldChange}
                    score={draft.field_scores?.delivery_date}
                    type="date"
                  />
                  <DraftField
                    label="Currency"
                    fieldKey="currency"
                    value={draft.currency}
                    onChange={handleFieldChange}
                    score={draft.field_scores?.currency}
                    placeholder="USD"
                  />
                  <DraftField
                    label="Destination"
                    fieldKey="destination_country"
                    value={draft.destination_country}
                    onChange={handleFieldChange}
                    score={draft.field_scores?.destination_country}
                  />
                  <DraftField
                    label="Payment Terms"
                    fieldKey="payment_terms"
                    value={draft.payment_terms}
                    onChange={handleFieldChange}
                    score={draft.field_scores?.payment_terms}
                    placeholder="e.g. TT 30 days"
                  />
                  <DraftField
                    label="Incoterms"
                    fieldKey="incoterms"
                    value={draft.incoterms}
                    onChange={handleFieldChange}
                    score={draft.field_scores?.incoterms}
                    placeholder="e.g. FOB"
                  />
                  <div className="col-span-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Special Instructions</label>
                      {draft.field_scores?.special_instructions != null && (
                        <ConfidenceBadge score={draft.field_scores.special_instructions} />
                      )}
                    </div>
                    <textarea
                      value={draft.special_instructions ?? ''}
                      onChange={(e) => handleFieldChange('special_instructions', e.target.value)}
                      placeholder="Packing, labelling, compliance notes"
                      rows={2}
                      className="px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Line items */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-700">Line Items</span>
                  <span className="ml-1 text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {draft.items?.length ?? 0}
                  </span>
                  {draft.unmatched_items?.length > 0 && (
                    <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      {draft.unmatched_items.length} unmatched
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
                    <span>SKU</span>
                    <span className="w-32">Description</span>
                    <span className="w-20 text-right">Qty</span>
                    <span className="w-20 text-right">Price</span>
                  </div>
                </div>

                <div className="p-4 space-y-2">
                  {draft.items?.map((item, i) => (
                    <LineItemRow
                      key={i}
                      item={item}
                      index={i}
                      fieldScores={draft.field_scores}
                      onChange={handleItemChange}
                      onRemove={handleRemoveItem}
                    />
                  ))}

                  <button
                    onClick={handleAddItem}
                    className="w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-sm text-gray-400 hover:border-violet-400 hover:text-violet-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add line item
                  </button>
                </div>
              </div>

              {/* Match suggestions */}
              {draft.match_suggestions?.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-blue-700 text-sm font-semibold">
                    <Info className="w-4 h-4" /> SKU Suggestions
                  </div>
                  {draft.match_suggestions.map((s, i) => (
                    <div key={i} className="text-xs text-blue-700">
                      <span className="font-medium">Item {s.item_index + 1}:</span>{' '}
                      Try <span className="font-mono font-bold">{s.suggested_sku}</span> — {s.suggestion_basis}
                    </div>
                  ))}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleConfirm}
                  disabled={confirming || !draft.buyer_name}
                  className="flex-1 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white py-3 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  {confirming ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Creating PO…</>
                  ) : (
                    <><CheckCircle2 className="w-4 h-4" /> Confirm & Create PO</>
                  )}
                </button>

                {!saved && (
                  <button
                    onClick={handleSaveDraft}
                    className="px-5 border border-gray-200 text-gray-700 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors"
                  >
                    Save Draft
                  </button>
                )}
                {saved && (
                  <div className="px-4 flex items-center gap-1.5 text-green-600 text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4" /> Saved
                  </div>
                )}

                <button
                  onClick={handleReject}
                  className="px-4 border border-red-200 text-red-500 py-3 rounded-xl text-sm font-semibold hover:bg-red-50 transition-colors flex items-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" /> Reject
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
