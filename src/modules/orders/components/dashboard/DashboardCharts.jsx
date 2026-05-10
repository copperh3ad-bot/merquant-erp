import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["hsl(225,65%,40%)","hsl(38,92%,50%)","hsl(160,60%,45%)","hsl(280,55%,50%)","hsl(340,65%,50%)","hsl(200,60%,50%)","hsl(25,80%,55%)","hsl(120,50%,40%)"];

export default function DashboardCharts({ purchaseOrders }) {
  const statusCounts = {};
  purchaseOrders.forEach(po => { statusCounts[po.status] = (statusCounts[po.status] || 0) + 1; });
  const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  const monthlyData = {};
  purchaseOrders.forEach(po => {
    if (po.order_date) {
      const month = new Date(po.order_date).toLocaleDateString("en", { month: "short", year: "2-digit" });
      monthlyData[month] = (monthlyData[month] || 0) + (po.total_po_value || 0);
    }
  });
  const barData = Object.entries(monthlyData).slice(-8).map(([month, value]) => ({ month, value }));

  const customerData = {};
  purchaseOrders.forEach(po => { customerData[po.customer_name] = (customerData[po.customer_name] || 0) + (po.total_po_value || 0); });
  const topCustomers = Object.entries(customerData).sort((a,b) => b[1]-a[1]).slice(0,6).map(([name, value]) => ({ name, value }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Monthly PO Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,13%,91%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220,9%,46%)" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220,9%,46%)" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ borderRadius:"8px", border:"1px solid hsl(220,13%,91%)", fontSize:"12px" }} formatter={v => [`$${v.toLocaleString()}`, "Value"]} />
                <Bar dataKey="value" fill="hsl(225,65%,40%)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Status Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-52 flex items-center">
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} cx="40%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                    {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius:"8px", border:"1px solid hsl(220,13%,91%)", fontSize:"11px" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground text-center w-full">No data yet</p>}
            {statusData.length > 0 && (
              <div className="space-y-1.5 min-w-[100px]">
                {statusData.slice(0,6).map((item, i) => (
                  <div key={item.name} className="flex items-center gap-1.5 text-[10px]">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground truncate">{item.name}</span>
                    <span className="font-medium ml-auto">{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">Top Customers by Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCustomers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,13%,91%)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip contentStyle={{ borderRadius:"8px", border:"1px solid hsl(220,13%,91%)", fontSize:"12px" }} formatter={v => [`$${v.toLocaleString()}`, "Value"]} />
                <Bar dataKey="value" fill="hsl(160,60%,45%)" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

