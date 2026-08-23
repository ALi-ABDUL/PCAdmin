import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Boxes, ClipboardPaste, Filter, ImageIcon, Loader2, MapPin, PackageX, Plus, RefreshCw, Search, Tags, Trash2, TrendingUp, X, Zap } from "lucide-react";
import { API, KEYS, loadKeys, proxyImg } from "../lib/api";
import { BackToTopButton } from "../components/BackToTopButton";
import { fmtDate, moneyCents } from "../lib/format";
import { calcPricing, usePricingRules } from "../lib/pricing";
import { Orders } from "./Orders";
import { Products } from "./ProductsList";

export function ScraperPage({ onView }) {
  const [url, setUrl] = useState(""); const [method, setMethod] = useState(loadKeys().method);
  const [loading, setLoading] = useState(false); const [status, setStatus] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sortBy, setSortBy] = useState("created_at_desc");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [categories, setCategories] = useState([]);
  const [rules] = usePricingRules();
  // Cache of every item id/url/item_id so we can flag duplicates while typing.
  const [existingUrls, setExistingUrls] = useState(new Map()); // Map<item_id, item>
  const [dupItem, setDupItem] = useState(null);

  // Debounce the search input so typing feels instant but doesn't hammer the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    axios.get(`${API}/categories`).then((r) => setCategories(r.data.categories || [])).catch(() => {});
  }, []);

  // Fetch a lightweight existence map of every imported URL/item_id so the paste
  // input can warn about duplicates regardless of the current filter.
  const loadExistence = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/items`, { params: { limit: 500 } });
      const map = new Map();
      for (const it of (data.items || [])) {
        if (it.item_id) map.set(String(it.item_id), it);
        if (it.url) map.set(it.url, it);
      }
      setExistingUrls(map);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadExistence(); }, [loadExistence]);

  // Detect duplicates as the user types / pastes.
  useEffect(() => {
    const raw = url.trim();
    if (!raw) { setDupItem(null); return; }
    // Extract eBay item_id from any of the common URL shapes.
    const m = raw.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/) || raw.match(/[?&]iid=(\d{9,})/);
    const itemId = m ? m[1] : null;
    const dup = (itemId && existingUrls.get(itemId)) || existingUrls.get(raw) || null;
    setDupItem(dup);
  }, [url, existingUrls]);

  const load = useCallback(async () => {
    const params = {
      q: debouncedQ || undefined,
      sort: sortBy,
      status: statusFilter || undefined,
      category: categoryFilter || undefined,
      min_price: minPrice !== "" ? Number(minPrice) : undefined,
      max_price: maxPrice !== "" ? Number(maxPrice) : undefined,
      limit: 200,
    };
    const { data } = await axios.get(`${API}/items`, { params });
    setItems(data.items);
    setTotal(data.total);
    // Drop selection entries that are no longer visible.
    setSelected((old) => new Set([...old].filter((id) => data.items.some((it) => it.id === id))));
  }, [debouncedQ, sortBy, statusFilter, categoryFilter, minPrice, maxPrice]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!url.trim()) return toast.error("Paste an eBay Australia URL");
    if (!/ebay\.com\.au/i.test(url)) return toast.error("Only ebay.com.au URLs are supported");
    if (dupItem && !window.confirm(`This URL is already imported as "${(dupItem.title || "").slice(0, 80)}". Import again anyway?`)) return;
    const keys = loadKeys(); setLoading(true);
    setStatus(method === "auto" ? "Trying stealth Chrome fingerprint (curl_cffi) …" : method === "manual" ? "Manual scrape (browser TLS impersonation) …" : `Requesting via ${method} …`);
    try {
      const { data } = await axios.post(`${API}/scrape`, { url: url.trim(), method, save: true, scrapingbee_key: keys.scrapingbee_key || undefined, scraperapi_key: keys.scraperapi_key || undefined }, { timeout: 120000 });
      toast.success(`Imported via ${data.method_used}`, { description: data.item?.title?.slice(0, 90) });
      setUrl(""); await load(); await loadExistence();
    } catch (e) { toast.error("Import failed", { description: e?.response?.data?.detail?.slice(0, 220) || e.message }); }
    finally { setLoading(false); setStatus(""); }
  };

  const paste = async () => { try { const t = await navigator.clipboard.readText(); if (t) setUrl(t.trim()); } catch { toast.error("Clipboard blocked"); } };

  const addToProducts = async (it) => {
    try { const { data } = await axios.post(`${API}/products/from-item/${it.id}`);
      toast.success("Added to products", { description: `${data.title} · ${moneyCents(data.price)} · SKU ${data.sku}` });
      await load();
    } catch (e) { toast.error("Failed", { description: e?.response?.data?.detail || e.message }); }
  };

  const del = async (it) => { if (!window.confirm("Delete this scraped item?")) return; await axios.delete(`${API}/items/${it.id}`); toast.success("Deleted"); load(); };
  const refresh = async (it) => {
    const keys = loadKeys();
    toast.loading("Refreshing…", { id: it.id });
    try { await axios.post(`${API}/items/${it.id}/refresh`, { url: it.url, method: keys.method || "auto", scrapingbee_key: keys.scrapingbee_key || undefined, scraperapi_key: keys.scraperapi_key || undefined, save: true }, { timeout: 120000 });
      toast.success("Refreshed", { id: it.id }); load(); }
    catch (e) { toast.error("Failed", { id: it.id, description: e?.response?.data?.detail?.slice(0,150) || e.message }); }
  };

  const [refreshingAll, setRefreshingAll] = useState(false);
  const refreshAll = async () => {
    if (!window.confirm("Re-scrape ALL eBay AU items now? This may take a while.")) return;
    const keys = loadKeys();
    setRefreshingAll(true); toast.loading("Refreshing all items…", { id: "ra" });
    try {
      const { data } = await axios.post(`${API}/items/refresh-all`, { method: keys.method || "auto", scrapingbee_key: keys.scrapingbee_key || undefined, scraperapi_key: keys.scraperapi_key || undefined }, { timeout: 30 * 60 * 1000 });
      toast.success(`Done · ${data.refreshed}/${data.total} refreshed · ${data.sold_found} sold`, { id: "ra", description: data.failed ? `${data.failed} failed` : undefined });
      await load();
    } catch (e) { toast.error("Refresh failed", { id: "ra", description: e?.response?.data?.detail?.slice(0,200) || e.message }); }
    finally { setRefreshingAll(false); }
  };

  // ---- Filter helpers ----
  const activeFilterCount =
    (debouncedQ ? 1 : 0) + (statusFilter ? 1 : 0) + (categoryFilter ? 1 : 0) +
    (minPrice !== "" ? 1 : 0) + (maxPrice !== "" ? 1 : 0) + (sortBy !== "created_at_desc" ? 1 : 0);
  const resetFilters = () => {
    setQ(""); setStatusFilter(""); setCategoryFilter(""); setMinPrice(""); setMaxPrice(""); setSortBy("created_at_desc");
  };

  // ---- Bulk selection ----
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allVisibleSelected = items.length > 0 && items.every((it) => selected.has(it.id));
  const toggleAll = () => setSelected((s) => allVisibleSelected ? new Set() : new Set(items.map((it) => it.id)));
  const clearSelection = () => setSelected(new Set());

  const bulk = async (action) => {
    if (selected.size === 0) return;
    if (action === "delete" && !window.confirm(`Delete ${selected.size} scraped item(s)?`)) return;
    setBulkBusy(true);
    try {
      const { data } = await axios.post(`${API}/items/bulk`, { ids: [...selected], action });
      let label;
      if (action === "delete") label = `Deleted ${data.deleted}`;
      else if (action === "deactivate") label = `Deactivated ${data.updated}`;
      else if (action === "activate") label = `Activated ${data.updated}`;
      else if (action === "add_to_products") {
        const parts = [];
        if (data.created) parts.push(`created ${data.created}`);
        if (data.skipped) parts.push(`skipped ${data.skipped} (already in products)`);
        if ((data.errors || []).length) parts.push(`${data.errors.length} failed`);
        label = `Bulk add · ${parts.join(" · ") || "no changes"}`;
      }
      toast.success(label);
      clearSelection();
      await load();
      await loadExistence();
    } catch (e) { toast.error("Bulk action failed", { description: e?.response?.data?.detail?.slice(0,200) || e.message }); }
    finally { setBulkBusy(false); }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-display text-2xl font-bold tracking-tight">Product Sourcing</div>
          <div className="text-xs text-slate-500 font-mono">stealth scrape · nightly auto-refresh · sold detection</div>
        </div>
        <button data-testid="refresh-all-btn" onClick={refreshAll} disabled={refreshingAll} className="btn btn-primary">
          {refreshingAll ? <Loader2 className="animate-spin" size={14}/> : <RefreshCw size={14}/>}
          {refreshingAll ? "Refreshing all…" : "Refresh all now"}
        </button>
      </div>
      <section className={`card p-6 md:p-8 ${loading ? "scanning" : ""}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="chip chip-primary">ebay.com.au only</span>
          <span className="chip chip-success">Chrome TLS fingerprint</span>
        </div>
        <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Paste an eBay Australia item URL to import</h2>
        <p className="text-slate-500 text-sm mt-1">Manual server-side stealth scrape (curl_cffi Chrome impersonation) with ScrapingBee & ScraperAPI as fallback. Auto-refreshes every night.</p>

        <div className="mt-5 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <input data-testid="ebay-url-input" value={url} onChange={(e)=>setUrl(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&!loading&&submit()} placeholder="https://www.ebay.com.au/itm/1234567890…" className="input w-full pl-4 pr-24 py-3.5 text-base font-mono"/>
            <button type="button" onClick={paste} data-testid="paste-btn" className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost text-xs !py-1.5 !px-2.5"><ClipboardPaste size={12}/> Paste</button>
          </div>
          <button data-testid="import-item-button" onClick={submit} disabled={loading} className="btn btn-primary px-6 py-3.5 min-w-[160px]">
            {loading ? <Loader2 className="animate-spin" size={16}/> : <Zap size={16}/>} {loading ? "Importing…" : "Import item"}
          </button>
        </div>

        {dupItem && !loading && (
          <div className="mt-3 flex items-center gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50" data-testid="dup-warning">
            <div className="w-10 h-10 rounded-md overflow-hidden bg-white border hairline shrink-0">
              {dupItem.images?.[0]
                ? <img src={proxyImg(dupItem.images[0])} alt="" className="w-full h-full object-cover"/>
                : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={14}/></div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-amber-800 flex items-center gap-1.5"><AlertTriangle size={13}/> Already imported</div>
              <div className="text-xs text-amber-700 truncate">{dupItem.title || ""}</div>
              <div className="text-[11px] text-amber-600 font-mono mt-0.5">
                {dupItem.price_display || ""} · imported {fmtDate(dupItem.created_at)}
              </div>
            </div>
            <button
              onClick={() => { onView(dupItem); }}
              className="btn btn-ghost text-xs shrink-0"
              data-testid="dup-view-btn"
            >View existing</button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mr-1">Method:</span>
          {[
            {id:"auto", label:"Auto"}, {id:"manual", label:"Manual"}, {id:"scrapingbee", label:"ScrapingBee"}, {id:"scraperapi", label:"ScraperAPI"},
          ].map((m) => (
            <button key={m.id} data-testid={`method-${m.id}`} onClick={()=>{setMethod(m.id); localStorage.setItem(KEYS.method, m.id);}}
              className={`chip cursor-pointer ${method===m.id ? "chip-primary" : "chip-neutral hover:bg-slate-100"}`}>{m.label}</button>
          ))}
        </div>

        {status && <div className="mt-4 text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin"/>{status}</div>}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="font-display font-bold text-lg">Scraped items</div>
            <div className="text-xs text-slate-500">
              {items.length} of {total} shown{activeFilterCount > 0 && <> · {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active</>}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="card p-3 md:p-4 mb-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-center" data-testid="scraper-toolbar">
          <div className="relative md:col-span-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input
              data-testid="scraper-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, seller, location"
              className="input pl-9 pr-3 py-2 text-sm w-full"
            />
          </div>
          <select data-testid="scraper-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input px-3 py-2 text-sm">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="out_of_stock">Out of stock</option>
            <option value="price_changed">Price changed</option>
          </select>
          <select data-testid="scraper-category-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input px-3 py-2 text-sm">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <div className="relative flex-1"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-mono">MIN</span>
              <input data-testid="scraper-min-price" type="number" min="0" step="1" placeholder="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="input pl-10 pr-2 py-2 text-sm w-full font-mono"/>
            </div>
            <div className="relative flex-1"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-mono">MAX</span>
              <input data-testid="scraper-max-price" type="number" min="0" step="1" placeholder="∞" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="input pl-10 pr-2 py-2 text-sm w-full font-mono"/>
            </div>
          </div>
          <select data-testid="scraper-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="input px-3 py-2 text-sm">
            <option value="created_at_desc">Newest</option>
            <option value="price_asc">Price low → high</option>
            <option value="price_desc">Price high → low</option>
            <option value="margin_desc">Highest margin</option>
            <option value="created_at_asc">Oldest</option>
            <option value="title_asc">Title A→Z</option>
          </select>

          {activeFilterCount > 0 && (
            <button onClick={resetFilters} className="btn btn-ghost text-xs !py-1.5 md:col-span-6 justify-self-start" data-testid="scraper-reset">
              <X size={12}/> Reset filters
            </button>
          )}
        </div>

        {/* Bulk selection bar — visible whenever ≥1 item is selected */}
        {selected.size > 0 && (
          <div className="card p-3 mb-3 flex items-center justify-between flex-wrap gap-2 border-indigo-200 bg-indigo-50/40" data-testid="scraper-bulk-bar">
            <div className="text-sm">
              <span className="font-bold text-indigo-700">{selected.size}</span> item{selected.size === 1 ? "" : "s"} selected
              <button onClick={clearSelection} className="ml-2 text-xs text-slate-500 hover:underline">clear</button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => bulk("add_to_products")} disabled={bulkBusy} className="btn btn-primary text-xs" data-testid="scraper-bulk-add-products"><Plus size={12}/> Push to Products</button>
              <button onClick={() => bulk("deactivate")} disabled={bulkBusy} className="btn btn-ghost text-xs" data-testid="scraper-bulk-deactivate"><PackageX size={12}/> Mark inactive</button>
              <button onClick={() => bulk("activate")} disabled={bulkBusy} className="btn btn-ghost text-xs" data-testid="scraper-bulk-activate"><BadgeCheck size={12}/> Reactivate</button>
              <button onClick={() => bulk("delete")} disabled={bulkBusy} className="btn btn-danger text-xs" data-testid="scraper-bulk-delete">
                {bulkBusy ? <Loader2 className="animate-spin" size={12}/> : <Trash2 size={12}/>} Delete
              </button>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="card p-16 text-center border-dashed">
            <Boxes size={28} className="mx-auto text-slate-300"/>
            <div className="font-display font-bold mt-2">No items match those filters</div>
            <div className="text-sm text-slate-500 mt-1">Try adjusting or resetting filters, or import a new eBay Australia URL above.</div>
          </div>
        ) : (
          <>
            <div className="mb-2 text-xs text-slate-500 flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="accent-indigo-600 w-4 h-4" data-testid="scraper-select-all"/>
                Select all {items.length}
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {items.map((it) => (
                <div key={it.id} className={`card overflow-hidden hover:shadow-lg transition-shadow relative ${it.is_sold ? "opacity-60 grayscale" : ""} ${it.active === false ? "opacity-70" : ""} ${selected.has(it.id) ? "ring-2 ring-indigo-500" : ""}`} data-testid="scraped-card">
                  {it.is_sold && <div className="absolute top-2 left-2 chip chip-danger z-10">SOLD</div>}
                  <label className="absolute top-2 right-2 z-10 grid place-items-center w-6 h-6 rounded-md bg-white/90 border hairline cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleOne(it.id)} className="accent-indigo-600 w-4 h-4" data-testid="scraped-card-checkbox"/>
                  </label>
                  <div className="aspect-[4/3] bg-slate-50 relative cursor-pointer" onClick={() => onView(it)}>
                    {it.images?.[0]
                      ? <img src={proxyImg(it.images[0])} alt="" className="w-full h-full object-contain p-2"/>
                      : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={22}/></div>}
                    {it.added_to_products && <span className="absolute bottom-2 left-2 chip chip-success">✓ In products</span>}
                    {it.active === false && <span className="absolute bottom-2 right-2 chip chip-neutral">Inactive</span>}
                  </div>
                  <div className="p-4">
                    <h3 className="text-sm font-semibold line-clamp-2 min-h-[2.6em] cursor-pointer" onClick={() => onView(it)}>{it.title || "Untitled"}</h3>
                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="font-mono text-lg font-bold text-indigo-600">{it.price_display || "—"}</span>
                      {it.condition && <span className="chip chip-neutral">{it.condition.split(" ").slice(0, 2).join(" ")}</span>}
                    </div>
                    {(() => {
                      const c = calcPricing(it.price_value, rules);
                      return c.ebay > 0 && (
                        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] font-mono" data-testid="scraped-card-pricing">
                          <div className="rounded-md bg-slate-50 border hairline p-1.5">
                            <div className="text-slate-400 uppercase tracking-widest text-[9px]">eBay</div>
                            <div className="text-slate-700 font-bold">${c.ebay.toFixed(2)}</div>
                          </div>
                          <div className="rounded-md bg-indigo-50 border border-indigo-100 p-1.5">
                            <div className="text-indigo-500 uppercase tracking-widest text-[9px]">Sell</div>
                            <div className="text-indigo-700 font-bold">${c.sell.toFixed(2)}</div>
                          </div>
                          <div className="rounded-md bg-emerald-50 border border-emerald-100 p-1.5">
                            <div className="text-emerald-600 uppercase tracking-widest text-[9px]">Profit</div>
                            <div className="text-emerald-700 font-bold">${c.profit.toFixed(2)}</div>
                          </div>
                        </div>
                      );
                    })()}
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      {it.category && <span className="chip chip-primary text-[10px]" data-testid="scraped-card-category" title={(it.ebay_category_path || []).join(" › ")}><Tags size={10}/> {it.category}</span>}
                      {(it.price_history || []).length >= 2 && it.price_history[0].value !== it.price_history[it.price_history.length - 1].value && (
                        <span className="chip chip-warning text-[10px]"><TrendingUp size={10}/> price changed</span>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-slate-500 truncate"><MapPin size={11} className="inline"/> {it.location || "—"}</div>
                    <div className="mt-3 flex items-center gap-1">
                      <button onClick={() => addToProducts(it)} disabled={it.added_to_products} className="btn btn-primary text-xs !py-1.5 flex-1"><Plus size={12}/> {it.added_to_products ? "Added" : "Add to products"}</button>
                      <button onClick={() => refresh(it)} className="btn btn-ghost !p-2" title="Refresh"><RefreshCw size={13}/></button>
                      <button onClick={() => del(it)} className="btn btn-danger !p-2" title="Delete"><Trash2 size={13}/></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      <BackToTopButton />
    </div>
  );
}

/* --------------------------------- Orders --------------------------------- */
