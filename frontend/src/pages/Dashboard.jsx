import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CheckCircle2, DollarSign, Layers, Loader2, Percent, ShoppingBag, Sparkles, Trophy, TrendingDown, TrendingUp, X } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard, StatusChip } from "../components/atoms";
import { API, proxyImg, imgThumb } from "../lib/api";
import { fmtDate, fmtDay, moneyCents } from "../lib/format";
import { loadDashboardLayout } from "../lib/dashboardLayout";
import { Products } from "./ProductsList";
import { ProfitCalculator } from "./Store";

export function Dashboard({ navigateTo }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Revenue-YTD deep-dive modal
  const [revenueModalOpen, setRevenueModalOpen] = useState(false);
  // Profit-YTD deep-dive modal
  const [profitModalOpen, setProfitModalOpen] = useState(false);
  // Widget-visibility preferences from Settings › Dashboard Layout.
  // Listen for changes so toggling in Settings live-updates the layout.
  const [layout, setLayout] = useState(loadDashboardLayout());
  useEffect(() => {
    const on = (e) => setLayout(e?.detail || loadDashboardLayout());
    window.addEventListener("dashboardlayoutchange", on);
    return () => window.removeEventListener("dashboardlayoutchange", on);
  }, []);

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
    { label: "Revenue (YTD)",  value: moneyCents(data.ytd.revenue), sub: `${data.ytd.orders} orders`, icon: DollarSign, tone: "primary", testId: "kpi-revenue-ytd", onExpand: () => setRevenueModalOpen(true) },
    { label: "Profit (YTD)",   value: moneyCents(data.ytd.profit),  sub: `${data.ytd.revenue ? ((data.ytd.profit / data.ytd.revenue) * 100).toFixed(1) : 0}% margin`, icon: TrendingUp, tone: "success", testId: "kpi-profit-ytd", onExpand: () => setProfitModalOpen(true) },
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
      {layout.kpi_primary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
        </div>
      )}

      {/* Secondary row */}
      {layout.kpi_secondary && (
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
      )}

      {/* Profit calculator */}
      {layout.profit_calc && <ProfitCalculator/>}

      {/* Revenue chart + category donut */}
      {layout.revenue_chart && (
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
      )}

      {layout.stuck_orders && <StuckOrdersWidget navigateTo={navigateTo}/>}

      {/* Top products + recent orders */}
      {layout.top_recent && (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6" data-testid="top-recent-row">        <div className="card overflow-hidden">
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
      )}

      {revenueModalOpen && (
        <RevenueDetailModal onClose={() => setRevenueModalOpen(false)}/>
      )}

      {profitModalOpen && (
        <ProfitDetailModal onClose={() => setProfitModalOpen(false)}/>
      )}
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


/* --------------------------- Revenue detail modal --------------------------
 *
 * Opens when the admin clicks the expand arrow on the Revenue YTD KPI card.
 * Shows monthly revenue bars, top-5 best sellers with product thumbnails,
 * average order value, orders-by-status breakdown, the best month so far
 * this year, and a same-period comparison to last year when data exists.
 *
 * Backend endpoint: `GET /api/analytics/revenue-detail` (aggregates everything
 * server-side so the modal only makes one fetch on open).
 * ------------------------------------------------------------------------- */

export function RevenueDetailModal({ onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API}/analytics/revenue-detail`)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(e => { if (!cancelled) setErr(e?.response?.data?.detail || e.message); });
    return () => { cancelled = true; };
  }, []);

  // Escape closes the modal — matches ImageLightbox / ProductEditModal ergonomics.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      data-testid="revenue-detail-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card max-w-5xl mx-auto my-4 sm:my-10 p-5 sm:p-8"
        role="dialog"
        aria-label="Revenue detail"
      >
        <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-slate-400 mb-1">
              Revenue Detail · {data?.year || new Date().getFullYear()}
            </div>
            <div className="font-display font-bold text-2xl sm:text-3xl tracking-tight">
              {data ? moneyCents(data.total_revenue) : "…"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {data ? `${data.total_orders.toLocaleString("en-AU")} orders · ${moneyCents(data.avg_order_value)} average order value` : "loading…"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost !p-2"
            aria-label="Close"
            data-testid="revenue-detail-close"
          >
            <X size={16}/>
          </button>
        </div>

        {err && (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm">
            Failed to load revenue detail: {err}
          </div>
        )}

        {!data && !err && (
          <div className="py-20 text-center text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={16}/> loading revenue detail…
          </div>
        )}

        {data && (
          <div className="grid gap-6">
            <RevenueHighlightsRow data={data}/>
            <RevenueMonthlyChart data={data}/>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RevenueTopProducts products={data.top_products}/>
              <RevenueStatusBreakdown rows={data.orders_by_status}/>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="btn btn-primary" data-testid="revenue-detail-close-footer">Close</button>
        </div>
      </div>
    </div>
  );
}


function RevenueHighlightsRow({ data }) {
  const best = data.best_month;
  const ly = data.last_year_comparison;
  const up = ly && ly.delta_pct >= 0;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="revenue-highlights">
      <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50/60">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-1">
          <Trophy size={11}/> Best month YTD
        </div>
        {best ? (
          <>
            <div className="font-display font-bold text-lg">{best.month}</div>
            <div className="font-mono text-emerald-700 text-sm">{moneyCents(best.revenue)}</div>
          </>
        ) : (
          <div className="text-sm text-slate-400 italic">No sales yet</div>
        )}
      </div>
      <div className="p-4 rounded-lg border hairline bg-slate-50/60">
        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Avg order value</div>
        <div className="font-display font-bold text-lg">{moneyCents(data.avg_order_value)}</div>
        <div className="text-xs text-slate-500">{data.total_orders.toLocaleString("en-AU")} orders</div>
      </div>
      <div className={`p-4 rounded-lg border ${ly ? (up ? "border-indigo-200 bg-indigo-50/50" : "border-amber-200 bg-amber-50/60") : "hairline bg-slate-50/60"}`}>
        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">
          vs same period last year
        </div>
        {ly ? (
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 chip !text-[11px] ${up ? "chip-primary" : "chip-warning"}`}>
              {up ? <ArrowUp size={11}/> : <ArrowDown size={11}/>}
              {up ? "+" : ""}{ly.delta_pct}%
            </span>
            <span className="font-mono text-xs text-slate-500">{moneyCents(ly.revenue)} · {ly.orders} orders</span>
          </div>
        ) : (
          <div className="text-sm text-slate-400 italic">No prior-year data</div>
        )}
      </div>
    </div>
  );
}


function RevenueMonthlyChart({ data }) {
  return (
    <div className="rounded-lg border hairline p-4" data-testid="revenue-monthly-chart">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-display font-bold">Monthly revenue · {data.year}</div>
          <div className="text-xs text-slate-500">Jan → current month</div>
        </div>
        <span className="chip chip-primary text-[10px]">AUD</span>
      </div>
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.monthly} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="month" tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
            <YAxis tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={44}/>
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
              formatter={(v, name) => [moneyCents(v), name === "revenue" ? "Revenue" : name]}
              labelFormatter={(l) => `${l} ${data.year}`}
            />
            <Bar dataKey="revenue" fill="#4F46E5" radius={[6, 6, 0, 0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


function RevenueTopProducts({ products }) {
  return (
    <div className="rounded-lg border hairline p-4" data-testid="revenue-top-products">
      <div className="font-display font-bold mb-3">Top 5 products · YTD</div>
      {products.length === 0 ? (
        <div className="text-sm text-slate-400 italic py-8 text-center">No sales yet.</div>
      ) : (
        <div className="grid gap-2">
          {products.map((p, i) => (
            <div key={p.product_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50" data-testid={`revenue-top-product-${i}`}>
              <div className="w-6 h-6 grid place-items-center rounded-md font-display font-bold text-white text-xs shrink-0" style={{ background: `linear-gradient(135deg, #4F46E5, #EC4899)`, opacity: 1 - i * 0.14 }}>{i + 1}</div>
              <div className="w-11 h-11 rounded-md bg-slate-100 border hairline overflow-hidden shrink-0">
                {p.image ? (
                  <img src={proxyImg(imgThumb(p.image))} alt="" className="w-full h-full object-cover" loading="lazy"/>
                ) : (
                  <div className="w-full h-full grid place-items-center text-[9px] text-slate-400 font-mono">no img</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.title}</div>
                <div className="text-xs text-slate-500">{p.units} units sold</div>
              </div>
              <div className="font-mono text-sm font-bold text-indigo-600 shrink-0">{moneyCents(p.revenue)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function RevenueStatusBreakdown({ rows }) {
  const nonZero = rows.filter(r => r.count > 0);
  const total = nonZero.reduce((sum, r) => sum + r.count, 0);
  return (
    <div className="rounded-lg border hairline p-4" data-testid="revenue-status-breakdown">
      <div className="font-display font-bold mb-3">Orders by status · YTD</div>
      {nonZero.length === 0 ? (
        <div className="text-sm text-slate-400 italic py-8 text-center">No orders yet this year.</div>
      ) : (
        <div className="grid gap-2">
          {nonZero.map((r) => {
            const pct = total ? Math.round((r.count / total) * 100) : 0;
            return (
              <div key={r.status} className="flex items-center gap-3" data-testid={`revenue-status-${r.status}`}>
                <div className="shrink-0 w-24"><StatusChip status={r.status}/></div>
                <div className="flex-1 min-w-0">
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-pink-500"
                      style={{ width: `${pct}%` }}
                      aria-label={`${pct}%`}
                    />
                  </div>
                </div>
                <div className="shrink-0 font-mono text-sm text-slate-700 tabular-nums">
                  {r.count.toLocaleString("en-AU")} <span className="text-slate-400 text-xs">({pct}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}



/* --------------------------- Profit detail modal ---------------------------
 *
 * Opens when the admin clicks the expand arrow on the Profit YTD KPI card.
 * Shows monthly profit bars + margin-% line chart, top-5 highest-margin
 * products with thumbnails, average margin per category, a side-by-side
 * revenue / cost / profit summary panel, and the best + worst margin
 * months this year.
 *
 * Backend endpoint: `GET /api/analytics/profit-detail` — one round-trip.
 * ------------------------------------------------------------------------- */

export function ProfitDetailModal({ onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API}/analytics/profit-detail`)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(e => { if (!cancelled) setErr(e?.response?.data?.detail || e.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      data-testid="profit-detail-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card max-w-5xl mx-auto my-4 sm:my-10 p-5 sm:p-8"
        role="dialog"
        aria-label="Profit detail"
      >
        <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-slate-400 mb-1">
              Profit Detail · {data?.year || new Date().getFullYear()}
            </div>
            <div className="font-display font-bold text-2xl sm:text-3xl tracking-tight">
              {data ? moneyCents(data.totals.profit) : "…"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {data
                ? <>
                    <span className="font-mono text-emerald-600 font-bold">{data.totals.margin_pct}%</span> margin
                    · {moneyCents(data.totals.revenue)} revenue on {moneyCents(data.totals.cost)} cost
                  </>
                : "loading…"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost !p-2"
            aria-label="Close"
            data-testid="profit-detail-close"
          >
            <X size={16}/>
          </button>
        </div>

        {err && (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm">
            Failed to load profit detail: {err}
          </div>
        )}

        {!data && !err && (
          <div className="py-20 text-center text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={16}/> loading profit detail…
          </div>
        )}

        {data && (
          <div className="grid gap-6">
            <ProfitTotalsPanel totals={data.totals}/>
            <ProfitMonthHighlights best={data.best_month} worst={data.worst_month}/>
            <ProfitMonthlyBars monthly={data.monthly} year={data.year}/>
            <ProfitMarginTrend monthly={data.monthly} year={data.year}/>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ProfitTopProducts products={data.top_products}/>
              <ProfitCategoryMargins rows={data.category_margins}/>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="btn btn-primary" data-testid="profit-detail-close-footer">Close</button>
        </div>
      </div>
    </div>
  );
}


function ProfitTotalsPanel({ totals }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="profit-totals-panel">
      <div className="p-4 rounded-lg border hairline bg-slate-50/60">
        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Revenue YTD</div>
        <div className="font-display font-bold text-lg">{moneyCents(totals.revenue)}</div>
      </div>
      <div className="p-4 rounded-lg border border-amber-200 bg-amber-50/60">
        <div className="text-[10px] font-mono uppercase tracking-widest text-amber-800 mb-1">Cost YTD</div>
        <div className="font-display font-bold text-lg text-amber-900">{moneyCents(totals.cost)}</div>
      </div>
      <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50/60">
        <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-800 mb-1 flex items-center gap-1"><TrendingUp size={11}/> Profit YTD</div>
        <div className="font-display font-bold text-lg text-emerald-700">{moneyCents(totals.profit)}</div>
        <div className="text-xs text-emerald-700 font-mono mt-0.5">{totals.margin_pct}% margin</div>
      </div>
    </div>
  );
}


function ProfitMonthHighlights({ best, worst }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="profit-month-highlights">
      <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50/60">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-1">
          <Trophy size={11}/> Best margin month
        </div>
        {best ? (
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="font-display font-bold text-lg">{best.month}</div>
            <div className="font-mono text-emerald-700 font-bold">{best.margin_pct}%</div>
            <div className="text-xs text-slate-500 font-mono">{moneyCents(best.profit)} profit</div>
          </div>
        ) : (
          <div className="text-sm text-slate-400 italic">No sales yet</div>
        )}
      </div>
      <div className="p-4 rounded-lg border border-amber-200 bg-amber-50/60">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-amber-800 mb-1">
          <TrendingDown size={11}/> Worst margin month
        </div>
        {worst ? (
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="font-display font-bold text-lg">{worst.month}</div>
            <div className="font-mono text-amber-800 font-bold">{worst.margin_pct}%</div>
            <div className="text-xs text-slate-500 font-mono">{moneyCents(worst.profit)} profit</div>
          </div>
        ) : (
          <div className="text-sm text-slate-400 italic">No sales yet</div>
        )}
      </div>
    </div>
  );
}


function ProfitMonthlyBars({ monthly, year }) {
  return (
    <div className="rounded-lg border hairline p-4" data-testid="profit-monthly-bars">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-display font-bold">Monthly profit · {year}</div>
          <div className="text-xs text-slate-500">Absolute dollar profit per month</div>
        </div>
        <span className="chip chip-success text-[10px]">AUD</span>
      </div>
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthly} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="month" tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
            <YAxis tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={44}/>
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
              formatter={(v) => [moneyCents(v), "Profit"]}
              labelFormatter={(l) => `${l} ${year}`}
            />
            <Bar dataKey="profit" fill="#10B981" radius={[6, 6, 0, 0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


function ProfitMarginTrend({ monthly, year }) {
  return (
    <div className="rounded-lg border hairline p-4" data-testid="profit-margin-trend">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-display font-bold">Margin % trend · {year}</div>
          <div className="text-xs text-slate-500">Month-over-month profit-to-revenue ratio</div>
        </div>
        <span className="chip chip-primary text-[10px]">%</span>
      </div>
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={monthly} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="month" tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
            <YAxis tickFormatter={(v) => `${v}%`} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={44} domain={[0, "auto"]}/>
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
              formatter={(v) => [`${v}%`, "Margin"]}
              labelFormatter={(l) => `${l} ${year}`}
            />
            <Line type="monotone" dataKey="margin_pct" stroke="#4F46E5" strokeWidth={2.5} dot={{ r: 4, fill: "#4F46E5" }} activeDot={{ r: 6 }}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


function ProfitTopProducts({ products }) {
  return (
    <div className="rounded-lg border hairline p-4" data-testid="profit-top-products">
      <div className="font-display font-bold mb-3">Top 5 by margin · YTD</div>
      {products.length === 0 ? (
        <div className="text-sm text-slate-400 italic py-8 text-center">No sales yet.</div>
      ) : (
        <div className="grid gap-2">
          {products.map((p, i) => (
            <div key={p.product_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50" data-testid={`profit-top-product-${i}`}>
              <div className="w-6 h-6 grid place-items-center rounded-md font-display font-bold text-white text-xs shrink-0" style={{ background: `linear-gradient(135deg, #10B981, #4F46E5)`, opacity: 1 - i * 0.14 }}>{i + 1}</div>
              <div className="w-11 h-11 rounded-md bg-slate-100 border hairline overflow-hidden shrink-0">
                {p.image ? (
                  <img src={proxyImg(imgThumb(p.image))} alt="" className="w-full h-full object-cover" loading="lazy"/>
                ) : (
                  <div className="w-full h-full grid place-items-center text-[9px] text-slate-400 font-mono">no img</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.title}</div>
                <div className="text-xs text-slate-500">{p.units} sold · {moneyCents(p.profit)} profit</div>
              </div>
              <div className="font-mono text-sm font-bold text-emerald-600 shrink-0">{p.margin_pct}%</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function ProfitCategoryMargins({ rows }) {
  const max = rows.reduce((m, r) => Math.max(m, r.margin_pct), 0) || 1;
  return (
    <div className="rounded-lg border hairline p-4" data-testid="profit-category-margins">
      <div className="font-display font-bold mb-3 flex items-center gap-2"><Layers size={14} className="text-slate-500"/> Margin by category · YTD</div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-400 italic py-8 text-center">No sales yet.</div>
      ) : (
        <div className="grid gap-2 max-h-72 overflow-y-auto pr-1">
          {rows.map((r) => {
            const pct = Math.round((r.margin_pct / max) * 100);
            return (
              <div key={r.category} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3" data-testid={`profit-category-${r.category}`}>
                <div className="text-xs font-medium capitalize truncate" title={r.category}>{r.category}</div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="font-mono text-xs text-slate-700 tabular-nums w-14 text-right">
                  {r.margin_pct}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

