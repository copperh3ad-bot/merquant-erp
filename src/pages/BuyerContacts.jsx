import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buyerContacts } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Plus, Pencil, Trash2, Search, Mail, Phone, MessageCircle, Star } from "lucide-react";
import EmptyState from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const TITLES = ["Buyer","Senior Buyer","Head of Buying","Merchandiser","Senior Merchandiser","Sourcing Manager","QC Manager","Technical Manager","Account Manager","Other"];

function ContactForm({ open, onOpenChange, onSave, initialData }) {
  const empty = { customer_name:"", full_name:"", title:"Buyer", department:"Buying", email:"", phone:"", whatsapp:"", country:"", city:"", is_primary:false, notes:"" };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const u = (k,v)=>setForm(p=>({...p,[k]:v}));
  React.useEffect(()=>{ if(open) setForm(initialData?{...empty,...initialData}:empty); },[open,initialData]);
  const handleSave=async()=>{ setSaving(true); try{await onSave(form);}finally{setSaving(false);} };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{initialData?"Edit Contact":"Add Buyer Contact"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Customer / Brand *</Label><Input value={form.customer_name} onChange={e=>u("customer_name",e.target.value)} placeholder="e.g. H&M, Zara"/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Full Name *</Label><Input value={form.full_name} onChange={e=>u("full_name",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Title</Label>
            <Select value={form.title} onValueChange={v=>u("title",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{TITLES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Department</Label><Input value={form.department} onChange={e=>u("department",e.target.value)}/></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={e=>u("email",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e=>u("phone",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">WhatsApp</Label><Input value={form.whatsapp} onChange={e=>u("whatsapp",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">Country</Label><Input value={form.country} onChange={e=>u("country",e.target.value)}/></div>
          <div className="space-y-1.5"><Label className="text-xs">City</Label><Input value={form.city} onChange={e=>u("city",e.target.value)}/></div>
          <label className="col-span-2 flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_primary} onChange={e=>u("is_primary",e.target.checked)} className="w-4 h-4 rounded"/>
            <span className="text-sm">Primary contact for this customer</span>
          </label>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e=>u("notes",e.target.value)} rows={2}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.customer_name||!form.full_name}>{saving?"Saving…":"Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BuyerContacts() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const qc = useQueryClient();
  const { data: contacts=[], isLoading } = useQuery({ queryKey:["buyerContacts"], queryFn:()=>buyerContacts.list() });

  const handleSave = async(data)=>{ if(editing){await buyerContacts.update(editing.id,data);}else{await buyerContacts.create(data);} qc.invalidateQueries({queryKey:["buyerContacts"]}); setShowForm(false); setEditing(null); };
  const handleDelete = async(id)=>{ if(!confirm("Delete?"))return; await buyerContacts.delete(id); qc.invalidateQueries({queryKey:["buyerContacts"]}); };

  const customers = useMemo(()=>[...new Set(contacts.map(c=>c.customer_name))].sort(),[contacts]);
  const filtered = useMemo(()=>contacts.filter(c=>{
    const mc = filterCustomer==="all"||c.customer_name===filterCustomer;
    const mq = !search||c.full_name?.toLowerCase().includes(search.toLowerCase())||c.email?.toLowerCase().includes(search.toLowerCase())||c.customer_name?.toLowerCase().includes(search.toLowerCase());
    return mc&&mq;
  }),[contacts,filterCustomer,search]);

  // Group by customer
  const grouped = useMemo(()=>{
    const g = {};
    filtered.forEach(c=>{ (g[c.customer_name]=g[c.customer_name]||[]).push(c); });
    return Object.entries(g).sort(([a],[b])=>a.localeCompare(b));
  },[filtered]);

  if (isLoading) return <div className="space-y-3">{[1,2].map(i=><Skeleton key={i} className="h-28 rounded-xl"/>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><Users className="h-5 w-5 text-primary"/><h1 className="text-base font-bold">Buyer Contacts</h1><span className="text-xs text-muted-foreground">{contacts.length} contacts across {customers.length} buyers</span></div>
        <Button size="sm" onClick={()=>{setEditing(null);setShowForm(true);}} className="gap-1.5"><Plus className="h-4 w-4"/>Add Contact</Button>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/><Input placeholder="Search name, email…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/></div>
        <Select value={filterCustomer} onValueChange={setFilterCustomer}>
          <SelectTrigger className="w-44 h-9 text-xs"><SelectValue placeholder="All Buyers"/></SelectTrigger>
          <SelectContent><SelectItem value="all">All Buyers</SelectItem>{customers.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {grouped.length===0 ? (
        <EmptyState icon={Users} title="No contacts yet" description="Build your buyer contact directory. Contacts are used across RFQs, Quotations, and Complaints." actionLabel="Add Contact" onAction={()=>setShowForm(true)}/>
      ) : (
        <div className="space-y-4">
          {grouped.map(([customer, cList])=>(
            <div key={customer}>
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">{customer.slice(0,2).toUpperCase()}</div>
                <p className="text-sm font-semibold">{customer}</p>
                <span className="text-xs text-muted-foreground">{cList.length} contact{cList.length!==1?"s":""}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {cList.map(c=>(
                  <Card key={c.id} className={cn("hover:shadow-sm transition-shadow", c.is_primary&&"border-primary/30")}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold">{c.full_name}</p>
                            {c.is_primary&&<Star className="h-3 w-3 text-amber-500 fill-amber-500"/>}
                          </div>
                          <p className="text-xs text-muted-foreground">{c.title}{c.department?` · ${c.department}`:""}</p>
                          <div className="mt-2 space-y-1">
                            {c.email&&<a href={`mailto:${c.email}`} className="flex items-center gap-1.5 text-xs text-primary hover:underline truncate"><Mail className="h-3 w-3 shrink-0"/>{c.email}</a>}
                            {c.phone&&<p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3"/>{c.phone}</p>}
                            {c.whatsapp&&<p className="flex items-center gap-1.5 text-xs text-muted-foreground"><MessageCircle className="h-3 w-3"/>{c.whatsapp}</p>}
                          </div>
                          {(c.city||c.country)&&<p className="text-[10px] text-muted-foreground mt-1.5">{[c.city,c.country].filter(Boolean).join(", ")}</p>}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>{setEditing(c);setShowForm(true);}}><Pencil className="h-3 w-3 text-muted-foreground"/></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>handleDelete(c.id)}><Trash2 className="h-3 w-3 text-muted-foreground"/></Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm&&<ContactForm open={showForm} onOpenChange={v=>{setShowForm(v);if(!v)setEditing(null);}} onSave={handleSave} initialData={editing}/>}
    </div>
  );
}

