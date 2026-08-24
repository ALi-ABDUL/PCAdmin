import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CheckCircle2, DollarSign, Loader2, Percent, ShoppingBag, Sparkles, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard, StatusChip } from "../components/atoms";
import { API } from "../lib/api";
import { fmtDate, fmtDay, moneyCents } from "../lib/format";
import { Products } from "./ProductsList";
import { ProfitCalculator } from "./Store";

export function Dashboard({ navigateTo }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/analytics/overview`); setData(r.data); }
    catch { toast.error("Failed to load analytics"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    toast.loading("Seeding demo data…", { id: "seed" });
    try { await axios.post(`${API}/demo/seed`, null, { params: { reset: true }}); toast.success("Demo data reseeded", { id: "seed" }); await load(); }
    catch { toast.error("Seed failed", { id: "seed" }); }
  };

  if (loading || !data) return <div className="text-slate-500 flex items-center gap-2 py-24 justify-center"><Loader2 className="animate-spin" size={16}/> loading dashboard…</div>;

  const kpis = [
    { label: "Revenue (YTD)",  value: moneyCents(data.ytd.revenue), sub: `${data.ytd.orders} orders`, icon: DollarSign, tone: "primary" },
    { label: "Profit (YTD)",   value: moneyCents(data.ytd.profit),  sub: `${data.ytd.revenue ? ((data.ytd.profit / data.ytd.revenue) * 100).toFixed(1) : 0}% margin`, icon: TrendingUp, tone: "success" },
    { label: "Units sold",     value: (data.ytd.units || 0).toLocaleString("en-AU"), sub: "this year", icon: ShoppingBag, tone: "violet" },
    { label: "Avg order value",value: data.ytd.orders ? moneyCents(data.ytd.revenue / data.ytd.orders) : "—", sub: "YTD", icon: Percent, tone: "pink" },
  ];

  const kpi2 = [
    { label: "Revenue (Month)", value: moneyCents(data.mtd.revenue), sub: `${data.mtd.orders} orders`, delta: "+12.4%" },
    { label: "Revenue (7d)",    value: moneyCents(data.last7.revenue), sub: `${data.last7.orders} orders`, delta: "+4.1%" },
    { label: "Products",        value: data.totals.products, sub: `${data.totals.active_products} active`, delta: null },
    { label: "Low stock",       value: data.totals.low_stock, sub: "≤ 3 in stock", delta: null, danger: data.totals.low_stock > 0 },
  ];

  const catColors = ["#4F46E5", "#EC4899", "#0EA5E9", "#10B981", "#F59E0B"];
  const noOrders = (data.all_time?.orders || 0) === 0;

  return (
    <div className="grid gap-6">
      {noOrders && (
        <div className="card p-5 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="font-display font-bold">No sales data yet</div>
            <div className="text-sm text-slate-500">Seed some realistic demo orders so you can see the dashboard come alive.</div>
          </div>
          <button data-testid="seed-btn" onClick={seed} className="btn btn-primary"><Sparkles size={14}/> Seed demo data</button>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* Secondary row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi2.map((k) => (
          <div key={k.label} className="card p-4">
            <div className="text-xs text-slate-500 font-medium">{k.label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <div className={`font-display text-2xl font-bold ${k.danger ? "text-red-600" : ""}`}>{k.value}</div>
              {k.delta && <span className="chip chip-success">{k.delta}</span>}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Profit calculator */}
      <ProfitCalculator/>

      {/* Revenue chart + category donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="card p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-display font-bold text-lg">Revenue · Last 30 days</div>
              <div className="text-xs text-slate-500">Revenue vs profit</div>
            </div>
            <span className="chip chip-primary">AUD</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4F46E5" stopOpacity={0.35}/><stop offset="100%" stopColor="#4F46E5" stopOpacity={0.03}/></linearGradient>
                  <linearGradient id="prf" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.35}/><stop offset="100%" stopColor="#10B981" stopOpacity={0.02}/></linearGradient>
                </defs>
                <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
                <YAxis tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={44}/>
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
                  labelFormatter={(l) => fmtDay(l)}
                  formatter={(v, name) => [moneyCents(v), name === "revenue" ? "Revenue" : "Profit"]}/>
                <Area type="monotone" dataKey="revenue" stroke="#4F46E5" strokeWidth={2} fill="url(#rev)"/>
                <Area type="monotone" dataKey="profit"  stroke="#10B981" strokeWidth={2} fill="url(#prf)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-display font-bold text-lg">By category</div>
              <div className="text-xs text-slate-500">Revenue split</div>
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.by_category} dataKey="revenue" nameKey="category" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {data.by_category.map((_, i) => <Cell key={i} fill={catColors[i % catColors.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => moneyCents(v)} contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 space-y-2">
            {data.by_category.map((c, i) => (
              <div key={c.category} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: catColors[i % catColors.length] }}/>
                <span className="capitalize text-slate-700 flex-1">{c.category}</span>
                <span className="font-mono text-slate-500">{moneyCents(c.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <StuckOrdersWidget navigateTo={navigateTo}/>

      {/* Top products + recent orders */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card overflow-hidden">
          <div className="p-5 border-b hairline flex items-center justify-between">
            <div>
              <div className="font-display font-bold text-lg">Top products</div>
              <div className="text-xs text-slate-500">By revenue</div>
            </div>
          </div>
          <div className="p-3">
            {data.top_products.length === 0
              ? <div className="text-sm text-slate-500 py-6 text-center">No sales yet.</div>
              : data.top_products.map((p, i) => (
                  <div key={p.product_id} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
                    <div className="w-8 h-8 grid place-items-center rounded-md font-display font-bold text-white" style={{ background: `linear-gradient(135deg, #4F46E5, #EC4899)`, opacity: 1 - i * 0.14 }}>{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-xs text-slate-500">{p.units} units</div>
                    </div>
                    <div className="font-mono text-sm font-bold text-indigo-600">{moneyCents(p.revenue)}</div>
                  </div>
                ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-5 border-b hairline flex items-center justify-between">
            <div>
              <div className="font-display font-bold text-lg">Recent orders</div>
              <div className="text-xs text-slate-500">Latest 8 orders</div>
            </div>
          </div>
          <div className="overflow-x-auto">            <table className="tbl">
              <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>
                {data.recent_orders.length === 0
                  ? <tr><td colSpan={4} className="text-center text-slate-500 py-6">No orders yet</td></tr>
                  : data.recent_orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <div className="text-slate-800 font-medium truncate max-w-[260px]" title={o.product_title}>{o.product_title}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{fmtDate(o.created_at)}</div>
                      </td>
                      <td className="text-slate-700">{o.customer_name}</td>
                      <td className="font-mono font-bold text-indigo-600">{moneyCents(o.total)}</td>
                      <td><StatusChip status={o.status}/></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}



/**
 * Shows every open order that has exceeded its per-status SLA. Refreshes
 * every 60 s so admins spot stuck orders quickly without a page reload.
 */
export function StuckOrdersWidget({ navigateTo }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/orders/stuck`);
      setRows(data.stuck || []);
    } catch (e) {
      setRows([]); // keep the widget silent on error
    }
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [load]);

  const isEmpty = rows && rows.length === 0;

  return (
    <div className="card overflow-hidden" data-testid="stuck-orders-widget">
      <div className="p-5 border-b hairline flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500"/>
          <div>
            <div className="font-display font-bold text-lg">Stuck orders</div>
            <div className="text-xs text-slate-500">Past SLA for their current status · refreshes every minute</div>
          </div>
        </div>
        {rows && rows.length > 0 && (
          <span className="chip !bg-red-50 !text-red-700 !border-red-200 font-mono" data-testid="stuck-orders-count">
            {rows.length} needs attention
          </span>
        )}
      </div>

      {rows === null ? (
        <div className="p-10 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 className="animate-spin" size={14}/> Checking orders…
        </div>
      ) : isEmpty ? (
        <div
          className="p-8 flex items-center justify-center gap-3 bg-emerald-50 text-emerald-700"
          data-testid="stuck-orders-empty"
        >
          <CheckCircle2 size={20}/>
          <div>
            <div className="font-display font-bold">All orders on track</div>
            <div className="text-xs opacity-80">Every open order is within its SLA window.</div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Product</th>
                <th>Status</th>
                <th>Days stuck</th>
                <th className="w-0"/>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 25).map((o) => {
                const over = o.days_stuck - o.sla_days;
                const tone = over >= 7 ? "!bg-red-50 !text-red-700 !border-red-200"
                  : over >= 3 ? "!bg-amber-50 !text-amber-700 !border-amber-200"
                  : "!bg-slate-100 !text-slate-600 !border-slate-200";
                return (
                  <tr key={o.id} data-testid="stuck-order-row">
                    <td>
                      <button
                        onClick={() => navigateTo?.({ tab: "orders", section: "all", filter: { orderId: o.id } })}
                        className="font-mono text-indigo-600 font-bold hover:text-indigo-800 hover:underline"
                        data-testid={`stuck-ref-${o.id}`}
                      >
                        {o.reference || o.id.slice(0, 8)}
                      </button>
                    </td>
                    <td>
                      <div className="text-sm font-medium truncate max-w-[320px]" title={o.product_title}>{o.product_title || "—"}</div>
                      {o.customer_name && (
                        <div className="text-[11px] text-slate-500 truncate">{o.customer_name}</div>
                      )}
                    </td>
                    <td><StatusChip status={o.status}/></td>
                    <td>
                      <span className={`chip ${tone} !text-[11px] font-mono`}>
                        {o.days_stuck} day{o.days_stuck === 1 ? "" : "s"}
                        <span className="opacity-60 ml-1">(SLA {o.sla_days}d)</span>
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => navigateTo?.({ tab: "orders", section: "all", filter: { orderId: o.id } })}
                        className="btn btn-ghost text-xs whitespace-nowrap"
                        data-testid={`stuck-open-${o.id}`}
                      >
                        Open <ArrowRight size={11}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 25 && (
            <div className="p-3 text-center text-xs text-slate-500 border-t hairline">
              Showing 25 of {rows.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
