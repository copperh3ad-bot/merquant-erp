import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { can as canCheck, canSeePage as canSeePageCheck, canSeeField as canSeeFieldCheck } from "@/lib/permissions";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  // Tracks the currently-known user ID. Supabase fires onAuthStateChange on
  // tab focus, visibility change, and token refresh — in those cases the
  // session object is newly allocated but represents the SAME user. Re-rendering
  // all consumers of useAuth() in those cases unmounts in-progress forms
  // (uploaders, dialogs, preview states). We compare the user id and only
  // propagate state changes when identity actually changes.
  const sessionUserIdRef = useRef(null);

  const fetchProfile = async (userId) => {
    // Try 3 times with increasing delays — handles race conditions on first load
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data, error } = await supabase
          .from("user_profiles")
          .select("id, email, role, full_name, is_active, team_id, department, approval_status")
          .eq("id", userId)
          .single();

        if (data && !error) {
          setProfile(data);
          return;
        }

        if (error) {
          console.warn(`[MerQuant] fetchProfile attempt ${attempt} failed:`, error.message);
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 500));
        }
      } catch (err) {
        console.warn(`[MerQuant] fetchProfile exception attempt ${attempt}:`, err);
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 500));
      }
    }
    console.error("[MerQuant] fetchProfile failed after 3 attempts. Check Supabase env vars and RLS policies.");
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      sessionUserIdRef.current = session?.user?.id ?? null;
      if (session?.user) fetchProfile(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUserId = session?.user?.id ?? null;
      const prevUserId = sessionUserIdRef.current;

      // Only update state when the authenticated identity actually changes.
      // This prevents cascading re-renders on tab focus / token refresh that
      // would otherwise unmount uploaders and lose in-progress form state.
      if (newUserId === prevUserId) {
        return;
      }

      sessionUserIdRef.current = newUserId;
      setSession(session);

      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signUp = async (email, password, fullName) => {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
    // Notify owner via edge function (runs even if email confirmation pending)
    if (data?.user?.id) {
      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "notify_owner",
            user_id: data.user.id,
            email, full_name: fullName,
            signup_method: "password",
          }),
        });
      } catch (e) { console.warn("notify_owner failed:", e); }
    }
    return data;
  };

  const signOut = async () => { await supabase.auth.signOut(); setProfile(null); };

  const resetPassword = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/LoginPage`,
    });
    if (error) throw error;
  };

  const updateProfile = async (updates) => {
    if (!session?.user?.id) return;
    const { data, error } = await supabase
      .from("user_profiles")
      .update(updates)
      .eq("id", session.user.id)
      .select()
      .single();
    if (error) throw error;
    setProfile(data);
    return data;
  };

  const refreshProfile = () => {
    if (session?.user?.id) fetchProfile(session.user.id);
  };

  const isLoading      = session === undefined;
  const user           = session?.user ?? null;
  const role           = profile?.role ?? "Viewer";
  const team           = profile?.team ?? null;
  const isOwner        = role === "Owner";
  const isManager      = role === "Manager"      || isOwner;
  const isMerchandiser = role === "Merchandiser"  || isManager;
  const isAdmin        = isOwner;
  const isPending      = profile?.approval_status === "pending";
  const isRejected     = profile?.approval_status === "rejected";
  const can            = (permission) => canCheck(role, permission);
  const canSeePage     = (pageName) => canSeePageCheck(role, pageName);
  const canSeeField    = (groupKey) => canSeeFieldCheck(role, groupKey);

  return (
    <AuthContext.Provider value={{
      session, user, profile, role, team,
      isOwner, isManager, isMerchandiser, isAdmin, isPending, isRejected,
      isLoading, can, canSeePage, canSeeField,
      signIn, signUp, signOut, resetPassword, updateProfile, refreshProfile, fetchProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

