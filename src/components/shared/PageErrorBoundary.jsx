import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[MerQuant] Page crash:", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center max-w-md mx-auto">
          <div className="h-14 w-14 rounded-2xl bg-red-100 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-red-600" />
          </div>
          <h2 className="text-base font-semibold text-foreground mb-1">Page failed to load</h2>
          <p className="text-sm text-muted-foreground mb-2">
            {this.state.error?.message || "An unexpected error occurred on this page."}
          </p>
          <p className="text-xs text-muted-foreground mb-5 font-mono bg-muted/50 rounded px-3 py-2 max-w-full overflow-auto">
            {this.state.error?.stack?.split("\n")[0]}
          </p>
          <Button
            size="sm"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Reload Page
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

