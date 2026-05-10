import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db, packingLists } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Package, Plus, Printer, Download, Trash2 } from "lucide-react";
import { format } from "date-fns";
import EmptyState from "@/components/shared/EmptyState";

const fmt = (d) => { try { return d?format(new Date(d),"dd-MMM-yyyy"):"—"; } catch { return "—"; } };

function generateCartons(items, netWtPerPc = 0.3, grossWtPerPc = 0.35) {
  const cartons = [];
  let num = 1;
  items.forEach(item => {
    const ppc = item.pieces_per_carton || 50;
    const total = item.quantity || 0;
    const L = item.carton_length || 60;
    const W = item.carton_width  || 40;
    const H = item.carton_height || 30;
    const cbmPerCarton = +(L * W * H / 1000000).toFixed(4);
    let remaining = total;
    while (remaining > 0) {
      const qty = Math.min(remaining, ppc);
      cartons.push({
        carton_no: num++,
        item_code: item.item_code,
        description: item.item_description,
        color: item.color,
        quantity: qty,
        net_weight: +(qty * netWtPerPc).toFixed(2),
        gross_weight: +(qty * grossWtPerPc).toFixed(2),
        length_cm: L, width_cm: W, height_cm: H,
        cbm: cbmPerCarton,
      });
      remaining -= qty;
    }
  });
  return cartons;
}

export default function PackingListPage() {
  const [searchParams] = useSearchParams();
  const [selectedPoId, setSelectedPoId] = useState(searchParams.get("po_id") || "");
  const [generating, setGenerating] = useState(false);
  const [netWt, setNetWt] = useState("0.30");
  const [grossWt, setGrossWt] = useState("0.35");
  const qc = useQueryClient();

  const { data: pos=[] } = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const activePo = useMemo(()=>selectedPoId?pos.find(p=>p.id===selectedPoId):pos[0],[pos,selectedPoId]);
  const { data: items=[] } = useQuery({ queryKey:["poItems",activePo?.id], queryFn:()=>db.poItems.listByPO(activePo.id), enabled:!!activePo?.id });
  const { data: pls=[] } = useQuery({ queryKey:["packingList",activePo?.id], queryFn:()=>packingLists.listByPO(activePo.id), enabled:!!activePo?.id });

  const activePL = pls[0];
  const cartons = useMemo(() => activePL?.carton_details || [], [activePL]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const generated = generateCartons(items, Number(netWt), Number(grossWt));
      const payload = {
        po_id: activePo.id, po_number: activePo.po_number,
        pl_number: `PL-${activePo.po_number}`,
        total_cartons: generated.length,
        total_net_weight: +generated.reduce((s,c)=>s+c.net_weight,0).toFixed(2),
        total_gross_weight: +generated.reduce((s,c)=>s+c.gross_weight,0).toFixed(2),
        total_cbm: +generated.reduce((s,c)=>s+c.cbm,0).toFixed(4),
        carton_details: generated,
      };
      if (activePL) { await packingLists.update(activePL.id, payload); }
      else { await packingLists.create(payload); }
      qc.invalidateQueries({queryKey:["packingList",activePo?.id]});
    } finally { setGenerating(false); }
  };

  const handleDownload = () => {
    if (!activePL) return;
    const rows = [
      ["PACKING LIST"],
      [`PO Number: ${activePo?.po_number}`, `Customer: ${activePo?.customer_name}`],
      [`ETD: ${fmt(activePo?.etd)}`, `Port: ${activePo?.port_of_loading} → ${activePo?.port_of_destination}`],
      [],
      ["Carton No","Item Code","Description","Color","Qty","Net Wt (kg)","Gross Wt (kg)","L cm","W cm","H cm","CBM"],
      ...cartons.map(c=>[c.carton_no,c.item_code,c.description,c.color||"",c.quantity,c.net_weight,c.gross_weight,c.length_cm,c.width_cm,c.height_cm,c.cbm]),
      [],
      ["TOTAL","","","",cartons.reduce((s,c)=>s+c.quantity,0),activePL.total_net_weight,activePL.total_gross_weight,"","","",activePL.total_cbm],
    ];
    const csv = rows.map(r=>r.map(v=>`"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([csv],{type:"text/csv"})),download:`PackingList_${activePo?.po_number}.csv`});
    a.click();
  };

  return (
    <div className="space-y-4">
      <style>{`@media print { .no-print{display:none!important;} @page{margin:1cm;size:A4;} }`}</style>
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-primary"/>
          <h1 className="text-base font-bold">Packing List Generator</h1>
          <Select value={selectedPoId||activePo?.id||""} onValueChange={setSelectedPoId}>
            <SelectTrigger className="w-60 h-8 text-xs"><SelectValue placeholder="Select PO"/></SelectTrigger>
            <SelectContent>{pos.map(p=><SelectItem key={p.id} value={p.id}>{p.po_number} – {p.customer_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs"><span className="text-muted-foreground">Net kg/pc</span><Input type="number" step="0.01" value={netWt} onChange={e=>setNetWt(e.target.value)} className="w-16 h-7 text-xs"/></div>
          <div className="flex items-center gap-1 text-xs"><span className="text-muted-foreground">Gross kg/pc</span><Input type="number" step="0.01" value={grossWt} onChange={e=>setGrossWt(e.target.value)} className="w-16 h-7 text-xs"/></div>
          <Button size="sm" onClick={handleGenerate} disabled={generating||!items.length}>
            <Plus className="h-4 w-4 mr-1.5"/>{generating?"Generating…":"Generate"}
          </Button>
          {activePL && <>
            <Button size="sm" variant="outline" className="text-xs gap-1" onClick={handleDownload}><Download className="h-3.5 w-3.5"/>CSV</Button>
            <Button size="sm" variant="outline" className="text-xs gap-1" onClick={()=>window.print()}><Printer className="h-3.5 w-3.5"/>Print</Button>
          </>}
        </div>
      </div>

      {!activePL ? (
        <EmptyState icon={Package} title="No packing list yet" description="Select a PO and click Generate to create a packing list from the line items." actionLabel="Generate" onAction={handleGenerate}/>
      ) : (
        <div className="bg-white border border-gray-300 rounded-lg p-6 max-w-4xl mx-auto" style={{fontFamily:"Arial,sans-serif"}}>
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-bold text-[#1F3864]">PACKING LIST</h2>
              <p className="text-sm mt-1">{activePL.pl_number}</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-bold text-[#1F3864]">MerQuant</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
            <div className="border border-gray-300 rounded p-3">
              <p className="font-semibold text-xs uppercase text-gray-500 mb-1">Buyer</p>
              <p className="font-bold">{activePo?.customer_name}</p>
            </div>
            <div className="border border-gray-300 rounded p-3 text-xs">
              <div className="grid grid-cols-2 gap-1">
                <span className="text-gray-500">PO No:</span><span className="font-medium">{activePo?.po_number}</span>
                <span className="text-gray-500">ETD:</span><span>{fmt(activePo?.etd)}</span>
                <span className="text-gray-500">Port Loading:</span><span>{activePo?.port_of_loading||"—"}</span>
                <span className="text-gray-500">Destination:</span><span>{activePo?.port_of_destination||"—"}</span>
              </div>
            </div>
          </div>
          {/* Summary boxes */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[["Total Cartons",activePL.total_cartons],["Total Qty",cartons.reduce((s,c)=>s+c.quantity,0).toLocaleString()],["Net Weight",`${activePL.total_net_weight} kg`],["Gross Weight",`${activePL.total_gross_weight} kg`]].map(([l,v])=>(
              <div key={l} className="border border-gray-300 rounded p-2 text-center">
                <p className="text-xs text-gray-500">{l}</p>
                <p className="font-bold text-sm mt-0.5">{v}</p>
              </div>
            ))}
          </div>
          {/* Carton table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{backgroundColor:"#1F3864",color:"white"}}>
                  {["Ctn #","Item Code","Description","Color","Qty","Net kg","Gross kg","L","W","H","CBM"].map(h=><th key={h} className="border border-gray-400 px-2 py-1.5 text-left whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {cartons.map((c,i)=>(
                  <tr key={i} style={{backgroundColor:i%2===0?"#EBF0FA":"#fff"}}>
                    <td className="border border-gray-300 px-2 py-1 text-center font-medium">{c.carton_no}</td>
                    <td className="border border-gray-300 px-2 py-1">{c.item_code}</td>
                    <td className="border border-gray-300 px-2 py-1">{c.description}</td>
                    <td className="border border-gray-300 px-2 py-1">{c.color||"—"}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{c.quantity}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{c.net_weight}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{c.gross_weight}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{c.length_cm}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{c.width_cm}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{c.height_cm}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{c.cbm}</td>
                  </tr>
                ))}
                <tr style={{backgroundColor:"#1F3864",color:"white",fontWeight:"bold"}}>
                  <td className="border border-gray-400 px-2 py-1.5" colSpan={4}>TOTAL</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-center">{cartons.reduce((s,c)=>s+c.quantity,0)}</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-center">{activePL.total_net_weight}</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-center">{activePL.total_gross_weight}</td>
                  <td colSpan={3} className="border border-gray-400"></td>
                  <td className="border border-gray-400 px-2 py-1.5 text-center">{activePL.total_cbm}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

