import React from "react";
import { useAuth } from "@/lib/AuthContext";
import { can } from "@/lib/permissions";
import { ShieldOff } from "lucide-react";

// Wrap any UI in <PermissionGate permission="PO_EDIT"> to hide/block it
export default function PermissionGate({ permission, children, fallback, silent = false }) {
  const { role } = useAuth();
  const allowed = can(role, permission);

  if (allowed) return children;
  if (silent) return null;
  if (fallback) return fallback;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border border-border rounded-lg text-xs text-muted-foreground">
      <ShieldOff className="h-3.5 w-3.5 shrink-0" />
      <span>Your role (<strong>{role}</strong>) doesn't have permission for this action.</span>
    </div>
  );
}

// Hook for programmatic permission checks
export function usePermission(permission) {
  const { role } = useAuth();
  return can(role, permission);
}

// Wrap a button — shows it disabled with tooltip if no permission
export function PermissionButton({ permission, children, className, ...props }) {
  const allowed = usePermission(permission);
  if (!allowed) return null;
  return <button className={className} {...props}>{children}</button>;
}

