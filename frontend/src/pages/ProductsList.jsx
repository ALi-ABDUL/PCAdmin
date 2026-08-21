import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, ImageIcon, Loader2, Search, Star as StarIcon, Trash2, Warehouse } from "lucide-react";
import { statusBadge } from "../components/atoms";
import { CatIcon } from "../components/icons";
import { API, proxyImg } from "../lib/api";
import { moneyCents } from "../lib/format";

export function Products({ deepLink, clearDeepLink, openProductDetail }) {
  const [list, setList] = useState([]); const [total, setTotal] = useState(0);
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [sort, setSort] = useState("created_at_desc");
  const [cats, setCats] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/products`, { params: { q: q || undefined, category: cat || undefined, sort } });
    setList(data.products); setTotal(data.total);
    setSelected(prev => {
      const ids = new Set(data.products.map(p => p.id));
      const next = new Set();
      prev.forEach(id => { if (ids.has(id)) next.add(id); });
      return next;
    });
  }, [q, cat, sort]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/categories`, { params: { active: true }}).then(r => setCats(r.data.categories)); }, []);

  // Deep-link now navigates to the full page instead of a modal
  useEffect(() => {
    if (!deepLink?.productId) return;
    openProductDetail(deepLink.productId);
    clearDeepLink && clearDeepLink();
  }, [deepLink, openProductDetail, clearDeepLink]);

  const del = async (p) => { if (!window.confirm(`Delete "${p.title}"? This can't be undone.`)) return; await axios.delete(`${API}/products/${p.id}`); toast.success("Deleted"); load(); };
  const archive = async (p) => { await axios.post(`${API}/products/${p.id}/archive`); toast.success(`Archived — find it under Archived`); load(); };
  const catByslug = (slug) => cats.find(c => c.slug === slug);

  const toggleOne = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(s => s.size === list.length ? new Set() : new Set(list.map(p => p.id)));
  const selectDeadOnly = () => setSelected(new Set(list.filter(p => p.is_sold || !p.active || (p.stock_status && p.stock_status !== "live")).map(p => p.id)));
  const bulkArchive = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Archive ${selected.size} product${selected.size===1?"":"s"}? They'll be hidden from All Products but restorable from the Archived tab.`)) return;
    setBulkBusy(true);
    try {
      const { data } = await axios.post(`${API}/products/bulk-archive`, { product_ids: Array.from(selected) });
      toast.success(`Archived ${data.archived} product${data.archived===1?"":"s"}`);
      setSelected(new Set()); load();
    } catch { toast.error("Bulk archive failed"); }
    finally { setBulkBusy(false); }
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-500 font-mono">{total} product{total===1?"":"s"}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={(e)=>setQ(e.target.value)} data-testid="product-search" placeholder="Search title / SKU / code" className="input pl-9 pr-3 py-2 text-sm w-56"/></div>
          <select value={cat} onChange={(e)=>setCat(e.target.value)} className="input px-3 py-2 text-sm" data-testid="product-cat">
            <option value="">All categories</option>
            {cats.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <select value={sort} onChange={(e)=>setSort(e.target.value)} className="input px-3 py-2 text-sm">
            <option value="created_at_desc">Newest</option>
            <option value="price_desc">Price ↓</option>
            <option value="price_asc">Price ↑</option>
            <option value="stock_asc">Stock ↑</option>
            <option value="sold_desc">Best sellers</option>
          </select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="card p-3 border-indigo-200 bg-indigo-50 flex items-center gap-3 flex-wrap" data-testid="bulk-actions-bar">
          <span className="text-sm font-medium text-indigo-900"><CheckCircle2 size={14} className="inline mr-1"/> {selected.size} selected</span>
          <span className="text-slate-400">·</span>
          <button onClick={selectDeadOnly} className="btn btn-ghost text-xs !py-1" data-testid="select-dead-btn">Select all inactive</button>
          <button onClick={() => setSelected(new Set())} className="btn btn-ghost text-xs !py-1">Clear</button>
          <div className="ml-auto">
            <button onClick={bulkArchive} disabled={bulkBusy} className="btn btn-primary text-xs" data-testid="bulk-archive-btn">
              {bulkBusy ? <Loader2 className="animate-spin" size={12}/> : <Warehouse size={12}/>} Archive {selected.size} product{selected.size===1?"":"s"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <th className="w-8"><input type="checkbox" className="accent-indigo-600" checked={list.length > 0 && selected.size === list.length} onChange={toggleAll} data-testid="bulk-select-all"/></th>
              <th>Product</th><th>SKU</th><th>Category</th><th>Rating</th>
              <th className="text-right">eBay</th><th className="text-right">Sell</th><th className="text-right">Profit</th>
              <th className="text-right">Stock</th><th className="text-right">Sold</th><th></th>
            </tr></thead>
            <tbody>
              {list.length === 0
                ? <tr><td colSpan={11} className="text-center py-10 text-slate-500">No products yet. Head to <b>Product Sourcing</b> and import your first one.</td></tr>
                : list.map((p) => {
                    const c = catByslug(p.category);
                    const ebay = Number(p.cost) || 0;
                    const sell = Number(p.price) || 0;
                    const profit = ebay > 0 ? Math.round((sell - ebay) * 100) / 100 : 0;
                    const badge = statusBadge(p);
                    const dead = p.is_sold || !p.active || (p.stock_status && p.stock_status !== "live");
                    const isSel = selected.has(p.id);
                    return (
                  <tr key={p.id} data-testid="product-row" className={`${dead ? "opacity-60 bg-slate-50/70" : ""} ${isSel ? "bg-indigo-50/60" : ""}`}>
                    <td><input type="checkbox" className="accent-indigo-600" checked={isSel} onChange={() => toggleOne(p.id)} data-testid={`bulk-check-${p.id}`}/></td>
                    <td>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border hairline shrink-0 ${dead ? "grayscale" : ""}`}>
                          {p.images?.[0] ? <img src={proxyImg(p.images[0])} alt="" className="w-full h-full object-cover"/> : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={16}/></div>}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate max-w-[320px] flex items-center gap-2">
                            {p.title}
                            {badge && <span className={`chip ${badge.cls}`} data-testid={`product-badge-${p.id}`}>{badge.label}</span>}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate flex items-center gap-2">
                            {p.product_code && <span className="font-mono text-indigo-600 font-bold" data-testid={`product-code-${p.id}`}>{p.product_code}</span>}
                            <span>·</span>
                            <span>{dead ? "Inactive — not shown on storefront" : "Active"}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-slate-500">{p.sku || "—"}</td>
                    <td>
                      {c ? (
                        <span className="chip inline-flex items-center gap-1.5" style={{ background: `${c.color}18`, color: c.color }}>
                          <CatIcon name={c.icon} size={11}/> {c.name}
                        </span>
                      ) : <span className="chip chip-neutral capitalize">{p.category || "—"}</span>}
                    </td>
                    <td>
                      {(p.review_count ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs" data-testid={`product-rating-${p.id}`}>
                          <StarIcon size={11} className="text-amber-500" fill="currentColor"/>
                          <span className="font-mono font-bold">{(p.average_rating ?? 0).toFixed(1)}</span>
                          <span className="text-slate-400 font-mono">({p.review_count})</span>
                        </span>
                      ) : <span className="text-[11px] text-slate-400 font-mono">no reviews</span>}
                    </td>
                    <td className="text-right font-mono text-slate-500">{ebay > 0 ? moneyCents(ebay) : "—"}</td>
                    <td className="text-right font-mono font-bold text-indigo-600">{moneyCents(sell)}</td>
                    <td className="text-right font-mono font-bold text-emerald-600">{ebay > 0 ? moneyCents(profit) : "—"}</td>
                    <td className={`text-right ${p.stock <= 3 ? "text-red-600 font-bold" : "text-slate-700"}`}>{p.stock}</td>
                    <td className="text-right">{p.sold_count || 0}</td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openProductDetail(p.id)} className="btn btn-ghost text-xs !py-1 !px-2" data-testid={`product-open-${p.id}`}>Open</button>
                        {dead && (
                          <button onClick={() => archive(p)} className="btn btn-ghost text-xs !py-1 !px-2" data-testid={`product-archive-${p.id}`} title="Archive — hide from main list, restore later">
                            <Warehouse size={12}/> Archive
                          </button>
                        )}
                        <button onClick={() => del(p)} className="btn btn-danger text-xs !py-1 !px-2" data-testid={`product-delete-${p.id}`} title="Delete permanently"><Trash2 size={12}/></button>
                      </div>
                    </td>
                  </tr>
                );})}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

