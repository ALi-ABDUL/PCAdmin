import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { BadgeCheck, Ban, History, Search } from "lucide-react";
import { StatBox } from "../components/atoms";
import { API } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { SUPPLIER_NAV } from "../lib/nav";
import { Orders } from "./Orders";
import { Products } from "./ProductsList";

export function Suppliers({ section, setSection }) {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("revenue_desc");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/suppliers`, { params: { q: q || undefined, status: status || undefined, sort } });
    setList(data.suppliers);
    setTotal(data.total);
  }, [q, status, sort]);
  const loadSummary = useCallback(async () => {
    const { data } = await axios.get(`${API}/suppliers/summary`);
    setSummary(data);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); }, [loadSummary, list.length]);

  const meta = SUPPLIER_NAV.find((s) => s.id === section) || SUPPLIER_NAV[0];
  const Icon = meta.icon;
  const descriptions = {
    all:      "Every eBay AU seller you have imported items from, with live product, order and revenue stats.",
    top:      "Top 5 sellers ranked by revenue generated from their imported items.",
    products: "Products sourced through each eBay seller.",
    orders:   "Orders fulfilled from products sourced via each seller.",
    activity: "Recent seller activity, driven by scrape / refresh times.",
  };

  return (
    <div className="grid gap-6">
      <div className="card p-5 md:p-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl grid place-items-center text-white shrink-0" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}><Icon size={20}/></div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">{meta.group}</div>
          <div className="font-display text-2xl font-bold tracking-tight">{meta.label}</div>
          <div className="text-sm text-slate-500 mt-1">{descriptions[section]}</div>
        </div>
      </div>

      {section === "all"      && <AllSuppliers list={list} total={total} q={q} setQ={setQ} sort={sort} setSort={setSort} status={status} setStatus={setStatus}/>}
      {section === "top"      && <TopSuppliers list={summary?.top_suppliers || []} agg={summary?.aggregate}/>}
      {section === "products" && <SupplierProducts list={list}/>}
      {section === "orders"   && <SupplierOrders list={list}/>}
      {section === "activity" && <SupplierActivity list={list}/>}
    </div>
  );
}

export function SupplierAvatar({ s, size = 40 }) {
  const initials = (s.name || "").replace(/\(.*\)/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return <div className="rounded-full grid place-items-center text-white font-bold shrink-0" style={{ width: size, height: size, background: "linear-gradient(135deg,#4F46E5,#EC4899)", fontSize: size * 0.36 }}>{initials || "S"}</div>;
}

export function SellerStatusChip({ status }) {
  const active = status === "active";
  return <span className={`chip ${active ? "chip-success" : "chip-neutral"}`} data-testid="sup-status">{active ? <BadgeCheck size={11}/> : <Ban size={11}/>} {active ? "Active" : "Inactive"}</span>;
}

export function AllSuppliers({ list, total, q, setQ, sort, setSort, status, setStatus }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-slate-500 font-mono">{total} seller{total===1?"":"s"}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={(e)=>setQ(e.target.value)} data-testid="sup-search" placeholder="Search seller or location" className="input pl-9 pr-3 py-2 text-sm w-64"/></div>
          <select value={status} onChange={(e)=>setStatus(e.target.value)} className="input px-3 py-2 text-sm" data-testid="sup-status-filter">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={sort} onChange={(e)=>setSort(e.target.value)} className="input px-3 py-2 text-sm" data-testid="sup-sort">
            <option value="revenue_desc">Revenue ↓</option>
            <option value="orders_desc">Total orders ↓</option>
            <option value="products_desc">Total products ↓</option>
            <option value="last_active_desc">Last active ↓</option>
            <option value="name_asc">Seller A→Z</option>
          </select>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <th>Seller Name</th>
              <th className="text-right">Total Products</th>
              <th className="text-right">Total Orders</th>
              <th className="text-right">Revenue Generated</th>
              <th>Last Active</th>
              <th>Status</th>
            </tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No eBay sellers yet — import a listing on the Product Sourcing page.</td></tr>}
              {list.map((s) => (
                <tr key={s.id} className={s.status === "inactive" ? "opacity-60" : ""} data-testid="sup-row">
                  <td>
                    <div className="flex items-center gap-3 min-w-0">
                      <SupplierAvatar s={s} size={36}/>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate max-w-[280px]">{s.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">{s.location}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-right font-mono">{s.total_products}</td>
                  <td className="text-right font-mono">{s.total_orders}</td>
                  <td className="text-right font-mono font-bold text-indigo-600">{moneyCents(s.revenue_generated)}</td>
                  <td className="text-xs text-slate-500 font-mono">{s.last_active ? fmtDate(s.last_active) : "—"}</td>
                  <td><SellerStatusChip status={s.status}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function TopSuppliers({ list, agg }) {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatBox label="Total revenue"  value={moneyCents(agg?.total_revenue || 0)} tone="success"/>
        <StatBox label="Total orders"   value={agg?.total_orders ?? 0}/>
        <StatBox label="Total products" value={agg?.total_products ?? 0}/>
      </div>
      <div className="card overflow-hidden">
        <div className="p-4 border-b hairline font-display font-bold">Top 5 by revenue</div>
        <div className="p-3">
          {list.length === 0 && <div className="text-sm text-slate-500 py-6 text-center">No eBay sellers yet</div>}
          {list.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
              <div className="w-8 h-8 grid place-items-center rounded-md font-display font-bold text-white text-xs" style={{ background: `linear-gradient(135deg,#4F46E5,#EC4899)`, opacity: 1 - i*0.12 }}>{i + 1}</div>
              <SupplierAvatar s={s} size={32}/>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{s.name}</div>
                <div className="text-xs text-slate-500">{s.total_orders} orders · {s.total_products} products</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-bold text-indigo-600 text-sm">{moneyCents(s.revenue_generated)}</div>
                <div className="text-[11px] text-slate-400">{s.location}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SupplierProducts({ list }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Seller</th><th>Location</th><th className="text-right">Total products</th><th>Status</th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td><div className="flex items-center gap-2"><SupplierAvatar s={s} size={28}/><span className="text-sm truncate max-w-[260px]">{s.name}</span></div></td>
              <td className="text-xs text-slate-500">{s.location}</td>
              <td className="text-right font-mono">{s.total_products}</td>
              <td><SellerStatusChip status={s.status}/></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={4} className="text-center text-slate-500 py-10">No seller products yet</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

export function SupplierOrders({ list }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Seller</th><th className="text-right">Total orders</th><th className="text-right">Revenue</th><th>Status</th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td><div className="flex items-center gap-2"><SupplierAvatar s={s} size={28}/><span className="text-sm truncate max-w-[280px]">{s.name}</span></div></td>
              <td className="text-right font-mono">{s.total_orders}</td>
              <td className="text-right font-mono font-bold text-indigo-600">{moneyCents(s.revenue_generated)}</td>
              <td><SellerStatusChip status={s.status}/></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={4} className="text-center text-slate-500 py-10">No orders sourced from sellers yet</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

export function SupplierActivity({ list }) {
  const events = list
    .filter((s) => s.last_active)
    .map((s) => ({ at: s.last_active, supplier: s }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 40);
  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b hairline font-display font-bold flex items-center gap-2"><History size={16}/> Recent seller activity</div>
      <div className="divide-y">
        {events.length === 0 && <div className="p-10 text-center text-slate-500">No activity yet</div>}
        {events.map((e, i) => (
          <div key={i} className="p-4 flex items-center gap-3 hover:bg-slate-50">
            <SupplierAvatar s={e.supplier} size={32}/>
            <div className="flex-1 min-w-0">
              <div className="text-sm"><span className="font-medium truncate">{e.supplier.name}</span> <span className="text-slate-500"> · last item refreshed</span></div>
              <div className="text-[11px] text-slate-400 font-mono">{fmtDate(e.at)}</div>
            </div>
            <SellerStatusChip status={e.supplier.status}/>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- Customers -------------------------------- */
