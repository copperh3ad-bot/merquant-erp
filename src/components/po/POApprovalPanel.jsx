import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, Send,
  MessageSquare, User, Calendar, ChevronDown, ChevronUp
} from "lucide-react";

const STATUS_CONFIG = {
  not_submitted: {
    label: "Not Submitted",
    color: "bg-gray-100 text-gray-600 border-gray-200",
    icon: Clock,
    dotColor: "bg-gray-400",
  },
  pending: {
    label: "Pending Approval",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    icon: Clock,
    dotColor: "bg-amber-400 animate-pulse",
  },
  approved: {
    label: "Approved",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
    dotColor: "bg-emerald-500",
  },
  rejected: {
    label: "Rejected",
    color: "bg-red-50 text-red-700 border-red-200",
    icon: XCircle,
    dotColor: "bg-red-500",
  },
  changes_requested: {
    label: "Changes Requested",
    color: "bg-orange-50 text-orange-700 border-orange-200",
    icon: AlertTriangle,
    dotColor: "bg-orange-500",
  },
};

const fmt = (d) => {
  try { return d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
  catch { return "—"; }
};

export default function POApprovalPanel({ po, compact = false }) {
  const { profile, can } = useAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(!compact);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [actionType, setActionType] = useState(null); // "approve" | "reject" | "changes"

  const canApprove = can("PO_APPROVE");
  const canSubmit = can("PO_SUBMIT_APPROVAL");
  const approvalStatus = po.approval_status || "not_submitted";
  const cfg = STATUS_CONFIG[approvalStatus] || STATUS_CONFIG.not_submitted;
  const StatusIcon = cfg.icon;

  const mutation = useMutation({
    mutationFn: async ({ action, notes: n }) => {
      const name = profile?.full_name || profile?.email || "Unknown";
      if (action === "submit")  return db.purchaseOrders.submitForApproval(po.id, name);
      if (action === "approve") return db.purchaseOrders.approve(po.id, name, n);
      if (action === "reject")  return db.purchaseOrders.reject(po.id, name, n);
      if (action === "changes") return db.purchaseOrders.requestChanges(po.id, name, n);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po", po.id] });
      qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      qc.invalidateQueries({ queryKey: ["pendingApprovals"] });
      setShowNotes(false);
      setNotes("");
      setActionType(null);
    },
  });

  const handleAction = (action) => {
    if (action === "submit") { mutation.mutate({ action }); return; }
    if (showNotes && actionType === action) {
      mutation.mutate({ action, notes });
    } else {
      setActionType(action);
      setShowNotes(true);
    }
  };

  return (
    <div className={cn("rounded-xl border", cfg.color, compact ? "p-3" : "p-4")}>
      {/* Header */}
      <div className="flex items-center justify-between cursor-pointer" onClick={() => compact && setExpanded(e => !e)}>
        <div className="flex items-center gap-2.5">
          <div className={cn("h-2 w-2 rounded-full", cfg.dotColor)} />
          <StatusIcon className="h-4 w-4" />
          <span className="text-sm font-semibold">{cfg.label}</span>
          {compact && (
            <span className="text-xs text-muted-foreground ml-1">Approval Status</span>
          )}
        </div>
        {compact && (
          expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Details */}
      {(!compact || expanded) && (
        <div className="mt-3 space-y-3">
          {/* Submission info */}
          {po.approval_requested_by && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" /> Submitted by <strong className="text-foreground">{po.approval_requested_by}</strong>
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> {fmt(po.approval_requested_at)}
              </span>
            </div>
          )}

          {/* Approval info */}
          {po.approved_by && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {approvalStatus === "approved" ? "Approved" : approvalStatus === "rejected" ? "Rejected" : "Reviewed"} by
                <strong className="text-foreground">{po.approved_by}</strong>
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> {fmt(po.approved_at)}
              </span>
            </div>
          )}

          {/* Notes */}
          {po.approval_notes && (
            <div className="flex items-start gap-1.5 text-xs bg-white/60 rounded-lg px-3 py-2 border border-current/10">
              <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <p className="italic">{po.approval_notes}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-1">
            {/* Merchandiser / anyone: Submit for Approval */}
            {canSubmit && (approvalStatus === "not_submitted" || approvalStatus === "rejected" || approvalStatus === "changes_requested") && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5 bg-white/70"
                onClick={() => handleAction("submit")}
                disabled={mutation.isPending}
              >
                <Send className="h-3.5 w-3.5" />
                {approvalStatus === "not_submitted" ? "Submit for Approval" : "Re-submit for Approval"}
              </Button>
            )}

            {/* Manager: Approve / Reject / Request Changes */}
            {canApprove && approvalStatus === "pending" && (
              <>
                <Button
                  size="sm"
                  className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => handleAction("approve")}
                  disabled={mutation.isPending}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50"
                  onClick={() => handleAction("changes")}
                  disabled={mutation.isPending}
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> Request Changes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => handleAction("reject")}
                  disabled={mutation.isPending}
                >
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </Button>
              </>
            )}

            {/* Manager: Re-open already approved PO */}
            {canApprove && approvalStatus === "approved" && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs gap-1.5 text-muted-foreground"
                onClick={() => handleAction("changes")}
                disabled={mutation.isPending}
              >
                <AlertTriangle className="h-3.5 w-3.5" /> Request Changes
              </Button>
            )}
          </div>

          {/* Notes input for approve/reject/changes */}
          {showNotes && (
            <div className="space-y-2 pt-1">
              <Textarea
                placeholder={
                  actionType === "approve" ? "Approval notes (optional)…"
                  : actionType === "reject" ? "Reason for rejection (required)…"
                  : "Describe what changes are needed…"
                }
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="text-xs min-h-[72px] bg-white/80"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="text-xs"
                  onClick={() => mutation.mutate({ action: actionType, notes })}
                  disabled={mutation.isPending || (actionType !== "approve" && !notes.trim())}
                >
                  {mutation.isPending ? "Saving…" : "Confirm"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => { setShowNotes(false); setNotes(""); setActionType(null); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

