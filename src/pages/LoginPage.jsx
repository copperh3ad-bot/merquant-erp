import React, { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, ArrowLeft, Shield, Crown, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const SIGNUP_ROLES = [
  { value: "Merchandiser",  label: "Merchandiser",  desc: "Upload BOMs, manage fabric specs, track orders" },
  { value: "Manager",       label: "Manager",        desc: "Approve workflows, manage teams" },
  { value: "QC Inspector",  label: "QC Inspector",   desc: "Inspections, lab dips, samples" },
  { value: "Viewer",        label: "Viewer (Read-only)", desc: "View data without editing" },
];

export default function LoginPage() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", fullName: "", confirmPassword: "", role: "Merchandiser" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const u = (k, v) => { setForm(p => ({ ...p, [k]: v })); setError(""); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (mode === "login") {
        await signIn(form.email, form.password);
      } else if (mode === "signup") {
        if (form.password !== form.confirmPassword) { setError("Passwords do not match."); return; }
        if (form.password.length < 6) { setError("Password must be at least 6 characters."); return; }
        if (!form.fullName.trim()) { setError("Full name is required."); return; }
        await signUp(form.email, form.password, form.fullName, form.role);
        setSuccess("Account created! Please check your email to confirm, then sign in.");
        setMode("login");
      } else if (mode === "forgot") {
        await resetPassword(form.email);
        setSuccess("Password reset email sent. Check your inbox.");
      }
    } catch (err) {
      setError(err.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 rounded-2xl bg-primary items-center justify-center mb-4 text-primary-foreground font-black text-2xl tracking-tight select-none">
            MQ
          </div>
          <h1 className="text-2xl font-bold text-white">MerQuant</h1>
          <p className="text-slate-400 text-sm mt-1">Quantitative Merchandising, Powered by AI</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
          {/* Mode tabs */}
          {mode !== "forgot" && (
            <div className="flex gap-1 bg-muted p-1 rounded-lg mb-6">
              {["login","signup"].map(m => (
                <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }}
                  className={cn("flex-1 py-1.5 rounded-md text-sm font-medium transition-all capitalize",
                    mode === m ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {m === "login" ? "Sign In" : "Sign Up"}
                </button>
              ))}
            </div>
          )}

          {mode === "forgot" && (
            <button onClick={() => setMode("login")} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </button>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 mb-4 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2.5 mb-4 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input value={form.fullName} onChange={e => u("fullName", e.target.value)} placeholder="Jane Smith" required />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => u("email", e.target.value)} placeholder="you@company.com" required />
            </div>

            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <Label>Password</Label>
                <div className="relative">
                  <Input type={showPw ? "text" : "password"} value={form.password} onChange={e => u("password", e.target.value)} placeholder="••••••••" required className="pr-10" />
                  <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label>Confirm Password</Label>
                  <Input type="password" value={form.confirmPassword} onChange={e => u("confirmPassword", e.target.value)} placeholder="••••••••" required />
                </div>

                <div className="space-y-1.5">
                  <Label>Your Role</Label>
                  <Select value={form.role} onValueChange={v => u("role", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SIGNUP_ROLES.map(r => (
                        <SelectItem key={r.value} value={r.value}>
                          <div>
                            <span className="font-medium">{r.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">— {r.desc}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">An Owner can change your role after you sign in. Note: Owner role is assigned directly by the system admin.</p>
                </div>
              </>
            )}

            <Button type="submit" className="w-full h-10" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Send Reset Email"}
            </Button>
          </form>

          {mode === "login" && (
            <button onClick={() => { setMode("forgot"); setError(""); }} className="w-full text-center text-xs text-muted-foreground hover:text-foreground mt-4 transition-colors">
              Forgot password?
            </button>
          )}

          {/* Role overview on signup */}
          {mode === "signup" && (
            <div className="mt-5 border border-border rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role overview</p>
              <div className="space-y-1.5">
                {[
                  { icon: Crown, role:"Owner", desc:"Full system access + AI programming", color:"text-red-600" },
                  { icon: Shield, role:"Manager", desc:"Approve workflows + Google Calendar sync", color:"text-violet-600" },
                  { icon: Users, role:"Merchandiser", desc:"Upload BOMs, fabric specs, manage POs", color:"text-blue-600" },
                ].map(r => (
                  <div key={r.role} className="flex items-start gap-2">
                    <r.icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", r.color)} />
                    <div>
                      <span className={cn("text-xs font-medium", r.color)}>{r.role}</span>
                      <span className="text-xs text-muted-foreground"> — {r.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-500 mt-4">MerQuant · Quantitative Merchandising, Powered by AI</p>
      </div>
    </div>
  );
}

