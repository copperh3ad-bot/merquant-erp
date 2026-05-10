import React, { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Pencil, Upload } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";

export default function POItemsTable({ items, onAdd, onEdit, onDelete, onCSVUpload }) {
  const csvRef = useRef(null);

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Item-wise Breakdown ({items.length} items)</CardTitle>
        <div className="flex gap-2">
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={onCSVUpload} />
          <Button size="sm" variant="outline" onClick={() => csvRef.current?.click()} title="Bulk-upload items via CSV">
            <Upload className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" onClick={onAdd} className="bg-primary hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">Item Code</TableHead>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Fabric / GSM</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Width</TableHead>
                <TableHead className="text-xs">Qty</TableHead>
                <TableHead className="text-xs">Unit Price</TableHead>
                <TableHead className="text-xs hidden lg:table-cell">CBM</TableHead>
                <TableHead className="text-xs hidden lg:table-cell">Cartons</TableHead>
                <TableHead className="text-xs">Price Check</TableHead>
                <TableHead className="text-xs w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                    No items yet — add manually or upload CSV
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-medium">{item.item_code}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                      {item.item_description || "—"}
                    </TableCell>
                    <TableCell className="text-xs hidden md:table-cell">
                      {item.fabric_type || "—"}{item.gsm ? ` · ${item.gsm}gsm` : ""}
                    </TableCell>
                    <TableCell className="text-xs hidden md:table-cell">{item.width ? `${item.width}"` : "—"}</TableCell>
                    <TableCell className="text-xs">{item.quantity?.toLocaleString()} {item.unit}</TableCell>
                    <TableCell className="text-xs font-medium">{item.unit_price ? `$${item.unit_price}` : "—"}</TableCell>
                    <TableCell className="text-xs hidden lg:table-cell">{item.cbm?.toFixed(4) || "—"}</TableCell>
                    <TableCell className="text-xs hidden lg:table-cell font-medium">
                      {item.pieces_per_carton && item.quantity
                        ? Math.ceil(item.quantity / item.pieces_per_carton)
                        : item.num_cartons || "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.price_status || "Pending"} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(item)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

