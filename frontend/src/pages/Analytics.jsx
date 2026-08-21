import { useEffect, useState } from "react";
import axios from "axios";
import { BarChart3, Factory, Percent, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { API } from "../lib/api";
import { fmtDay, moneyCents } from "../lib/format";

export function Analytics() {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/analytics/report`).then(r => setData(r.data)); }, []);
  if (!data) return <div className="text-slate-500 py-24 text-center">loading…</div>;
  return (
    <div className="grid gap-6">
      <div>
        <div className="font-display text-2xl font-bold tracking-tight">Reporting</div>
        <div className="text-xs text-slate-500 mt-1">Deeper insights beyond the daily overview — supplier performance, margin trends, category comparison & product profitability.</div>
      </div>

      <TopSuppliersReport list={data.top_suppliers}/>
      <MarginTrendReport data={data.margin_trend}/>
      <CategoryPerformanceReport data={data.category_performance}/>
      <BestMarginProductsReport rows={data.best_margin_products}/>
    </div>
  );
}

export function TopSuppliersReport({ list }) {
  const max = Math.max(1, ...list.map((s) => s.revenue_generated));
  return (
    <div className="card overflow-hidden" data-testid="rep-top-suppliers">
      <div className="p-5 border-b hairline flex items-center gap-2">
        <Factory size={16} className="text-indigo-600"/>
        <div className="font-display font-bold text-lg">Top 5 suppliers by revenue</div>
      </div>
      {list.length === 0 ? (
        <div className="p-10 text-center text-slate-500">No supplier revenue yet — link imported eBay items to products with orders to see rankings.</div>
      ) : (
        <div className="p-3">
          {list.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
              <div className="w-8 h-8 grid place-items-center rounded-md font-display font-bold text-white text-xs" style={{ background: "linear-gradient(135deg,#4F46E5,#EC4899)", opacity: 1 - i * 0.12 }}>{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="font-mono font-bold text-indigo-600 text-sm shrink-0">{moneyCents(s.revenue_generated)}</div>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(s.revenue_generated / max) * 100}%`, background: "linear-gradient(90deg,#4F46E5,#EC4899)" }}/>
                </div>
                <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
                  <span>{s.total_orders} orders</span>
                  <span>·</span>
                  <span>{s.total_products} products</span>
                  <span>·</span>
                  <span className="truncate">{s.location}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MarginTrendReport({ data }) {
  const nonZero = data.filter((d) => d.margin_pct > 0);
  const avg = nonZero.length ? nonZero.reduce((a, b) => a + b.margin_pct, 0) / nonZero.length : 0;
  return (
    <div className="card p-5" data-testid="rep-margin-trend">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-emerald-600"/>
          <div className="font-display font-bold text-lg">Margin trend — last 30 days</div>
        </div>
        <div className="text-xs text-slate-500 font-mono">30-day avg margin <span className="text-emerald-600 font-bold">{avg.toFixed(1)}%</span></div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
            <YAxis tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`}/>
            <Tooltip
              labelFormatter={fmtDay}
              contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
              formatter={(v, name) => name === "margin_pct" ? [`${Number(v).toFixed(1)}%`, "Margin"] : [v, name]}
            />
            <Line type="monotone" dataKey="margin_pct" stroke="#10B981" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function CategoryPerformanceReport({ data }) {
  const chartData = data.slice(0, 10).map((c) => ({
    ...c,
    label: c.category.length > 14 ? c.category.slice(0, 12) + "…" : c.category,
  }));
  return (
    <div className="card p-5" data-testid="rep-category-perf">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={16} className="text-pink-600"/>
        <div className="font-display font-bold text-lg">Category performance</div>
      </div>
      {data.length === 0 ? (
        <div className="p-10 text-center text-slate-500">No category revenue yet — create some orders against products to populate this chart.</div>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="label" tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
              <YAxis tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => `$${v >= 1000 ? (v/1000).toFixed(0)+"k" : v}`}/>
              <Tooltip
                contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
                formatter={(v, name) => [`AU $${Number(v).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`, name === "revenue" ? "Revenue" : "Profit"]}
              />
              <Bar dataKey="revenue" name="revenue" fill="#4F46E5" radius={[4, 4, 0, 0]}/>
              <Bar dataKey="profit"  name="profit"  fill="#EC4899" radius={[4, 4, 0, 0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function BestMarginProductsReport({ rows }) {
  return (
    <div className="card overflow-hidden" data-testid="rep-best-margin">
      <div className="p-5 border-b hairline flex items-center gap-2">
        <Percent size={16} className="text-emerald-600"/>
        <div className="font-display font-bold text-lg">Best margin products</div>
        <span className="chip chip-neutral ml-1">Top 20</span>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr>
            <th>Product</th>
            <th className="text-right">Buy price</th>
            <th className="text-right">Sell price</th>
            <th className="text-right">Margin %</th>
            <th className="text-right">Units sold</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-slate-500">No sold products yet.</td></tr>}
            {rows.map((p) => (
              <tr key={p.product_id} data-testid="best-margin-row">
                <td className="text-sm truncate max-w-[420px]" title={p.title}>{p.title}</td>
                <td className="text-right font-mono text-slate-500">{moneyCents(p.buy_price)}</td>
                <td className="text-right font-mono font-bold text-indigo-600">{moneyCents(p.sell_price)}</td>
                <td className="text-right"><span className={`chip ${p.margin_pct >= 40 ? "chip-success" : p.margin_pct >= 20 ? "chip-primary" : "chip-neutral"} font-mono`}>{p.margin_pct.toFixed(1)}%</span></td>
                <td className="text-right font-mono">{p.units_sold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

