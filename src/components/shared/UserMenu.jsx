import React, { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { LogOut, ChevronDown, User, Shield, Crown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_INFO } from "@/lib/permissions";

export default function UserMenu() {
  const { user, profile, role, signOut, isOwner, isManager } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const displayName = profile?.full_name || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const initials = displayName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const roleInfo = ROLE_INFO[role] || ROLE_INFO.Viewer;
  const team = profile?.team?.name;

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
  };

  const RoleIcon = isOwner ? Crown : isManager ? Shield : Lock;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-muted/60 transition-colors text-left"
      >
        <div className={cn(
          "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0",
          roleInfo.badgeColor || "bg-gray-500"
        )}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground truncate">{displayName}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <RoleIcon className="h-2.5 w-2.5 shrink-0 opacity-70" style={{color: "currentColor"}} />
            <span className={cn("text-[10px] font-medium truncate", roleInfo.color.split(" ")[1])}>{role}</span>
            {team && <span className="text-[10px] text-muted-foreground truncate">· {team}</span>}
          </div>
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-semibold text-foreground">{displayName}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{email}</p>
              <div className={cn("inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded border", roleInfo.color)}>
                <RoleIcon className="h-2.5 w-2.5" />
                {role}
              </div>
            </div>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full flex items-center gap-2 px-4 py-3 text-xs text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

