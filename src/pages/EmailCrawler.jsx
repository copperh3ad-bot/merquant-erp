import React, { useState, useRef, useCallback, useEffect } from "react";
import { normalizeItemCode } from '@/lib/codes';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { db, emailCrawl, supabase } from "@/api/supabaseClient";
import { callClaude } from "@/lib/aiProxy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail, Sparkles, Loader2, CheckCircle2, AlertCircle, RefreshCw,
  FileText, X, ChevronRight, Inbox, Filter, Search,
  Package, Trash2, ExternalLink, Play, StopCircle, Info, Plus, GitBranch, Paperclip
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ─── Constants ───────────────────────────────────────────────────────────────
const REVISION_KEYWORDS = [
  "revised", "revision", "amended", "amendment", "updated",
  "supersedes", "superseded", "replaces", "replacement",
  "corrected", "correction", "modified", "changed", "new version",
  "rev.", "rev ", "v2", "v3",
];

const EXTRACT_ALL_POS_SYSTEM = `You are a textile merchandising assistant. Read the email body + any attachments and extract:
1. Every purchase order found (plus revision detection)
2. Any updates to existing orders: sample approvals, trim/accessory/print-layout approvals, QC inspection bookings/bookings-confirmed, TNA milestone status updates
3. Classify the email into ONE primary purpose, but also list ALL updates found.

A single email may contain multiple POs or multiple updates.
A PO is a revision if the email references a previous PO number AND uses words like "revised", "amended", "updated", "supersedes", "replaces", "v2", "rev".

CRITICAL — IDENTIFYING PARTIES (do NOT confuse these):
Every PO has THREE distinct parties:
1. BUYER / CUSTOMER: the party ISSUING the PO (the brand placing the order). Usually in the letterhead at the top of the page or above "PURCHASE ORDER". Goes in "customer_name". Examples: Purecare, H&M, Walmart.
2. VENDOR / SUPPLIER: the party RECEIVING the PO (the factory/supplier fulfilling the order). Labeled "VENDOR", "SUPPLIER", "SELLER", "SOLD TO" on the PO. Goes in "vendor_name". DO NOT put the vendor in customer_name.
3. SHIP-TO / CONSIGNEE: where goods are delivered. Labeled "SHIP TO", "DELIVER TO", "CONSIGNEE", "DC", "WAREHOUSE". Goes in "ship_to_name". Often different from the buyer (e.g., buyer = Purecare, ship-to = Bob's Discount Furniture DC).

RULES:
- customer_name MUST be the buyer/issuer of the PO (from letterhead/top of page), NEVER the vendor/supplier block.
- If letterhead shows "Purecare" and VENDOR block shows "Union Fabrics Ltd.", then customer_name = "Purecare" and vendor_name = "Union Fabrics Ltd.".
- Normalize customer_name to a clean brand name — strip "Direct to consumer warehouse", "DC", addresses, etc. (e.g., "Purecare Direct to consumer warehouse" → "Purecare").

Respond ONLY with valid JSON, no markdown:
{
  "is_purchase_order": true | false,
  "classification": "purchase_order" | "invoice" | "shipping" | "general" | "spam",
  "confidence": 0.0-1.0,
  "has_revision_keywords": true | false,
  "revision_keywords_found": [string],
  "referenced_po_numbers": [string],
  "pos": [
    {
      "po_number": string,
      "customer_name": string,
      "vendor_name": string,
      "ship_to_name": string,
      "order_date": "YYYY-MM-DD" | null,
      "delivery_date": "YYYY-MM-DD" | null,
      "ex_factory_date": "YYYY-MM-DD" | null,
      "etd": "YYYY-MM-DD" | null,
      "eta": "YYYY-MM-DD" | null,
      "currency": "USD" | "EUR" | "GBP" | "INR" | "CNY" | "PKR" | "BDT" | null,
      "total_po_value": number | null,
      "total_quantity": number | null,
      "season": string | null,
      "payment_terms": string | null,
      "port_of_loading": string | null,
      "port_of_destination": string | null,
      "source_attachment": string | null,       // filename this PO was extracted from, or null if from body
      "is_revision_of": string | null,          // prior PO# this one revises, or null
      "revision_reason": string | null          // one sentence explaining why this is flagged as a revision
    }
  ],
  "updates": [
    {
      "type": "sample_approval" | "trim_approval" | "layout_approval" | "inspection_booking" | "tna_milestone",
      "po_number": string | null,
      "article_code": string | null,
      "identifier": string | null,
      "action": "approve" | "reject" | "amend" | "book" | "confirm" | "complete" | "delay",
      "new_status": string | null,
      "target_date": "YYYY-MM-DD" | null,
      "actual_date": "YYYY-MM-DD" | null,
      "party": "Internal QA" | "3rd Party" | null,
      "comments": string | null,
      "evidence_quote": string
    }
  ],
  "reason": "one sentence explaining classification"
}

UPDATE EXTRACTION RULES:
- sample_approval: buyer approves/rejects/requests amendment on a sample. identifier = sample_type or style.
- trim_approval: buyer approves/rejects a trim, label or accessory. identifier = trim_category or description.
- layout_approval: buyer approves/rejects a print layout. identifier = layout_type.
- inspection_booking: 3rd party (SGS/Intertek/BV) or internal QA scheduling/confirming an inspection. party field required.
- tna_milestone: generic milestone update (fabric received, cutting started, shipped, etc). identifier = milestone name.
- evidence_quote: EXACT sentence from email (max 200 chars) that supports this update — shown to the user for review.
- Only emit updates where confidence is HIGH. If ambiguous, skip.`;

const BATCH_SIZE = 1;
const CLASS_COLORS = {
  purchase_order:     "bg-blue-50 text-blue-700 border-blue-200",
  sample_approval:    "bg-pink-50 text-pink-700 border-pink-200",
  trim_approval:      "bg-orange-50 text-orange-700 border-orange-200",
  layout_approval:    "bg-violet-50 text-violet-700 border-violet-200",
  inspection_booking: "bg-lime-50 text-lime-700 border-lime-200",
  tna_update:         "bg-cyan-50 text-cyan-700 border-cyan-200",
  invoice:            "bg-amber-50 text-amber-700 border-amber-200",
  shipping:           "bg-teal-50 text-teal-700 border-teal-200",
  general:            "bg-gray-50 text-gray-600 border-gray-200",
  spam:               "bg-red-50 text-red-500 border-red-200",
  unknown:            "bg-gray-50 text-gray-500 border-gray-200",
};
const CLASS_LABELS = {
  purchase_order:     "Purchase Order",
  sample_approval:    "Sample Approval",
  trim_approval:      "Trim Approval",
  layout_approval:    "Layout Approval",
  inspection_booking: "Inspection Booking",
  tna_update:         "TNA Update",
  invoice:            "Invoice",
  shipping:           "Shipping",
  general:            "General",
  spam:               "Spam",
  unknown:            "Unknown",
};
const UPDATE_TYPE_ICON = {
  sample_approval:    "🧵",
  trim_approval:      "🏷",
  layout_approval:    "🎨",
  inspection_booking: "🔍",
  tna_milestone:      "📅",
};
const UPDATE_TYPE_LABEL = {
  sample_approval:    "Sample",
  trim_approval:      "Trim/Accessory",
  layout_approval:    "Print Layout",
  inspection_booking: "Inspection",
  tna_milestone:      "TNA Milestone",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function scanForRevisionKeywords(text) {
  const found = [];
  if (!text) return found;
  const lower = text.toLowerCase();
  for (const kw of REVISION_KEYWORDS) {
    if (lower.includes(kw)) found.push(kw);
  }
  return [...new Set(found)];
}

// Extract PO-like tokens (letters+digits+separators, 4-30 chars) for candidate matching
function extractPoNumbers(text) {
  if (!text) return [];
  const matches = text.match(/\b(?:PO|P\.O\.?|Order|SO|MTA)[\s#:-]*([A-Z0-9][A-Z0-9\-\/_]{3,25})\b/gi) || [];
  const direct  = text.match(/\b[A-Z]{1,4}-?\d{4,10}(?:-\d{1,5})?\b/g) || [];
  const all = [...matches.map(m => m.replace(/^(?:PO|P\.O\.?|Order|SO|MTA)[\s#:-]*/i, "").trim()), ...direct];
  return [...new Set(all.filter(Boolean))];
}

async function extractFromEmail({ subject, body, attachments }) {
  // attachments = [{ filename, mime_type, content_base64 }]
  const contentBlocks = [];

  if (attachments?.length) {
    for (const att of attachments) {
      if (!att.content_base64) continue;
      if (att.mime_type === "application/pdf") {
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: att.content_base64 },
        });
        contentBlocks.push({ type: "text", text: `(Above is attachment: ${att.filename})` });
      } else if (att.mime_type?.startsWith("image/")) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: att.mime_type, data: att.content_base64 },
        });
        contentBlocks.push({ type: "text", text: `(Above is attachment: ${att.filename})` });
      }
    }
  }

  contentBlocks.push({
    type: "text",
    text: `Subject: ${subject || ""}\n\nEmail body:\n${(body || "").slice(0, 15000)}`,
  });

  try {
    const d = await callClaude({
      system: EXTRACT_ALL_POS_SYSTEM,
      max_tokens: 6000,
      messages: [{ role: "user", content: contentBlocks }],
    });
    const raw = d.content?.filter(b => b.type === "text").map(b => b.text).join("") || "{}";
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (err) {
    console.error("extractFromEmail failed:", err);
    return null;
  }
}

const fmtDate = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : null; } catch { return null; } };
const fmtTs = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy, HH:mm") : "—"; } catch { return "—"; } };

// ─── Sub-components ───────────────────────────────────────────────────────────
function ClassBadge({ cls }) {
  return (
    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap", CLASS_COLORS[cls] || CLASS_COLORS.unknown)}>
      {CLASS_LABELS[cls] || cls}
    </span>
  );
}

function StatPill({ label, value, color }) {
  return (
    <div className={cn("rounded-xl px-4 py-3 text-center", color)}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-0.5 opacity-80">{label}</p>
    </div>
  );
}

function EmailRow({ row, onCreatePO, onDelete, creatingKey, onApplyUpdate, onRejectUpdate, applyingUpdateKey, appliedUpdateKeys, rejectedUpdateKeys }) {
  const [expanded, setExpanded] = useState(false);
  const isPO = row.classification === "purchase_order";
  const pos = row.extracted_pos || [];
  const updates = row.updates || [];
  const multiPo = pos.length > 1;
  const pendingUpdates = updates.filter((_, i) => {
    const key = `${row.id}-upd-${i}`;
    return !appliedUpdateKeys.has(key) && !rejectedUpdateKeys.has(key);
  }).length;

  return (
    <div className={cn(
      "border border-border rounded-xl overflow-hidden transition-all",
      isPO && !row.po_created && "border-blue-200 bg-blue-50/30"
    )}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setExpanded(v => !v)} className="flex-1 flex items-center gap-3 text-left min-w-0">
          <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
            isPO ? "bg-blue-100" : "bg-muted"
          )}>
            {isPO ? <Package className="h-4 w-4 text-blue-600" /> : <Mail className="h-4 w-4 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground truncate max-w-[280px]">
                {row.subject || "(no subject)"}
              </span>
              <ClassBadge cls={row.classification} />
              {multiPo && (
                <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full font-medium">
                  {pos.length} POs
                </span>
              )}
              {row.has_revision_keywords && (
                <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <GitBranch className="h-3 w-3" /> Revision
                </span>
              )}
              {row.attachment_count > 0 && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Paperclip className="h-3 w-3" /> {row.attachment_count}
                </span>
              )}
              {row.po_created && (
                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                  PO Created
                </span>
              )}
              {pendingUpdates > 0 && (
                <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full font-medium">
                  {pendingUpdates} update{pendingUpdates > 1 ? "s" : ""} pending
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {row.sender} · {fmtTs(row.received_at)}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(row.id)}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-90")} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-background/80 space-y-3">
          {row.revision_keywords_found?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
              <p className="font-semibold text-amber-900 flex items-center gap-1">
                <GitBranch className="h-3.5 w-3.5" /> Revision keywords detected
              </p>
              <p className="text-amber-800 mt-0.5">
                Found: {row.revision_keywords_found.join(", ")}
                {row.referenced_po_numbers?.length > 0 && (
                  <span> · References: {row.referenced_po_numbers.join(", ")}</span>
                )}
              </p>
            </div>
          )}

          {pos.length === 0 && isPO && (
            <p className="text-xs text-muted-foreground italic">No PO details extracted.</p>
          )}

          {pos.map((po, i) => (
            <PoCard
              key={`${row.id}-${i}`}
              row={row}
              po={po}
              index={i}
              onCreatePO={onCreatePO}
              creating={creatingKey === `${row.id}-${i}`}
            />
          ))}

          {updates.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Proposed Updates ({updates.length})</p>
              {updates.map((upd, i) => {
                const key = `${row.id}-upd-${i}`;
                const isApplied = appliedUpdateKeys.has(key);
                const isRejected = rejectedUpdateKeys.has(key);
                const isApplying = applyingUpdateKey === key;
                return (
                  <div key={key} className={cn(
                    "border rounded-lg p-3 text-xs",
                    isApplied && "border-emerald-200 bg-emerald-50/40",
                    isRejected && "border-gray-200 bg-gray-50 opacity-60",
                    !isApplied && !isRejected && "border-purple-200 bg-purple-50/30"
                  )}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base">{UPDATE_TYPE_ICON[upd.type] || "•"}</span>
                          <span className="font-semibold text-foreground">{UPDATE_TYPE_LABEL[upd.type] || upd.type}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-border text-muted-foreground uppercase">{upd.action}</span>
                          {upd.po_number && <span className="text-[11px] text-muted-foreground">PO: <span className="font-mono">{upd.po_number}</span></span>}
                          {upd.party && <span className="text-[11px] text-muted-foreground">· {upd.party}</span>}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {upd.identifier && <span className="font-medium text-foreground">{upd.identifier}</span>}
                          {upd.new_status && <span> → <span className="font-medium text-foreground">{upd.new_status}</span></span>}
                          {upd.target_date && <span> · target {fmtDate(upd.target_date)}</span>}
                          {upd.actual_date && <span> · actual {fmtDate(upd.actual_date)}</span>}
                        </div>
                        {upd.comments && <p className="mt-1 italic text-muted-foreground">"{upd.comments}"</p>}
                        {upd.evidence_quote && (
                          <p className="mt-1 pl-2 border-l-2 border-purple-300 text-[11px] text-purple-900 bg-purple-50 rounded-sm py-1 pr-2">
                            <span className="font-medium">Evidence:</span> {upd.evidence_quote}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {isApplied ? (
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Applied
                          </span>
                        ) : isRejected ? (
                          <span className="text-[10px] bg-gray-200 text-gray-600 px-2 py-1 rounded-full font-medium">Rejected</span>
                        ) : (
                          <>
                            <Button size="sm" className="h-7 px-2 text-[11px] gap-1"
                              onClick={() => onApplyUpdate(row, upd, i)} disabled={isApplying}>
                              {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                              Confirm
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                              onClick={() => onRejectUpdate(row, i)} disabled={isApplying}>
                              <X className="h-3 w-3" /> Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {row.raw_snippet && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Snippet</p>
              <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2">{row.raw_snippet}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PoCard({ row, po, index, onCreatePO, creating }) {
  const isRevision = !!po.is_revision_of;
  return (
    <div className={cn(
      "border rounded-lg p-3 space-y-2",
      isRevision ? "border-amber-300 bg-amber-50/40" : "border-border bg-card"
    )}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Package className="h-4 w-4 text-blue-600" />
          <span className="font-semibold text-sm">{po.po_number || "(no PO #)"}</span>
          {isRevision && (
            <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1">
              <GitBranch className="h-3 w-3" /> Revises {po.is_revision_of}
            </span>
          )}
          {po.source_attachment && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Paperclip className="h-3 w-3" /> {po.source_attachment}
            </span>
          )}
        </div>
        <Button
          size="sm"
          className="text-xs h-7 gap-1"
          onClick={() => onCreatePO(row, po, index)}
          disabled={creating || row.po_created_keys?.includes(`${row.id}-${index}`)}
        >
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {row.po_created_keys?.includes(`${row.id}-${index}`) ? "Created" : (isRevision ? "Import as Revision" : "Create PO")}
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
        {[
          ["Customer", po.customer_name],
          ["Ship To", po.ship_to_name],
          ["Value", po.total_po_value ? `${po.currency || "USD"} ${Number(po.total_po_value).toLocaleString()}` : null],
          ["Qty", po.total_quantity ? `${Number(po.total_quantity).toLocaleString()} pcs` : null],
          ["Order Date", fmtDate(po.order_date)],
          ["Delivery", fmtDate(po.delivery_date)],
          ["ETD", fmtDate(po.etd)],
          ["ETA", fmtDate(po.eta)],
        ].filter(([,v]) => v).map(([label, val]) => (
          <div key={label}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-sm font-medium text-foreground">{val}</p>
          </div>
        ))}
      </div>

      {po.revision_reason && (
        <p className="text-[11px] text-amber-800 italic">Revision reason: {po.revision_reason}</p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function EmailCrawler() {
  const [crawling, setCrawling] = useState(false);
  const [crawlLog, setCrawlLog] = useState([]);
  const [crawlStats, setCrawlStats] = useState(null);
  const [filterCls, setFilterCls] = useState("all");
  const [search, setSearch] = useState("");
  const [creatingKey, setCreatingKey] = useState(null);
  const [applyingUpdateKey, setApplyingUpdateKey] = useState(null);
  const [rejectedUpdateKeys, setRejectedUpdateKeys] = useState(new Set());
  const [appliedUpdateKeys, setAppliedUpdateKeys] = useState(new Set());
  const [maxEmails, setMaxEmails] = useState("50");
  const [queryStr, setQueryStr] = useState("subject:order OR subject:PO OR subject:purchase");
  const [crawlerEmail, setCrawlerEmail] = useState("");
  const [userEmail, setUserEmail] = useState("");

  // Auto-crawl every 3 hours while tab is open
  useEffect(() => {
    const ONE_HOUR = 1 * 60 * 60 * 1000;
    const interval = setInterval(() => {
      if (!crawling && crawlerEmail) {
        console.log("[Auto-crawl] 3h timer fired, starting crawl...");
        handleCrawl();
      }
    }, ONE_HOUR);
    return () => clearInterval(interval);
  }, [crawling, crawlerEmail]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserEmail(user.email || "");
      const { data: s } = await supabase.from("user_settings").select("crawler_email,crawler_query_default,crawler_max_emails").eq("user_id", user.id).maybeSingle();
      if (s?.crawler_email) setCrawlerEmail(s.crawler_email);
      else setCrawlerEmail(user.email || "");
      if (s?.crawler_query_default) setQueryStr(s.crawler_query_default);
      if (s?.crawler_max_emails) setMaxEmails(String(s.crawler_max_emails));
    })();
  }, []);
  const stopRef = useRef(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: crawledEmails = [], isLoading, refetch } = useQuery({
    queryKey: ["emailCrawl"],
    queryFn: () => emailCrawl.list({ limit: 200 }),
  });

  const log = useCallback((msg, type = "info") => {
    setCrawlLog(prev => [...prev.slice(-200), { msg, type, ts: Date.now() }]);
  }, []);

  // Fetch messages with full body + attachments via Gmail MCP
  const fetchAttachmentBase64 = async (message_id, attachment_id) => {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: "get_attachment", message_id, attachment_id }),
    });
    if (!resp.ok) return null;
    const d = await resp.json();
    return d.content_base64 || null;
  };

  const fetchGmailMessagesFull = async (maxResults, query) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated.");
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "search", query, max_results: maxResults, include_attachments: false }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gmail fetch failed (${response.status}): ${errText}`);
    }
    const data = await response.json();
    if (data.error === "not_connected") throw new Error("Gmail not connected. Go to Settings and click Connect Gmail.");
    if (data.error) throw new Error(data.error);
    return data.emails || [];
  };

  const handleCrawl = async () => {
    setCrawling(true);
    stopRef.current = false;
    setCrawlLog([]);
    setCrawlStats(null);

    const stats = {
      total: 0, pos_emails: 0, pos_extracted: 0, revisions: 0,
      invoices: 0, shipping: 0, general: 0, skipped: 0, errors: 0,
    };

    try {
      log(`Starting Gmail crawl — query: "${queryStr}", max: ${maxEmails}`, "info");
      log("Fetching emails with bodies + attachments...", "info");
      const messages = await fetchGmailMessagesFull(parseInt(maxEmails) || 50, queryStr);

      if (!messages.length) {
        log("No emails found matching the query.", "warn");
        setCrawling(false);
        return;
      }

      log(`Found ${messages.length} emails — extracting POs and detecting revisions...`, "success");
      stats.total = messages.length;

      const existing = await emailCrawl.list({ limit: 500 });
      const existingIds = new Set(existing.map(e => e.gmail_message_id));

      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        if (stopRef.current) { log("Crawl stopped by user.", "warn"); break; }

        const batch = messages.slice(i, i + BATCH_SIZE);
        log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(messages.length / BATCH_SIZE)} — ${batch.length} emails`, "info");

        const batchResults = await Promise.allSettled(
          batch.map(async (msg) => {
            if (existingIds.has(msg.id)) { stats.skipped++; return null; }
            try {
              const extracted = await extractFromEmail({
                subject: msg.subject,
                body: msg.body || msg.snippet,
                attachments: msg.attachments,
              });
              return { msg, extracted };
            } catch {
              stats.errors++;
              return null;
            }
          })
        );

        const toUpsert = batchResults
          .filter(r => r.status === "fulfilled" && r.value)
          .map(({ value: { msg, extracted } }) => {
            if (!extracted) { stats.errors++; return null; }

            const cls = extracted.classification || "unknown";
            if (cls === "purchase_order") stats.pos_emails++;
            else if (cls === "invoice") stats.invoices++;
            else if (cls === "shipping") stats.shipping++;
            else stats.general++;

            const pos = Array.isArray(extracted.pos) ? extracted.pos : [];
            stats.pos_extracted += pos.length;
            stats.revisions += pos.filter(p => p.is_revision_of).length;

            // Augment revision detection with local keyword scan as fallback
            const localKeywords = scanForRevisionKeywords(
              [msg.subject, msg.body].filter(Boolean).join("\n")
            );
            const localPoNums = extractPoNumbers(
              [msg.subject, msg.body].filter(Boolean).join("\n")
            );
            const revisionKeywords = [...new Set([
              ...(extracted.revision_keywords_found || []),
              ...localKeywords,
            ])];
            const referencedPoNums = [...new Set([
              ...(extracted.referenced_po_numbers || []),
              ...localPoNums,
            ])];

            // Primary row (one per email)
            return {
              gmail_message_id: msg.id,
              gmail_thread_id: msg.threadId,
              subject: msg.subject,
              sender: msg.sender,
              received_at: msg.date ? new Date(msg.date).toISOString() : null,
              classification: cls,
              confidence: extracted.confidence || 0,
              // Summary fields (first PO, for backwards compat display)
              extracted_po_number: pos[0]?.po_number || null,
              extracted_customer: pos[0]?.customer_name || null,
              extracted_value: pos[0]?.total_po_value || null,
              extracted_currency: pos[0]?.currency || null,
              extracted_delivery_date: pos[0]?.delivery_date || null,
              extracted_quantity: pos[0]?.total_quantity ? Math.round(Number(pos[0].total_quantity)) : null,
              // New fields
              extracted_pos: pos,
              updates: Array.isArray(extracted.updates) ? extracted.updates : [],
              attachment_count: (msg.attachments || []).length,
              has_revision_keywords: revisionKeywords.length > 0 || pos.some(p => p.is_revision_of),
              revision_keywords_found: revisionKeywords,
              referenced_po_numbers: referencedPoNums,
              raw_snippet: msg.snippet || null,
              po_created: false,
            };
          })
          .filter(Boolean);

        if (toUpsert.length) await emailCrawl.upsert(toUpsert);
        log(`Batch done. POs extracted so far: ${stats.pos_extracted} (${stats.revisions} flagged as revisions)`, "success");
      }

      log(`Crawl complete. ${stats.pos_emails} PO emails · ${stats.pos_extracted} POs extracted · ${stats.revisions} revisions`, "success");

      // AUTO-IMPORT: after crawl, loop through PO emails that haven't been imported yet
      window.__autoImportRunning = true;
      log("Auto-importing POs to Purchase Orders...", "info");
      const { data: pendingEmails } = await supabase
        .from("email_crawl_log")
        .select("*")
        .eq("classification", "purchase_order")
        .eq("po_created", false)
        .order("received_at", { ascending: false })
        .limit(100);
      let autoCreated = 0, autoSkipped = 0, autoErrors = 0;
      for (const emailRow of (pendingEmails || [])) {
        const pos = emailRow.extracted_pos || [];
        for (let i = 0; i < pos.length; i++) {
          const key = `${emailRow.id}-${i}`;
          if ((emailRow.po_created_keys || []).includes(key)) { autoSkipped++; continue; }
          try {
            await handleCreatePO(emailRow, pos[i], i);
            autoCreated++;
          } catch (e) {
            console.error("auto-import error:", e);
            autoErrors++;
          }
        }
      }
      log(`Auto-import done. Created/linked: ${autoCreated} · Already imported: ${autoSkipped} · Errors: ${autoErrors}`, autoErrors ? "warning" : "success");
      window.__autoImportRunning = false;
      setCrawlStats(stats);
      qc.invalidateQueries({ queryKey: ["emailCrawl"] });

    } catch (err) {
      log(`Crawl error: ${err.message}`, "error");
    } finally {
      setCrawling(false);
    }
  };

  // Create a PO from a specific extracted entry in an email
  const handleCreatePO = async (row, po, index) => {
    const key = `${row.id}-${index}`;
    setCreatingKey(key);
    try {
      // Revision detection: look up predecessor in DB
      let supersedesPoId = null;
      let revisionNumber = 0;
      let isRevision = false;
      let detectedFrom = null;

      const candidate = po.is_revision_of || (row.has_revision_keywords && row.referenced_po_numbers?.[0]);
      if (candidate) {
        const { data: prior } = await supabase
          .from("purchase_orders")
          .select("id, revision_number")
          .eq("po_number", candidate)
          .order("revision_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (prior) {
          supersedesPoId = prior.id;
          revisionNumber = (prior.revision_number || 0) + 1;
          isRevision = true;
          detectedFrom = "email_body_keywords";
        }
      }

      const poData = {
        po_number: po.po_number || `PO-EMAIL-${Date.now()}-${index}`,
        customer_name: po.customer_name || "Unknown",
        ship_to_name: po.ship_to_name || null,
        order_date: po.order_date || null,
        delivery_date: po.delivery_date || null,
        ex_factory_date: po.ex_factory_date || null,
        etd: po.etd || null,
        eta: po.eta || null,
        currency: po.currency || "USD",
        total_po_value: po.total_po_value != null ? Number(po.total_po_value) : null,
        total_quantity: po.total_quantity != null ? Math.round(Number(po.total_quantity)) : null,
        season: po.season || null,
        payment_terms: po.payment_terms || null,
        port_of_loading: po.port_of_loading || null,
        port_of_destination: po.port_of_destination || null,
        status: isRevision ? "Revised" : "PO Received",
        source: "Email",
        notes: [
          `Imported from email: "${row.subject}" from ${row.sender}`,
          po.source_attachment ? `Source attachment: ${po.source_attachment}` : null,
          po.revision_reason ? `Revision reason: ${po.revision_reason}` : null,
        ].filter(Boolean).join(" · "),
        supersedes_po_id: supersedesPoId,
        is_revision: isRevision,
        revision_number: revisionNumber,
        revision_notes: isRevision ? (po.revision_reason || `Revision detected from email "${row.subject}"`) : null,
        revision_detected_from: detectedFrom,
      };

      let newPo;
      try {
        newPo = await db.purchaseOrders.create(poData);
      } catch (dupErr) {
        if (String(dupErr?.message || "").includes("duplicate key") || dupErr?.code === "23505") {
          // PO already exists - look it up and mark email as imported
          const { data: existing } = await supabase
            .from("purchase_orders")
            .select("id, po_number")
            .eq("po_number", poData.po_number)
            .maybeSingle();
          if (existing) {
            newPo = existing;
            console.log(`[auto-import] PO ${existing.po_number} already exists - linking email`);
          } else { throw dupErr; }
        } else { throw dupErr; }
      }

      // If we superseded something, mark it in the older PO's notes
      if (supersedesPoId) {
        await supabase.from("purchase_orders").update({
          notes: `⚠ Superseded by PO ${newPo.po_number} (revision #${revisionNumber})`,
        }).eq("id", supersedesPoId);
      }

      // Track which entries of this email have been created
      const createdKeys = [...(row.po_created_keys || []), key];
      const allDone = createdKeys.length >= (row.extracted_pos?.length || 1);
      await emailCrawl.update(row.id, {
        po_created: allDone,
        po_created_keys: createdKeys,
      });

      qc.invalidateQueries({ queryKey: ["emailCrawl"] });
      qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      // navigate only if single manual create (skip during auto-import loop)
      if (!window.__autoImportRunning) navigate(`/PODetail?id=${newPo.id}`);
    } catch (e) {
      alert("Failed to create PO: " + e.message);
    } finally {
      setCreatingKey(null);
    }
  };

  // Apply a single update (sample/trim/layout/inspection/tna) after user confirms
  const handleApplyUpdate = async (row, update, idx) => {
    const key = `${row.id}-upd-${idx}`;
    setApplyingUpdateKey(key);
    try {
      // Resolve po_id if po_number is provided
      let poId = null;
      if (update.po_number) {
        const { data: poRow } = await supabase
          .from("purchase_orders")
          .select("id")
          .eq("po_number", update.po_number)
          .maybeSingle();
        poId = poRow?.id || null;
      }

      const now = new Date().toISOString();
      const auditNote = `Auto-updated from email "${row.subject}" [${fmtTs(row.received_at)}]. Evidence: "${update.evidence_quote || ""}". Sender: ${row.sender}`;

      if (update.type === "sample_approval") {
        if (!poId) throw new Error(`PO ${update.po_number || "(missing)"} not found in DB`);
        let q = supabase.from("samples").update({
          status: update.action === "approve" ? "Approved" :
                  update.action === "reject" ? "Rejected" :
                  update.action === "amend"  ? "Amendment Required" :
                  "Delivered",
          buyer_comments: update.comments || null,
          actual_feedback_date: update.actual_date || now.slice(0, 10),
          internal_notes: auditNote,
        }).eq("po_id", poId);
        if (update.identifier) {
          q = q.or(`sample_type.ilike.%${update.identifier}%,style_number.eq.${update.identifier}`);
        }
        const { error, count } = await q.select("id");
        if (error) throw error;
        if (!count) throw new Error("No matching sample found");

      } else if (update.type === "trim_approval") {
        if (!poId) throw new Error(`PO ${update.po_number || "(missing)"} not found`);
        const newStatus = update.action === "approve" ? "Received" :
                          update.action === "reject" ? "Rejected" : "Planned";
        let q = supabase.from("trim_items").update({
          status: newStatus,
          notes: auditNote,
        }).eq("po_id", poId);
        if (update.identifier) {
          q = q.or(`trim_category.ilike.%${update.identifier}%,item_description.ilike.%${update.identifier}%`);
        }
        const { error } = await q.select("id");
        if (error) throw error;
        // Also try accessory_items
        await supabase.from("accessory_items").update({
          status: newStatus,
          notes: auditNote,
        }).eq("po_id", poId).or(`category.ilike.%${update.identifier}%,item_description.ilike.%${update.identifier}%`);

      } else if (update.type === "layout_approval") {
        if (!poId) throw new Error(`PO ${update.po_number || "(missing)"} not found`);
        const newStatus = update.action === "approve" ? "Approved" :
                          update.action === "reject" ? "Rejected" :
                          update.action === "amend"  ? "Revision Required" : "Sent for Approval";
        let q = supabase.from("print_layouts").update({
          approval_status: newStatus,
          approval_source: "email",
          email_subject: row.subject,
          email_sender: row.sender,
          email_message_id: row.gmail_message_id,
          email_approval_text: update.evidence_quote || null,
          approved_by: row.sender,
          approved_date: update.actual_date || now.slice(0, 10),
          notes: auditNote,
        }).eq("po_id", poId);
        if (update.identifier) {
          q = q.ilike("layout_type", `%${update.identifier}%`);
        }
        const { error } = await q.select("id");
        if (error) throw error;

      } else if (update.type === "inspection_booking") {
        if (!poId) throw new Error(`PO ${update.po_number || "(missing)"} not found`);
        const party = update.party || "3rd Party";
        const booking = update.action === "confirm" ? "Confirmed" :
                        update.action === "book"    ? "Booked" :
                        update.action === "complete" ? "Completed" : "Scheduled";
        const payload = {
          booking_status: booking,
          inspection_company: update.identifier || undefined,
          scheduled_date: update.target_date || undefined,
          inspection_date: update.actual_date || update.target_date || undefined,
          notes: auditNote,
        };
        // Remove undefined
        Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

        const { data: existing } = await supabase.from("qc_inspections")
          .select("id").eq("po_id", poId).eq("inspection_party", party).maybeSingle();

        if (existing) {
          await supabase.from("qc_inspections").update(payload).eq("id", existing.id);
        } else {
          await supabase.from("qc_inspections").insert({
            po_id: poId,
            po_number: update.po_number,
            inspection_party: party,
            inspection_type: party === "Internal QA" ? "In-line" : "Pre-shipment",
            verdict: "Pending",
            ...payload,
          });
        }

      } else if (update.type === "tna_milestone") {
        if (!poId) throw new Error(`PO ${update.po_number || "(missing)"} not found`);
        const newStatus = update.action === "complete" ? "completed" :
                          update.action === "delay"    ? "delayed" :
                          update.action === "book"     ? "in_progress" : "in_progress";
        let q = supabase.from("tna_milestones").update({
          status: newStatus,
          actual_date: update.actual_date || (newStatus === "completed" ? now.slice(0, 10) : null),
          target_date: update.target_date || undefined,
          notes: auditNote,
        }).eq("po_id", poId);
        if (update.identifier) {
          q = q.ilike("name", `%${update.identifier}%`);
        }
        const { error } = await q.select("id");
        if (error) throw error;

      } else {
        throw new Error(`Unknown update type: ${update.type}`);
      }

      setAppliedUpdateKeys(prev => new Set(prev).add(key));
      qc.invalidateQueries({ queryKey: ["emailCrawl"] });
    } catch (e) {
      alert(`Failed to apply update: ${e.message}`);
    } finally {
      setApplyingUpdateKey(null);
    }
  };

  const handleRejectUpdate = (row, idx) => {
    const key = `${row.id}-upd-${idx}`;
    setRejectedUpdateKeys(prev => new Set(prev).add(key));
  };

  const handleDelete = async (id) => {
    if (!confirm("Remove this email from the log?")) return;
    await emailCrawl.delete(id);
    qc.invalidateQueries({ queryKey: ["emailCrawl"] });
  };

  const filtered = crawledEmails.filter(e => {
    const matchCls = filterCls === "all" || e.classification === filterCls;
    const matchSearch = !search ||
      e.subject?.toLowerCase().includes(search.toLowerCase()) ||
      e.sender?.toLowerCase().includes(search.toLowerCase()) ||
      e.extracted_customer?.toLowerCase().includes(search.toLowerCase()) ||
      e.extracted_po_number?.toLowerCase().includes(search.toLowerCase()) ||
      (e.extracted_pos || []).some(p => p.po_number?.toLowerCase().includes(search.toLowerCase()));
    return matchCls && matchSearch;
  });

  const totals = {
    all: crawledEmails.length,
    purchase_order: crawledEmails.filter(e => e.classification === "purchase_order").length,
    pending_po: crawledEmails.filter(e => e.classification === "purchase_order" && !e.po_created).length,
    created: crawledEmails.filter(e => e.po_created).length,
    revisions: crawledEmails.filter(e => e.has_revision_keywords).length,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-base font-bold text-foreground flex items-center gap-2">
            <Inbox className="h-5 w-5 text-primary" /> Email PO Crawler
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Reads Gmail bodies + attachments, extracts multiple POs per email, detects revisions automatically
          </p>
          {crawlerEmail ? (
            <p className="text-xs mt-1">
              <span className="text-muted-foreground">Crawling: </span>
              <span className="font-mono font-medium text-emerald-700">{crawlerEmail}</span>
              {crawlerEmail !== userEmail && <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">different from login</span>}
              <span className="text-muted-foreground ml-2">· <a href="/settings" className="underline hover:text-primary">Change</a></span>
            </p>
          ) : (
            <p className="text-xs text-red-600 mt-1">No crawler email configured. <a href="/settings" className="underline">Set one in Settings</a>.</p>
          )}
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isLoading} className="gap-1.5 text-xs">
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {(totals.all > 0 || crawlStats) && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatPill label="Emails crawled" value={totals.all} color="bg-muted/50" />
          <StatPill label="PO emails" value={totals.purchase_order} color="bg-blue-50 text-blue-800" />
          <StatPill label="Pending import" value={totals.pending_po} color="bg-amber-50 text-amber-800" />
          <StatPill label="POs created" value={totals.created} color="bg-emerald-50 text-emerald-800" />
          <StatPill label="Revisions" value={totals.revisions} color="bg-amber-50 text-amber-900" />
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Crawl Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Gmail Search Query</label>
              <Input
                value={queryStr}
                onChange={e => setQueryStr(e.target.value)}
                placeholder='subject:order OR subject:"purchase order"'
                className="text-sm font-mono"
                disabled={crawling}
              />
              <p className="text-[11px] text-muted-foreground">Standard Gmail search operators work</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Max Emails to Fetch</label>
              <Select value={maxEmails} onValueChange={setMaxEmails} disabled={crawling}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["10","25","50","100","200"].map(v => <SelectItem key={v} value={v}>{v} emails</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Already-crawled emails are skipped automatically</p>
            </div>
          </div>

          <div className="flex gap-2">
            {!crawling ? (
              <Button onClick={handleCrawl} className="gap-2">
                <Play className="h-4 w-4" /> Start Crawl
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => { stopRef.current = true; }} className="gap-2">
                <StopCircle className="h-4 w-4" /> Stop
              </Button>
            )}
          </div>

          {crawlLog.length > 0 && (
            <div className="bg-muted/30 border border-border rounded-xl p-3 max-h-44 overflow-y-auto font-mono text-[11px] space-y-0.5">
              {crawlLog.map((l, i) => (
                <div key={i} className={cn(
                  l.type === "success" && "text-emerald-600",
                  l.type === "error" && "text-red-600",
                  l.type === "warn" && "text-amber-600",
                  l.type === "info" && "text-muted-foreground"
                )}>
                  <span className="opacity-50">{l.ts ? format(new Date(l.ts), "HH:mm:ss") : ""}</span>{" "}{l.msg}
                </div>
              ))}
              {crawling && <div className="flex items-center gap-1.5 text-primary mt-1"><Loader2 className="h-3 w-3 animate-spin" /> Processing…</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {crawledEmails.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search emails, customers, PO numbers…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {[
              ["all", "All", totals.all],
              ["purchase_order", "POs", totals.purchase_order],
              ["invoice", "Invoices", crawledEmails.filter(e=>e.classification==="invoice").length],
              ["shipping", "Shipping", crawledEmails.filter(e=>e.classification==="shipping").length],
              ["general", "General", crawledEmails.filter(e=>e.classification==="general").length],
            ].map(([val, label, count]) => (
              <button key={val} onClick={() => setFilterCls(val)}
                className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
                  filterCls === val ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                )}>
                {label} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isLoading && crawledEmails.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Inbox className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-1">No emails crawled yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Set your search query above and click "Start Crawl" to scan Gmail for purchase orders.
          </p>
          <div className="bg-muted/50 rounded-xl p-4 text-left max-w-sm text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground mb-2">Example Gmail queries:</p>
            <p><code className="bg-muted px-1 py-0.5 rounded">subject:"purchase order" has:attachment</code></p>
            <p><code className="bg-muted px-1 py-0.5 rounded">from:buyer@hm.com subject:PO</code></p>
            <p><code className="bg-muted px-1 py-0.5 rounded">subject:(order OR revision) after:2025/01/01</code></p>
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {crawledEmails.length} emails
            {filterCls === "purchase_order" && ` · ${totals.pending_po} pending import`}
          </p>
          {filtered.map(row => (
            <EmailRow
              key={row.id}
              row={row}
              onCreatePO={handleCreatePO}
              onDelete={handleDelete}
              creatingKey={creatingKey}
              onApplyUpdate={handleApplyUpdate}
              onRejectUpdate={handleRejectUpdate}
              applyingUpdateKey={applyingUpdateKey}
              appliedUpdateKeys={appliedUpdateKeys}
              rejectedUpdateKeys={rejectedUpdateKeys}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 && crawledEmails.length > 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No emails match the current filter.
        </div>
      )}
    </div>
  );
}

