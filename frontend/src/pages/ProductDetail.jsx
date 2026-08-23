import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BadgeCheck, Ban, CheckCircle2, ChevronLeft, ExternalLink, GripVertical, Layout, Loader2, Plus, RefreshCw, Star as StarIcon, Trash2 } from "lucide-react";
import { Field, statusBadge } from "../components/atoms";
import { CatIcon } from "../components/icons";
import { ImageSourceDialog } from "../components/ImageSourceDialog";
import { API, proxyImg } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";

export function ProductDetailPage({ productId, onBack }) {
  const [p, setP] = useState(null);
  const [f, setF] = useState({});
  const [cats, setCats] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCatPopover, setShowCatPopover] = useState(false);
  const [imgDialog, setImgDialog] = useState({ open: false, mode: "add", idx: null, current: "" });
  // Drag-reorder state: the index currently being dragged + which slot is
  // being hovered. Persist to server on drop.
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const load = useCallback(async () => {
    const [prod, rev] = await Promise.all([
      axios.get(`${API}/products/${productId}`).then(r => r.data),
      axios.get(`${API}/products/${productId}/reviews`).then(r => r.data.reviews || []).catch(() => []),
    ]);
    setP(prod);
    setF({
      title: prod.title || "",
      sku: prod.sku || "",
      category: prod.category || "other",
      price: prod.price ?? 0,
      cost: prod.cost ?? 0,
      stock: prod.stock ?? 0,
      active: !!prod.active,
      description: prod.description || "",
    });
    setReviews(rev);
    setDirty(false);
  }, [productId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/categories`, { params: { active: true }}).then(r => setCats(r.data.categories || [])); }, []);

  const setField = (k, v) => { setF(prev => ({ ...prev, [k]: v })); setDirty(true); };
  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/products/${productId}`, {
        title: f.title, sku: f.sku, category: f.category,
        price: Number(f.price), cost: Number(f.cost), stock: Number(f.stock),
        active: !!f.active, description: f.description,
      });
      toast.success("Saved");
      await load();
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail });
    } finally { setSaving(false); }
  };
  const del = async () => {
    if (!window.confirm(`Delete "${p.title}"? This can't be undone.`)) return;
    try { await axios.delete(`${API}/products/${productId}`); toast.success("Deleted"); onBack(); }
    catch { toast.error("Delete failed"); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data } = await axios.post(`${API}/products/${productId}/refresh`);
      setP(data);
      setF(v => ({ ...v, title: data.title, price: data.price, cost: data.cost }));
      toast.success("Refreshed from eBay");
      await load();
    } catch (e) { toast.error("Refresh failed", { description: e?.response?.data?.detail }); }
    finally { setRefreshing(false); }
  };
  const changeCategory = async (slug) => {
    setF(prev => ({ ...prev, category: slug }));
    setShowCatPopover(false);
    try { await axios.patch(`${API}/products/${productId}`, { category: slug }); toast.success("Category updated"); load(); }
    catch { toast.error("Failed"); }
  };
  const removeImage = async (idx) => {
    const next = (p.images || []).filter((_, i) => i !== idx);
    try { await axios.patch(`${API}/products/${productId}`, { images: next }); toast.success("Image removed"); load(); }
    catch { toast.error("Failed"); }
  };
  const openReplace = (idx) => setImgDialog({ open: true, mode: "replace", idx, current: p.images?.[idx] || "" });
  const openAdd = () => setImgDialog({ open: true, mode: "add", idx: null, current: "" });
  const closeImgDialog = () => setImgDialog((s) => ({ ...s, open: false }));
  const submitImage = async (value) => {
    const list = [...(p.images || [])];
    if (imgDialog.mode === "replace" && imgDialog.idx != null) {
      list[imgDialog.idx] = value;
    } else {
      list.push(value);
    }
    await axios.patch(`${API}/products/${productId}`, { images: list });
    toast.success(imgDialog.mode === "replace" ? "Image replaced" : "Image added");
    await load();
  };

  /**
   * Persist a reordered images array. Called by onDrop after the user drags
   * one thumbnail onto another. If the source == target index, this is a no-op.
   */
  const reorderImages = async (from, to) => {
    if (from === to || from == null || to == null) return;
    const list = [...(p.images || [])];
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    // Optimistic UI so the drag feels snappy.
    setP((prev) => ({ ...prev, images: list }));
    try {
      await axios.patch(`${API}/products/${productId}`, { images: list });
      toast.success(to === 0 ? "New listing hero image" : "Image order saved");
    } catch {
      toast.error("Reorder failed");
      await load();
    }
  };

  if (!p) return <div className="text-slate-500 py-24 text-center">loading product…</div>;

  const badge = statusBadge(p);
  const variants = p.variants || [];
  const variantsByType = variants.reduce((acc, v) => { (acc[v.type] = acc[v.type] || []).push(v); return acc; }, {});
  const avg = p.average_rating || 0;
  const margin = f.price ? ((Number(f.price) - Number(f.cost || 0)) / Number(f.price)) * 100 : 0;

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full min-w-0 px-1 sm:px-2" data-testid="product-detail-page">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={onBack} className="btn btn-ghost text-sm" data-testid="product-back-btn"><ChevronLeft size={14}/> Back to products</button>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={refresh} disabled={refreshing || !p.source_url} className="btn btn-ghost text-sm" data-testid="product-refresh-btn" title={p.source_url ? "Re-scrape latest data from eBay" : "This product isn't linked to an eBay URL"}>
            {refreshing ? <Loader2 className="animate-spin" size={13}/> : <RefreshCw size={13}/>} Refresh from eBay
          </button>
          <div className="relative">
            <button onClick={() => setShowCatPopover(v => !v)} className="btn btn-ghost text-sm" data-testid="product-changecat-btn"><Layout size={13}/> Change category</button>
            {showCatPopover && (
              <div className="absolute right-0 top-11 w-64 max-h-72 overflow-y-auto bg-white border hairline shadow-2xl rounded-xl p-2 z-30" data-testid="changecat-popover">
                {cats.map(c => (
                  <button key={c.slug} onClick={() => changeCategory(c.slug)} className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 flex items-center gap-2 ${c.slug === f.category ? "bg-indigo-50 text-indigo-700" : ""}`}>
                    <CatIcon name={c.icon} size={12} style={{ color: c.color }}/>
                    <span>{c.name}</span>
                    <span className="ml-auto text-[10px] text-slate-400 font-mono">{c.group}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={del} className="btn btn-danger text-sm" data-testid="product-delete-btn"><Trash2 size={13}/> Delete</button>
          <button onClick={save} disabled={!dirty || saving} className="btn btn-primary text-sm" data-testid="product-save-btn">
            {saving ? <Loader2 className="animate-spin" size={13}/> : <BadgeCheck size={13}/>} Save
          </button>
        </div>
      </div>

      {/* Title & meta */}
      <div className="card p-5 grid gap-2">
        <input className="input w-full px-3 py-2 text-xl font-display font-bold" value={f.title} onChange={(e) => setField("title", e.target.value)} data-testid="product-title-input"/>
        <div className="flex items-center gap-3 flex-wrap text-xs">
          {p.product_code && <span className="font-mono text-indigo-600 font-bold" data-testid="product-detail-code">{p.product_code}</span>}
          {badge && <span className={`chip ${badge.cls}`}>{badge.label}</span>}
          {p.review_count > 0 && (
            <span className="inline-flex items-center gap-1 font-mono">
              <StarIcon size={11} className="text-amber-500" fill="currentColor"/>
              <span className="font-bold">{avg.toFixed(1)}</span>
              <span className="text-slate-400">({p.review_count} reviews)</span>
            </span>
          )}
          {p.source_url && (
            <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="chip chip-neutral inline-flex items-center gap-1 hover:!bg-indigo-50 hover:!text-indigo-600 transition-colors" data-testid="product-ebay-link">
              <ExternalLink size={11}/> View on eBay
            </a>
          )}
        </div>
      </div>

      {/* Images */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="font-display font-bold">Images · <span className="text-slate-500 font-mono text-sm">{(p.images || []).length}</span></div>
          <div className="flex items-center gap-3">
            {(p.images || []).length > 1 && (
              <div className="text-[11px] text-slate-400 hidden sm:flex items-center gap-1">
                <GripVertical size={11}/> Drag to reorder · first image = listing hero
              </div>
            )}
            <button onClick={openAdd} className="btn btn-ghost text-xs" data-testid="product-add-image-btn"><Plus size={12}/> Add image</button>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1" data-testid="product-images-strip">
          {(p.images || []).length === 0 && <div className="text-slate-400 text-sm py-8 text-center flex-1">No images yet.</div>}
          {(p.images || []).map((src, i) => {
            const isDragging = dragFrom === i;
            const isOver = dragOver === i && dragFrom !== null && dragFrom !== i;
            return (
              <div
                key={`${i}-${src.slice(0, 32)}`}
                draggable
                onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch {} }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOver !== i) setDragOver(i); }}
                onDragEnter={(e) => { e.preventDefault(); }}
                onDragLeave={() => { if (dragOver === i) setDragOver(null); }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const from = dragFrom;
                  setDragFrom(null); setDragOver(null);
                  await reorderImages(from, i);
                }}
                onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                className={`relative shrink-0 w-40 h-40 rounded-xl overflow-hidden bg-slate-100 border hairline group cursor-grab active:cursor-grabbing transition ${isDragging ? "opacity-40 scale-95" : ""} ${isOver ? "ring-2 ring-indigo-500 scale-[1.02]" : ""}`}
                data-testid={`product-image-${i}`}
                data-image-idx={i}
              >
                <img src={proxyImg(src)} alt="" className="w-full h-full object-cover pointer-events-none"/>
                {i === 0 && (
                  <span className="absolute top-2 left-2 chip chip-primary !text-[10px] !py-0.5 shadow-sm">Hero</span>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button onClick={() => openReplace(i)} className="btn btn-ghost !bg-white text-xs !py-1" data-testid={`product-image-replace-${i}`}><RefreshCw size={11}/> Replace</button>
                  <button onClick={() => removeImage(i)} className="btn btn-danger text-xs !py-1" data-testid={`product-image-delete-${i}`}><Trash2 size={11}/></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Variants */}
      {variants.length > 0 && (
        <div className="card p-5" data-testid="product-detail-variants">
          <div className="font-display font-bold mb-3">Variants · <span className="text-slate-500 font-mono text-sm">{variants.length}</span></div>
          <div className="border hairline rounded-lg overflow-hidden">
            <table className="tbl">
              <thead><tr><th>Type</th><th>Option</th><th className="text-right">Price</th><th>Status</th><th>SKU</th></tr></thead>
              <tbody>
                {Object.entries(variantsByType).flatMap(([type, rows]) =>
                  rows.map((v, idx) => (
                    <tr key={`${type}-${idx}-${v.option}`}>
                      {idx === 0 ? <td rowSpan={rows.length} className="align-top font-mono text-xs text-slate-600 border-r hairline bg-slate-50">{type}</td> : null}
                      <td className="text-sm">{v.option}</td>
                      <td className="text-right font-mono text-indigo-600 font-bold">{v.price != null ? moneyCents(v.price) : "—"}</td>
                      <td>
                        {v.stock_status === "live"
                          ? <span className="chip chip-success !text-[10px]"><CheckCircle2 size={10}/> In stock</span>
                          : <span className="chip chip-danger !text-[10px]"><Ban size={10}/> Out of stock</span>}
                      </td>
                      <td className="font-mono text-xs text-slate-500">{v.sku || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Editable fields */}
      <div className="card p-5">
        <div className="font-display font-bold mb-3">Product details</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="SKU"><input className="input w-full px-3 py-2 font-mono" value={f.sku} onChange={(e) => setField("sku", e.target.value)} data-testid="product-sku-input"/></Field>
          <Field label="Product code"><input className="input w-full px-3 py-2 font-mono text-indigo-600 font-bold bg-slate-50" value={p.product_code || ""} readOnly data-testid="product-code-input"/></Field>
          <Field label="Category">
            <select className="input w-full px-3 py-2" value={f.category} onChange={(e) => setField("category", e.target.value)} data-testid="product-category-select">
              {cats.length === 0 && <option value="other">Other</option>}
              {cats.map(c => <option key={c.slug} value={c.slug}>{c.group} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Sell price (AUD)"><input type="number" className="input w-full px-3 py-2 font-mono" value={f.price} onChange={(e) => setField("price", e.target.value)} data-testid="product-price-input"/></Field>
          <Field label="Cost (AUD)"><input type="number" className="input w-full px-3 py-2 font-mono" value={f.cost} onChange={(e) => setField("cost", e.target.value)} data-testid="product-cost-input"/></Field>
          <Field label="Stock"><input type="number" className="input w-full px-3 py-2 font-mono" value={f.stock} onChange={(e) => setField("stock", e.target.value)} data-testid="product-stock-input"/></Field>
          <Field label="Active">
            <select className="input w-full px-3 py-2" value={f.active ? "1" : "0"} onChange={(e) => setField("active", e.target.value === "1")} data-testid="product-active-select">
              <option value="1">Yes — visible on storefront</option>
              <option value="0">No — hidden</option>
            </select>
          </Field>
          <Field label="Margin"><div className={`input w-full px-3 py-2 font-mono ${margin>=40?"text-emerald-600":margin>=20?"text-amber-600":"text-red-600"} font-bold`}>{margin.toFixed(1)}%</div></Field>
        </div>
        <Field label="Description" className="mt-3"><textarea className="input w-full px-3 py-2 min-h-[160px] leading-relaxed" value={f.description} onChange={(e) => setField("description", e.target.value)} data-testid="product-description-input"/></Field>
      </div>

      {/* Reviews */}
      {reviews.length > 0 && (
        <div className="card p-5" data-testid="product-detail-reviews">
          <div className="font-display font-bold mb-3 flex items-center gap-2">
            Reviews · <span className="text-slate-500 font-mono text-sm">{reviews.length}</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 text-sm"><StarIcon size={12} className="text-amber-500" fill="currentColor"/> {avg.toFixed(1)}</span>
          </div>
          <div className="grid gap-2">
            {reviews.slice(0, 8).map(r => (
              <div key={r.id} className="p-3 rounded-lg bg-slate-50 border hairline">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-500 flex items-center gap-0.5">{[1,2,3,4,5].map(i=><StarIcon key={i} size={10} fill={i<=r.rating?"currentColor":"none"}/>)}</span>
                    <span className="text-xs font-medium">{r.customer_name}</span>
                    {r.verified_purchase && <span className="chip chip-success !text-[9px]"><BadgeCheck size={9}/> Verified</span>}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">{fmtDate(r.created_at)}</span>
                </div>
                {r.title && <div className="text-sm font-medium mt-1">{r.title}</div>}
                {r.body && <div className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{r.body}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky footer save */}
      <div className="sticky bottom-4 flex items-center justify-end gap-2 py-2 z-20">
        <button onClick={onBack} className="btn btn-ghost text-sm">Cancel</button>
        <button onClick={save} disabled={!dirty || saving} className="btn btn-primary text-sm shadow-lg" data-testid="product-save-btn-footer">
          {saving ? <Loader2 className="animate-spin" size={13}/> : <BadgeCheck size={13}/>} Save changes
        </button>
      </div>

      <ImageSourceDialog
        open={imgDialog.open}
        mode={imgDialog.mode}
        initialUrl={imgDialog.current}
        onClose={closeImgDialog}
        onSubmit={submitImage}
      />
    </div>
  );
}


/* -------------------------- Full order detail page -------------------------- */
