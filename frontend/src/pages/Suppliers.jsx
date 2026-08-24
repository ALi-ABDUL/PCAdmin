import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { BadgeCheck, Ban, ChevronLeft, ExternalLink, History, ImageIcon, Loader2, Search } from "lucide-react";
import { StatBox } from "../components/atoms";
import { Pagination, usePagePref } from "../components/Pagination";
import { SortableTh, useSortPref } from "../components/SortableTh";
import { API, proxyImg } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { SUPPLIER_NAV } from "../lib/nav";
import { Orders } from "./Orders";
import { Products } from "./ProductsList";

export function Suppliers({ section, setSection, supplierDetailId, openSupplierDetail, openProductDetail }) {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { field: sortField, dir: sortDir, sortParam, toggle: toggleSort } = useSortPref("suppliers", "revenue_generated", "desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePagePref("suppliers", 50);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/suppliers`, {
      params: {
        q: q || undefined,
        status: status || undefined,
        sort: sortParam,
        limit: pageSize,
        skip: (page - 1) * pageSize,
      },
    });
    setList(data.suppliers);
    setTotal(data.total);
  }, [q, status, sortParam, page, pageSize]);
  const loadSummary = useCallback(async () => {
    const { data } = await axios.get(`${API}/suppliers/summary`);
    setSummary(data);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); }, [loadSummary, list.length]);
  useEffect(() => { setPage(1); }, [q, status, sortParam, pageSize]);

  // Supplier detail takes over the entire Suppliers UI when active.
  if (supplierDetailId) {
    return <SupplierDetailPage supplierId={supplierDetailId} onBack={() => openSupplierDetail?.(null)} openProductDetail={openProductDetail}/>;
  }

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

      {section === "all"      && <AllSuppliers list={list} total={total} q={q} setQ={setQ} sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} status={status} setStatus={setStatus} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} onOpen={openSupplierDetail}/>}
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

export function AllSuppliers({ list, total, q, setQ, sortField, sortDir, toggleSort, status, setStatus, page = 1, setPage, pageSize = 50, setPageSize, onOpen }) {
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
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <SortableTh label="Seller Name" field="name" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="sup"/>
              <SortableTh label="Total Products" field="total_products" active={sortField} dir={sortDir} onSort={toggleSort} align="right" testPrefix="sup"/>
              <SortableTh label="Total Orders" field="total_orders" active={sortField} dir={sortDir} onSort={toggleSort} align="right" testPrefix="sup"/>
              <SortableTh label="Revenue Generated" field="revenue_generated" active={sortField} dir={sortDir} onSort={toggleSort} align="right" testPrefix="sup"/>
              <SortableTh label="Last Active" field="last_active" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="sup"/>
              <SortableTh label="Status" field="status" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="sup"/>
            </tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No eBay sellers yet — import a listing on the Product Sourcing page.</td></tr>}
              {list.map((s) => (
                <tr
                  key={s.id}
                  className={`cursor-pointer hover:bg-slate-50 transition-colors ${s.status === "inactive" ? "opacity-60" : ""}`}
                  data-testid="sup-row"
                  onClick={() => onOpen?.(s.id)}
                >
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
      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        testPrefix="suppliers"
      />
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


/* ------------------------------ Supplier Detail ---------------------------- */

export function SupplierDetailPage({ supplierId, onBack, openProductDetail }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    axios.get(`${API}/suppliers/${supplierId}`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(e?.response?.data?.detail || "Failed to load supplier"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [supplierId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 text-sm">
        <Loader2 className="animate-spin mr-2" size={16}/> Loading supplier…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="grid gap-4">
        <button onClick={onBack} className="btn btn-ghost text-sm w-fit" data-testid="sup-detail-back"><ChevronLeft size={14}/> Back to suppliers</button>
        <div className="card p-8 text-center text-slate-500">{error || "Supplier not found"}</div>
      </div>
    );
  }

  const { supplier: s, products, product_count } = data;
  return (
    <div className="grid gap-6" data-testid="supplier-detail">
      <div>
        <button onClick={onBack} className="btn btn-ghost text-sm" data-testid="sup-detail-back">
          <ChevronLeft size={14}/> Back to suppliers
        </button>
      </div>
      <div className="card p-5 md:p-6 flex items-start gap-4">
        <SupplierAvatar s={s} size={56}/>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Supplier</div>
          <div className="font-display text-2xl font-bold tracking-tight truncate" data-testid="sup-detail-name">{s.name}</div>
          <div className="text-sm text-slate-500 mt-1 truncate">{s.location}</div>
          <div className="mt-3 flex items-center gap-3 flex-wrap text-xs text-slate-500">
            <SellerStatusChip status={s.status}/>
            <span className="font-mono">{s.total_products} scraped listing{s.total_products === 1 ? "" : "s"}</span>
            {s.last_active && <span className="font-mono">last active {fmtDate(s.last_active)}</span>}
          </div>
        </div>
      </div>

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="font-display text-lg font-bold">Products in your store</div>
        <div className="text-xs text-slate-500 font-mono" data-testid="sup-detail-count">
          {product_count} product{product_count === 1 ? "" : "s"} sourced from this supplier
        </div>
      </div>

      {products.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">
          No products from this supplier are in your store yet. Import listings from Product Sourcing to add some.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="sup-detail-grid">
          {products.map((p) => (
            <SupplierProductCard key={p.id} product={p} onOpen={() => openProductDetail?.(p.id)}/>
          ))}
        </div>
      )}
    </div>
  );
}

function SupplierProductCard({ product: p, onOpen }) {
  const image = p.images?.[0] || null;
  const stock = Number(p.stock ?? 0);
  const stockChip = stock <= 0
    ? { cls: "chip-danger", label: "Out of stock" }
    : stock <= 3
      ? { cls: "chip-warning", label: `Low · ${stock}` }
      : { cls: "chip-success", label: `${stock} in stock` };
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`sup-detail-product-${p.id}`}
      className="card overflow-hidden hover:shadow-lg transition-shadow text-left group flex flex-col"
      title="Open product detail"
    >
      <div className="aspect-[4/3] bg-slate-50 relative overflow-hidden">
        {image ? (
          <img src={proxyImg(image)} alt={p.title} className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-500"/>
        ) : (
          <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={32}/></div>
        )}
        {p.active === false && (
          <span className="absolute top-2 left-2 chip chip-neutral text-[10px]">Inactive</span>
        )}
      </div>
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="text-sm font-medium line-clamp-2 min-h-[2.5rem]" title={p.title}>{p.title}</div>
        {p.product_code && <div className="text-[11px] text-slate-400 font-mono truncate">{p.product_code}</div>}
        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="font-mono font-bold text-indigo-600">{moneyCents(p.price)}</div>
          <span className={`chip ${stockChip.cls} text-[10px]`}>{stockChip.label}</span>
        </div>
        <div className="text-[11px] text-indigo-600 font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ExternalLink size={11}/> View product details
        </div>
      </div>
    </button>
  );
}
