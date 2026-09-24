import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { CalendarClock, ChevronLeft, DollarSign, ImageIcon, Loader2, Pencil, Plus, RefreshCw, Sparkles, Star as StarIcon, Trash2 } from "lucide-react";
import { statusBadge } from "../components/atoms";
import { CatIcon } from "../components/icons";
import { CategoryEditModal } from "../components/modals/CategoryEditModal";
import { API, proxyImg } from "../lib/api";
import { moneyCents } from "../lib/format";

export function Categories({ navigateTo }) {
  const [cats, setCats] = useState([]);
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [browsing, setBrowsing] = useState(null); // category currently being drilled into
  const [cleanupSchedule, setCleanupSchedule] = useState(null);
  const [cleanupAt, setCleanupAt] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const load = useCallback(async () => {
    const [categoryResponse, scheduleResponse] = await Promise.all([
      axios.get(`${API}/categories`), axios.get(`${API}/categories/cleanup-schedule`),
    ]);
    setCats(categoryResponse.data.categories); setGroups(categoryResponse.data.groups);
    setCleanupSchedule(scheduleResponse.data);
    if (scheduleResponse.data.next_run_at) {
      const date = new Date(scheduleResponse.data.next_run_at);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setCleanupAt(local);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = group ? cats.filter(c => c.group === group) : cats;
  const grouped = filtered.reduce((acc, c) => { (acc[c.group] = acc[c.group] || []).push(c); return acc; }, {});

  const del = async (c) => {
    if (!window.confirm(`Delete category "${c.name}"?`)) return;
    try { await axios.delete(`${API}/categories/${c.id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error("Delete failed", { description: e?.response?.data?.detail }); }
  };
  const toggleActive = async (c) => {
    try { await axios.patch(`${API}/categories/${c.id}`, { active: !c.active }); load(); }
    catch { toast.error("Update failed"); }
  };
  const reseed = async () => {
    if (!window.confirm("Reseed defaults? Existing categories will remain; only missing defaults are added.")) return;
    try { await axios.post(`${API}/categories/reseed`, null); toast.success("Reseeded"); load(); }
    catch (e) { toast.error("Reseed failed", { description: e?.response?.data?.detail }); }
  };
  const cleanupNow = async () => {
    if (!window.confirm("Permanently delete every empty category from the site and database? This cannot be undone.")) return;
    setCleanupBusy(true);
    try {
      const { data } = await axios.post(`${API}/categories/cleanup-empty`);
      toast.success(data.deleted ? `Permanently deleted ${data.deleted} empty categories` : "No empty categories found");
      await load();
    } catch (error) { toast.error("Cleanup failed", { description: error?.response?.data?.detail || error.message }); }
    finally { setCleanupBusy(false); }
  };
  const saveCleanupSchedule = async () => {
    if (cleanupSchedule?.enabled && !cleanupAt) return toast.error("Choose a future date and time");
    setCleanupBusy(true);
    try {
      const { data } = await axios.patch(`${API}/categories/cleanup-schedule`, {
        enabled: !!cleanupSchedule?.enabled,
        recurrence: cleanupSchedule?.recurrence || "once",
        ...(cleanupAt ? { next_run_at: new Date(cleanupAt).toISOString() } : {}),
      });
      setCleanupSchedule(data);
      toast.success(data.enabled ? "Empty category cleanup scheduled" : "Cleanup schedule paused");
    } catch (error) { toast.error("Schedule failed", { description: error?.response?.data?.detail || error.message }); }
    finally { setCleanupBusy(false); }
  };

  if (browsing) {
    return <CategoryProductBrowser cat={browsing} onBack={() => { setBrowsing(null); load(); }} navigateTo={navigateTo}/>;
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-display text-2xl font-bold tracking-tight">Categories</div>
          <div className="text-xs text-slate-500 font-mono">{cats.length} categories across {groups.length} groups · click a card to browse products</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={group} onChange={(e)=>setGroup(e.target.value)} className="input px-3 py-2 text-sm" data-testid="cat-group-filter">
            <option value="">All groups</option>
            {groups.map(g => <option key={g}>{g}</option>)}
          </select>
          <button onClick={reseed} className="btn btn-ghost text-sm"><Sparkles size={13}/> Reseed defaults</button>
          <button onClick={() => setCreating(true)} className="btn btn-primary text-sm" data-testid="add-category-btn"><Plus size={14}/> New category</button>
        </div>
      </div>

      {cleanupSchedule && <div className="border hairline rounded-lg p-4 grid gap-4" data-testid="category-cleanup-scheduler">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex gap-3">
            <CalendarClock size={18} className="text-indigo-600 mt-0.5"/>
            <div><div className="font-medium text-sm">Empty category cleanup</div><div className="text-xs text-slate-500">Permanently removes categories with no products from the site and database.</div></div>
          </div>
          <button onClick={cleanupNow} disabled={cleanupBusy} className="btn btn-danger text-sm" data-testid="category-cleanup-now-button"><Trash2 size={14}/> Delete empty now</button>
        </div>
        <div className="grid sm:grid-cols-[auto_minmax(0,1fr)_180px_auto] gap-3 items-end pt-3 border-t hairline">
          <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="category-cleanup-enabled-toggle"><input type="checkbox" checked={!!cleanupSchedule.enabled} onChange={(event) => setCleanupSchedule(current => ({ ...current, enabled: event.target.checked }))} className="accent-indigo-600 w-4 h-4"/> Schedule cleanup</label>
          <label className="grid gap-1 text-xs text-slate-500">Date & time<input type="datetime-local" value={cleanupAt} onChange={(event) => setCleanupAt(event.target.value)} className="input px-3 py-2 text-sm" data-testid="category-cleanup-datetime-input"/></label>
          <label className="grid gap-1 text-xs text-slate-500">Repeat<select value={cleanupSchedule.recurrence || "once"} onChange={(event) => setCleanupSchedule(current => ({ ...current, recurrence: event.target.value }))} className="input px-3 py-2 text-sm" data-testid="category-cleanup-recurrence-select"><option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
          <button onClick={saveCleanupSchedule} disabled={cleanupBusy} className="btn btn-primary text-sm" data-testid="category-cleanup-save-button">{cleanupBusy ? <Loader2 size={14} className="animate-spin"/> : <CalendarClock size={14}/>} Save</button>
        </div>
        <div className="text-xs text-slate-500" data-testid="category-cleanup-schedule-status">{cleanupSchedule.enabled && cleanupSchedule.next_run_at ? `Next cleanup: ${new Date(cleanupSchedule.next_run_at).toLocaleString()}` : "Automatic cleanup is paused."}</div>
      </div>}

      {Object.keys(grouped).sort().map((g) => (
        <div key={g}>
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2">
            <span>{g}</span><span className="text-slate-300">·</span><span>{grouped[g].length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {grouped[g].map((c) => (
              <div key={c.id} onClick={() => setBrowsing(c)}
                className={`card p-4 group cursor-pointer hover:shadow-lg hover:border-indigo-200 transition-all ${!c.active ? "opacity-50" : ""}`}
                data-testid={`category-card-${c.slug}`}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl grid place-items-center shrink-0" style={{ background: `${c.color}20`, color: c.color }}>
                    <CatIcon name={c.icon} size={18}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-semibold truncate">{c.name}</div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">/{c.slug}</div>
                  </div>
                  <span className="chip chip-neutral">{c.product_count}</span>
                </div>
                <div className="text-xs text-slate-500 mt-3 leading-relaxed line-clamp-2 min-h-[2.4em]">{c.description || "—"}</div>
                <div className="mt-3 pt-3 border-t hairline flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <label className="flex items-center gap-1.5 text-[11px] font-mono uppercase text-slate-500 cursor-pointer mr-auto">
                    <input type="checkbox" checked={c.active} onChange={()=>toggleActive(c)} className="accent-indigo-600 w-3.5 h-3.5"/>Active
                  </label>
                  <button onClick={()=>setEditing(c)} className="btn btn-ghost text-xs !py-1 !px-2">Edit</button>
                  <button onClick={()=>del(c)} className="btn btn-danger text-xs !py-1 !px-2"><Trash2 size={12}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <AnimatePresence>
        {(creating || editing) && <CategoryEditModal cat={editing} groups={groups} onClose={()=>{ setCreating(false); setEditing(null); }} onSaved={()=>{ setCreating(false); setEditing(null); load(); }}/>}
      </AnimatePresence>
    </div>
  );
}

export function CategoryProductBrowser({ cat, onBack, navigateTo }) {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState({}); // {productId: "refresh"|"price"}
  const [cats, setCats] = useState([]);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/products`, { params: { category: cat.slug, sort: "created_at_desc" }});
    setList(data.products || []); setTotal(data.total || 0);
  }, [cat.slug]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/categories`, { params: { active: true }}).then(r => setCats(r.data.categories)); }, []);

  const del = async (p) => { if (!window.confirm(`Delete "${p.title}"?`)) return; await axios.delete(`${API}/products/${p.id}`); toast.success("Deleted"); load(); };
  const refresh = async (p) => {
    if (!p.source_url) return toast.error("This product isn't linked to an eBay URL");
    setBusy(b => ({ ...b, [p.id]: "refresh" }));
    try {
      const { data } = await axios.post(`${API}/scrape`, { url: p.source_url, refresh: true });
      // Backend mirrors stock_status/price to the product; just reload
      toast.success(`Refreshed · latest eBay price ${data?.price || "—"}`);
      load();
    } catch (e) {
      toast.error("Refresh failed", { description: e?.response?.data?.detail });
    } finally { setBusy(b => ({ ...b, [p.id]: null })); }
  };
  const updatePrice = async (p) => {
    const v = window.prompt(`Set new sell price for "${p.title.slice(0,50)}"`, String(p.price ?? ""));
    if (v == null) return;
    const num = parseFloat(v);
    if (!Number.isFinite(num) || num < 0) return toast.error("Enter a valid price");
    await axios.patch(`${API}/products/${p.id}`, { price: num });
    toast.success("Price updated"); load();
  };

  return (
    <div className="grid gap-4" data-testid="category-product-browser">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn btn-ghost text-sm" data-testid="cat-back"><ChevronLeft size={14}/> Back to categories</button>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl grid place-items-center" style={{ background: `${cat.color}20`, color: cat.color }}>
              <CatIcon name={cat.icon} size={18}/>
            </div>
            <div>
              <div className="font-display text-xl font-bold tracking-tight">{cat.name}</div>
              <div className="text-xs text-slate-500 font-mono">{total} product{total===1?"":"s"} · /{cat.slug}</div>
            </div>
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card p-12 text-center text-slate-500">No products in this category yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map(p => {
            const badge = statusBadge(p);
            const dead = p.is_sold || !p.active || (p.stock_status && p.stock_status !== "live");
            const margin = p.price ? ((p.price - (p.cost || 0)) / p.price) * 100 : 0;
            const isBusy = busy[p.id];
            return (
              <div key={p.id} data-testid={`cat-product-card-${p.id}`}
                className={`card p-0 overflow-hidden flex flex-col ${dead ? "opacity-70" : ""}`}>
                <div className={`aspect-[4/3] bg-slate-100 relative ${dead ? "grayscale" : ""}`}>
                  {p.images?.[0]
                    ? <img src={proxyImg(p.images[0])} alt="" className="w-full h-full object-cover"/>
                    : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={28}/></div>}
                  {badge && <span className={`chip ${badge.cls} absolute top-2 left-2`}>{badge.label}</span>}
                  {p.product_code && (
                    <span className="absolute bottom-2 left-2 font-mono text-[10px] font-bold text-white bg-indigo-600/85 rounded-md px-2 py-0.5" data-testid={`cat-product-code-${p.id}`}>
                      {p.product_code}
                    </span>
                  )}
                </div>
                <div className="p-4 flex flex-col gap-2 flex-1">
                  <div className="text-sm font-medium line-clamp-2 min-h-[2.6em]" title={p.title}>{p.title}</div>
                  {(p.review_count ?? 0) > 0 && (
                    <div className="flex items-center gap-1 text-xs" data-testid={`cat-rating-${p.id}`}>
                      <StarIcon size={11} className="text-amber-500" fill="currentColor"/>
                      <span className="font-mono font-bold">{(p.average_rating ?? 0).toFixed(1)}</span>
                      <span className="text-slate-400 font-mono">({p.review_count} review{p.review_count===1?"":"s"})</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                    <div>
                      <div className="text-slate-400 font-mono uppercase tracking-widest text-[10px]">eBay</div>
                      <div className="font-mono text-slate-700">{p.cost > 0 ? moneyCents(p.cost) : "—"}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 font-mono uppercase tracking-widest text-[10px]">Sell</div>
                      <div className="font-mono font-bold text-indigo-600">{moneyCents(p.price)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 font-mono uppercase tracking-widest text-[10px]">Margin</div>
                      <div className={`font-mono font-bold ${margin>=40?"text-emerald-600":margin>=20?"text-amber-600":"text-red-600"}`}>{margin.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-slate-400 font-mono uppercase tracking-widest text-[10px]">Stock</div>
                      <div className={`font-mono font-bold ${p.stock <= 3 ? "text-red-600" : "text-slate-700"}`}>{p.stock ?? 0}</div>
                    </div>
                  </div>
                  <div className="mt-auto pt-3 border-t hairline grid grid-cols-2 gap-1.5">
                    <button onClick={() => navigateTo && navigateTo({ tab: "products", section: "all", filter: { productId: p.id }})} className="btn btn-ghost text-xs !py-1.5" data-testid={`cat-edit-${p.id}`}><Pencil size={11}/> Open</button>
                    <button onClick={() => updatePrice(p)} className="btn btn-ghost text-xs !py-1.5" data-testid={`cat-price-${p.id}`}><DollarSign size={11}/> Update price</button>
                    <button onClick={() => refresh(p)} disabled={!!isBusy || !p.source_url} className="btn btn-ghost text-xs !py-1.5" title={p.source_url ? "Re-scrape latest from eBay" : "Not linked to eBay"} data-testid={`cat-refresh-${p.id}`}>
                      {isBusy === "refresh" ? <Loader2 className="animate-spin" size={11}/> : <RefreshCw size={11}/>} Refresh
                    </button>
                    <button onClick={() => del(p)} className="btn btn-danger text-xs !py-1.5" data-testid={`cat-delete-${p.id}`}><Trash2 size={11}/> Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {/* CategoryProductBrowser no longer renders the modal — Edit navigates to the full product page */}
      </AnimatePresence>
    </div>
  );
}

