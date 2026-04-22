import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, accessoryPOs, mfg } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, FileText, Download, Trash2, CheckCircle, Eye, X, Package, Printer } from "lucide-react";
import { format } from "date-fns";
import { jsPDF } from "jspdf";
import EmptyState from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";

const STATUS_COLORS = {
  Draft:     "bg-gray-100 text-gray-700 border-gray-200",
  Issued:    "bg-blue-100 text-blue-700 border-blue-200",
  Confirmed: "bg-amber-100 text-amber-700 border-amber-200",
  Received:  "bg-emerald-100 text-emerald-700 border-emerald-200",
  Cancelled: "bg-red-100 text-red-700 border-red-200",
};
const CATEGORIES = ["All","Label","Accessory","Insert Card","Polybag","Stiffener","Carton","Sticker"];
const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy") : "—"; } catch { return "—"; } };

function downloadCSV(apo) {
  const rows = [
    ["ACCESSORY PURCHASE ORDER", apo.apo_number],
    ["Supplier:", apo.supplier, "Production PO Ref:", apo.po_ref],
    ["Date:", apo.order_date, "Currency:", apo.currency],
    [],
    ["#","Category","Description","Article","Spec/Size","Qty","Unit","Unit Cost","Total Cost"],
    ...(apo.items||[]).map((item,i)=>[i+1,item.category,item.item_description,item.article_code||item.article_name||"",item.size_spec||"",item.quantity,item.unit,item.unit_cost||"",item.total_cost||""]),
    [],
    ["","","","","","","","TOTAL",apo.total_cost||0],
  ];
  const csv = rows.map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const a = Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([csv],{type:"text/csv"})),download:`${apo.apo_number}.csv`});
  a.click();
}

function downloadPDF(apo) {
  const doc = new jsPDF({ orientation: "landscape", format: "a4" });
  doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text(`Accessory Purchase Order — ${apo.apo_number}`, 14, 15);

  // Header block
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(`Supplier: ${apo.supplier || "—"}`, 14, 24);
  doc.text(`Production PO: ${apo.po_ref || "—"}`, 120, 24);
  doc.text(`Order Date: ${apo.order_date || "—"}`, 200, 24);
  doc.text(`Status: ${apo.status || "Draft"}`, 14, 30);
  doc.text(`Currency: ${apo.currency || "—"}`, 120, 30);

  // Table
  const cols = ["#", "Category", "Description", "Article", "Spec", "Qty", "Unit", "Unit Cost", "Total"];
  const widths = [10, 26, 60, 45, 30, 18, 16, 22, 25];
  let y = 42;

  // Header row
  doc.setFillColor(31, 56, 100); doc.setTextColor(255, 255, 255);
  let x = 14;
  cols.forEach((col, i) => {
    doc.rect(x, y - 4, widths[i], 7, "F");
    doc.setFontSize(8); doc.text(col, x + 1.5, y);
    x += widths[i];
  });
  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal");
  y += 6;

  // Body rows
  (apo.items || []).forEach((item, idx) => {
    if (y > 180) { doc.addPage(); y = 20; }
    if (idx % 2 === 0) {
      doc.setFillColor(235, 240, 250);
      let rx = 14;
      widths.forEach((w) => { doc.rect(rx, y - 3.5, w, 6, "F"); rx += w; });
    }
    const row = [
      String(idx + 1),
      (item.category || "").substring(0, 18),
      (item.item_description || "").substring(0, 38),
      (item.article_code || item.article_name || "").substring(0, 26),
      (item.size_spec || "").substring(0, 18),
      Number(item.quantity || 0).toLocaleString(),
      item.unit || "",
      item.unit_cost ? Number(item.unit_cost).toFixed(2) : "",
      item.total_cost ? Number(item.total_cost).toFixed(2) : "",
    ];
    doc.setFontSize(7.5);
    let cx = 14;
    row.forEach((val, i) => { doc.text(String(val), cx + 1.5, y); cx += widths[i]; });
    y += 6;
  });

  // Totals row
  if (y > 185) { doc.addPage(); y = 20; }
  doc.setFillColor(31, 56, 100); doc.setTextColor(255, 255, 255);
  const totalsStart = 14 + widths.slice(0, -1).reduce((s, w) => s + w, 0);
  doc.rect(14, y - 3.5, widths.reduce((s, w) => s + w, 0), 7, "F");
  doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text("GRAND TOTAL", 14 + 4, y + 0.5);
  doc.text(`${apo.currency || ""} ${(apo.total_cost || 0).toLocaleString()}`, totalsStart + 1.5, y + 0.5);
  doc.setTextColor(0, 0, 0);

  if (apo.notes) {
    y += 12;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Notes: ${apo.notes}`, 14, y);
  }

  doc.save(`${apo.apo_number}.pdf`);
}

function printPO(apo) {
  const itemRows = (apo.items || []).map((item, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${item.category || ""}</td>
      <td>${item.item_description || ""}</td>
      <td>${item.article_code || item.article_name || ""}</td>
      <td>${item.size_spec || ""}</td>
      <td style="text-align:right">${Number(item.quantity || 0).toLocaleString()}</td>
      <td>${item.unit || ""}</td>
      <td style="text-align:right">${item.unit_cost ? Number(item.unit_cost).toFixed(2) : ""}</td>
      <td style="text-align:right">${item.total_cost ? Number(item.total_cost).toFixed(2) : ""}</td>
    </tr>
  `).join("");

  const html = `<html><head><title>${apo.apo_number}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; }
      h2 { color: #1F3864; margin: 0 0 4px 0; }
      .meta { color: #555; font-size: 11px; margin-bottom: 12px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
      .meta b { color: #222; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      th, td { border: 1px solid #bbb; padding: 4px 6px; }
      th { background: #EBF0FA; text-align: left; }
      tr:nth-child(even) td { background: #F9FAFB; }
      .total-row td { background: #1F3864 !important; color: white; font-weight: bold; }
      .notes { margin-top: 16px; font-size: 11px; color: #444; }
    </style></head>
    <body>
      <h2>Accessory Purchase Order — ${apo.apo_number}</h2>
      <div class="meta">
        <div><b>Supplier:</b> ${apo.supplier || "—"}</div>
        <div><b>Production PO:</b> ${apo.po_ref || "—"}</div>
        <div><b>Order Date:</b> ${apo.order_date || "—"}</div>
        <div><b>Status:</b> ${apo.status || "Draft"}</div>
        <div><b>Currency:</b> ${apo.currency || "—"}</div>
        <div><b>Items:</b> ${(apo.items || []).length}</div>
      </div>
      <table>
        <thead><tr>
          <th style="width:30px">#</th><th>Category</th><th>Description</th>
          <th>Article</th><th>Spec</th><th>Qty</th><th>Unit</th>
          <th>Unit Cost</th><th>Total</th>
        </tr></thead>
        <tbody>
          ${itemRows}
          <tr class="total-row">
            <td colspan="8" style="text-align:right">GRAND TOTAL</td>
            <td style="text-align:right">${apo.currency || ""} ${(apo.total_cost || 0).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      ${apo.notes ? `<div class="notes"><b>Notes:</b> ${apo.notes}</div>` : ""}
    </body></html>`;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  w.print();
}

export default function AccessoryPurchaseOrders() {
  const qc = useQueryClient();
  const [showGenerator, setShowGenerator] = useState(false);
  const [viewingPO, setViewingPO] = useState(null);
  const [searchParams] = useSearchParams();
  const [selectedPoId, setSelectedPoId] = useState(searchParams.get("po_id") || "");
  const [supplier, setSupplier] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [notes, setNotes] = useState("");
  const [selectedItems, setSelectedItems] = useState({});
  const [unitCosts, setUnitCosts] = useState({});
  const [filterCat, setFilterCat] = useState("All");
  const [generating, setGenerating] = useState(false);

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const { data: accItems = [] } = useQuery({ queryKey: ["accessoryItems"], queryFn: () => mfg.accessories.list() });
  const { data: apos = [] } = useQuery({ queryKey: ["accessoryPOs"], queryFn: () => accessoryPOs.list() });

  const activePo = useMemo(() => selectedPoId ? pos.find(p => p.id === selectedPoId) : null, [pos, selectedPoId]);
  const poItems = useMemo(() => accItems.filter(i => i.po_id === activePo?.id && (i.quantity_required||0) > 0), [accItems, activePo?.id]);
  const filteredPoItems = filterCat === "All" ? poItems : poItems.filter(i => i.category === filterCat);
  const grouped = useMemo(() => filteredPoItems.reduce((g, item) => { const cat = item.category||"Other"; (g[cat]=g[cat]||[]).push(item); return g; }, {}), [filteredPoItems]);
  const selectedList = poItems.filter(i => selectedItems[i.id]);
  const totalCost = selectedList.reduce((s, i) => s + (Number(unitCosts[i.id]||0)*(i.quantity_required||0)), 0);

  const toggleItem = (id) => setSelectedItems(p => ({ ...p, [id]: !p[id] }));
  const toggleAll = () => {
    const allSel = filteredPoItems.every(i => selectedItems[i.id]);
    const next = {};
    filteredPoItems.forEach(i => { next[i.id] = !allSel; });
    setSelectedItems(p => ({ ...p, ...next }));
  };

  // Map an APO status to the status that source accessory_items should be in.
  // Receiving flows through: Draft/Issued/Confirmed all mean "committed to this APO"
  // so source items are Ordered. Received flips them to Received. Cancelled or
  // deletion releases them back to Planned so they can be put on a different APO.
  const apoStatusToItemStatus = (apoStatus) => {
    if (apoStatus === "Received") return "Received";
    if (apoStatus === "Cancelled") return "Planned";
    return "Ordered"; // Draft, Issued, Confirmed
  };

  const itemIdsFor = (apo) =>
    (apo?.items || []).map((i) => i.accessory_item_id).filter(Boolean);

  const handleGenerate = async () => {
    if (!activePo || !selectedList.length) return alert("Select at least one item.");
    if (!supplier.trim()) return alert("Enter a supplier name.");
    setGenerating(true);
    try {
      const apo_number = `APO-${Date.now().toString().slice(-6)}`;
      const items = selectedList.map(item => ({
        accessory_item_id: item.id,
        category: item.category,
        item_description: item.item_description,
        article_name: item.article_name,
        article_code: item.article_code,
        size_spec: item.size_spec,
        quantity: item.quantity_required,
        unit: item.unit||"Pcs",
        unit_cost: Number(unitCosts[item.id]||0),
        total_cost: Number(unitCosts[item.id]||0)*(item.quantity_required||0),
      }));
      const total = items.reduce((s, i) => s+(i.total_cost||0), 0);
      await accessoryPOs.create({
        apo_number, po_ref: activePo.po_number, po_id: activePo.id,
        supplier, currency, notes, items, total_cost: total,
        order_date: new Date().toISOString().slice(0,10), status:"Draft",
      });
      // Flip source items to Ordered so they're no longer selectable for a new APO
      await mfg.accessories.bulkUpdateStatus(
        selectedList.map(i => i.id),
        "Ordered"
      );
      qc.invalidateQueries({ queryKey: ["accessoryPOs"] });
      qc.invalidateQueries({ queryKey: ["accessoryItems"] });
      setShowGenerator(false); setSelectedItems({}); setSupplier(""); setNotes(""); setUnitCosts({});
    } finally { setGenerating(false); }
  };

  const handleStatus = async (id, status) => {
    await accessoryPOs.update(id, { status });
    // Keep source items in sync with the new APO status
    const apo = apos.find(a => a.id === id);
    const ids = itemIdsFor(apo);
    if (ids.length) {
      await mfg.accessories.bulkUpdateStatus(ids, apoStatusToItemStatus(status));
    }
    qc.invalidateQueries({ queryKey: ["accessoryPOs"] });
    qc.invalidateQueries({ queryKey: ["accessoryItems"] });
  };
  const handleDelete = async (id) => {
    if (!confirm("Delete this APO? Source items will be released back to Planned.")) return;
    // Release items BEFORE deleting the APO so we still have the link
    const apo = apos.find(a => a.id === id);
    const ids = itemIdsFor(apo);
    if (ids.length) {
      await mfg.accessories.bulkUpdateStatus(ids, "Planned");
    }
    await accessoryPOs.delete(id);
    qc.invalidateQueries({ queryKey: ["accessoryPOs"] });
    qc.invalidateQueries({ queryKey: ["accessoryItems"] });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3"><Package className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Accessory Purchase Orders</h1></div>
        <Button onClick={() => setShowGenerator(true)} className="gap-1.5"><Plus className="h-4 w-4"/>Generate New APO</Button>
      </div>

      {apos.length === 0 ? (
        <EmptyState icon={Package} title="No accessory POs yet" description="Generate purchase orders for labels, polybags, cartons, and other accessories." actionLabel="Generate APO" onAction={() => setShowGenerator(true)}/>
      ) : (
        <div className="space-y-3">
          {apos.map(apo => (
            <Card key={apo.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{apo.apo_number}</span>
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded border", STATUS_COLORS[apo.status]||"")}>{apo.status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Supplier: <span className="font-medium text-foreground">{apo.supplier||"—"}</span> · Ref: {apo.po_ref||"—"} · {fmt(apo.order_date)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(apo.items||[]).length} items · Total: <span className="font-bold text-foreground">{apo.currency} {(apo.total_cost||0).toLocaleString()}</span>
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => setViewingPO(apo)}><Eye className="h-3.5 w-3.5"/>View</Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => downloadCSV(apo)}><Download className="h-3.5 w-3.5"/>CSV</Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => downloadPDF(apo)}><FileText className="h-3.5 w-3.5"/>PDF</Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => printPO(apo)}><Printer className="h-3.5 w-3.5"/>Print</Button>
                    {apo.status==="Draft" && <Button size="sm" variant="outline" className="text-xs" onClick={() => handleStatus(apo.id,"Issued")}>Issue</Button>}
                    {apo.status==="Issued" && <Button size="sm" variant="outline" className="text-xs" onClick={() => handleStatus(apo.id,"Confirmed")}>Confirm</Button>}
                    {apo.status==="Confirmed" && <Button size="sm" variant="outline" className="text-xs" onClick={() => handleStatus(apo.id,"Received")}>Received</Button>}
                    <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => handleDelete(apo.id)}><Trash2 className="h-3.5 w-3.5"/></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* View dialog */}
      {viewingPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b" style={{backgroundColor:"#1F3864"}}>
              <div>
                <h2 className="font-bold text-base text-white">{viewingPO.apo_number}</h2>
                <p className="text-xs text-blue-200">Supplier: {viewingPO.supplier} · Ref: {viewingPO.po_ref} · {fmt(viewingPO.order_date)}</p>
              </div>
              <button onClick={() => setViewingPO(null)}><X className="h-5 w-5 text-white"/></button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              <div className="overflow-x-auto rounded border border-gray-300">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr style={{backgroundColor:"#EBF0FA"}}>
                      {["#","Category","Description","Article","Spec/Size","Qty","Unit","Unit Cost","Total"].map(h => (
                        <th key={h} className="border border-gray-300 px-2 py-1.5 text-left font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(viewingPO.items||[]).map((item, idx) => (
                      <tr key={idx} style={{backgroundColor:idx%2===0?"#fff":"#F9FAFB"}}>
                        <td className="border border-gray-300 px-2 py-1">{idx+1}</td>
                        <td className="border border-gray-300 px-2 py-1">{item.category}</td>
                        <td className="border border-gray-300 px-2 py-1 font-medium">{item.item_description}</td>
                        <td className="border border-gray-300 px-2 py-1">{item.article_code||item.article_name||"—"}</td>
                        <td className="border border-gray-300 px-2 py-1">{item.size_spec||"—"}</td>
                        <td className="border border-gray-300 px-2 py-1 font-bold text-center" style={{backgroundColor:"#FFF2CC"}}>{(item.quantity||0).toLocaleString()}</td>
                        <td className="border border-gray-300 px-2 py-1">{item.unit}</td>
                        <td className="border border-gray-300 px-2 py-1">{item.unit_cost?`${viewingPO.currency} ${item.unit_cost}`:"—"}</td>
                        <td className="border border-gray-300 px-2 py-1 font-bold">{item.total_cost?`${viewingPO.currency} ${Number(item.total_cost).toFixed(0)}`:"—"}</td>
                      </tr>
                    ))}
                    <tr style={{backgroundColor:"#1F3864",color:"white",fontWeight:"bold"}}>
                      <td className="border border-gray-400 px-2 py-1.5" colSpan={8}>TOTAL</td>
                      <td className="border border-gray-400 px-2 py-1.5">{viewingPO.currency} {Number(viewingPO.total_cost||0).toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {viewingPO.notes && <p className="mt-3 text-xs text-muted-foreground">Notes: {viewingPO.notes}</p>}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <Button variant="outline" className="gap-1 text-xs" onClick={() => downloadCSV(viewingPO)}><Download className="h-3.5 w-3.5"/>CSV</Button>
              <Button variant="outline" className="gap-1 text-xs" onClick={() => downloadPDF(viewingPO)}><FileText className="h-3.5 w-3.5"/>PDF</Button>
              <Button variant="outline" className="gap-1 text-xs" onClick={() => printPO(viewingPO)}><Printer className="h-3.5 w-3.5"/>Print</Button>
              <Button variant="outline" onClick={() => setViewingPO(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Generator */}
      {showGenerator && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-6 px-4">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-4xl">
            <div className="flex items-center justify-between p-4 border-b" style={{backgroundColor:"#1F3864"}}>
              <h2 className="font-bold text-base text-white">Generate Accessory Purchase Order</h2>
              <button onClick={() => setShowGenerator(false)}><X className="h-5 w-5 text-white"/></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Production PO *</label>
                  <Select value={selectedPoId} onValueChange={v => { setSelectedPoId(v); setSelectedItems({}); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select PO"/></SelectTrigger>
                    <SelectContent>{pos.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number} – {p.customer_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Supplier *</label>
                  <Input className="h-8 text-xs" placeholder="Supplier name" value={supplier} onChange={e => setSupplier(e.target.value)}/>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Currency</label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                    <SelectContent>{["USD","EUR","PKR","GBP"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
                  <Input className="h-8 text-xs" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)}/>
                </div>
              </div>

              {poItems.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {CATEGORIES.map(cat => (
                    <button key={cat} onClick={() => setFilterCat(cat)}
                      className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-all", filterCat===cat?"bg-primary text-primary-foreground border-primary":"border-border text-muted-foreground hover:bg-muted")}>
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              {!selectedPoId ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Select a production PO to load planned accessory items.</div>
              ) : filteredPoItems.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No planned accessory items for this PO. Complete accessories planning first.</div>
              ) : (
                <div className="overflow-x-auto rounded border border-gray-300">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr style={{backgroundColor:"#1F3864",color:"white"}}>
                        <th className="border border-gray-400 px-2 py-2 w-8"><input type="checkbox" checked={filteredPoItems.every(i=>selectedItems[i.id])} onChange={toggleAll}/></th>
                        {["Category","Description","Article","Spec","Qty (incl. wastage)","Unit",`Unit Cost (${currency})`,`Total`].map(h=>(
                          <th key={h} className="border border-gray-400 px-2 py-2 text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(grouped).map(([cat, items]) => [
                        <tr key={`h-${cat}`}><td colSpan={9} className="px-3 py-1.5 text-xs font-bold text-white" style={{backgroundColor:"#3D5A99"}}>{cat}</td></tr>,
                        ...items.map((item, idx) => (
                          <tr key={item.id} style={{backgroundColor:selectedItems[item.id]?"#EBF5FB":idx%2===0?"#fff":"#F9FAFB"}}>
                            <td className="border border-gray-300 px-2 py-1.5 text-center"><input type="checkbox" checked={!!selectedItems[item.id]} onChange={()=>toggleItem(item.id)}/></td>
                            <td className="border border-gray-300 px-2 py-1">{item.category}</td>
                            <td className="border border-gray-300 px-2 py-1 font-medium">{item.item_description}</td>
                            <td className="border border-gray-300 px-2 py-1">{item.article_code||item.article_name||"—"}</td>
                            <td className="border border-gray-300 px-2 py-1">{item.size_spec||"—"}</td>
                            <td className="border border-gray-300 px-2 py-1.5 text-center font-bold" style={{backgroundColor:"#FFF2CC"}}>{(item.quantity_required||0).toLocaleString()}</td>
                            <td className="border border-gray-300 px-2 py-1">{item.unit||"Pcs"}</td>
                            <td className="border border-gray-300 px-1.5 py-1">
                              <input type="number" min="0" step="0.01" className="w-20 text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                value={unitCosts[item.id]||""} onChange={e=>setUnitCosts(p=>({...p,[item.id]:e.target.value}))} placeholder="0.00"/>
                            </td>
                            <td className="border border-gray-300 px-2 py-1 font-medium">
                              {unitCosts[item.id]?`${currency} ${(Number(unitCosts[item.id])*(item.quantity_required||0)).toFixed(0)}`:"—"}
                            </td>
                          </tr>
                        ))
                      ])}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedList.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{selectedList.length} items selected</p>
                  {totalCost > 0 && <p className="text-sm font-bold">Total: {currency} {totalCost.toLocaleString()}</p>}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <Button variant="outline" onClick={() => setShowGenerator(false)}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={generating||!selectedList.length||!supplier.trim()}>
                <FileText className="h-4 w-4 mr-1.5"/>{generating?"Generating…":`Generate APO (${selectedList.length} items)`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

