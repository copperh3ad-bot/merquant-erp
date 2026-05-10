import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, techPacks, discrepancies } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Lock, Unlock, Trash2, X, Loader2, RotateCcw, AlertTriangle,
} from "lucide-react";

// Session 12 - bulk actions toolbar for the Tech Packs card grid.
//
// Always shows a summary confirmation modal before committing any action.
// Destructive actions (Delete) use red accent and count-in-button; all others
// use neutral/primary styling. Idempotent actions (Approve, Lock, Unlock,
// Clear Review) skip rows that are already in the target state rather than
// overwriting - the result toast reports "N changed, M skipped".

const fmtList = (items, max = 5) => {
  if (!items.length) return "";
  const visible = items.slice(0, max).map(tp =>
    `${tp.article_code || tp.article_name || "Unnamed"} - ${tp.file_name || ""}`
  );
  const extra = items.length - max;
  return extra > 0
    ? [...visible, `and ${extra} more`]
    : visible;
};

const ACTIONS = {
  delete: {
    key: "delete",
    label: "Delete",
    Icon: Trash2,
    destructive: true,
    verb: "Delete",
    summary: (n) => `Delete ${n} tech pack${n === 1 ? "" : "s"}?`,
    detail: () => "This will also remove any linked cross-check discrepancies. This action cannot be undone.",
    needsNotes: false,
  },
  approve: {
    key: "approve",
    label: "Approve",
    Icon: CheckCircle2,
    destructive: false,
    verb: "Approve",
    summary: (n) => `Approve ${n} tech pack${n === 1 ? "" : "s"}?`,
    detail: (profile) => `Marks each as reviewed by ${profile?.full_name || "you"}. Already-reviewed rows will be left unchanged.`,
    needsNotes: true,
    notesLabel: "Review notes (optional, applied to all selected)",
  },
  clearReview: {
    key: "clearReview",
    label: "Clear Review",
    Icon: RotateCcw,
    destructive: false,
    verb: "Clear review",
    summary: (n) => `Clear review on ${n} tech pack${n === 1 ? "" : "s"}?`,
    detail: () => "Unsets reviewer, reviewed-at timestamp, and review notes. Locked rows are not affected.",
    needsNotes: false,
  },
  lock: {
    key: "lock",
    label: "Lock",
    Icon: Lock,
    destructive: false,
    verb: "Lock",
    summary: (n) => `Lock ${n} tech pack${n === 1 ? "" : "s"}?`,
    detail: () => "Locked tech packs are read-only. Already-locked rows are skipped.",
    needsNotes: true,
    notesLabel: "Lock reason (optional, applied to all selected)",
  },
  unlock: {
    key: "unlock",
    label: "Unlock",
    Icon: Unlock,
    destructive: false,
    verb: "Unlock",
    summary: (n) => `Unlock ${n} tech pack${n === 1 ? "" : "s"}?`,
    detail: () => "Removes the lock and the lock reason. Rows that are not locked are skipped.",
    needsNotes: false,
  },
};

export default function BulkActionsBar({ selection, allItems }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [pendingAction, setPendingAction] = useState(null); // one of ACTIONS or null
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);

  if (selection.size === 0) return null;
  const items = selection.selectedItems;

  const openAction = (actionKey) => {
    setPendingAction(ACTIONS[actionKey]);
    setNotes("");
  };

  const closeModal = () => {
    if (running) return;
    setPendingAction(null);
    setNotes("");
  };

  // Run the selected action. Always batched through Supabase so we can skip
  // already-in-target-state rows and report exact counts.
  const commit = async () => {
    if (!pendingAction) return;
    setRunning(true);
    const ids = Array.from(selection.selectedIds);
    let changed = 0;
    let skipped = 0;
    try {
      if (pendingAction.key === "delete") {
        // Remove discrepancy rows first (no ON DELETE CASCADE in the current schema).
        await supabase.from("discrepancies").delete().in("tech_pack_id", ids);
        const { error } = await supabase
          .from("tech_packs")
          .delete()
          .in("id", ids);
        if (error) throw error;
        changed = ids.length;
      } else if (pendingAction.key === "approve") {
        // Skip rows that already have reviewed_at set.
        const pending = items.filter(tp => !tp.reviewed_at);
        skipped = items.length - pending.length;
        if (pending.length) {
          const { error } = await supabase
            .from("tech_packs")
            .update({
              reviewed_by: profile?.full_name || "User",
              reviewed_at: new Date().toISOString(),
              review_notes: notes.trim() || null,
            })
            .in("id", pending.map(tp => tp.id));
          if (error) throw error;
          changed = pending.length;
        }
      } else if (pendingAction.key === "clearReview") {
        const reviewed = items.filter(tp => tp.reviewed_at || tp.reviewed_by);
        skipped = items.length - reviewed.length;
        if (reviewed.length) {
          const { error } = await supabase
            .from("tech_packs")
            .update({ reviewed_by: null, reviewed_at: null, review_notes: null })
            .in("id", reviewed.map(tp => tp.id));
          if (error) throw error;
          changed = reviewed.length;
        }
      } else if (pendingAction.key === "lock") {
        const unlocked = items.filter(tp => !tp.is_locked);
        skipped = items.length - unlocked.length;
        if (unlocked.length) {
          const { error } = await supabase
            .from("tech_packs")
            .update({
              is_locked: true,
              locked_reason: notes.trim() || null,
              locked_at: new Date().toISOString(),
            })
            .in("id", unlocked.map(tp => tp.id));
          if (error) throw error;
          changed = unlocked.length;
        }
      } else if (pendingAction.key === "unlock") {
        const locked = items.filter(tp => tp.is_locked);
        skipped = items.length - locked.length;
        if (locked.length) {
          const { error } = await supabase
            .from("tech_packs")
            .update({ is_locked: false, locked_reason: null, locked_at: null })
            .in("id", locked.map(tp => tp.id));
          if (error) throw error;
          changed = locked.length;
        }
      }

      // Invalidate the tech packs cache so the grid refreshes.
      qc.invalidateQueries({ queryKey: ["techPacks"] });
      selection.clear();
      setPendingAction(null);
      setNotes("");

      // A simple result line in the console for now; a proper toast system
      // would be the next upgrade.
      const result = skipped > 0
        ? `${pendingAction.verb} complete: ${changed} changed, ${skipped} skipped`
        : `${pendingAction.verb} complete: ${changed} tech pack${changed === 1 ? "" : "s"}`;
      console.info(result);
      if (skipped > 0) {
        alert(result);  // inform user about skipped rows
      }
    } catch (err) {
      console.error("Bulk action failed:", err);
      alert(`${pendingAction.verb} failed: ${err.message || "unknown error"}`);
    } finally {
      setRunning(false);
    }
  };

  const affectedLines = fmtList(items);

  return (
    <>
      {/* Sticky toolbar. Fixed to the bottom of the viewport so it never
          overlaps the card grid content. z-40 keeps it under any open dialogs
          (Radix dialogs use z-50). */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40
                      bg-background border border-border shadow-lg rounded-full
                      px-3 py-2 flex items-center gap-2">
        <span className="text-xs font-semibold px-2 py-1 bg-primary/10 text-primary rounded-full">
          {selection.size} selected
        </span>
        <div className="h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5"
                onClick={() => openAction("approve")}>
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Approve
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5"
                onClick={() => openAction("clearReview")}>
          <RotateCcw className="h-3.5 w-3.5" /> Clear Review
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5"
                onClick={() => openAction("lock")}>
          <Lock className="h-3.5 w-3.5" /> Lock
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5"
                onClick={() => openAction("unlock")}>
          <Unlock className="h-3.5 w-3.5" /> Unlock
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => openAction("delete")}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
        <div className="h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={selection.clear} title="Clear selection">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Confirmation modal. Every action (including non-destructive ones)
          opens this so the user always sees a summary of what will change. */}
      {pendingAction && (
        <Dialog open onOpenChange={closeModal}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                {pendingAction.destructive
                  ? <AlertTriangle className="h-4 w-4 text-red-600" />
                  : <pendingAction.Icon className="h-4 w-4 text-primary" />}
                {pendingAction.summary(selection.size)}
              </DialogTitle>
            </DialogHeader>

            <p className="text-xs text-muted-foreground">
              {pendingAction.detail(profile)}
            </p>

            <div className="border border-border rounded-md max-h-48 overflow-y-auto bg-muted/30 divide-y divide-border">
              {affectedLines.map((line, i) => (
                <div key={i} className={cn(
                  "px-3 py-1.5 text-xs font-mono",
                  typeof line === "string" && line.startsWith("and ")
                    ? "text-muted-foreground italic"
                    : ""
                )}>
                  {line}
                </div>
              ))}
            </div>

            {pendingAction.needsNotes && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{pendingAction.notesLabel}</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder=""
                  rows={2}
                  className="text-xs resize-none"
                  disabled={running}
                />
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" size="sm" onClick={closeModal} disabled={running}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={commit}
                disabled={running}
                className={cn(
                  "gap-1.5",
                  pendingAction.destructive && "bg-red-600 hover:bg-red-700 text-white"
                )}
              >
                {running
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <pendingAction.Icon className="h-3.5 w-3.5" />}
                {running ? `${pendingAction.verb}ing...` : `${pendingAction.verb} ${selection.size} tech pack${selection.size === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
