import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Ship, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import ShipmentFormDialog from "@/components/shipments/ShipmentFormDialog";

const statuses = ["All","Planned","Booked","Booking Confirmed","Loaded","In Transit","At Port","Customs Clearance","Delivered","Cancelled"];
const fmt = (d) => { try { return d ? format(new Date(d), "dd MMM yy") : "—"; } catch { return "—"; } };

export default function Shipments() {
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [editingShipment, setEditingShipment] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [poFilter, setPoFilter] = useState(searchParams.get("po_id") || "");
  const qc = useQueryClient();

  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ["shipments"],
    queryFn: () => db.shipments.list(),
  });

  const handleSave = async (data) => {
    if (editingShipment) {
      await db.shipments.update(editingShipment.id, data);
    } else {
      await db.shipments.create(data);
    }
    qc.invalidateQueries({ queryKey: ["shipments"] });
    setShowForm(false);
    setEditingShipment(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this shipment?")) return;
    await db.shipments.delete(id);
    qc.invalidateQueries({ queryKey: ["shipments"] });
  };

  const filtered = shipments.filter(s => {
    if (poFilter && s.po_id !== poFilter) return false;
    const ms = !search || s.shipment_number?.toLowerCase().includes(search.toLowerCase()) || s.po_number?.toLowerCase().includes(search.toLowerCase()) || s.carrier?.toLowerCase().includes(search.toLowerCase()) || s.vessel_name?.toLowerCase().includes(search.toLowerCase());
    const st = statusFilter === "All" || s.status === statusFilter;
    return ms && st;
  });

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-1 gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search shipment, PO, vessel…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={() => { setEditingShipment(null); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-2" /> New Shipment
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Ship} title="No Shipments" description="Track your first shipment." actionLabel="Add Shipment" onAction={() => setShowForm(true)} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Shipment</TableHead>
                    <TableHead className="text-xs">PO Number</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Carrier / Vessel</TableHead>
                    <TableHead className="text-xs hidden md:table-cell">Route</TableHead>
                    <TableHead className="text-xs hidden lg:table-cell">ETD</TableHead>
                    <TableHead className="text-xs hidden lg:table-cell">ETA</TableHead>
                    <TableHead className="text-xs hidden xl:table-cell">CBM</TableHead>
                    <TableHead className="text-xs hidden xl:table-cell">Cartons</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(s => (
                    <TableRow key={s.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-lg bg-cyan-50 flex items-center justify-center shrink-0">
                            <Ship className="h-3.5 w-3.5 text-cyan-600" />
                          </div>
                          <span className="text-xs font-medium">{s.shipment_number || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-primary font-medium">{s.po_number || "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <p className="text-xs font-medium">{s.carrier || "—"}</p>
                        {s.vessel_name && <p className="text-[11px] text-muted-foreground">{s.vessel_name}</p>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {(s.port_of_loading || s.port_of_destination) ? (
                          <p className="text-xs text-muted-foreground">{s.port_of_loading} → {s.port_of_destination}</p>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">{fmt(s.etd)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">{fmt(s.eta)}</TableCell>
                      <TableCell className="text-xs hidden xl:table-cell">{s.total_cbm?.toFixed(2) || "—"}</TableCell>
                      <TableCell className="text-xs hidden xl:table-cell">{s.total_cartons || "—"}</TableCell>
                      <TableCell><StatusBadge status={s.status} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingShipment(s); setShowForm(true); }}>
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(s.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <ShipmentFormDialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditingShipment(null); }} onSave={handleSave} initialData={editingShipment} />
    </div>
  );
}

