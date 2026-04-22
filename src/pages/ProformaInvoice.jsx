import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Pencil, Save, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const fmtDisplay = (d) => {
  try { if (!d) return "—"; const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; } catch { return "—"; }
};

function EI({ value, onChange, type = "text", step, placeholder }) {
  return (
    <input type={type} step={step} placeholder={placeholder}
      className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full"
      value={value || ""} onChange={(e) => onChange(e.target.value)} />
  );
}

export default function ProformaInvoice() {
  const [searchParams] = useSearchParams();
  const paramPoId = searchParams.get("po_id");
  const queryClient = useQueryClient();

  const [selectedPoId, setSelectedPoId] = useState(paramPoId || "");
  const [editMode, setEditMode] = useState(false);
  const [editHeader, setEditHeader] = useState({});
  const [editItems, setEditItems] = useState([]);

  const { data: pos = [] } = useQuery({ queryKey: ["purchaseOrders"], queryFn: () => db.purchaseOrders.list("-created_at") });
  const { data: allItems = [] } = useQuery({
    queryKey: ["allPoItems"],
    queryFn: async () => { const { data, error } = await supabase.from("po_items").select("*").limit(2000).order("item_code"); if (error) throw error; return data || []; },
  });

  const po = useMemo(() => selectedPoId ? pos.find((p) => p.id === selectedPoId) : pos[0], [pos, selectedPoId]);
  const items = useMemo(() => allItems.filter((i) => i.po_id === po?.id), [allItems, po]);
  const totalQty   = items.reduce((s, i) => s + (i.quantity || 0), 0);
  const totalValue = items.reduce((s, i) => s + (i.total_price || (i.unit_price || 0) * (i.quantity || 0)), 0);
  const cur = po?.currency || "USD";

  const updatePO   = useMutation({ mutationFn: ({ id, data }) => db.purchaseOrders.update(id, data), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] }) });
  const updateItem = useMutation({
    mutationFn: async ({ id, data }) => { const { error } = await supabase.from("po_items").update(data).eq("id", id); if (error) throw error; },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allPoItems"] }),
  });

  const startEdit = () => {
    setEditHeader({
      pi_number:           po?.pi_number || "",
      pi_date:             po?.pi_date || "",
      cust_po:             po?.po_number || "",
      sales_order_number:  po?.sales_order_number || "",
      ex_factory:          po?.ex_factory_date || "",
      etd:                 po?.etd || "",
      eta:                 po?.eta || "",
      terms:               po?.payment_terms || "NET 60 | FOB Origin",
      ship_via:            po?.ship_via || "Container Direct",
      buyer_name:          po?.customer_name || "",
      buyer_address:       po?.buyer_address || "",
      ship_to_name:        po?.ship_to_name || "",
      ship_to_address:     po?.ship_to_address || "",
      port_loading:        po?.port_of_loading || "Karachi, Pakistan",
      port_discharge:      po?.port_of_destination || "",
      country_origin:      po?.country_of_origin || "Pakistan",
    });
    setEditItems(items.map((i) => ({ ...i })));
    setEditMode(true);
  };

  const saveEdit = async () => {
    await updatePO.mutateAsync({ id: po.id, data: {
      pi_number:           editHeader.pi_number,
      pi_date:             editHeader.pi_date || null,
      ex_factory_date:     editHeader.ex_factory || null,
      etd:                 editHeader.etd || null,
      eta:                 editHeader.eta || null,
      payment_terms:       editHeader.terms,
      ship_via:            editHeader.ship_via,
      buyer_address:       editHeader.buyer_address,
      ship_to_name:        editHeader.ship_to_name,
      ship_to_address:     editHeader.ship_to_address,
      port_of_loading:     editHeader.port_loading,
      port_of_destination: editHeader.port_discharge,
      country_of_origin:   editHeader.country_origin,
      sales_order_number:  editHeader.sales_order_number,
    }});
    for (const item of editItems) {
      const orig = items.find((i) => i.id === item.id);
      if (orig?.quantity !== item.quantity || orig?.unit_price !== item.unit_price || orig?.item_description !== item.item_description) {
        await updateItem.mutateAsync({ id: item.id, data: { quantity: Number(item.quantity), unit_price: Number(item.unit_price), total_price: Number(item.quantity) * Number(item.unit_price), item_description: item.item_description } });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["allPoItems"] });
    setEditMode(false);
  };

  const updateEI = (id, field, value) => setEditItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  const h  = (k) => editHeader[k] ?? "";
  const sH = (k) => (v) => setEditHeader((p) => ({ ...p, [k]: v }));

  const displayItems = editMode ? editItems : items;
  const dispTotal = editMode ? editItems.reduce((s, i) => s + Number(i.quantity||0)*Number(i.unit_price||0), 0) : totalValue;
  const dispQty   = editMode ? editItems.reduce((s, i) => s + Number(i.quantity||0), 0) : totalQty;

  if (!po && pos.length > 0) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-sm text-muted-foreground mb-3">Select a Purchase Order to view the Proforma Invoice</p>
      <select className="text-sm border rounded px-3 py-1.5" onChange={e => setSelectedPoId(e.target.value)} defaultValue="">
        <option value="" disabled>Choose PO…</option>
        {pos.map(p => <option key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</option>)}
      </select>
    </div>
  );

  return (
    <div>
      <style>{`@media print{.print-hidden{display:none!important}@page{margin:1cm;size:A4}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`}</style>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 print-hidden gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/PurchaseOrders"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
          <Select value={selectedPoId || po?.id || ""} onValueChange={setSelectedPoId}>
            <SelectTrigger className="w-60 h-8 text-xs"><SelectValue placeholder="Select PO" /></SelectTrigger>
            <SelectContent>{pos.map((p) => <SelectItem key={p.id} value={p.id}>{p.po_number} — {p.customer_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          {editMode ? (
            <><Button size="sm" variant="outline" onClick={() => setEditMode(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
            <Button size="sm" onClick={saveEdit}><Save className="h-4 w-4 mr-1" />Save</Button></>
          ) : <Button size="sm" variant="outline" onClick={startEdit}><Pencil className="h-4 w-4 mr-1" />Edit</Button>}
          <Button size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print / PDF</Button>
        </div>
      </div>

      {/* PI Document */}
      <div className="bg-white border border-gray-400 print:border-0" style={{ fontFamily: "Arial, sans-serif", fontSize: "11px" }}>

        {/* ── Company Header ───────────────────────────────── */}
        <div className="border-b-2 border-gray-800 px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 border-2 border-gray-700 flex items-center justify-center shrink-0 text-center leading-tight">
                <div><div className="text-[7px] font-black tracking-widest text-gray-800">UNION</div><div className="text-[5px] text-gray-500 tracking-wider">FABRICS</div></div>
              </div>
              <div>
                <div className="font-black text-gray-900 uppercase tracking-tight" style={{ fontSize: "14px" }}>UNION FABRICS (PVT.) LIMITED.</div>
                <div className="text-gray-600 mt-0.5" style={{ fontSize: "10px" }}>E20/B Central Avenue Site, Karachi, PK 75700</div>
                <div className="text-gray-600" style={{ fontSize: "10px" }}>Tel: +92 21 32567881</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-black text-blue-700 uppercase tracking-widest leading-tight" style={{ fontSize: "20px" }}>PROFORMA</div>
              <div className="font-black text-blue-700 uppercase tracking-widest leading-tight" style={{ fontSize: "20px" }}>INVOICE</div>
              <div className="text-gray-500 mt-0.5" style={{ fontSize: "10px" }}>Sales Confirmation</div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4">

          {/* ── PI Info ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 border border-gray-400 mb-3">
            <div className="border-r border-gray-400 p-2">
              <table className="w-full">
                <tbody>
                  {[
                    ["Pro. Invoice #:", editMode ? <EI value={h("pi_number")} onChange={sH("pi_number")} placeholder="PI-2026-001" /> :
                      (po?.pi_number ? <span className="font-semibold text-red-600 italic">{po.pi_number}</span> : <span className="text-red-500 italic">Not set — click Edit</span>)],
                    ["Dated:",         editMode ? <EI value={h("pi_date")} onChange={sH("pi_date")} type="date" /> : (fmtDisplay(po?.pi_date) === "—" ? "—" : fmtDisplay(po?.pi_date))],
                    ["PO #:",          <span className="font-semibold">{po?.po_number}</span>],
                    ["Cust PO #:",     editMode ? <EI value={h("cust_po")} onChange={sH("cust_po")} /> : (po?.po_number || "—")],
                    ["Sales Order #:", editMode ? <EI value={h("sales_order_number")} onChange={sH("sales_order_number")} placeholder="—" /> : (po?.sales_order_number || "—")],
                  ].map(([lbl, val]) => (
                    <tr key={lbl}><td className="font-bold py-0.5 pr-2 text-gray-600 whitespace-nowrap" style={{ width: "120px" }}>{lbl}</td><td className="py-0.5">{val}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-2">
              <table className="w-full">
                <tbody>
                  {[
                    ["Ex-Factory:", editMode ? <EI value={h("ex_factory")} onChange={sH("ex_factory")} type="date" /> : fmtDisplay(po?.ex_factory_date)],
                    ["ETD:",        editMode ? <EI value={h("etd")} onChange={sH("etd")} type="date" />         : fmtDisplay(po?.etd)],
                    ["ETA:",        editMode ? <EI value={h("eta")} onChange={sH("eta")} type="date" />         : fmtDisplay(po?.eta)],
                    ["Terms:",      editMode ? <EI value={h("terms")} onChange={sH("terms")} />                 : (po?.payment_terms || "NET 60 | FOB Origin")],
                    ["Ship Via:",   editMode ? <EI value={h("ship_via")} onChange={sH("ship_via")} />           : (po?.ship_via || "Container Direct")],
                  ].map(([lbl, val]) => (
                    <tr key={lbl}><td className="font-bold py-0.5 pr-2 text-gray-600 whitespace-nowrap" style={{ width: "120px" }}>{lbl}</td><td className="py-0.5">{val}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Addresses ────────────────────────────────────── */}
          <div className="grid grid-cols-2 border border-gray-400 mb-3">
            <div className="border-r border-gray-400 p-2">
              <div className="font-bold text-gray-700 mb-1 uppercase tracking-wide" style={{ fontSize: "10px" }}>Buyer's Name &amp; Address:</div>
              {editMode ? (
                <div className="space-y-1">
                  <EI value={h("buyer_name")} onChange={sH("buyer_name")} placeholder="Buyer / Brand name" />
                  <textarea rows={3} className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full" value={h("buyer_address")} onChange={(e) => sH("buyer_address")(e.target.value)} placeholder="Buyer address" />
                </div>
              ) : (
                <div className="leading-relaxed" style={{ fontSize: "11px" }}>
                  <p className="font-semibold">{po?.customer_name || "—"}</p>
                  {po?.buyer_address && <p className="text-gray-600 whitespace-pre-line mt-0.5">{po.buyer_address}</p>}
                </div>
              )}
            </div>
            <div className="p-2">
              <div className="font-bold text-gray-700 mb-1 uppercase tracking-wide" style={{ fontSize: "10px" }}>Ship to Party Name &amp; Address:</div>
              {editMode ? (
                <div className="space-y-1">
                  <EI value={h("ship_to_name")} onChange={sH("ship_to_name")} placeholder="Ship-to party name" />
                  <textarea rows={3} className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full" value={h("ship_to_address")} onChange={(e) => sH("ship_to_address")(e.target.value)} placeholder="Full shipping address" />
                </div>
              ) : (
                <div className="leading-relaxed" style={{ fontSize: "11px" }}>
                  {po?.ship_to_name
                    ? <><p className="font-bold uppercase">{po.ship_to_name}</p>{po.ship_to_address && <p className="mt-0.5 whitespace-pre-line">{po.ship_to_address}</p>}</>
                    : <span className="text-red-500 italic">Not set — click Edit</span>
                  }
                </div>
              )}
            </div>
          </div>

          {/* ── Ports ────────────────────────────────────────── */}
          <div className="border border-gray-400 mb-3 p-2">
            <div className="flex flex-wrap gap-8" style={{ fontSize: "11px" }}>
              {[
                ["Port of Loading:",    editMode ? <input className="border border-gray-300 rounded px-1 text-xs w-44" value={h("port_loading")} onChange={(e) => sH("port_loading")(e.target.value)} /> : (po?.port_of_loading || "Karachi, Pakistan")],
                ["Port of Discharge:", editMode ? <input className="border border-gray-300 rounded px-1 text-xs w-44" value={h("port_discharge")} onChange={(e) => sH("port_discharge")(e.target.value)} /> : (po?.port_of_destination || "—")],
                ["Country of Origin:", editMode ? <input className="border border-gray-300 rounded px-1 text-xs w-28" value={h("country_origin")} onChange={(e) => sH("country_origin")(e.target.value)} /> : (po?.country_of_origin || "Pakistan")],
              ].map(([lbl, val]) => (
                <div key={lbl}><span className="font-bold text-gray-700">{lbl} </span>{val}</div>
              ))}
            </div>
          </div>

          {/* ── Items Table ───────────────────────────────────── */}
          <table className="w-full border-collapse border border-gray-400 mb-3" style={{ fontSize: "11px" }}>
            <thead>
              <tr className="bg-gray-100">
                {["S#","Item Code","Description","Qty","UOM",`Unit Price\n(${cur})`,`Amount (${cur})`].map((h2, i) => (
                  <th key={i} className="border border-gray-400 px-2 py-1.5 text-left font-bold whitespace-pre-line"
                    style={{ textAlign: i >= 3 ? (i === 3 || i === 4 ? "center" : "right") : "left", width: [32,88,undefined,60,44,100,110][i] }}>{h2}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, idx) => {
                const amount = editMode ? Number(item.quantity||0)*Number(item.unit_price||0) : (item.total_price || (item.unit_price||0)*(item.quantity||0));
                return (
                  <tr key={item.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="border border-gray-300 px-2 py-1 text-center">{idx+1}</td>
                    <td className="border border-gray-300 px-2 py-1 font-semibold">{item.item_code}</td>
                    <td className="border border-gray-300 px-2 py-1">
                      {editMode ? <input className="w-full border border-gray-300 rounded px-1 text-xs" value={item.item_description||""} onChange={(e) => updateEI(item.id,"item_description",e.target.value)} /> : item.item_description}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-center">
                      {editMode ? <input type="number" className="w-16 border border-gray-300 rounded px-1 text-xs text-center" value={item.quantity||""} onChange={(e) => updateEI(item.id,"quantity",e.target.value)} /> : item.quantity?.toLocaleString()}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{item.unit || "EA"}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">
                      {editMode ? <input type="number" step="0.01" className="w-20 border border-gray-300 rounded px-1 text-xs text-right" value={item.unit_price||""} onChange={(e) => updateEI(item.id,"unit_price",e.target.value)} /> : `$${Number(item.unit_price||0).toFixed(2)}`}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-medium">
                      ${amount.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-200 font-bold">
                <td colSpan={3} className="border border-gray-400 px-2 py-1.5 text-right uppercase tracking-wide" style={{ fontSize: "10px" }}>TOTAL</td>
                <td className="border border-gray-400 px-2 py-1.5 text-center">{dispQty.toLocaleString()}</td>
                <td className="border border-gray-400 px-2 py-1.5"></td>
                <td className="border border-gray-400 px-2 py-1.5"></td>
                <td className="border border-gray-400 px-2 py-1.5 text-right">{cur} {dispTotal.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              </tr>
            </tfoot>
          </table>

          {/* ── Total Box ─────────────────────────────────────── */}
          <div className="flex justify-end mb-4">
            <div className="border-2 border-gray-800 px-6 py-2">
              <span className="font-bold uppercase tracking-wide" style={{ fontSize: "11px" }}>Total Invoice Value: </span>
              <span className="font-black text-blue-700 ml-2" style={{ fontSize: "13px" }}>
                {cur} {dispTotal.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
              </span>
            </div>
          </div>

          {/* ── Payment Terms ─────────────────────────────────── */}
          <div className="border border-gray-400 p-2 mb-4" style={{ fontSize: "11px" }}>
            <span className="font-bold">Payment Terms: </span>
            {po?.payment_terms || "NET 60 days from Bill of Lading date"}. Payment to be made in {cur} via TT / Wire Transfer.
          </div>

          {/* ── Signatures ────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-12 mt-10" style={{ fontSize: "11px" }}>
            <div><div className="border-t-2 border-gray-700 pt-2 mt-10"><p className="font-bold">For Union Fabrics (Pvt.) Limited.</p><p className="text-gray-500 mt-0.5">Authorized Signature &amp; Stamp</p></div></div>
            <div><div className="border-t-2 border-gray-700 pt-2 mt-10"><p className="font-bold">For {po?.customer_name || "Buyer"}</p><p className="text-gray-500 mt-0.5">Authorized Signature &amp; Date</p></div></div>
          </div>

        </div>
      </div>
    </div>
  );
}

