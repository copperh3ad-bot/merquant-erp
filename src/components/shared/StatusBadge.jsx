import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusStyles = {
  "PO Received":        "bg-blue-50 text-blue-700 border-blue-200",
  "Items Entered":      "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Price Verification": "bg-amber-50 text-amber-700 border-amber-200",
  "Price Approved":     "bg-emerald-50 text-emerald-700 border-emerald-200",
  "CBM Calculated":     "bg-cyan-50 text-cyan-700 border-cyan-200",
  "FWS Prepared":       "bg-violet-50 text-violet-700 border-violet-200",
  "Yarn Planned":       "bg-purple-50 text-purple-700 border-purple-200",
  "Accessories Planned":"bg-pink-50 text-pink-700 border-pink-200",
  "Packaging Planned":  "bg-rose-50 text-rose-700 border-rose-200",
  "In Production":      "bg-orange-50 text-orange-700 border-orange-200",
  "QC Inspection":      "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Ready to Ship":      "bg-lime-50 text-lime-700 border-lime-200",
  "Shipped":            "bg-teal-50 text-teal-700 border-teal-200",
  "At Port":            "bg-sky-50 text-sky-700 border-sky-200",
  "Delivered":          "bg-green-50 text-green-700 border-green-200",
  "Cancelled":          "bg-red-50 text-red-700 border-red-200",
  "Pending":            "bg-gray-50 text-gray-600 border-gray-200",
  "Matched":            "bg-green-50 text-green-700 border-green-200",
  "Mismatch":           "bg-red-50 text-red-700 border-red-200",
  "Approved":           "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Planned":            "bg-blue-50 text-blue-700 border-blue-200",
  "Booking Confirmed":  "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Loaded":             "bg-violet-50 text-violet-700 border-violet-200",
  "In Transit":         "bg-orange-50 text-orange-700 border-orange-200",
  "Customs Clearance":  "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Active":             "bg-green-50 text-green-700 border-green-200",
  "Inactive":           "bg-gray-50 text-gray-600 border-gray-200",
};

export default function StatusBadge({ status }) {
  return (
    <Badge variant="outline" className={cn("text-xs font-medium px-2.5 py-0.5 border whitespace-nowrap", statusStyles[status] || "bg-gray-50 text-gray-600 border-gray-200")}>
      {status}
    </Badge>
  );
}

