import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Validation report card shown above the Import button.
 *
 * States:
 *   - Loading / not run: render nothing
 *   - All green: green banner with summary
 *   - Has warnings only: yellow banner, expandable list, import proceeds
 *   - Has errors: red banner, expandable list, import BLOCKED
 *
 * Props:
 *   result: output of validateMasterData() — {errors, warnings, info, stats, ok}
 *   onDismiss: optional callback if the user wants to override a warning
 */
export default function ValidationReport({ result }) {
  const [expandedSections, setExpandedSections] = useState({
    errors: true, // errors open by default (user needs to fix them)
    warnings: false,
    info: false,
  });

  if (!result) return null;

  const { errors = [], warnings = [], info = [], stats = {} } = result;

  const toggle = (key) =>
    setExpandedSections((s) => ({ ...s, [key]: !s[key] }));

  // Group issues by sheet for readable display
  const groupBySheet = (issues) => {
    const g = {};
    issues.forEach((i) => {
      if (!g[i.sheet]) g[i.sheet] = [];
      g[i.sheet].push(i);
    });
    return g;
  };

  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasInfo = info.length > 0;
  const allClean = !hasErrors && !hasWarnings && !hasInfo;

  return (
    <Card
      className={cn(
        "border-2",
        hasErrors
          ? "border-red-300 bg-red-50"
          : hasWarnings
          ? "border-amber-300 bg-amber-50"
          : "border-emerald-300 bg-emerald-50"
      )}
    >
      <CardContent className="pt-4 pb-4 space-y-3">
        {/* Banner */}
        <div className="flex items-start gap-3">
          {hasErrors ? (
            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
          ) : hasWarnings ? (
            <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <div
              className={cn(
                "font-semibold text-sm",
                hasErrors
                  ? "text-red-900"
                  : hasWarnings
                  ? "text-amber-900"
                  : "text-emerald-900"
              )}
            >
              {hasErrors
                ? `${errors.length} error${errors.length > 1 ? "s" : ""} block import`
                : hasWarnings
                ? `${warnings.length} warning${warnings.length > 1 ? "s" : ""} — review before import`
                : "All checks passed"}
            </div>
            <div className="text-xs text-gray-700 mt-0.5">
              {stats.totalRows ?? 0} rows across {stats.totalSheets ?? 0} sheets
              {hasErrors && " · fix errors to enable Import"}
              {!hasErrors && hasWarnings && " · warnings are advisory"}
              {allClean && " · ready to import"}
            </div>
          </div>
        </div>

        {/* Error list */}
        {hasErrors && (
          <IssueSection
            title={`Errors (${errors.length})`}
            severity="error"
            expanded={expandedSections.errors}
            onToggle={() => toggle("errors")}
            grouped={groupBySheet(errors)}
          />
        )}

        {/* Warning list */}
        {hasWarnings && (
          <IssueSection
            title={`Warnings (${warnings.length})`}
            severity="warn"
            expanded={expandedSections.warnings}
            onToggle={() => toggle("warnings")}
            grouped={groupBySheet(warnings)}
          />
        )}

        {/* Info list */}
        {hasInfo && (
          <IssueSection
            title={`Info (${info.length})`}
            severity="info"
            expanded={expandedSections.info}
            onToggle={() => toggle("info")}
            grouped={groupBySheet(info)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function IssueSection({ title, severity, expanded, onToggle, grouped }) {
  const colors = {
    error: "text-red-900 hover:bg-red-100",
    warn: "text-amber-900 hover:bg-amber-100",
    info: "text-gray-800 hover:bg-gray-100",
  };

  return (
    <div className="border-t pt-2 border-gray-200/60">
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold w-full text-left rounded px-1.5 py-1",
          colors[severity]
        )}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        {title}
      </button>
      {expanded && (
        <div className="mt-1 space-y-2 pl-5 pr-1">
          {Object.entries(grouped).map(([sheet, issues]) => (
            <div key={sheet} className="text-xs">
              <div className="font-medium text-gray-700 mb-0.5">{sheet}</div>
              <ul className="space-y-0.5">
                {issues.slice(0, 10).map((iss, idx) => (
                  <li key={idx} className="flex gap-1.5 leading-snug">
                    <span className="text-gray-500 font-mono text-[10px] mt-px flex-shrink-0">
                      row {iss.row}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-900">{iss.message}</div>
                      {iss.suggestion && (
                        <div className="text-gray-500 text-[11px] mt-0.5">
                          → {iss.suggestion}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
                {issues.length > 10 && (
                  <li className="text-gray-500 text-[11px] italic">
                    … and {issues.length - 10} more
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
