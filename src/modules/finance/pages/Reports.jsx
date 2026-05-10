import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { db, supabase, costing, labDips, samples } from "@/api/supabaseClient";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, DollarSign, Package, Target, Users, Truck, AlertTriangle, BarChart2 } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";

const COLORS = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6","#f97316","#84cc16"];

function SectionTitle({ icon: Icon, title, sub }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-primary"/>
      <div>
        <h2 className="text-sm font-bold">{title}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, color }) {
  return (
    <div className={cn("rounded-xl p-4 border", color || "bg-card border-border")}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Reports() {
  const { data: pos = [] }       = useQuery({ queryKey:["purchaseOrders"], queryFn:()=>db.purchaseOrders.list("-created_at") });
  const { data: shipments = [] } = useQuery({ queryKey:["shipments"],      queryFn:()=>db.shipments.list() });
  const { data: qcList = [] }    = useQuery({ queryKey:["qcInspections"],  queryFn:async()=>{ const{data,error}=await supabase.from("qc_inspections").select("*").limit(500); if(error)throw error; return data||[]; }});
  const { data: payments = [] }  = useQuery({ queryKey:["payments"],       queryFn:async()=>{ const{data,error}=await supabase.from("payments").select("*").limit(500).order("expected_date"); if(error)throw error; return data||[]; }});
  const { data: rfqList = [] }   = useQuery({ queryKey:["rfqs"],           queryFn:async()=>{ const{data}=await supabase.from("rfqs").select("*").limit(200).order("received_date",{ascending:false}); return data||[]; }});
  const { data: complaints = [] }= useQuery({ queryKey:["complaints"],     queryFn:async()=>{ const{data}=await supabase.from("complaints").select("*").limit(200).order("received_date",{ascending:false}); return data||[]; }});
  // Use "allCostingSheets" key — Reports fetches ALL sheets, CostingSheet.jsx fetches per-PO with ["costing", poId]
  const { data: costSheets = [] }= useQuery({ queryKey:["allCostingSheets"], queryFn:async()=>{ const{data,error}=await supabase.from("costing_sheets").select("*").limit(2000); if(error)throw error; return data||[]; }});
  const { data: labDipList = [] }= useQuery({ queryKey:["labDips"],        queryFn:()=>labDips.list() });
  const { data: sampleList = [] }= useQuery({ queryKey:["samples"],        queryFn:()=>samples.list() });

  const kpis = useMemo(()=>{
    const totalValue = pos.reduce((s,p)=>s+(p.total_po_value||0),0);
    const totalQty   = pos.reduce((s,p)=>s+(p.total_quantity||0),0);
    const shippedD   = shipments.filter(s=>s.actual_departure&&s.etd);
    const onTime     = shippedD.filter(s=>new Date(s.actual_departure)<=new Date(s.etd));
    const onTimePct  = shippedD.length>0 ? (onTime.length/shippedD.length)*100 : null;
    const delayed    = shippedD.filter(s=>new Date(s.actual_departure)>new Date(s.etd));
    const avgDelay   = delayed.length>0 ? delayed.reduce((s,sh)=>s+differenceInDays(new Date(sh.actual_departure),new Date(sh.etd)),0)/delayed.length : 0;
    const qcV        = qcList.filter(q=>q.verdict);
    const qcPct      = qcV.length>0 ? (qcV.filter(q=>["Pass","Conditional Pass"].includes(q.verdict)).length/qcV.length)*100 : null;
    const outstanding= payments.filter(p=>["Pending","Overdue"].includes(p.status)).reduce((s,p)=>s+(p.amount||0),0);
    const rfqClosed  = rfqList.filter(r=>["Won","Lost"].includes(r.status));
    const rfqWinRate = rfqClosed.length>0 ? (rfqList.filter(r=>r.status==="Won").length/rfqClosed.length)*100 : null;
    return { totalValue, totalQty, active:pos.filter(p=>!["Delivered","Shipped","Cancelled"].includes(p.status)).length, onTimePct, avgDelay, qcPct, outstanding, rfqWinRate };
  },[pos,shipments,qcList,payments,rfqList]);

  const monthlyTrend = useMemo(()=>{
    const m={};
    pos.forEach(p=>{ if(!p.order_date)return; try{ const mo=format(new Date(p.order_date),"MMM yy"); m[mo]=(m[mo]||{month:mo,value:0,qty:0}); m[mo].value+=(p.total_po_value||0); m[mo].qty+=(p.total_quantity||0); }catch{} });
    return Object.values(m).slice(-12);
  },[pos]);

  const customerRanking = useMemo(()=>{
    const m={};
    pos.forEach(p=>{ if(!m[p.customer_name])m[p.customer_name]={name:p.customer_name,value:0,qty:0,orders:0}; m[p.customer_name].value+=(p.total_po_value||0); m[p.customer_name].qty+=(p.total_quantity||0); m[p.customer_name].orders+=1; });
    return Object.values(m).sort((a,b)=>b.value-a.value).slice(0,8);
  },[pos]);

  const pipelineData = useMemo(()=>{
    const order=["PO Received","Items Entered","Price Approved","FWS Prepared","In Production","QC Inspection","Ready to Ship","Shipped","Delivered"];
    const counts={};
    pos.forEach(p=>{ if(p.status&&p.status!=="Cancelled")counts[p.status]=(counts[p.status]||0)+1; });
    return order.filter(s=>counts[s]).map(s=>({status:s.length>14?s.slice(0,13)+"…":s, count:counts[s]}));
  },[pos]);

  const deliveryPie = useMemo(()=>{
    const d=shipments.filter(s=>s.actual_departure&&s.etd);
    const early=d.filter(s=>differenceInDays(new Date(s.etd),new Date(s.actual_departure))>3).length;
    const onTime=d.filter(s=>{ const diff=differenceInDays(new Date(s.actual_departure),new Date(s.etd)); return diff<=0&&!((differenceInDays(new Date(s.etd),new Date(s.actual_departure)))>3); }).length;
    const late7=d.filter(s=>{ const df=differenceInDays(new Date(s.actual_departure),new Date(s.etd)); return df>0&&df<=7; }).length;
    const late=d.filter(s=>differenceInDays(new Date(s.actual_departure),new Date(s.etd))>7).length;
    return [["Early",early,"#10b981"],["On Time",onTime,"#6366f1"],["Delay ≤7d",late7,"#f59e0b"],["Delay >7d",late,"#ef4444"]].filter(d=>d[1]>0).map(([name,value,fill])=>({name,value,fill}));
  },[shipments]);

  const complaintData = useMemo(()=>{
    const m={};
    complaints.forEach(c=>{ const cat=(c.category||"Other").split("–")[0].trim(); m[cat]=(m[cat]||0)+1; });
    return Object.entries(m).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value).slice(0,8);
  },[complaints]);

  const rfqFunnel = useMemo(()=>[
    {stage:"RFQ Received",count:rfqList.length},
    {stage:"Quoted",count:rfqList.filter(r=>["Sent","Won","Lost"].includes(r.status)).length},
    {stage:"Won",count:rfqList.filter(r=>r.status==="Won").length},
    {stage:"Converted → PO",count:rfqList.filter(r=>r.converted_to_po_id).length},
  ].filter(d=>d.count>0),[rfqList]);

  const marginData = useMemo(()=>{
    const m={};
    costSheets.forEach(c=>{ const p=pos.find(x=>x.id===c.po_id); if(!p)return; const k=p.customer_name; if(!m[k])m[k]={customer:k,total:0,n:0}; m[k].total+=(c.gross_margin_pct||0); m[k].n+=1; });
    return Object.values(m).map(d=>({customer:d.customer,avgMargin:+(d.total/d.n).toFixed(1)})).sort((a,b)=>b.avgMargin-a.avgMargin);
  },[costSheets,pos]);

  const seasonData = useMemo(()=>{
    const m={};
    pos.forEach(p=>{ if(!p.season)return; m[p.season]=(m[p.season]||{season:p.season,value:0,qty:0,orders:0}); m[p.season].value+=(p.total_po_value||0); m[p.season].qty+=(p.total_quantity||0); m[p.season].orders+=1; });
    return Object.values(m).sort((a,b)=>b.value-a.value);
  },[pos]);

  if (pos.length === 0 && shipments.length === 0) return (
    <div className="text-center py-20 text-muted-foreground"><BarChart2 className="h-12 w-12 mx-auto mb-3 opacity-30"/><p className="text-sm font-medium">No data yet</p><p className="text-xs mt-1">Reports populate as you add POs, shipments, and inspections.</p></div>
  );

  return (
    <div className="space-y-7">
      <div className="flex items-center gap-3"><BarChart2 className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Reports & Analytics</h1></div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard label="Total Order Value" value={`$${(kpis.totalValue/1000).toFixed(0)}k`} color="bg-primary/5 border-primary/20"/>
        <KPICard label="Total Units" value={kpis.totalQty.toLocaleString()} color="bg-violet-50 border-violet-200"/>
        <KPICard label="Active POs" value={kpis.active} color="bg-amber-50 border-amber-200"/>
        <KPICard label="On-Time Delivery" value={kpis.onTimePct!=null?`${kpis.onTimePct.toFixed(0)}%`:"—"} sub={kpis.avgDelay>0?`Avg delay ${kpis.avgDelay.toFixed(1)}d`:undefined} color={kpis.onTimePct==null?"bg-muted/30 border-border":kpis.onTimePct>=85?"bg-emerald-50 border-emerald-200":"bg-amber-50 border-amber-200"}/>
        <KPICard label="QC Pass Rate" value={kpis.qcPct!=null?`${kpis.qcPct.toFixed(0)}%`:"—"} color={kpis.qcPct==null?"bg-muted/30 border-border":kpis.qcPct>=90?"bg-emerald-50 border-emerald-200":"bg-amber-50 border-amber-200"}/>
        <KPICard label="RFQ Win Rate" value={kpis.rfqWinRate!=null?`${kpis.rfqWinRate.toFixed(0)}%`:"—"} color="bg-blue-50 border-blue-200"/>
      </div>

      {/* Pipeline + Monthly trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {pipelineData.length > 0 && (
          <div>
            <SectionTitle icon={Target} title="Production Pipeline" sub="Active POs by status"/>
            <Card><CardContent className="pt-4">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={pipelineData} margin={{top:0,right:0,bottom:24,left:-20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="status" tick={{fontSize:9}} angle={-25} textAnchor="end"/>
                  <YAxis tick={{fontSize:10}}/>
                  <Tooltip/>
                  <Bar dataKey="count" radius={[4,4,0,0]}>{pipelineData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent></Card>
          </div>
        )}
        {monthlyTrend.length > 0 && (
          <div>
            <SectionTitle icon={TrendingUp} title="Monthly Order Value" sub="Last 12 months"/>
            <Card><CardContent className="pt-4">
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={monthlyTrend} margin={{top:0,right:0,bottom:0,left:-20}}>
                  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="month" tick={{fontSize:10}}/>
                  <YAxis tick={{fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                  <Tooltip formatter={v=>[`$${Number(v).toLocaleString()}`]}/>
                  <Area type="monotone" dataKey="value" stroke="#6366f1" fill="url(#g)" strokeWidth={2}/>
                </AreaChart>
              </ResponsiveContainer>
            </CardContent></Card>
          </div>
        )}
      </div>

      {/* Customer ranking + Delivery pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {customerRanking.length > 0 && (
          <div>
            <SectionTitle icon={Users} title="Customer Ranking" sub="By total order value"/>
            <Card><CardContent className="p-0">
              {customerRanking.map((c,i)=>{
                const pct = customerRanking[0].value>0?(c.value/customerRanking[0].value)*100:0;
                return (
                  <div key={c.name} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0">
                    <span className="text-xs font-bold text-muted-foreground w-4">{i+1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium truncate">{c.name}</span>
                        <span className="text-xs font-bold ml-2">${(c.value/1000).toFixed(0)}k</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{width:`${pct}%`,backgroundColor:COLORS[i%COLORS.length]}}/>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{c.orders} orders · {c.qty?.toLocaleString()} pcs</p>
                    </div>
                  </div>
                );
              })}
            </CardContent></Card>
          </div>
        )}
        {deliveryPie.length > 0 && (
          <div>
            <SectionTitle icon={Truck} title="Delivery Performance" sub="ETD vs Actual Departure"/>
            <Card><CardContent className="pt-4 flex justify-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={deliveryPie} cx="50%" cy="50%" outerRadius={75} dataKey="value">
                    {deliveryPie.map((d,i)=><Cell key={i} fill={d.fill}/>)}
                  </Pie>
                  <Tooltip/>
                  <Legend iconSize={10} wrapperStyle={{fontSize:"11px"}}/>
                </PieChart>
              </ResponsiveContainer>
            </CardContent></Card>
          </div>
        )}
      </div>

      {/* RFQ Funnel + Margin by customer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {rfqFunnel.length > 0 && (
          <div>
            <SectionTitle icon={Target} title="RFQ Booking Funnel" sub="Enquiry to confirmed order"/>
            <Card><CardContent className="p-0">
              {rfqFunnel.map((stage,i)=>{
                const pct=rfqFunnel[0].count>0?(stage.count/rfqFunnel[0].count)*100:0;
                return (
                  <div key={stage.stage} className="px-4 py-3 border-b border-border/50 last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{stage.stage}</span>
                      <span className="text-sm font-bold">{stage.count}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width:`${pct}%`,backgroundColor:COLORS[i]}}/>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{pct.toFixed(0)}% conversion</p>
                  </div>
                );
              })}
            </CardContent></Card>
          </div>
        )}
        {marginData.length > 0 && (
          <div>
            <SectionTitle icon={DollarSign} title="Avg Margin by Customer" sub="From costing sheets"/>
            <Card><CardContent className="pt-4">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={marginData.slice(0,8)} layout="vertical" margin={{top:0,right:40,bottom:0,left:70}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis type="number" tick={{fontSize:10}} tickFormatter={v=>`${v}%`}/>
                  <YAxis dataKey="customer" type="category" tick={{fontSize:10}} width={70}/>
                  <Tooltip formatter={v=>[`${v}%`]}/>
                  <Bar dataKey="avgMargin" radius={[0,4,4,0]}>{marginData.map((d,i)=><Cell key={i} fill={d.avgMargin>=15?"#10b981":d.avgMargin>=8?"#f59e0b":"#ef4444"}/>)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent></Card>
          </div>
        )}
      </div>

      {/* Complaint categories */}
      {complaintData.length > 0 && (
        <div>
          <SectionTitle icon={AlertTriangle} title="Complaint Categories" sub="All-time breakdown"/>
          <Card><CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={complaintData} layout="vertical" margin={{top:0,right:20,bottom:0,left:100}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis type="number" tick={{fontSize:10}}/>
                <YAxis dataKey="name" type="category" tick={{fontSize:10}} width={100}/>
                <Tooltip/>
                <Bar dataKey="value" radius={[0,4,4,0]}>{complaintData.map((_,i)=><Cell key={i} fill={i===0?"#ef4444":i===1?"#f59e0b":COLORS[i%COLORS.length]}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent></Card>
        </div>
      )}

      {/* Season table */}
      {seasonData.length > 0 && (
        <div>
          <SectionTitle icon={Package} title="Season Breakdown"/>
          <Card><CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-muted/50 border-b">{["Season","Orders","Total Value","Total Qty","Avg/Order"].map(h=><th key={h} className="text-left px-4 py-2.5 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {seasonData.map(s=>(
                    <tr key={s.season} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-semibold">{s.season}</td>
                      <td className="px-4 py-2.5">{s.orders}</td>
                      <td className="px-4 py-2.5 font-bold">${Number(s.value).toLocaleString()}</td>
                      <td className="px-4 py-2.5">{Number(s.qty).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">${s.orders>0?Math.round(s.value/s.orders).toLocaleString():0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        </div>
      )}
    </div>
  );
}

