import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { rbac, customerTeams } from "@/api/supabaseClient";
import { ROLE_INFO, ROLES } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Users, Plus, Pencil, Trash2, Shield, Crown,
  ChevronDown, ChevronRight, Building2, UserCheck,
  Lock, Star, Tag, Search, X, ShoppingBag, Check, XCircle, Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import PermissionGate from "@/components/shared/PermissionGate";
import EmptyState from "@/components/shared/EmptyState";

const ROLE_LIST = ["Owner","Manager","Merchandiser","QC Inspector","Supplier","Viewer"];
const DEPARTMENTS = ["Merchandising","Production","QC","Sourcing","Finance","Management","Other"];
const TEAM_COLORS = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6","#f97316","#84cc16"];

// ── Shared helpers ────────────────────────────────────────────────────────
function RoleBadge({ role, size = "sm" }) {
  const info = ROLE_INFO[role] || ROLE_INFO.Viewer;
  return (
    <span className={cn("font-semibold border rounded-full", info.color,
      size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-3 py-1"
    )}>{role}</span>
  );
}

function Avatar({ name, color, size = "md" }) {
  const initials = (name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0,2);
  return (
    <div className={cn(
      "rounded-full flex items-center justify-center text-white font-bold shrink-0",
      size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-xs"
    )} style={{ backgroundColor: color || "#6366f1" }}>
      {initials}
    </div>
  );
}

function TeamColorDot({ color, size = 3 }) {
  return <div className={`h-${size} w-${size} rounded-full shrink-0`} style={{ backgroundColor: color || "#6366f1" }} />;
}

// ── Team Form ─────────────────────────────────────────────────────────────
function TeamForm({ open, onOpenChange, onSave, initialData, users }) {
  const [form, setForm] = useState({
    name:"", department:"Merchandising", description:"",
    manager_id:"", line_manager_id:"", color:"#6366f1"
  });
  const [saving, setSaving] = useState(false);
  const u = (k,v) => setForm(p=>({...p,[k]:v}));

  React.useEffect(()=>{
    if(open) setForm({
      name:"", department:"Merchandising", description:"",
      manager_id:"", line_manager_id:"", color:"#6366f1",
      ...(initialData || {})
    });
  },[open,initialData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        ...form,
        manager_id: form.manager_id||null,
        line_manager_id: form.line_manager_id||null,
      });
    } finally { setSaving(false); }
  };

  const managers = users.filter(u => ["Owner","Manager"].includes(u.role));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initialData ? "Edit Team" : "New Team"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Team Name *</Label>
              <Input value={form.name} onChange={e=>u("name",e.target.value)} placeholder="e.g. H&M Merchandising Team"/>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <Select value={form.department} onValueChange={v=>u("department",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{DEPARTMENTS.map(d=><SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Team Color</Label>
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg border border-border shrink-0" style={{ backgroundColor: form.color }}/>
                <div className="flex gap-1 flex-wrap">
                  {TEAM_COLORS.map(c => (
                    <button key={c} onClick={()=>u("color",c)}
                      className={cn("h-5 w-5 rounded-full border-2 transition-all", form.color===c?"border-foreground scale-110":"border-transparent")}
                      style={{ backgroundColor: c }}/>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Line Manager — leads the team on the floor day-to-day */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Line Manager <span className="text-muted-foreground font-normal">(leads team day-to-day)</span></Label>
            <Select value={form.line_manager_id || "__none"} onValueChange={v=>u("line_manager_id",v||null)}>
              <SelectTrigger><SelectValue placeholder="Assign line manager…"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Unassigned</SelectItem>
                {users.filter(u=>["Manager","Owner"].includes(u.role)).map(m=>(
                  <SelectItem key={m.id} value={m.id}>
                    <div className="flex items-center gap-2">
                      <span>{m.full_name||m.email||m.id.slice(0,8)}</span>
                      <RoleBadge role={m.role}/>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Senior Manager — strategic oversight */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Senior Manager <span className="text-muted-foreground font-normal">(strategic oversight)</span></Label>
            <Select value={form.manager_id || "__none"} onValueChange={v=>u("manager_id",v||null)}>
              <SelectTrigger><SelectValue placeholder="Assign senior manager…"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Unassigned</SelectItem>
                {managers.map(m=>(
                  <SelectItem key={m.id} value={m.id}>
                    <div className="flex items-center gap-2">
                      <span>{m.full_name||m.email||m.id.slice(0,8)}</span>
                      <RoleBadge role={m.role}/>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea value={form.description||""} onChange={e=>u("description",e.target.value)} rows={2}/>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!form.name}>{saving?"Saving…":"Save Team"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Customer Assignment Dialog ────────────────────────────────────────────
function CustomerAssignDialog({ open, onOpenChange, team, customers, existingAssignments, onAssign }) {
  const [selected, setSelected] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [season, setSeason] = useState("");
  const [saving, setSaving] = useState(false);

  const assigned = new Set(existingAssignments.map(a=>a.customer_name));
  const available = customers.filter(c=>!assigned.has(c));

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try { await onAssign(team.id, selected, isPrimary, season||null); onOpenChange(false); setSelected(""); setIsPrimary(false); setSeason(""); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2">
              <TeamColorDot color={team?.color} size={3}/>
              Assign Customer to {team?.name}
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Customer *</Label>
            {available.length > 0 ? (
              <Select value={selected} onValueChange={v => setSelected(v === "__none" || v === "__all" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select customer…"/></SelectTrigger>
                <SelectContent>
                  {available.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2">All known customers are already assigned to this team.</div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Season (optional)</Label>
            <Input value={season} onChange={e=>setSeason(e.target.value)} placeholder="e.g. SS26 or leave blank for all seasons"/>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isPrimary} onChange={e=>setIsPrimary(e.target.checked)} className="w-4 h-4 rounded"/>
            <div>
              <span className="text-sm font-medium">Primary team</span>
              <p className="text-xs text-muted-foreground">This team leads all work for this customer</p>
            </div>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving||!selected}>{saving?"Saving…":"Assign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Member Edit Dialog ────────────────────────────────────────────────────
function MemberForm({ open, onOpenChange, onSave, member, teams }) {
  const [form, setForm] = useState({ role:"Merchandiser", team_id:"", department:"" });
  const [saving, setSaving] = useState(false);
  const { isOwner } = useAuth();
  const u = (k,v)=>setForm(p=>({...p,[k]:v}));
  React.useEffect(()=>{ if(open&&member) setForm({ role:member.role||"Merchandiser", team_id:member.team_id||"", department:member.department||"" }); },[open,member]);
  const handleSave = async()=>{ setSaving(true); try { await onSave(member.id,{...form,team_id:form.team_id||null}); } finally { setSaving(false); } };
  const availableRoles = isOwner?ROLE_LIST:ROLE_LIST.filter(r=>r!=="Owner");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit Member — {member?.full_name||"User"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <Select value={form.role} onValueChange={v=>u("role",v)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{availableRoles.map(r=><SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
            {ROLE_INFO[form.role] && (
              <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">{ROLE_INFO[form.role].description}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Team</Label>
            <Select value={form.team_id || "__none"} onValueChange={v=>u("team_id",v||null)}>
              <SelectTrigger><SelectValue placeholder="No team"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No team</SelectItem>
                {teams.map(t=>(
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2"><TeamColorDot color={t.color} size={2}/>{t.name}</div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Department</Label>
            <Input value={form.department||""} onChange={e=>u("department",e.target.value)}/>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving?"Saving…":"Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Team Card ─────────────────────────────────────────────────────────────
function TeamCard({ team, members, assignments, customers, onEditTeam, onEditMember, onAssignCustomer, onRemoveAssignment }) {
  const [open, setOpen] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const teamMembers = members.filter(u=>u.team_id===team.id);
  const teamAssignments = assignments.filter(a=>a.team_id===team.id);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Team header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/20 transition-colors">
        <button onClick={()=>setOpen(v=>!v)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          {open?<ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/>:<ChevronRight className="h-4 w-4 text-muted-foreground shrink-0"/>}
          <div className="h-9 w-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ backgroundColor: team.color || "#6366f1" }}>
            {team.name.slice(0,2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-foreground">{team.name}</p>
              <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{team.department}</span>
              <span className="text-[10px] text-muted-foreground">{teamMembers.length} member{teamMembers.length!==1?"s":""}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {team.line_manager && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3"/> Line: {team.line_manager.full_name||"—"}
                </span>
              )}
              {team.manager && team.manager.id !== team.line_manager?.id && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Crown className="h-3 w-3"/> Sr: {team.manager.full_name||"—"}
                </span>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <PermissionGate permission="TEAM_MANAGE" silent>
            <Button size="sm" variant="outline" className="text-xs gap-1 h-7" onClick={()=>setShowAssign(true)}>
              <Plus className="h-3 w-3"/> Customer
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={()=>onEditTeam(team)}>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground"/>
            </Button>
          </PermissionGate>
        </div>
      </div>

      {open && (
        <div className="border-t border-border grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/50">

          {/* Left: Members */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-2">Members ({teamMembers.length})</p>
            {teamMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground px-4 pb-3 italic">No members assigned</p>
            ) : (
              <div className="divide-y divide-border/30">
                {teamMembers.map(member=>{
                  const isLineManager = team.line_manager_id === member.id;
                  const isManager = team.manager_id === member.id;
                  return (
                    <div key={member.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20">
                      <Avatar name={member.full_name} color={team.color} size="sm"/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-foreground">{member.full_name||member.email||"—"}</span>
                          {isLineManager && <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-semibold">LINE MGR</span>}
                          {isManager && !isLineManager && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">SR MGR</span>}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <RoleBadge role={member.role}/>
                          {member.department && <span className="text-[10px] text-muted-foreground">{member.department}</span>}
                        </div>
                      </div>
                      <PermissionGate permission="USER_MANAGE" silent>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={()=>onEditMember(member)}>
                          <Pencil className="h-3 w-3 text-muted-foreground"/>
                        </Button>
                      </PermissionGate>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Customer Assignments */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-2">
              Assigned Customers ({teamAssignments.length})
            </p>
            {teamAssignments.length === 0 ? (
              <p className="text-xs text-muted-foreground px-4 pb-3 italic">No customers assigned yet</p>
            ) : (
              <div className="divide-y divide-border/30">
                {teamAssignments.map(a=>(
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20">
                    <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground">{a.customer_name}</span>
                        {a.is_primary && (
                          <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                            <Star className="h-2.5 w-2.5"/>PRIMARY
                          </span>
                        )}
                      </div>
                      {a.season && <span className="text-[10px] text-muted-foreground">{a.season}</span>}
                    </div>
                    <PermissionGate permission="TEAM_MANAGE" silent>
                      <button onClick={()=>onRemoveAssignment(a.id)} className="text-muted-foreground hover:text-red-500 shrink-0">
                        <X className="h-3.5 w-3.5"/>
                      </button>
                    </PermissionGate>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showAssign && (
        <CustomerAssignDialog
          open={showAssign}
          onOpenChange={setShowAssign}
          team={team}
          customers={customers}
          existingAssignments={teamAssignments}
          onAssign={async (...args)=>{ await onAssignCustomer(...args); }}
        />
      )}
    </div>
  );
}

// ── Customer View ─────────────────────────────────────────────────────────
function CustomerView({ customers, assignments, teams, users }) {
  const [search, setSearch] = useState("");

  const customerMap = useMemo(()=>{
    const map = {};
    customers.forEach(c=>{
      const cAssignments = assignments.filter(a=>a.customer_name===c);
      map[c] = cAssignments.map(a=>({
        ...a,
        team: teams.find(t=>t.id===a.team_id),
      }));
    });
    return map;
  },[customers,assignments,teams]);

  const filtered = Object.entries(customerMap).filter(([name])=>
    !search||name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input placeholder="Search customers…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 text-sm"/>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {search ? "No customers match your search." : "No customer-team assignments yet. Go to the Teams tab and click '+ Customer' on a team."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(([customerName, cAssignments])=>{
            const primaryTeam = cAssignments.find(a=>a.is_primary)?.team;
            const allTeams = cAssignments.map(a=>a.team).filter(Boolean);
            const allMembers = [...new Set(allTeams.flatMap(t=>users.filter(u=>u.team_id===t?.id)))];

            return (
              <div key={customerName} className="border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-card">
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {customerName.slice(0,2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {cAssignments.length} team{cAssignments.length!==1?"s":""} · {allMembers.length} member{allMembers.length!==1?"s":""}
                      {primaryTeam && <span> · Primary: {primaryTeam.name}</span>}
                    </p>
                  </div>
                </div>

                {cAssignments.length > 0 && (
                  <div className="border-t border-border divide-y divide-border/50">
                    {cAssignments.map(a=>{
                      const t = a.team;
                      if (!t) return null;
                      const lineManager = t.line_manager;
                      const tMembers = users.filter(u=>u.team_id===t.id);
                      return (
                        <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                          <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0 mt-0.5"
                            style={{ backgroundColor: t.color||"#6366f1" }}>
                            {t.name.slice(0,2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-foreground">{t.name}</span>
                              {a.is_primary && (
                                <span className="text-[9px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                                  <Star className="h-2.5 w-2.5"/>PRIMARY
                                </span>
                              )}
                              {a.season && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{a.season}</span>}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                              {lineManager && (
                                <span className="flex items-center gap-1">
                                  <Shield className="h-3 w-3 text-violet-500"/>
                                  Line Manager: <span className="font-medium text-foreground">{lineManager.full_name||"—"}</span>
                                </span>
                              )}
                              <span>{tMembers.length} member{tMembers.length!==1?"s":""}</span>
                            </div>
                            {tMembers.length > 0 && (
                              <div className="flex gap-1 mt-1.5">
                                {tMembers.slice(0,6).map(m=>(
                                  <div key={m.id} className="h-6 w-6 rounded-full flex items-center justify-center text-[9px] text-white font-bold border-2 border-background"
                                    style={{ backgroundColor: t.color||"#6366f1" }}>
                                    {(m.full_name||"?").split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2)}
                                  </div>
                                ))}
                                {tMembers.length > 6 && (
                                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[9px] text-muted-foreground border-2 border-background">
                                    +{tMembers.length-6}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
function PendingApprovalTab({ pending, qc }) {
  const [busy, setBusy] = useState({});
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pendingUsers"] });
    qc.invalidateQueries({ queryKey: ["allUsers"] });
  };

  const handleApprove = async (user) => {
    setError("");
    setBusy(p => ({ ...p, [user.id]: "approve" }));
    try {
      await rbac.users.approve(user.id);
      invalidate();
    } catch (err) {
      setError(`Approve failed for ${user.email}: ${err.message}`);
    } finally {
      setBusy(p => ({ ...p, [user.id]: null }));
    }
  };

  const handleReject = async () => {
    if (!rejectingId) return;
    setError("");
    setBusy(p => ({ ...p, [rejectingId]: "reject" }));
    try {
      await rbac.users.reject(rejectingId, rejectReason);
      setRejectingId(null);
      setRejectReason("");
      invalidate();
    } catch (err) {
      setError(`Reject failed: ${err.message}`);
    } finally {
      setBusy(p => ({ ...p, [rejectingId]: null }));
    }
  };

  if (pending.length === 0) {
    return (
      <EmptyState
        icon={UserCheck}
        title="No pending approvals"
        description="New users who sign up will appear here for review."
      />
    );
  }

  const fmt = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      const diff = Date.now() - d.getTime();
      const m = Math.floor(diff / 60000);
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    } catch { return iso; }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
        <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0"/>
        <div>
          <b>{pending.length} user{pending.length !== 1 ? "s" : ""}</b> waiting for approval.
          Once approved, they'll receive a magic-link email and can sign in.
          Rejection is permanent — they'll see a rejection screen and can't sign in again.
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
          <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0"/>{error}
        </div>
      )}

      <Card><CardContent className="p-0">
        {pending.map(user => (
          <div key={user.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/50 last:border-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Avatar name={user.full_name || user.email} color="#f59e0b" size="sm"/>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.full_name || "(no name)"}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {user.email}
                  {user.signup_method && <span className="ml-2 opacity-70">via {user.signup_method}</span>}
                  <span className="ml-2">· requested {fmt(user.requested_at)}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                disabled={!!busy[user.id]}
                onClick={() => { setRejectingId(user.id); setRejectReason(""); }}
              >
                <XCircle className="h-3.5 w-3.5"/> Reject
              </Button>
              <Button
                size="sm"
                className="text-xs gap-1"
                disabled={!!busy[user.id]}
                onClick={() => handleApprove(user)}
              >
                {busy[user.id] === "approve" ? (
                  <><Clock className="h-3.5 w-3.5 animate-pulse"/> Approving…</>
                ) : (
                  <><Check className="h-3.5 w-3.5"/> Approve</>
                )}
              </Button>
            </div>
          </div>
        ))}
      </CardContent></Card>

      {/* Reject confirmation dialog */}
      <Dialog open={!!rejectingId} onOpenChange={v => { if (!v) { setRejectingId(null); setRejectReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject this signup?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              The user will no longer be able to sign in with this account.
              Rejection reason is optional but helps you remember why.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea
                rows={3}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="e.g. Not a team member, personal email domain"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setRejectingId(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50"
              onClick={handleReject}
              disabled={!!busy[rejectingId]}
            >
              {busy[rejectingId] === "reject" ? "Rejecting…" : "Reject User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function UserManagement() {
  const { isOwner, isManager, can } = useAuth();
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [editingMember, setEditingMember] = useState(null);
  const [activeTab, setActiveTab] = useState("teams");
  const qc = useQueryClient();

  const { data: teams=[], isLoading:tLoading } = useQuery({ queryKey:["teams"], queryFn:()=>rbac.teams.list() });
  const { data: users=[] } = useQuery({ queryKey:["allUsers"], queryFn:()=>rbac.users.list() });
  const { data: assignments=[] } = useQuery({ queryKey:["customerTeams"], queryFn:()=>customerTeams.list() });
  const { data: customers=[] } = useQuery({ queryKey:["customerNames"], queryFn:()=>customerTeams.getCustomers() });
  const { data: pending=[] } = useQuery({ queryKey:["pendingUsers"], queryFn:()=>rbac.users.listPending() });

  const handleSaveTeam = async (data) => {
    if (editingTeam) { await rbac.teams.update(editingTeam.id, data); }
    else { await rbac.teams.create(data); }
    qc.invalidateQueries({queryKey:["teams"]});
    setShowTeamForm(false); setEditingTeam(null);
  };

  const handleSaveMember = async (id, data) => {
    await rbac.users.update(id, data);
    qc.invalidateQueries({queryKey:["allUsers"]});
    setShowMemberForm(false); setEditingMember(null);
  };

  const handleAssignCustomer = async (teamId, customerName, isPrimary, season) => {
    await customerTeams.assign(teamId, customerName, isPrimary, season);
    qc.invalidateQueries({queryKey:["customerTeams"]});
  };

  const handleRemoveAssignment = async (id) => {
    if (!confirm("Remove this customer assignment?")) return;
    await customerTeams.remove(id);
    qc.invalidateQueries({queryKey:["customerTeams"]});
  };

  const unassigned = users.filter(u=>!u.team_id);

  const tabs = [
    { id:"pending",   label:"Pending Approval", count:pending.length, highlight: pending.length > 0 },
    { id:"teams",     label:"Teams",          count:teams.length },
    { id:"customers", label:"By Customer",    count:customers.length },
    { id:"members",   label:"All Members",    count:users.length },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-primary"/>
          <h1 className="text-base font-bold">Users & Teams</h1>
        </div>
        {isManager && (
          <Button size="sm" onClick={()=>{setEditingTeam(null);setShowTeamForm(true);}}>
            <Plus className="h-4 w-4 mr-1.5"/> New Team
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Teams",          value:teams.length,                          color:"bg-primary/10 text-primary" },
          { label:"Customers Assigned", value:[...new Set(assignments.map(a=>a.customer_name))].length, color:"bg-violet-50 text-violet-700" },
          { label:"Active Members", value:users.filter(u=>u.is_active!==false).length, color:"bg-emerald-50 text-emerald-700" },
          { label:"Unassigned",     value:unassigned.length,                     color:unassigned.length>0?"bg-amber-50 text-amber-700":"bg-muted/50 text-muted-foreground" },
        ].map(s=>(
          <div key={s.label} className={cn("rounded-xl p-4", s.color)}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs mt-0.5 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)}
            className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors relative",
              activeTab===t.id?"border-primary text-primary":"border-transparent text-muted-foreground hover:text-foreground"
            )}>
            {t.label} <span className={cn("ml-1.5 text-xs", t.highlight ? "text-amber-600 font-bold" : "opacity-70")}>({t.count})</span>
            {t.highlight && activeTab !== t.id && (
              <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-amber-500"/>
            )}
          </button>
        ))}
      </div>

      {/* PENDING APPROVAL TAB */}
      {activeTab==="pending" && (
        <PendingApprovalTab pending={pending} qc={qc}/>
      )}

      {/* TEAMS TAB */}
      {activeTab==="teams" && (
        <div className="space-y-3">
          {tLoading ? (
            <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-32 rounded-xl bg-muted/40 animate-pulse"/>)}</div>
          ) : teams.length === 0 ? (
            <EmptyState icon={Building2} title="No teams yet" description="Create teams and assign customers to them. Each team is led by a Line Manager." actionLabel="Create Team" onAction={()=>setShowTeamForm(true)}/>
          ) : (
            <>
              {teams.map(team=>(
                <TeamCard key={team.id} team={team} members={users} assignments={assignments}
                  customers={customers}
                  onEditTeam={t=>{setEditingTeam(t);setShowTeamForm(true);}}
                  onEditMember={m=>{setEditingMember(m);setShowMemberForm(true);}}
                  onAssignCustomer={handleAssignCustomer}
                  onRemoveAssignment={handleRemoveAssignment}
                />
              ))}
              {unassigned.length > 0 && (
                <div className="border border-dashed border-border rounded-xl overflow-hidden">
                  <p className="text-xs font-semibold text-muted-foreground px-4 py-2.5 bg-muted/30">
                    Unassigned Members ({unassigned.length})
                  </p>
                  <div className="divide-y divide-border/50">
                    {unassigned.map(member=>(
                      <div key={member.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20">
                        <div className="flex items-center gap-3">
                          <Avatar name={member.full_name} color="#94a3b8" size="sm"/>
                          <div>
                            <p className="text-xs font-medium">{member.full_name||member.email||"—"}</p>
                            <RoleBadge role={member.role}/>
                          </div>
                        </div>
                        <PermissionGate permission="USER_MANAGE" silent>
                          <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={()=>{setEditingMember(member);setShowMemberForm(true);}}>
                            <Pencil className="h-3 w-3"/>Assign team
                          </Button>
                        </PermissionGate>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* CUSTOMERS TAB */}
      {activeTab==="customers" && (
        <CustomerView customers={customers} assignments={assignments} teams={teams} users={users}/>
      )}

      {/* ALL MEMBERS TAB */}
      {activeTab==="members" && (
        <div className="space-y-3">
          {ROLE_LIST.map(r=>{
            const rMembers = users.filter(u=>u.role===r);
            if (!rMembers.length) return null;
            return (
              <div key={r}>
                <div className="flex items-center gap-2 mb-2">
                  <RoleBadge role={r} size="md"/>
                  <span className="text-xs text-muted-foreground">{rMembers.length} member{rMembers.length!==1?"s":""}</span>
                </div>
                <Card><CardContent className="p-0">
                  {rMembers.map(member=>{
                    const team = teams.find(t=>t.id===member.team_id);
                    return (
                      <div key={member.id} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/20">
                        <div className="flex items-center gap-3">
                          <Avatar name={member.full_name} color={team?.color||"#94a3b8"} size="sm"/>
                          <div>
                            <p className="text-sm font-medium">{member.full_name||member.email||"—"}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                              {team ? (
                                <><TeamColorDot color={team.color} size={2}/>{team.name}</>
                              ) : <span className="italic">No team</span>}
                              {member.department && <span>· {member.department}</span>}
                            </p>
                          </div>
                        </div>
                        <PermissionGate permission="USER_MANAGE" silent>
                          <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={()=>{setEditingMember(member);setShowMemberForm(true);}}>
                            <Pencil className="h-3 w-3"/>Edit
                          </Button>
                        </PermissionGate>
                      </div>
                    );
                  })}
                </CardContent></Card>
              </div>
            );
          })}
          {users.length===0 && <EmptyState icon={Users} title="No users yet" description="Users appear here after they sign up."/>}
        </div>
      )}

      <TeamForm open={showTeamForm} onOpenChange={v=>{setShowTeamForm(v);if(!v)setEditingTeam(null);}}
        onSave={handleSaveTeam} initialData={editingTeam} users={users}/>
      {editingMember && (
        <MemberForm open={showMemberForm} onOpenChange={v=>{setShowMemberForm(v);if(!v)setEditingMember(null);}}
          onSave={handleSaveMember} member={editingMember} teams={teams}/>
      )}
    </div>
  );
}

