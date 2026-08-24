import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BadgeCheck, Ban, Calendar, CheckCircle2, ChevronLeft, ExternalLink, GripVertical, Layout, Loader2, Pencil, Plus, RefreshCw, Save, Star as StarIcon, Trash2, Truck, X } from "lucide-react";
import { Field, statusBadge } from "../components/atoms";
import { CatIcon } from "../components/icons";
import { ImageSourceDialog } from "../components/ImageSourceDialog";
import { API, proxyImg, imgThumb, imgFull } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { computeDeliveryEstimate, formatCutoffLabel } from "../lib/delivery";

export function ProductDetailPage({ productId, onBack }) {
  const [p, setP] = useState(null);
  const [f, setF] = useState({});
  const [cats, setCats] = useState([]);
  const [presets, setPresets] = useState([]);
  const [deliveryDefaults, setDeliveryDefaults] = useState({ default_min_days: 3, default_max_days: 7, cutoff_enabled: true, cutoff_hhmm: "14:00" });
  const [reviews, setReviews] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCatPopover, setShowCatPopover] = useState(false);
  const [imgDialog, setImgDialog] = useState({ open: false, mode: "add", idx: null, current: "" });
  const [lightboxIdx, setLightboxIdx] = useState(null);   // opens full-size viewer at index
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
      postage_preset_id: prod.postage_preset_id || "",
      postage_amount: prod.postage_amount ?? "",
      postage_insurance_amount: prod.postage_insurance_amount ?? "",
      custom_delivery_window: !!prod.custom_delivery_window,
      delivery_min_days: prod.delivery_min_days ?? "",
      delivery_max_days: prod.delivery_max_days ?? "",
    });
    setReviews(rev);
    setDirty(false);
  }, [productId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/categories`, { params: { active: true }}).then(r => setCats(r.data.categories || [])); }, []);
  useEffect(() => { axios.get(`${API}/postage-presets`).then(r => setPresets((r.data.presets || []).filter(x => x.active !== false))); }, []);
  useEffect(() => { axios.get(`${API}/delivery-settings`).then(r => setDeliveryDefaults(r.data || { default_min_days: 3, default_max_days: 7 })); }, []);

  const setField = (k, v) => { setF(prev => ({ ...prev, [k]: v })); setDirty(true); };
  const save = async () => {
    setSaving(true);
    try {
      const selectedPreset = presets.find(x => x.id === f.postage_preset_id);
      const body = {
        title: f.title, sku: f.sku, category: f.category,
        price: Number(f.price), cost: Number(f.cost), stock: Number(f.stock),
        active: !!f.active, description: f.description,
      };
      // Only include postage fields when the admin has actually chosen a preset.
      // A blank selection leaves whatever was already stored on the product
      // (typically the scraped `postage` string) untouched.
      if (f.postage_preset_id) {
        body.postage_preset_id = f.postage_preset_id;
        if (selectedPreset?.kind === "free") {
          body.postage_amount = 0;
          body.postage_insurance_amount = 0;
        } else if (selectedPreset?.kind === "large_item") {
          body.postage_amount = Number(f.postage_amount) || 0;
          body.postage_insurance_amount = Number(f.postage_insurance_amount) || 0;
        } else {
          // "standard" or unknown → single amount, insurance cleared
          body.postage_amount = Number(f.postage_amount) || 0;
          body.postage_insurance_amount = 0;
        }
      }
      // Custom delivery window: only send min/max when the toggle is ON so
      // turning it OFF cleanly reverts the product to the store-wide default
      // (the frontend uses `custom_delivery_window` to pick which to show).
      body.custom_delivery_window = !!f.custom_delivery_window;
      if (f.custom_delivery_window) {
        body.delivery_min_days = Number(f.delivery_min_days) || 0;
        body.delivery_max_days = Number(f.delivery_max_days) || 0;
        if (body.delivery_max_days < body.delivery_min_days) {
          setSaving(false);
          return toast.error("Max delivery days must be greater than or equal to min days");
        }
      }
      await axios.patch(`${API}/products/${productId}`, body);
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
                onClick={() => setLightboxIdx(i)}
                role="button"
                aria-label="Open full-size image"
                className={`relative shrink-0 w-40 h-40 rounded-xl overflow-hidden bg-slate-100 border hairline group cursor-pointer active:cursor-grabbing transition ${isDragging ? "opacity-40 scale-95" : ""} ${isOver ? "ring-2 ring-indigo-500 scale-[1.02]" : ""}`}
                data-testid={`product-image-${i}`}
                data-image-idx={i}
              >
                <img src={proxyImg(imgThumb(src))} alt="" loading="lazy" className="w-full h-full object-cover pointer-events-none"/>
                {i === 0 && (
                  <span className="absolute top-2 left-2 chip chip-primary !text-[10px] !py-0.5 shadow-sm pointer-events-none">Hero</span>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
                  <button
                    onClick={(e) => { e.stopPropagation(); openReplace(i); }}
                    className="btn btn-ghost !bg-white text-xs !py-1 pointer-events-auto"
                    data-testid={`product-image-replace-${i}`}
                  ><RefreshCw size={11}/> Replace</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                    className="btn btn-danger text-xs !py-1 pointer-events-auto"
                    data-testid={`product-image-delete-${i}`}
                  ><Trash2 size={11}/></button>
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
          {/* Postage preset — replaces the previously read-only scraped
              postage line. The admin picks a preset from Store Management ›
              Postage Presets. If the chosen preset is "Large Item" we show
              two extra fields (postage + insurance) pre-filled from the
              preset but editable so an admin can tweak them for this
              specific product without changing the shared preset. */}
          <div className="md:col-span-3">
            <PostagePresetField
              presets={presets}
              product={p}
              f={f}
              setF={setF}
              setDirty={setDirty}
            />
          </div>
          <div className="md:col-span-3">
            <DeliveryWindowField
              f={f}
              setF={setF}
              setDirty={setDirty}
              defaults={deliveryDefaults}
            />
          </div>
        </div>
        <Field label="Description" className="mt-3"><textarea className="input w-full px-3 py-2 min-h-[160px] leading-relaxed" value={f.description} onChange={(e) => setField("description", e.target.value)} data-testid="product-description-input"/></Field>
      </div>

      {/* Product specifications — grouped labelled fields scraped from eBay item specifics.
          Displayed as its own section so the description above stays a clean overview. */}
      <ProductSpecsCard product={p} onUpdated={(fresh) => setP(fresh)}/>

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
      <ProductImageLightbox
        images={p.images || []}
        idx={lightboxIdx}
        onClose={() => setLightboxIdx(null)}
        onNav={(next) => setLightboxIdx(next)}
      />
    </div>
  );
}


/* ------------------------ Full-size image lightbox --------------------------
 *
 * We only store `s-l1600` URLs; this viewer renders the full-size version
 * using `imgFull(src)`. Left/right arrows and the ← → keys step through the
 * gallery, Escape closes.
 * ------------------------------------------------------------------------- */

function ProductImageLightbox({ images, idx, onClose, onNav }) {
  const open = idx !== null && images[idx];
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && idx < images.length - 1) onNav(idx + 1);
      else if (e.key === "ArrowLeft"  && idx > 0)                 onNav(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, idx, images.length, onClose, onNav]);
  if (!open) return null;
  const src = images[idx];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 md:p-10"
      onClick={onClose}
      data-testid="product-image-lightbox"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white text-3xl leading-none w-10 h-10 grid place-items-center rounded-full bg-black/40 hover:bg-black/60 transition-colors"
        aria-label="Close"
        data-testid="lightbox-close"
      >
        ×
      </button>
      {idx > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNav(idx - 1); }}
          className="absolute left-4 md:left-8 text-white/80 hover:text-white text-4xl leading-none w-12 h-12 grid place-items-center rounded-full bg-black/40 hover:bg-black/60 transition-colors"
          aria-label="Previous image"
          data-testid="lightbox-prev"
        >‹</button>
      )}
      {idx < images.length - 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNav(idx + 1); }}
          className="absolute right-4 md:right-8 text-white/80 hover:text-white text-4xl leading-none w-12 h-12 grid place-items-center rounded-full bg-black/40 hover:bg-black/60 transition-colors"
          aria-label="Next image"
          data-testid="lightbox-next"
        >›</button>
      )}
      <img
        src={proxyImg(imgFull(src))}
        alt=""
        className="max-w-[95vw] max-h-[92vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="lightbox-image"
      />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-xs font-mono bg-black/50 px-3 py-1 rounded-full">
        {idx + 1} / {images.length}
      </div>
    </div>
  );
}


/* -------------------------- Full order detail page -------------------------- */


/* --------------------- Product Specifications section ----------------------
 *
 * Groups scraped eBay item-specifics into buckets the admin actually cares
 * about (Dimensions, Materials, Colours, Weight, then everything else in
 * "Other specifications"). Each row is a `LABEL: value` line so the section
 * stays scannable even for listings with 30+ specifics.
 * ------------------------------------------------------------------------- */

// Keyword rules for grouping specifics. Case-insensitive substring match on
// the spec label. Priority = order in the array; first match wins.
const SPEC_GROUPS = [
  { id: "dimensions", title: "Dimensions", keywords: ["dimension", "size", "length", "width", "height", "depth", "diameter"] },
  { id: "materials",  title: "Materials",  keywords: ["material", "fabric", "composition"] },
  { id: "colours",    title: "Colours",    keywords: ["colour", "color", "finish"] },
  { id: "weight",     title: "Weight",     keywords: ["weight", "gross weight", "net weight"] },
];

function bucketSpecs(specifics) {
  const groups = SPEC_GROUPS.map((g) => ({ ...g, entries: [] }));
  const other = [];
  const entries = Object.entries(specifics || {});
  for (const [rawLabel, rawValue] of entries) {
    const label = String(rawLabel || "").trim();
    const value = String(rawValue || "").trim();
    if (!label || !value) continue;
    const key = label.toLowerCase();
    const grp = groups.find((g) => g.keywords.some((k) => key.includes(k)));
    (grp ? grp.entries : other).push({ label, value });
  }
  const filled = groups.filter((g) => g.entries.length > 0);
  return { groups: filled, other };
}

/**
 * Custom delivery window picker. When the toggle is OFF, the store-wide
 * default is used (shown as a preview line for reference). When ON, admins
 * can override min/max business days for this specific product — useful for
 * large items that ship slower. The preview updates live in the browser so
 * the date range rolls forward automatically each new day without any
 * background job.
 */
export function DeliveryWindowField({ f, setF, setDirty, defaults }) {
  const useCustom = !!f.custom_delivery_window;
  const min = useCustom ? (Number(f.delivery_min_days) || 0) : Number(defaults.default_min_days) || 0;
  const max = useCustom ? (Number(f.delivery_max_days) || 0) : Number(defaults.default_max_days) || 0;
  const invalid = useCustom && max < min;
  const cutoff = { enabled: !!defaults.cutoff_enabled, hhmm: defaults.cutoff_hhmm || "14:00" };
  const est = computeDeliveryEstimate(min, max, new Date(), cutoff);

  const toggle = (v) => {
    setF(prev => ({
      ...prev,
      custom_delivery_window: v,
      // Seed the override with the current defaults so admins have a
      // reasonable starting point instead of an empty field.
      delivery_min_days: v && (prev.delivery_min_days === "" || prev.delivery_min_days == null)
        ? defaults.default_min_days : prev.delivery_min_days,
      delivery_max_days: v && (prev.delivery_max_days === "" || prev.delivery_max_days == null)
        ? defaults.default_max_days : prev.delivery_max_days,
    }));
    setDirty(true);
  };

  return (
    <div className="grid gap-3" data-testid="product-delivery-window-field">
      <label className="flex items-start gap-3 p-3 rounded-lg border hairline bg-slate-50/40 cursor-pointer" data-testid="product-custom-delivery-toggle">
        <input
          type="checkbox"
          checked={useCustom}
          onChange={(e) => toggle(e.target.checked)}
          className="accent-indigo-600 mt-1 w-4 h-4"
        />
        <div className="flex-1">
          <div className="text-sm font-medium flex items-center gap-2"><Truck size={14} className="text-slate-500"/> Custom delivery window</div>
          <div className="text-xs text-slate-500 mt-0.5">
            When OFF, this product uses the store-wide default ({defaults.default_min_days}–{defaults.default_max_days} business days). Turn it ON to override for large items or slow-shipping products.
          </div>
        </div>
        <span className={`chip ${useCustom ? "chip-primary" : "chip-neutral"} font-mono text-[10px] shrink-0`}>{useCustom ? "Custom" : "Default"}</span>
      </label>

      {useCustom && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Min business days">
            <input
              type="number" min="0" max="365" step="1"
              className="input w-full px-3 py-2 font-mono"
              value={f.delivery_min_days}
              onChange={(e) => { setF(v => ({ ...v, delivery_min_days: e.target.value })); setDirty(true); }}
              data-testid="product-delivery-min-input"
            />
          </Field>
          <Field label="Max business days">
            <input
              type="number" min="0" max="365" step="1"
              className="input w-full px-3 py-2 font-mono"
              value={f.delivery_max_days}
              onChange={(e) => { setF(v => ({ ...v, delivery_max_days: e.target.value })); setDirty(true); }}
              data-testid="product-delivery-max-input"
            />
          </Field>
        </div>
      )}

      {invalid ? (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
          <Calendar size={13}/> Max days must be greater than or equal to min days.
        </div>
      ) : (
        <div
          className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/60"
          data-testid="product-delivery-estimate-preview"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 flex items-center gap-1">
              <Calendar size={11}/> Live delivery estimate
            </div>
            {est.shifted && (
              <span className="chip chip-warning font-mono text-[10px]" data-testid="product-delivery-shift-chip">
                {est.shiftReason === "cutoff"
                  ? `After ${formatCutoffLabel(cutoff.hhmm)} cutoff · shipping next business day`
                  : "Weekend order · shipping Monday"}
              </span>
            )}
          </div>
          <div className="text-sm text-slate-800 mt-0.5 font-medium" data-testid="product-delivery-estimate-label">
            {est.label}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            {min}–{max} business days · weekends skipped · {useCustom ? "custom override" : "store default"}
          </div>
        </div>
      )}
    </div>
  );
}


/* ------------------------ Postage / Delivery card --------------------------
 *
 * eBay listings pack the postage area with restriction lines ("Doesn't post
 * to United States", "Located in:", "See details for delivery"). We only
 * scrape the two positive signals — the green-bold delivery speed and the
 * "Get it between …" ETA — and render them as a clean two-line card. If
 * neither was captured we fall back to the plain postage string.
 * ------------------------------------------------------------------------- */

/**
 * Product-level postage picker. Renders a dropdown of active presets from
 * Store Management. When the chosen preset is `large_item`, we surface two
 * editable amounts (postage + insurance) pre-filled from the preset so the
 * admin can override per product without touching the shared preset.
 *
 * The scraped delivery-speed / ETA still show underneath for reference so
 * the admin can compare eBay's advertised delivery to their own priced-in
 * postage.
 */
export function PostagePresetField({ presets, product, f, setF, setDirty }) {
  const selectedId = f.postage_preset_id || "";
  const selected = presets.find(p => p.id === selectedId) || null;
  const kind = selected?.kind || null;

  const pickPreset = (pid) => {
    const pr = presets.find(x => x.id === pid) || null;
    setF(prev => ({
      ...prev,
      postage_preset_id: pid,
      // Pre-fill overrides from the preset each time the user changes it.
      postage_amount: pr && pr.kind !== "free" ? pr.postage_amount : "",
      postage_insurance_amount: pr && pr.kind === "large_item" ? pr.insurance_amount : "",
    }));
    setDirty(true);
  };

  return (
    <div className="grid gap-3" data-testid="product-postage-preset-field">
      <Field label="Postage preset">
        <select
          className="input w-full px-3 py-2"
          value={selectedId}
          onChange={(e) => pickPreset(e.target.value)}
          data-testid="product-postage-preset-select"
        >
          <option value="">— Not selected (use scraped postage below) —</option>
          {presets.map(pr => (
            <option key={pr.id} value={pr.id}>
              {pr.name}
              {pr.kind === "free"       ? "  ·  Free"
                : pr.kind === "large_item" ? `  ·  $${Number(pr.postage_amount).toFixed(2)} + $${Number(pr.insurance_amount).toFixed(2)} insurance`
                : `  ·  $${Number(pr.postage_amount).toFixed(2)}`}
            </option>
          ))}
        </select>
      </Field>

      {kind === "large_item" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Postage amount (AUD)">
            <input
              type="number" min="0" step="0.01"
              className="input w-full px-3 py-2 font-mono"
              value={f.postage_amount}
              onChange={(e) => { setF(v => ({ ...v, postage_amount: e.target.value })); setDirty(true); }}
              data-testid="product-postage-amount-input"
            />
          </Field>
          <Field label="Insurance amount (AUD)">
            <input
              type="number" min="0" step="0.01"
              className="input w-full px-3 py-2 font-mono"
              value={f.postage_insurance_amount}
              onChange={(e) => { setF(v => ({ ...v, postage_insurance_amount: e.target.value })); setDirty(true); }}
              data-testid="product-postage-insurance-input"
            />
          </Field>
        </div>
      )}

      {kind === "standard" && (
        <Field label="Postage amount (AUD)">
          <input
            type="number" min="0" step="0.01"
            className="input w-full px-3 py-2 font-mono md:w-1/2"
            value={f.postage_amount}
            onChange={(e) => { setF(v => ({ ...v, postage_amount: e.target.value })); setDirty(true); }}
            data-testid="product-postage-amount-input"
          />
        </Field>
      )}

      {/* Scraped delivery/ETA reference (informational). */}
      <PostageCard product={product}/>
    </div>
  );
}


// Junk phrases sometimes leaked into the postage string on older records.
// We defensively strip them at render time so retro data cleans itself up.
const _POSTAGE_JUNK = /(doesn't\s+post\s+to.*|see\s+details\s+for\s+delivery.*|located\s+in:.*|international\s+shipment.*)/gi;

function cleanPostageText(s) {
  return (s || "").replace(_POSTAGE_JUNK, "").replace(/\s{2,}/g, " ").trim();
}

export function PostageCard({ product }) {
  const speed = cleanPostageText(product?.delivery_speed);
  const eta = cleanPostageText(product?.delivery_date_range);
  const fallback = cleanPostageText(product?.postage);
  const isFree = /free/i.test(speed || fallback || "");
  const hasClean = !!(speed || eta);

  return (
    <div
      className="w-full px-4 py-3 rounded-lg border hairline bg-emerald-50/40"
      data-testid="product-postage-display"
    >
      {hasClean ? (
        <div className="grid gap-1">
          {speed && (
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm" data-testid="postage-speed">
              <CheckCircle2 size={14} className="shrink-0"/>
              <span>{speed}</span>
            </div>
          )}
          {eta && (
            <div className="flex items-center gap-2 text-slate-500 text-xs" data-testid="postage-eta">
              <Calendar size={12} className="shrink-0"/>
              <span>{eta}</span>
            </div>
          )}
        </div>
      ) : fallback ? (
        <div className={`flex items-center gap-2 text-sm font-medium ${isFree ? "text-emerald-700" : "text-slate-800"}`}>
          <CheckCircle2 size={14} className="shrink-0"/>
          <span>{fallback}</span>
        </div>
      ) : (
        <span className="text-slate-400 italic text-sm">Not specified</span>
      )}
    </div>
  );
}


function SpecRow({ label, value }) {  return (
    <div className="grid grid-cols-[minmax(120px,180px)_1fr] gap-3 py-1.5 text-sm border-b hairline last:border-0" data-testid="product-spec-row">
      <div className="text-slate-500 font-medium">{label}</div>
      <div className="text-slate-800 whitespace-pre-wrap break-words">{value}</div>
    </div>
  );
}

// Turn the specifics dict into a stable ordered array of `{id, label, value}`
// tuples so React can key on `id` while the admin edits, adds, or deletes.
function specsToRows(specifics) {
  return Object.entries(specifics || {}).map(([label, value], i) => ({
    id: `spec-${i}-${label}`,
    label,
    value: String(value ?? ""),
  }));
}

export function ProductSpecsCard({ product, onUpdated }) {
  const specifics = product?.specifics || {};
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(() => specsToRows(specifics));
  const [saving, setSaving] = useState(false);

  // Reset local rows whenever the parent product refreshes.
  useEffect(() => { if (!editing) setRows(specsToRows(specifics)); }, [product?.id, JSON.stringify(specifics), editing]);

  const { groups, other } = bucketSpecs(specifics);
  const hasAny = groups.length > 0 || other.length > 0;

  const patchRow = (id, patch) => setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...patch } : r));
  const addRow = () => setRows((rs) => [...rs, { id: `spec-new-${Date.now()}-${rs.length}`, label: "", value: "" }]);
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));

  const save = async () => {
    // Build the specifics dict from the edited rows, dropping blank labels and
    // silently merging duplicate labels (last write wins) to keep the shape sane.
    const out = {};
    for (const r of rows) {
      const label = (r.label || "").trim();
      const value = (r.value || "").trim();
      if (!label || !value) continue;
      out[label] = value;
    }
    setSaving(true);
    try {
      const { data } = await axios.patch(`${API}/products/${product.id}`, { specifics: out });
      toast.success("Specifications saved");
      onUpdated?.(data);
      setEditing(false);
    } catch (e) {
      toast.error("Could not save specifications", { description: e?.response?.data?.detail || e.message });
    } finally {
      setSaving(false);
    }
  };

  // Empty state — show a lightweight prompt so admins can start from scratch.
  if (!editing && !hasAny) {
    return (
      <div className="card p-5" data-testid="product-specs">
        <div className="flex items-center justify-between mb-3">
          <div className="font-display font-bold">Specifications</div>
          <button onClick={() => { setRows([]); addRow(); setEditing(true); }} className="btn btn-primary text-xs" data-testid="specs-add-first"><Plus size={12}/> Add specs</button>
        </div>
        <div className="text-sm text-slate-500 italic">No specifications yet — add dimensions, materials, colours, weight, or anything else worth showing.</div>
      </div>
    );
  }

  return (
    <div className="card p-5" data-testid="product-specs">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="font-display font-bold">Specifications</div>
        {editing ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setEditing(false); setRows(specsToRows(specifics)); }}
              className="btn btn-ghost text-xs"
              disabled={saving}
              data-testid="specs-cancel"
            ><X size={12}/> Cancel</button>
            <button
              onClick={save}
              className="btn btn-primary text-xs"
              disabled={saving}
              data-testid="specs-save"
            >{saving ? <Loader2 className="animate-spin" size={12}/> : <Save size={12}/>} Save</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="btn btn-ghost text-xs" data-testid="specs-edit"><Pencil size={12}/> Edit</button>
        )}
      </div>

      {editing ? (
        <div>
          {rows.length === 0 && <div className="text-sm text-slate-500 italic mb-3">No rows. Add one to get started.</div>}
          <div className="grid gap-2">
            {rows.map((r, idx) => (
              <div key={r.id} className="grid grid-cols-[minmax(120px,180px)_1fr_auto] gap-2 items-center" data-testid={`spec-edit-row-${idx}`}>
                <input
                  value={r.label}
                  onChange={(e) => patchRow(r.id, { label: e.target.value })}
                  placeholder="Label (e.g. Length)"
                  className="input px-3 py-1.5 text-sm"
                  data-testid={`spec-edit-label-${idx}`}
                />
                <input
                  value={r.value}
                  onChange={(e) => patchRow(r.id, { value: e.target.value })}
                  placeholder="Value (e.g. 180 cm)"
                  className="input px-3 py-1.5 text-sm"
                  data-testid={`spec-edit-value-${idx}`}
                />
                <button
                  onClick={() => removeRow(r.id)}
                  className="btn btn-danger !p-2"
                  title="Delete spec"
                  data-testid={`spec-edit-delete-${idx}`}
                ><Trash2 size={12}/></button>
              </div>
            ))}
          </div>
          <button onClick={addRow} className="btn btn-ghost text-xs mt-3" data-testid="specs-add-row"><Plus size={12}/> Add spec</button>
        </div>
      ) : (
        <div className="grid gap-5">
          {groups.map((g) => (
            <div key={g.id}>
              <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-1">{g.title}</div>
              <div>{g.entries.map((e, i) => <SpecRow key={i} label={e.label} value={e.value}/>)}</div>
            </div>
          ))}
          {other.length > 0 && (
            <div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-1">Other specifications</div>
              <div>{other.map((e, i) => <SpecRow key={i} label={e.label} value={e.value}/>)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
