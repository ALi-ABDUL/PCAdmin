import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Search, Trash2, Warehouse } from "lucide-react";
import { Pagination, usePagePref } from "../components/Pagination";
import { ProductGrid } from "../components/ProductGrid";
import { API } from "../lib/api";

export function Products({ deepLink, clearDeepLink, openProductDetail, stock, sectionKey = "products-all" }) {
  const [list, setList] = useState([]); const [total, setTotal] = useState(0);
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [sort, setSort] = useState("created_at_desc");
  const [cats, setCats] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePagePref(sectionKey, 50);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/products`, {
      params: {
        q: q || undefined,
        category: cat || undefined,
        sort,
        stock: stock || undefined,
        limit: pageSize,
        skip: (page - 1) * pageSize,
      },
    });
    setList(data.products); setTotal(data.total);
    setSelected(prev => {
      const ids = new Set(data.products.map(p => p.id));
      const next = new Set();
      prev.forEach(id => { if (ids.has(id)) next.add(id); });
      return next;
    });
  }, [q, cat, sort, stock, page, pageSize]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/categories`, { params: { active: true }}).then(r => setCats(r.data.categories)); }, []);
  // Reset to page 1 whenever a filter changes so pagination doesn't strand
  // the admin on an empty page.
  useEffect(() => { setPage(1); }, [q, cat, sort, stock, pageSize]);

  useEffect(() => {
    if (!deepLink?.productId) return;
    openProductDetail(deepLink.productId);
    clearDeepLink && clearDeepLink();
  }, [deepLink, openProductDetail, clearDeepLink]);

  const del = async (p) => { if (!window.confirm(`Delete "${p.title}"? This can't be undone.`)) return; await axios.delete(`${API}/products/${p.id}`); toast.success("Deleted"); load(); };
  const archive = async (p) => { await axios.post(`${API}/products/${p.id}/archive`); toast.success(`Archived — find it under Archived`); load(); };

  const toggleOne = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(s => s.size === list.length ? new Set() : new Set(list.map(p => p.id)));
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

  const extraActions = (p) => {
    const dead = p.is_sold || !p.active || (p.stock_status && p.stock_status !== "live");
    return (
      <>
        {dead && (
          <button onClick={() => archive(p)} className="btn btn-ghost text-xs !py-1 !px-2" data-testid={`product-archive-${p.id}`} title="Archive — hide from main list, restore later">
            <Warehouse size={12}/> Archive
          </button>
        )}
        <button onClick={() => del(p)} className="btn btn-danger text-xs !py-1 !px-2" data-testid={`product-delete-${p.id}`} title="Delete permanently"><Trash2 size={12}/></button>
      </>
    );
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
          {list.length > 0 && (
            <button onClick={selectAll} className="btn btn-ghost text-xs !py-1" data-testid="bulk-select-all">
              {selected.size === list.length ? "Clear selection" : "Select all"}
            </button>
          )}
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

      <ProductGrid
        list={list}
        cats={cats}
        onOpen={(p) => openProductDetail(p.id)}
        emptyLabel="No products yet. Head to Product Sourcing and import your first one."
        showBulkCheckbox
        selected={selected}
        onToggleSelect={toggleOne}
        extraActions={extraActions}
        testId="products-grid"
      />
      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        testPrefix="products"
      />
    </div>
  );
}
