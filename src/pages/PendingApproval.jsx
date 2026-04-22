import { useEffect, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, Mail, LogOut } from "lucide-react";

export default function PendingApproval() {
  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data?.user?.email || ""));
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
            <Clock className="h-8 w-8 text-amber-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Approval Pending</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Hi {email}. Your access request has been submitted.
            </p>
          </div>
          <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <Mail className="h-3.5 w-3.5" /> What happens next
            </div>
            <p>• The owner will review your request</p>
            <p>• Once approved, you'll get a login email</p>
            <p>• Use the link in that email to access MerQuant</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs bg-muted hover:bg-muted/80 rounded-md"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign Out
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
