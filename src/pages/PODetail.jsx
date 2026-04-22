import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { db, supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Pencil, Plus, Trash2, Package, AlertTriangle, Upload, Download, Layers, Scissors, PackageCheck, Tag, FlaskConical, TestTube, ClipboardList, DollarSign, FileText, ShieldCheck, Calendar, Ship, ShieldAlert, Receipt, FileBox, Shirt, ClipboardCheck, Image, Copy } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/shared/StatusBadge";
import POWorkflowSteps from "@/components/po/POWorkflowSteps";
import POFormDialog from "@/components/po/POFormDialog";
import POItemFormDialog from "@/components/po/POItemFormDialog";
import POChangeLog from "@/components/po/POChangeLog";
import PaymentSchedulePanel from "@/components/po/PaymentSchedulePanel";
import CBMSummary from "@/components/po/CBMSummary";
import PriceVerification from "@/components/po/PriceVerification";
import POBatches from "@/components/po/POBatches";
import POApprovalPanel from "@/components/po/POApprovalPanel";
import PriceOverrideCell from "@/components/po/PriceOverrideCell";

// CSV bulk upload helper
async function parsePOItemsCSV(text, poId, poNumber) {
  const lines = text.split(/\r?\n/).map(l => l.split(",").map(c => c.replace(/^"|"$/g,"").trim()));
  if (lines.length < 2) return { records:[], errors:["Empty CSV"] };
  const headers = lines[0].map(h => h.toLowerCase().replace(/\s+/g,"_"));
  const required = ["item_code","quantity"];
  const missing = required.filter(r => !headers.includes(r));
  if (missing.length) return { records:[], errors:[`Missing columns: ${missing.join(", ")}`] };
  const records = [], errors = [];
  lines.slice(1).forEach((row, idx) => {
    if (row.join("").trim() === "") return;
    const r = {};
    headers.forEach((h, i) => { r[h] = row[i] || ""; });
    if (!r.item_code) { errors.push(`Row ${idx+2}: missing item_code`); return; }
    const qty = Number(r.quantity) || 0;
    if (qty <= 0) { errors.push(`Row ${idx+2}: invalid quantity`); return; }
    records.push({
      po_id: poId, po_number: poNumber,
      item_code: r.item_code, item_description: r.item_description||r.description||"",
      fabric_type: r.fabric_type||"", gsm: r.gsm?Number(r.gsm):null,
      color: r.color||"", quantity: qty, unit: r.unit||"Pieces",
      unit_price: r.unit_price?Number(r.unit_price):0,
      total_price: qty*(r.unit_price?Number(r.unit_price):0),
      cbm: r.cbm?Number(r.cbm):null, pieces_per_carton: r.pieces_per_carton?Number(r.pieces_per_carton):null,
      delivery_date: r.delivery_date||null, price_status:"Pending",
    });
  });
  return { records, errors };
}

const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy") : "—"; } catch { return "—"; } };

function InfoRow({ label, value }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-medium text-foreground mt-0.5">{value || "—"}</p>
    </div>
  );
}

export default function PODetail() {
  const poId = new URLSearchParams(window.location.search).get("id");
  const unknownsCount = parseInt(new URLSearchParams(window.location.search).get("unknowns") || "0");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, profile } = useAuth();
  const canPriceOverride = can("PRICE_OVERRIDE");
  const canEditItems = can("BOM_UPLOAD"); // Owner + Manager + Merchandiser can add/edit/delete line items
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const csvRef = React.useRef();

  const handleCSVUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { records, errors } = await parsePOItemsCSV(text, poId, po?.po_number);
    if (errors.length && !records.length) { alert("CSV errors:\n" + errors.join("\n")); e.target.value=""; return; }
    // Fetch existing items to upsert by item_code
    const existing = await db.poItems.listByPO(poId);
    const existMap = {};
    existing.forEach(i => { if (i.item_code) existMap[i.item_code.trim().toUpperCase()] = i.id; });
    let created = 0, updated = 0;
    for (const rec of records) {
      const key = rec.item_code.trim().toUpperCase();
      if (existMap[key]) {
        await db.poItems.update(existMap[key], rec);
        updated++;
      } else {
        await db.poItems.create(rec);
        created++;
      }
    }
    const summary = `${created} created, ${updated} updated.`;
    if (errors.length) alert(`${summary} Skipped:\n${errors.join("\n")}`);
    else if (records.length) alert(summary);
    qc.invalidateQueries({ queryKey: ["poItems", poId] });
    e.target.value = "";
  };
  const [showEditPO, setShowEditPO] = useState(false);

  const { data: po, isLoading: poLoading } = useQuery({
    queryKey: ["po", poId],
    queryFn: () => db.purchaseOrders.get(poId),
    enabled: !!poId,
  });
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["poItems", poId],
    queryFn: () => db.poItems.listByPO(poId),
    enabled: !!poId,
  });

  const handleStatusChange = async (newStatus) => {
    await db.statusLogs.log("purchase_order", poId, po?.status, newStatus);
    await db.purchaseOrders.update(poId, { status: newStatus });
    qc.invalidateQueries({ queryKey: ["po", poId] });
    qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
  };

  const handleSaveItem = async (data) => {
    if (editingItem) {
      await db.poItems.update(editingItem.id, data);
    } else {
      await db.poItems.create({ ...data, po_id: poId, po_number: po?.po_number || "", price_status: "Pending" });
    }
    qc.invalidateQueries({ queryKey: ["poItems", poId] });
    setShowItemForm(false);
    setEditingItem(null);
  };

  const handleDeleteItem = async (id) => {
    if (!window.confirm("Delete this item?")) return;
    await db.poItems.delete(id);
    qc.invalidateQueries({ queryKey: ["poItems", poId] });
  };

  const handleEditPO = async (data) => {
    await db.purchaseOrders.update(poId, data);
    qc.invalidateQueries({ queryKey: ["po", poId] });
    qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
    setShowEditPO(false);
  };

  const handleDuplicatePO = async () => {
    if (!confirm(`Duplicate ${po.po_number}? This creates a new PO with the same items, articles, and accessories.`)) return;
    // Create new PO with incremented number
    const newPoNum = po.po_number + "-COPY";
    const { id: newId, ...poRest } = po;
    const newPo = await db.purchaseOrders.create({
      ...poRest,
      po_number: newPoNum,
      pi_number: null,
      pi_date: null,
      status: "PO Received",
      created_at: undefined,
      updated_at: undefined,
    });
    // Copy po_items
    const poItemRows = await db.poItems.listByPO(po.id);
    if (poItemRows.length) {
      await db.poItems.bulkCreate(poItemRows.map(({ id, created_at, updated_at, ...r }) => ({
        ...r, po_id: newPo.id, po_number: newPoNum,
      })));
    }
    // Copy articles
    const { data: artRows } = await supabase.from("articles").select("*").eq("po_id", po.id);
    if (artRows?.length) {
      await supabase.from("articles").insert(artRows.map(({ id, created_at, updated_at, ...r }) => ({
        ...r, po_id: newPo.id, po_number: newPoNum,
      })));
    }
    // Copy accessories
    const { data: accRows } = await supabase.from("accessory_items").select("*").eq("po_id", po.id);
    if (accRows?.length) {
      for (let i = 0; i < accRows.length; i += 50) {
        await supabase.from("accessory_items").insert(
          accRows.slice(i, i + 50).map(({ id, created_at, updated_at, ...r }) => ({
            ...r, po_id: newPo.id, po_number: newPoNum,
          }))
        );
      }
    }
    qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
    navigate(`/PODetail?id=${newPo.id}`);
  };

  const totalItemValue = items.reduce((s, i) => s + (i.total_price || 0), 0);
  const totalItemQty = items.reduce((s, i) => s + (i.quantity || 0), 0);
  const totalCBM = items.reduce((s, i) => s + (i.cbm || 0), 0);

  if (poLoading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>;
  if (!po) return (
    <div className="text-center py-16">
      <p className="text-muted-foreground">Purchase Order not found</p>
      <Link to={createPageUrl("PurchaseOrders")} className="text-primary text-sm hover:underline mt-2 inline-block">Back to POs</Link>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={createPageUrl("PurchaseOrders")}>
          <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-semibold text-foreground">{po.po_number}</h1>
            <StatusBadge status={po.status} />
            {po.season && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{po.season}</span>}
          </div>
          <p className="text-sm text-muted-foreground">{po.customer_name}</p>
        </div>
        {can("PO_EDIT") && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleDuplicatePO}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Duplicate
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowEditPO(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
          </div>
        )}
      </div>

      {/* Workflow */}
      <POWorkflowSteps currentStatus={po.status} onStatusChange={handleStatusChange} />

      {/* Approval Panel */}
      <POApprovalPanel po={po} />

      {/* Quick navigation to planning modules */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "T&A Calendar",    icon: Calendar,      page: "TNACalendar",         color: "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100" },
          { label: "Fabric Working",  icon: Layers,        page: "FabricWorking",       color: "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100" },
          { label: "Yarn Planning",   icon: Scissors,      page: "YarnPlanning",        color: "bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100" },
          { label: "Trims",           icon: Tag,           page: "Trims",               color: "bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100" },
          { label: "Accessories & Packaging", icon: PackageCheck, page: "PackagingPlanning", color: "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100" },
          { label: "Fabric Orders",   icon: Shirt,         page: "FabricOrders",        color: "bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100" },
          { label: "Costing",         icon: DollarSign,    page: "CostingSheet",        color: "bg-pink-50 border-pink-200 text-pink-700 hover:bg-pink-100" },
          { label: "Lab Dips",        icon: FlaskConical,  page: "LabDips",             color: "bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100" },
          { label: "Samples",         icon: TestTube,      page: "Samples",             color: "bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100" },
          { label: "QC",              icon: ShieldCheck,   page: "QCInspections",       color: "bg-green-50 border-green-200 text-green-700 hover:bg-green-100" },
          { label: "Job Cards",       icon: ClipboardCheck,page: "JobCards",            color: "bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100" },
          { label: "Proforma",        icon: Receipt,       page: "ProformaInvoice",     color: "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100" },
          { label: "Comm Invoice",    icon: FileBox,       page: "CommercialInvoices",  color: "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100" },
          { label: "Packing List",    icon: ClipboardList, page: "PackingList",         color: "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100" },
          { label: "Shipments",       icon: Ship,          page: "Shipments",           color: "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100" },
          { label: "Shipping Docs",   icon: FileText,      page: "ShippingDocuments",   color: "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100" },
          { label: "Compliance",      icon: ShieldAlert,   page: "Compliance",          color: "bg-red-50 border-red-200 text-red-700 hover:bg-red-100" },
          { label: "Tech Packs",      icon: FileText,      page: "TechPacks",           color: "bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-100" },
          { label: "Accessories & Trims Approval",   icon: Image,         page: "PrintLayouts",        color: "bg-lime-50 border-lime-200 text-lime-700 hover:bg-lime-100" },
        ].map(({ label, icon: Icon, page, color }) => (
          <Link key={page} to={`${createPageUrl(page)}?po_id=${poId}`}>
            <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${color}`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          </Link>
        ))}
      </div>

      {/* Unknown SKU banner */}
      {unknownsCount > 0 && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0"/>
            <p className="text-sm font-medium text-amber-800">
              {unknownsCount} SKU{unknownsCount !== 1 ? "s" : ""} in this PO didn't match any fabric template — human review required before production planning
            </p>
          </div>
          <Link to="/SKUReviewQueue">
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white text-xs gap-1.5 shrink-0">
              <AlertTriangle className="h-3.5 w-3.5"/> Review SKUs
            </Button>
          </Link>
        </div>
      )}

      {/* PO Info */}
      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
            <InfoRow label="Customer" value={po.customer_name} />
            <InfoRow label="PI Number" value={po.pi_number} />
            <InfoRow label="PI Date" value={fmt(po.pi_date)} />
            <InfoRow label="Order Date" value={fmt(po.order_date)} />
            <InfoRow label="Ex-Factory" value={fmt(po.ex_factory_date)} />
            <InfoRow label="ETD" value={fmt(po.etd)} />
            <InfoRow label="ETA" value={fmt(po.eta)} />
            <InfoRow label="Delivery Date" value={fmt(po.delivery_date)} />
            <InfoRow label="Port of Loading" value={po.port_of_loading} />
            <InfoRow label="Port of Destination" value={po.port_of_destination} />
            {po.country_of_origin && <InfoRow label="Country of Origin" value={po.country_of_origin} />}
            {po.ship_via && <InfoRow label="Ship Via" value={po.ship_via} />}
            {po.ship_to_name && <InfoRow label="Ship To" value={po.ship_to_name} />}
            {po.ship_to_address && <InfoRow label="Ship To Address" value={po.ship_to_address} />}
            <InfoRow label="Payment Terms" value={po.payment_terms} />
            <InfoRow label="Source" value={po.source} />
          </div>
        </CardContent>
      </Card>

      {/* Value Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Value</p>
          <p className="text-xl font-bold mt-1">{po.currency} {totalItemValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Qty</p>
          <p className="text-xl font-bold mt-1">{totalItemQty.toLocaleString()} pcs</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total CBM</p>
          <p className="text-xl font-bold mt-1">{totalCBM.toFixed(2)}</p>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold">Line Items ({items.length})</CardTitle>
          {canEditItems && (
            <div className="flex gap-2">
              <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={handleCSVUpload}/>
              <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => {
                const csv = "item_code,quantity,item_description,fabric_type,gsm,color,unit,unit_price,cbm,pieces_per_carton,delivery_date\nGPMP33-WHT-S,240,Polo Shirt White Small,Pique Cotton,180,White,Pieces,4.25,0.045,12,2025-06-15";
                const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], {type:"text/csv"})), download: "MerQuant_Template_po_items.csv" });
                a.click();
              }}>
                <Download className="h-3.5 w-3.5"/> Template
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => csvRef.current?.click()}>
                <Upload className="h-3.5 w-3.5"/> CSV
              </Button>
              <Button size="sm" onClick={() => { setEditingItem(null); setShowItemForm(true); }}>
                <Plus className="h-4 w-4 mr-1.5" /> Add Item
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {itemsLoading ? <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10" />)}</div> : items.length === 0 ? (
            <div className="text-center py-10">
              <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No items yet. Add line items to this PO.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Item Code</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Fabric</TableHead>
                    <TableHead className="text-xs hidden md:table-cell">GSM</TableHead>
                    <TableHead className="text-xs">Qty</TableHead>
                    <TableHead className="text-xs">Unit Price</TableHead>
                    <TableHead className="text-xs">Total</TableHead>
                    <TableHead className="text-xs hidden lg:table-cell">CBM</TableHead>
                    <TableHead className="text-xs">Price</TableHead>
                    <TableHead className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => (
                    <TableRow key={item.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-medium">{item.item_code || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[160px] truncate">{item.item_description || "—"}</TableCell>
                      <TableCell className="text-xs hidden sm:table-cell text-muted-foreground">{item.fabric_type || "—"}</TableCell>
                      <TableCell className="text-xs hidden md:table-cell text-muted-foreground">{item.gsm || "—"}</TableCell>
                      <TableCell className="text-xs">{item.quantity?.toLocaleString()}</TableCell>
                      <TableCell className="text-xs">
                        {canPriceOverride
                          ? <PriceOverrideCell item={item} poId={poId} />
                          : <>{po.currency} {Number(item.unit_price).toFixed(4)}</>
                        }
                      </TableCell>
                      <TableCell className="text-xs font-medium">{po.currency} {Number(item.total_price || item.total_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-xs hidden lg:table-cell">{item.cbm?.toFixed(2) || "—"}</TableCell>
                      <TableCell><StatusBadge status={item.price_status} /></TableCell>
                      <TableCell>
                        {canEditItems && (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingItem(item); setShowItemForm(true); }}>
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeleteItem(item.id)}>
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {po.notes && (
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Notes</p>
          <p className="text-sm text-foreground">{po.notes}</p>
        </Card>
      )}

      {/* Shipment Batch Manager */}
      <Tabs defaultValue="shipments" className="w-full">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="shipments" className="text-xs">Shipments</TabsTrigger>
          <TabsTrigger value="pricing" className="text-xs">Pricing & CBM</TabsTrigger>
          <TabsTrigger value="payments" className="text-xs">Payments</TabsTrigger>
          <TabsTrigger value="changes" className="text-xs">Change Log</TabsTrigger>
        </TabsList>
        <TabsContent value="shipments" className="mt-3">
          <POBatches po={po} poItems={items} />
        </TabsContent>
        <TabsContent value="pricing" className="mt-3 space-y-4">
          <PriceVerification poId={poId} items={items} onEditItem={(item) => { setEditingItem(item); setShowItemForm(true); }} />
          <CBMSummary items={items} />
        </TabsContent>
        <TabsContent value="payments" className="mt-3">
          <PaymentSchedulePanel po={po} onPoUpdate={(updated) => qc.setQueryData(["po", poId], updated)} />
        </TabsContent>
        <TabsContent value="changes" className="mt-3">
          <POChangeLog poId={poId} poNumber={po.po_number} />
        </TabsContent>
      </Tabs>

      <POFormDialog open={showEditPO} onOpenChange={setShowEditPO} onSave={handleEditPO} initialData={po} />
      <POItemFormDialog open={showItemForm} onOpenChange={v => { setShowItemForm(v); if (!v) setEditingItem(null); }} onSave={handleSaveItem} initialData={editingItem} />
    </div>
  );
}

