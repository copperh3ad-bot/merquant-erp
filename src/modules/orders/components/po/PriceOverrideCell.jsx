import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PriceOverrideCell({ item, poId }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(item.quantity || 0);
  const [price, setPrice] = useState(item.unit_price || 0);

  const mutation = useMutation({
    mutationFn: async () => {
      const quantity    = Number(qty) || 0;
      const unit_price  = Number(price) || 0;
      const total_value = +(quantity * unit_price).toFixed(2);
      return db.poItems.update(item.id, {
        quantity,
        unit_price,
        total_price,
        price_status: "Manager Override",
        updated_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["poItems", poId] });
      qc.invalidateQueries({ queryKey: ["po", poId] });
      setEditing(false);
    },
  });

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <div className="text-right">
          <div className="text-xs font-semibold">
            {item.currency || "USD"} {(item.unit_price || 0).toFixed(2)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            × {item.quantity || 0} = {((item.unit_price || 0) * (item.quantity || 0)).toFixed(2)}
          </div>
          {item.price_status === "Manager Override" && (
            <span className="text-[9px] bg-violet-100 text-violet-700 rounded px-1">
              Overridden
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-primary"
          onClick={() => {
            setQty(item.quantity || 0);
            setPrice(item.unit_price || 0);
            setEditing(true);
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 bg-violet-50 rounded-lg px-2 py-1.5 border border-violet-200">
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-8">Qty</span>
          <Input
            type="number"
            value={qty}
            onChange={e => setQty(e.target.value)}
            className="h-6 w-16 text-xs px-1.5"
            min={0}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-8">Price</span>
          <Input
            type="number"
            value={price}
            onChange={e => setPrice(e.target.value)}
            className="h-6 w-20 text-xs px-1.5"
            min={0}
            step={0.01}
          />
        </div>
        <div className="text-[10px] text-violet-600 font-medium text-right">
          = {((Number(qty) || 0) * (Number(price) || 0)).toFixed(2)}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Button
          size="icon"
          className="h-6 w-6 bg-emerald-600 hover:bg-emerald-700"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setEditing(false)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

