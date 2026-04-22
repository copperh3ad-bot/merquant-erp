import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, ChevronRight } from "lucide-react";

const steps = [
  "PO Received","Items Entered","Price Verification","Price Approved",
  "CBM Calculated","FWS Prepared","Yarn Planned","Accessories Planned",
  "Packaging Planned","In Production","QC Inspection","Ready to Ship",
  "Shipped","At Port","Delivered",
];

export default function POWorkflowSteps({ currentStatus, onStatusChange }) {
  const currentIndex = steps.indexOf(currentStatus);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-foreground">Workflow Progress</p>
          {currentIndex < steps.length - 1 && (
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => onStatusChange(steps[currentIndex + 1])}>
              Next: {steps[currentIndex + 1]} <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
        <div className="flex items-center overflow-x-auto gap-0 pb-1">
          {steps.map((step, i) => {
            const isCompleted = i < currentIndex;
            const isCurrent = i === currentIndex;
            return (
              <React.Fragment key={step}>
                <button
                  onClick={() => onStatusChange(step)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-all shrink-0",
                    isCompleted && "bg-emerald-100 text-emerald-700",
                    isCurrent && "bg-primary text-primary-foreground shadow-sm",
                    !isCompleted && !isCurrent && "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {isCompleted && <Check className="h-2.5 w-2.5" />}
                  {step}
                </button>
                {i < steps.length - 1 && (
                  <div className={cn("w-3 h-px shrink-0", i < currentIndex ? "bg-emerald-300" : "bg-border")} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

