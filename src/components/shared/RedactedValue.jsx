import React from "react";
import { useAuth } from "@/lib/AuthContext";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * RedactedValue — shows children if role can see the field group, otherwise
 * renders a blurred placeholder with a lock icon.
 *
 * Usage:
 *   <RedactedValue group="PO_FINANCIAL">
 *     {formatCurrency(po.total_po_value)}
 *   </RedactedValue>
 *
 * Or pass `placeholder` for custom skeleton width:
 *   <RedactedValue group="COSTING" placeholder="$••••">
 *     {formatCurrency(cost)}
 *   </RedactedValue>
 */
export default function RedactedValue({ group, children, placeholder, className, as: Tag = "span" }) {
  const { canSeeField } = useAuth();

  if (canSeeField(group)) {
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <Tag
      className={cn(
        "inline-flex items-center gap-1 select-none text-muted-foreground/70",
        "bg-muted/40 px-1.5 rounded border border-dashed border-muted-foreground/20",
        "cursor-not-allowed",
        className
      )}
      title="Restricted — you don't have permission to view this field"
    >
      <Lock className="h-2.5 w-2.5 shrink-0 opacity-60" />
      <span className="blur-[3px] tabular-nums">{placeholder || "••••••"}</span>
    </Tag>
  );
}

/**
 * Utility: redact a value inline without the component wrapper.
 * Returns either the raw value or a redacted placeholder string.
 * Useful inside tables where you can't wrap with JSX.
 */
export function redactIfRestricted(value, group, canSeeField, placeholder = "••••••") {
  if (canSeeField(group)) return value;
  return placeholder;
}
