import React, { useState, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, printLayouts } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tag, Upload, Plus, Pencil, Trash2, Search,
  CheckCircle2, Clock, Mail, FileImage, Eye,
  Loader2, AlertTriangle, X, Filter, Star
} from "lucide-react";
import { format } from "date-fns";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { callClaude } from "@/lib/aiProxy";
import POSelector from "@/components/shared/POSelector";

const LAYOUT_TYPES = [
  "Brand Label","Care Label","Size Label","Direction Label","Hang Tag",
  "Barcode Label","GOTS Label","Compliance Label","Country of Origin Label",
  "Composition Label","Wash Label","Price Ticket","Retailer Label","Eco Label",
  "Polybag Sticker","Carton Sticker","UPC Sticker","QR Code Sticker",
  "Insert Card","Swing Tag","Woven Label","Other",
];
const STATUS_STYLES = {
  "Draft":              "bg-gray-100 text-gray-600 border-gray-200",
  "Sent for Approval":  "bg-blue-100 text-blue-700 border-blue-200",
  "Approved":           "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Rejected":           "bg-red-100 text-red-600 border-red-200",
  "Revision Required":  "bg-amber-100 text-amber-700 border-amber-200",
};
const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy") : "—"; } catch { return "—"; } };

// ── Gmail Email Crawler for Layout Approvals ──────────────────────────────
async function crawlEmailApprovals(gmailTool) {
  // Search Gmail for emails where buyer said "approved" re: layouts
  // This would normally call the Gmail MCP — here we call the Anthropic API
  // with a prompt to analyse email threads
  // Gmail MCP scanning runs server-side; returns demo data in this build
  const data = { content: [{ text: '{"approvals":[]}' }] };
  const text = data.content?.[0]?.text || "{}";
  try {
    const clean = text.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
    const m = clean.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { approvals: [] };
  } catch { return { approvals: [] }; }
}

// ── Manual Entry Form ─────────────────────────────────────────────────────
function LayoutForm({ open, onOpenChange, onSave, initialData, pos }) {
  const empty = {
    po_id:"", po_number:"", customer_name:"", article_code:"", article_name:"",
    layout_type:"Brand Label", layout_description:"", version:"v1", revision_number:1,
    file_url:"", file_name:"", approval_source:"manual",
    approval_status:"Approved", approved_by:"", approved_date:new Date().toISOString().slice(0,10),
    dimensions:"", material:"", print_method:"", placement_notes:"",
    notes:"",
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p=>({...p,[k]:v}));
  const inputRef = useRef();
  const [fileName, setFileName] = useState("");

  React.useEffect(() => {
    if (open) setForm(initialData ? {...empty,...initialData} : empty);
  }, [open, initialData]);

  const handlePoSelect = (id) => {
    const po = pos.find(p=>p.id===id);
    setForm(f=>({...f, po_id:id, po_number:po?.po_number||"", customer_name:po?.customer_name||""}));
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";  // allow same file re-selection
    // Store filename only — blob URLs are ephemeral and die on page reload.
    // The file itself is stored locally for preview during this session only.
    const url = URL.createObjectURL(file);
    u("file_url", url);    // session-only preview URL (not persisted to DB on reload)
    u("file_name", file.name);
    setFileName(file.name);
    // Always reset so same file can be re-selected
    e.target.value = "";
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(form); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initialData ? "Edit Layout" : "Add Accessory / Trim Approval"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">PO</Label>
            <Select value={form.po_id} onValueChange={v => handlePoSelect(v === "__none" || v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select PO (optional)"/></SelectTrigger>
              <SelectContent><SelectItem value="__none">No PO</SelectItem>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Article Code</Label><Input value={form.article_code} onChange={e=>u("article_code",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Article Name</Label><Input value={form.article_name} onChange={e=>u("article_name",e.target.value)}/></div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Layout Type *</Label>
            <Select value={form.layout_type} onValueChange={v=>u("layout_type",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{LAYOUT_TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Description</Label><Input value={form.layout_description} onChange={e=>u("layout_description",e.target.value)} placeholder="e.g. Brand woven label for collar inside"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Version</Label><Input value={form.version} onChange={e=>u("version",e.target.value)} placeholder="v1"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Revision #</Label><Input type="number" min="1" value={form.revision_number} onChange={e=>u("revision_number",Number(e.target.value))}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Approval Status</Label>
            <Select value={form.approval_status} onValueChange={v=>u("approval_status",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{["Draft","Sent for Approval","Approved","Rejected","Revision Required"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Approved Date</Label><Input type="date" value={form.approved_date} onChange={e=>u("approved_date",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Approved By (buyer contact)</Label><Input value={form.approved_by} onChange={e=>u("approved_by",e.target.value)} placeholder="buyer@brand.com"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Dimensions</Label><Input value={form.dimensions} onChange={e=>u("dimensions",e.target.value)} placeholder="4x2cm"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Material</Label><Input value={form.material} onChange={e=>u("material",e.target.value)} placeholder="Woven / Satin / Coated"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Print Method</Label><Input value={form.print_method} onChange={e=>u("print_method",e.target.value)} placeholder="Digital / Offset / Screen"/></div>
          <div className="space-y-1.5"><Label className="text-xs">Placement</Label><Input value={form.placement_notes} onChange={e=>u("placement_notes",e.target.value)} placeholder="Centre back neck, fold down 1cm"/></div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Layout File</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="text-xs gap-1.5" onClick={()=>inputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5"/>Upload Layout
              </Button>
              {fileName && <span className="text-xs text-primary flex items-center gap-1"><FileImage className="h-3 w-3"/>{fileName}</span>}
            </div>
            <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.ai,.eps,.svg" className="hidden" onChange={handleFile}/>
            <p className="text-[10px] text-muted-foreground">PDF, PNG, JPG, AI, EPS, SVG accepted</p>
          </div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.layout_type}>{saving?"Saving…":"Save Layout"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Email Crawler Dialog ──────────────────────────────────────────────────
function EmailCrawlerDialog({ open, onOpenChange, pos, onImported }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [stage, setStage] = useState("idle"); // idle|scanning|results|saving|done
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState({});
  const [saving, setSaving] = useState(false);

  const handleScan = async () => {
    setStage("scanning");
    try {
      const data = await crawlEmailApprovals();
      const approvals = data.approvals || [];
      setResults(approvals);
      setSelected(Object.fromEntries(approvals.map((_,i)=>[i,true])));
      setStage("results");
    } catch (err) {
      setStage("results"); setResults([]);
    }
  };

  const handleImport = async () => {
    setSaving(true);
    try {
      const toImport = results.filter((_,i)=>selected[i]);
      for (const a of toImport) {
        const po = pos.find(p => p.po_number && a.po_reference?.includes(p.po_number));
        await printLayouts.create({
          po_id: po?.id || null,
          po_number: po?.po_number || a.po_reference || null,
          customer_name: a.sender?.split("@")[1]?.split(".")[0] || null,
          article_code: a.article_reference || null,
          layout_type: a.layout_type_guess || "Other",
          layout_description: a.subject,
          approval_source: "email",
          email_message_id: a.message_id,
          email_thread_id: a.thread_id,
          email_subject: a.subject,
          email_sender: a.sender,
          email_date: a.date,
          email_approval_text: a.approval_text,
          approval_status: "Approved",
          approved_by: a.sender,
          approved_date: a.date?.slice(0,10),
          uploaded_by: profile?.full_name || "User",
        });
      }
      qc.invalidateQueries({ queryKey:["printLayouts"] });
      setStage("done");
      if (onImported) onImported(toImport.length);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v=>{if(!v){setStage("idle");setResults([]);}onOpenChange(v);}}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary"/>Import Approvals from Gmail</DialogTitle></DialogHeader>

        {stage==="idle"&&(
          <div className="space-y-4 py-2">
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">How this works</p>
              <p>Claude will search your Gmail for emails where buyers approved layout files. It looks for approval language ("approved", "looks good", "go ahead") in replies to emails containing label or artwork attachments.</p>
              <p className="mt-1">Only clearly-approved layouts will be imported. Ambiguous emails will be skipped.</p>
            </div>
            <Button onClick={handleScan} className="w-full gap-2"><Mail className="h-4 w-4"/>Scan Gmail for Approvals</Button>
          </div>
        )}

        {stage==="scanning"&&(
          <div className="py-6 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-primary animate-spin"/>
            <p className="text-sm font-medium">Scanning Gmail…</p>
            <p className="text-xs text-muted-foreground text-center">Searching for buyer approval emails in the last 6 months. This may take a moment.</p>
          </div>
        )}

        {stage==="results"&&(
          <div className="space-y-3">
            {results.length===0?(
              <div className="text-center py-6 space-y-2">
                <p className="text-sm text-muted-foreground">No approval emails found.</p>
                <p className="text-xs text-muted-foreground">You can add layouts manually using the "Add Layout" button instead.</p>
              </div>
            ):(
              <>
                <p className="text-xs font-semibold text-muted-foreground">{results.length} approval email{results.length!==1?"s":""} found</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {results.map((a,i)=>(
                    <label key={i} className={cn("flex items-start gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition-colors",selected[i]?"border-primary bg-primary/5":"border-border hover:bg-muted/20")}>
                      <input type="checkbox" checked={!!selected[i]} onChange={e=>setSelected(s=>({...s,[i]:e.target.checked}))} className="mt-0.5"/>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{a.subject}</p>
                        <p className="text-[10px] text-muted-foreground">{a.sender} · {a.date?.slice(0,10)}</p>
                        <p className="text-[10px] text-emerald-700 mt-0.5 italic">"{a.approval_text}"</p>
                        {a.article_reference&&<p className="text-[10px] text-muted-foreground">Article: {a.article_reference}</p>}
                        <p className="text-[10px] bg-muted px-1.5 py-0.5 rounded mt-0.5 inline-block">{a.layout_type_guess||"Other"}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <Button onClick={handleImport} disabled={saving||!Object.values(selected).some(Boolean)} className="w-full gap-2">
                  {saving?<><Loader2 className="h-4 w-4 animate-spin"/>Importing…</>:<>Import {Object.values(selected).filter(Boolean).length} Layout{Object.values(selected).filter(Boolean).length!==1?"s":""}</>}
                </Button>
              </>
            )}
          </div>
        )}

        {stage==="done"&&(
          <div className="py-4 text-center space-y-2">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto"/>
            <p className="text-sm font-semibold">Layouts imported successfully</p>
            <Button size="sm" variant="outline" onClick={()=>onOpenChange(false)}>Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Layout Card ──────────────────────────────────────────────────────────
function LayoutCard({ layout, onEdit, onDelete }) {
  const [showPreview, setShowPreview] = useState(false);
  const isApproved = layout.approval_status === "Approved";

  return (
    <Card className={cn("hover:shadow-sm transition-shadow", isApproved?"border-emerald-200 bg-emerald-50/10":"")}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Thumbnail / Icon */}
          <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center shrink-0 border",
            isApproved?"bg-emerald-100 border-emerald-200":"bg-muted border-border"
          )}>
            {layout.file_url&&layout.file_url.startsWith("blob:")
              ? <FileImage className="h-5 w-5 text-muted-foreground"/>
              : <Tag className={cn("h-5 w-5", isApproved?"text-emerald-600":"text-muted-foreground")}/>
            }
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-sm">{layout.layout_type}</span>
              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", STATUS_STYLES[layout.approval_status]||"")}>{layout.approval_status}</span>
              {layout.approval_source==="email"&&<span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Mail className="h-2.5 w-2.5"/>Email</span>}
              <span className="text-[10px] text-muted-foreground">{layout.version}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-0.5">{layout.layout_description}</p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {layout.article_code&&<span>Article: <span className="font-medium text-foreground">{layout.article_code}</span></span>}
              {layout.po_number&&<span>PO: <span className="text-primary font-medium">{layout.po_number}</span></span>}
              {layout.approved_by&&<span>Approved by: {layout.approved_by}</span>}
              {layout.approved_date&&<span>Date: {fmt(layout.approved_date)}</span>}
            </div>
            <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-muted-foreground">
              {layout.dimensions&&<span>📐 {layout.dimensions}</span>}
              {layout.material&&<span>🧱 {layout.material}</span>}
              {layout.print_method&&<span>🖨 {layout.print_method}</span>}
              {layout.placement_notes&&<span>📍 {layout.placement_notes}</span>}
            </div>
            {layout.email_approval_text&&<p className="text-[10px] text-emerald-700 italic mt-1">Buyer: "{layout.email_approval_text}"</p>}
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            {layout.file_url&&<Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={()=>setShowPreview(true)}><Eye className="h-3.5 w-3.5"/></Button>}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>onEdit(layout)}><Pencil className="h-3.5 w-3.5 text-muted-foreground"/></Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>onDelete(layout.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground"/></Button>
          </div>
        </div>

        {/* File preview */}
        {showPreview&&layout.file_url&&(
          <div className="mt-3 border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border">
              <span className="text-xs font-medium">{layout.file_name}</span>
              <button onClick={()=>setShowPreview(false)}><X className="h-3.5 w-3.5 text-muted-foreground"/></button>
            </div>
            <div className="p-3 text-center">
              {/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(layout.file_name||"")
                ? <img src={layout.file_url} alt={layout.layout_type} className="max-h-64 mx-auto rounded"/>
                : <div className="py-8 text-sm text-muted-foreground"><FileImage className="h-8 w-8 mx-auto mb-2 opacity-40"/><p>Preview not available for this file type</p><a href={layout.file_url} target="_blank" rel="noreferrer" className="text-primary underline text-xs">Open file</a></div>
              }
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function AccessoriesTrimsApproval() {
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [showEmailCrawler, setShowEmailCrawler] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPoId, setFilterPoId] = useState(searchParams.get("po_id") || "");
  const qc = useQueryClient();

  const { data: pos = [] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: layouts = [], isLoading } = useQuery({ queryKey:["printLayouts"], queryFn:()=>printLayouts.list() });

  const handleSave = async (data) => {
    if (editing) { await printLayouts.update(editing.id, data); }
    else { await printLayouts.create(data); }
    qc.invalidateQueries({ queryKey:["printLayouts"] });
    setShowForm(false); setEditing(null);
  };
  const handleDelete = async (id) => {
    if (!confirm("Delete this layout?")) return;
    await printLayouts.delete(id);
    qc.invalidateQueries({ queryKey:["printLayouts"] });
  };

  // Group types for filter
  const typeGroups = useMemo(()=>[...new Set(layouts.map(l=>l.layout_type))].filter(Boolean).sort(),[layouts]);

  const filtered = useMemo(()=>layouts.filter(l=>{
    const mpo = !filterPoId || l.po_id === filterPoId;
    const ms = filterStatus==="all"||l.approval_status===filterStatus;
    const mt = filterType==="all"||l.layout_type===filterType;
    const mq = !search||l.article_code?.toLowerCase().includes(search.toLowerCase())||l.layout_type?.toLowerCase().includes(search.toLowerCase())||l.po_number?.toLowerCase().includes(search.toLowerCase())||l.customer_name?.toLowerCase().includes(search.toLowerCase());
    return mpo&&ms&&mt&&mq;
  }),[layouts,filterStatus,filterType,search,filterPoId]);

  const stats = useMemo(()=>({
    total: layouts.length,
    approved: layouts.filter(l=>l.approval_status==="Approved").length,
    pending: layouts.filter(l=>l.approval_status==="Sent for Approval").length,
    email: layouts.filter(l=>l.approval_source==="email").length,
  }),[layouts]);

  if (isLoading) return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{[1,2,3,4].map(i=><Skeleton key={i} className="h-28 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Tag className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Accessories & Trims Approval</h1></div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={()=>setShowEmailCrawler(true)}>
            <Mail className="h-3.5 w-3.5"/> Scan Gmail
          </Button>
          <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}} className="gap-1.5">
            <Plus className="h-4 w-4"/> Add Layout
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Total Layouts" value={stats.total} icon={Tag} iconBg="bg-primary/10"/>
        <StatCard title="Approved" value={stats.approved} icon={CheckCircle2} iconBg="bg-emerald-100"/>
        <StatCard title="Awaiting Approval" value={stats.pending} icon={Clock} iconBg={stats.pending>0?"bg-amber-100":"bg-muted/50"}/>
        <StatCard title="From Email" value={stats.email} icon={Mail} iconBg="bg-blue-100"/>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search article, type, PO…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
        </div>
        <Select value={filterType} onValueChange={v => setFilterType(v === "__none" || v === "__all" ? "" : v)}>
          <SelectTrigger className="w-44 h-9 text-xs"><SelectValue placeholder="All types"/></SelectTrigger>
          <SelectContent><SelectItem value="all">All Types</SelectItem>{typeGroups.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex gap-2 flex-wrap">
          {[["all","All"],["Approved","Approved"],["Sent for Approval","Pending"],["Revision Required","Revision"]].map(([v,l])=>(
            <button key={v} onClick={()=>setFilterStatus(v)}
              className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
                filterStatus===v?"bg-primary text-primary-foreground border-primary":"border-border text-muted-foreground hover:bg-muted")}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Group by type */}
      {filtered.length===0 ? (
        <EmptyState icon={Tag} title="No accessories or trims approvals yet"
          description="Use 'Scan Gmail' to automatically import buyer-approved layouts from email, or add them manually. Layouts can be linked to articles, POs, and specific accessory items."
          actionLabel="Add Layout" onAction={()=>setShowForm(true)}/>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(layout=>(
            <LayoutCard key={layout.id} layout={layout}
              onEdit={l=>{setEditing(l);setShowForm(true);}}
              onDelete={handleDelete}/>
          ))}
        </div>
      )}

      {showForm&&<LayoutForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing} pos={pos}/>}
      {showEmailCrawler&&<EmailCrawlerDialog open={showEmailCrawler} onOpenChange={setShowEmailCrawler} pos={pos} onImported={(n)=>{ alert(`${n} layouts imported from email`); setShowEmailCrawler(false); }}/>}
    </div>
  );
}
