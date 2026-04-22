import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";
import StatusBadge from "@/components/shared/StatusBadge";

const safeDate = (d, fmt) => {
  try { const dt = new Date(d); return isNaN(dt) ? "—" : format(dt, fmt); } catch { return "—"; }
};

export default function POInfoHeader({ po }) {
  const fields = [
    { label: "Customer",      value: po.customer_name },
    { label: "Order Date",    value: po.order_date    ? safeDate(po.order_date,    "dd MMM yyyy") : "—" },
    { label: "Delivery Date", value: po.delivery_date ? safeDate(po.delivery_date, "dd MMM yyyy") : "—" },
    { label: "Ex-Factory",    value: po.ex_factory_date ? safeDate(po.ex_factory_date, "dd MMM yyyy") : "—" },
    { label: "ETD / ETA",     value: `${po.etd ? safeDate(po.etd, "dd MMM") : "—"} / ${po.eta ? safeDate(po.eta, "dd MMM") : "—"}` },
    { label: "Value",         value: `${po.currency || ""} ${po.total_po_value?.toLocaleString() || "—"}` },
    { label: "Quantity",      value: po.total_quantity?.toLocaleString() || "—" },
    { label: "CBM",           value: po.total_cbm?.toFixed(2) || "—" },
  ];

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">{po.po_number}</h2>
            <p className="text-sm text-muted-foreground">{po.customer_name}</p>
          </div>
          <StatusBadge status={po.status} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {fields.map((f) => (
            <div key={f.label}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{f.label}</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{f.value}</p>
            </div>
          ))}
        </div>
        {po.ship_to_name && (
          <div className="mt-4 pt-3 border-t border-border">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Ship To</p>
            <p className="text-xs text-foreground font-medium">{po.ship_to_name}</p>
            {po.ship_to_address && <p className="text-xs text-muted-foreground mt-0.5">{po.ship_to_address}</p>}
          </div>
        )}
        {po.notes && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Notes</p>
            <p className="text-xs text-muted-foreground">{po.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

