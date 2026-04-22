import React from "react";
import { cn } from "@/lib/utils";
import { Check, Minus } from "lucide-react";

// Session 12 - selection checkbox for card-grid lists.
//
// Three placement / state modes:
//   <SelectionCheckbox checked onChange />              standard inline checkbox
//   <SelectionCheckbox corner checked onChange />       absolute top-left of parent card
//   <SelectionCheckbox indeterminate onChange />        partial-selection state
//
// `indeterminate` overrides `checked` visually but the onChange behavior is
// the caller's responsibility (typically: any selection -> clear, no selection
// -> select all).
//
// In corner mode the parent must have position: relative. The button stops
// propagation so clicking the box does not also fire the parent's onClick.

export default function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  corner = false,
  className,
  title,
}) {
  const handleClick = (e) => {
    e.stopPropagation();
    onChange();
  };

  const isFilled = checked || indeterminate;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-checked={indeterminate ? "mixed" : !!checked}
      role="checkbox"
      title={title}
      className={cn(
        "flex items-center justify-center h-5 w-5 rounded border-2 transition-colors shrink-0",
        isFilled
          ? "bg-primary border-primary text-primary-foreground"
          : "bg-background border-border hover:border-primary/60",
        corner && "absolute top-3 left-3 z-10 shadow-sm",
        className
      )}
    >
      {indeterminate
        ? <Minus className="h-3.5 w-3.5" strokeWidth={3} />
        : checked
          ? <Check className="h-3.5 w-3.5" strokeWidth={3} />
          : null}
    </button>
  );
}

