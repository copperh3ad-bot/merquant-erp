import React, { useState, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, Search, X } from "lucide-react";

/**
 * PO Selector with inline search.
 * Props:
 *  - pos: array of { id, po_number, customer_name }
 *  - value: selected po id (string) OR "__all" OR "__none"
 *  - onChange: (newValue) => void
 *  - allowAll: show "All POs" option (default true)
 *  - allowNone: show "None" option (default false)
 *  - placeholder: trigger placeholder text
 *  - className: trigger button className
 */
export default function POSelector({ pos = [], value, onChange, allowAll = true, allowNone = false, placeholder = "Select PO", className = "w-[220px]" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!q) return pos;
    const t = q.toLowerCase();
    return pos.filter(p =>
      (p.po_number || "").toLowerCase().includes(t) ||
      (p.customer_name || "").toLowerCase().includes(t)
    );
  }, [pos, q]);

  const label = value === "__all" ? "All POs"
    : value === "__none" || !value ? placeholder
    : (pos.find(p => p.id === value)?.po_number || "—") + (pos.find(p => p.id === value)?.customer_name ? ` — ${pos.find(p => p.id === value).customer_name}` : "");

  const pick = (v) => { onChange(v); setOpen(false); setQ(""); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={`justify-between ${className}`}>
          <span className="truncate text-left text-sm">{label}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0"/>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"/>
            <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search PO # or customer…" className="pl-8 pr-7 h-8 text-sm"/>
            {q && <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5"/></button>}
          </div>
        </div>
        <div className="max-h-[280px] overflow-y-auto p-1">
          {allowAll && <button onClick={() => pick("__all")} className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${value === "__all" ? "bg-muted font-medium" : ""}`}>All POs</button>}
          {allowNone && <button onClick={() => pick("__none")} className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${value === "__none" ? "bg-muted font-medium" : ""}`}>— None —</button>}
          {filtered.length === 0 ? <div className="px-2 py-3 text-xs text-muted-foreground text-center">No matches</div>
            : filtered.map(p => (
              <button key={p.id} onClick={() => pick(p.id)} className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${value === p.id ? "bg-muted font-medium" : ""}`}>
                <div className="truncate">{p.po_number}</div>
                <div className="text-xs text-muted-foreground truncate">{p.customer_name || "—"}</div>
              </button>
            ))
          }
        </div>
      </PopoverContent>
    </Popover>
  );
}
