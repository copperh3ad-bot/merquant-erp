import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { db } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Factory, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format, isBefore, addDays } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/shared/StatusBadge";
import StatCard from "@/components/shared/StatCard";

const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yyyy") : "—"; } catch { return "—"; } };

export default function Production() {
  const { data: purchaseOrders = [], isLoading } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => db.purchaseOrders.list("-created_at"),
  });

  const inProduction = purchaseOrders.filter(po => po.status === "In Production");
  const qcPending = purchaseOrders.filter(po => po.status === "QC Inspection");
  const readyToShip = purchaseOrders.filter(po => po.status === "Ready to Ship");

  const now = new Date();
  const urgent = purchaseOrders.filter(po => {
    if (["Delivered","Shipped","Cancelled"].includes(po.status)) return false;
    const d = po.ex_factory_date || po.etd;
    if (!d) return false;
    return isBefore(new Date(d), addDays(now, 14));
  });

  const pipeline = purchaseOrders.filter(po => !["Delivered","Shipped","Cancelled"].includes(po.status));

  if (isLoading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="In Production" value={inProduction.length} icon={Factory} iconBg="bg-orange-100" />
        <StatCard title="QC Inspection" value={qcPending.length} icon={CheckCircle2} iconBg="bg-yellow-100" />
        <StatCard title="Ready to Ship" value={readyToShip.length} icon={CheckCircle2} iconBg="bg-lime-100" />
        <StatCard title="Urgent (14 days)" value={urgent.length} subtitle="Ex-factory / ETD soon" icon={AlertTriangle} iconBg="bg-red-100" />
      </div>

      {urgent.length > 0 && (
        <Card className="border-red-200 bg-red-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" /> Urgent — Departing Within 14 Days
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {urgent.map(po => (
                <Link key={po.id} to={createPageUrl("PODetail") + `?id=${po.id}`}>
                  <div className="p-3 bg-white rounded-lg border border-red-200 hover:border-red-300 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold">{po.po_number}</span>
                      <StatusBadge status={po.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{po.customer_name}</p>
                    <p className="text-[11px] text-red-600 font-medium mt-1">
                      {po.ex_factory_date ? `Ex-Factory: ${fmt(po.ex_factory_date)}` : `ETD: ${fmt(po.etd)}`}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold">Production Pipeline ({pipeline.length} active)</CardTitle>
          <Link to={createPageUrl("PurchaseOrders")} className="text-xs text-primary hover:underline flex items-center gap-1">
            All POs <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="pt-0">
          {pipeline.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No active orders in pipeline</p>
          ) : (
            <div className="space-y-2">
              {pipeline.map(po => (
                <Link key={po.id} to={createPageUrl("PODetail") + `?id=${po.id}`}>
                  <div className="flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/60 rounded-lg transition-colors border border-transparent hover:border-border/50">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Factory className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{po.po_number}</p>
                        <p className="text-xs text-muted-foreground">{po.customer_name} • {po.total_quantity?.toLocaleString() || "—"} pcs</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="hidden sm:block text-right">
                        <p className="text-[11px] text-muted-foreground">Ex-Factory</p>
                        <p className="text-xs font-medium">{fmt(po.ex_factory_date)}</p>
                      </div>
                      <StatusBadge status={po.status} />
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

