import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Building2, Pencil, Trash2, Mail, Phone, MapPin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import SupplierFormDialog from "@/components/suppliers/SupplierFormDialog";

export default function Suppliers() {
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => db.suppliers.list(),
  });

  const handleSave = async (data) => {
    if (editingSupplier) {
      await db.suppliers.update(editingSupplier.id, data);
    } else {
      await db.suppliers.create(data);
    }
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    setShowForm(false);
    setEditingSupplier(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this supplier?")) return;
    await db.suppliers.delete(id);
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  const filtered = suppliers.filter(s => !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.city?.toLowerCase().includes(search.toLowerCase()) || s.country?.toLowerCase().includes(search.toLowerCase()));

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search suppliers…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
        </div>
        <Button onClick={() => { setEditingSupplier(null); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-2" /> New Supplier
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Building2} title="No Suppliers" description="Add your first supplier to get started." actionLabel="Add Supplier" onAction={() => setShowForm(true)} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Supplier</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Contact</TableHead>
                    <TableHead className="text-xs hidden md:table-cell">Location</TableHead>
                    <TableHead className="text-xs hidden lg:table-cell">Payment Terms</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(s => (
                    <TableRow key={s.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Building2 className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-foreground">{s.name}</p>
                            {s.contact_person && <p className="text-[11px] text-muted-foreground">{s.contact_person}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="space-y-0.5">
                          {s.email && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{s.email}</div>}
                          {s.phone && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{s.phone}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {(s.city || s.country) && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />{[s.city, s.country].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs hidden lg:table-cell text-muted-foreground">{s.payment_terms || "—"}</TableCell>
                      <TableCell><StatusBadge status={s.status} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingSupplier(s); setShowForm(true); }}>
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

      <SupplierFormDialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditingSupplier(null); }} onSave={handleSave} initialData={editingSupplier} />
    </div>
  );
}

