import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Activity, BadgeCheck, Ban, ExternalLink, ImageIcon, Loader2, Plus } from "lucide-react";
import { Field, StatBox, SubHero } from "../components/atoms";
import { BackToTopButton } from "../components/BackToTopButton";
import { ProductGrid } from "../components/ProductGrid";
import { API, proxyImg } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { PRODUCT_NAV } from "../lib/nav";
import { ArchivedProducts } from "./ArchivedProducts";
import { Orders } from "./Orders";
import { ProductDetailPage } from "./ProductDetail";
import { Products } from "./ProductsList";

export function ProductsModule({ section, setSection, deepLink, clearDeepLink, openProductDetail, productDetailId }) {
  const [priceAlertItems, setPriceAlertItems] = useState([]);

  useEffect(() => {
    if (section === "price-alerts") {
      axios.get(`${API}/items`, { params: { limit: 300 }}).then(r => setPriceAlertItems(r.data.items));
    }
  }, [section]);

  // Detail page takes over the entire module UI when active.
  if (productDetailId) {
    return <ProductDetailPage productId={productDetailId} onBack={() => openProductDetail(null)}/>;
  }

  const meta = PRODUCT_NAV.find((s) => s.id === section) || PRODUCT_NAV[0];
  const Icon = meta.icon;
  const hints = {
    all: "Every product in your store.",
    "low-stock": "Items with 1–3 units remaining. Restock soon.",
    "out-of-stock": "Items at 0 or below. Hidden from storefront.",
    archived: "Archived products are hidden from the main list. Restore them anytime.",
    "price-alerts": "Scraped eBay AU items whose seller changed the price. Sold or out-of-stock listings are excluded automatically.",
  };

  return (
    <div className="grid gap-6">
      <SubHero icon={Icon} group={meta.group} label={meta.label} hint={hints[section]}/>
      {section === "all"           && <Products deepLink={deepLink} clearDeepLink={clearDeepLink} openProductDetail={openProductDetail} sectionKey="products-all"/>}
      {section === "low-stock"     && <Products openProductDetail={openProductDetail} stock="low" sectionKey="products-low"/>}
      {section === "out-of-stock"  && <Products openProductDetail={openProductDetail} stock="out" sectionKey="products-out"/>}
      {section === "archived"      && <ArchivedProducts openProductDetail={openProductDetail}/>}
      {section === "price-alerts"  && <PriceAlertsView items={priceAlertItems} highlightItemId={deepLink?.itemId} clearDeepLink={clearDeepLink} openProductDetail={openProductDetail}/>}
      <BackToTopButton />
    </div>
  );
}

export function PriceAlertsView({ items, highlightItemId, clearDeepLink, openProductDetail }) {
  // Exclude items that are sold / ended / out of stock — no point pricing what you can't sell.
  const live = items.filter(it => !it.is_sold && (it.stock_status || "live") === "live");
  // Price alerts auto-expire 5 days after the most recent detected change.
  // We use the timestamp of the last `price_history` entry (that's when the
  // alert was effectively "created") to decide whether the alert is still
  // fresh enough to display.
  const ALERT_TTL_MS = 5 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const alerts = live
    .map(it => {
      const h = (it.price_history || []).filter(p => p.value != null);
      if (h.length < 2) return null;
      const first = h[0].value, last = h[h.length - 1].value;
      const delta = last - first;
      if (Math.abs(delta) < 0.01) return null;
      const pct = first ? (delta / first) * 100 : 0;
      const alertAt = h[h.length - 1].at;
      const alertMs = alertAt ? new Date(alertAt).getTime() : 0;
      if (!alertMs || (nowMs - alertMs) > ALERT_TTL_MS) return null;
      return { it, first, last, delta, pct, changes: h.length - 1, alertAt };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  const drops = alerts.filter(a => a.delta < 0).length;
  const rises = alerts.filter(a => a.delta > 0).length;
  const excluded = items.length - live.length;
  // Alerts that were suppressed only because they aged past the 5-day TTL.
  const staleAlerts = live.filter(it => {
    const h = (it.price_history || []).filter(p => p.value != null);
    if (h.length < 2) return false;
    const first = h[0].value, last = h[h.length - 1].value;
    if (Math.abs(last - first) < 0.01) return false;
    const alertMs = h[h.length - 1].at ? new Date(h[h.length - 1].at).getTime() : 0;
    return alertMs && (nowMs - alertMs) > ALERT_TTL_MS;
  }).length;

  // Scroll to & flash-highlight the row for the item passed via deepLink from the
  // notification bell. Runs once per highlight target, then clears the deepLink so
  // regular navigation isn't sticky.
  const rowRefs = useRef({});
  const [pulseId, setPulseId] = useState(null);
  useEffect(() => {
    if (!highlightItemId) return;
    // Wait a tick so refs are populated after the alerts render.
    const t = setTimeout(() => {
      const el = rowRefs.current[highlightItemId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setPulseId(highlightItemId);
        // Fade the highlight out after 2.4s.
        setTimeout(() => setPulseId(null), 2400);
      } else {
        toast("Item not in current price-alerts list", { description: "The seller price change may no longer be active." });
      }
      clearDeepLink?.();
    }, 120);
    return () => clearTimeout(t);
  }, [highlightItemId, alerts.length, clearDeepLink]);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Alerts" value={alerts.length}/>
        <StatBox label="Price drops" value={drops} tone="success"/>
        <StatBox label="Price rises" value={rises}/>
        <StatBox label="Items tracked" value={live.length}/>
      </div>
      {(excluded > 0 || staleAlerts > 0) && (
        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-3 flex-wrap" data-testid="price-alerts-excluded">
          {excluded > 0 && (
            <span className="flex items-center gap-1"><Ban size={11}/> {excluded} sold / ended / out-of-stock listing{excluded===1?"":"s"} excluded</span>
          )}
          {staleAlerts > 0 && (
            <span className="flex items-center gap-1" data-testid="price-alerts-expired">
              <Ban size={11}/> {staleAlerts} alert{staleAlerts===1?"":"s"} auto-cleared after 5 days
            </span>
          )}
        </div>
      )}
      <div className="card overflow-hidden">
        {alerts.length === 0 && <div className="p-10 text-center text-slate-500">No price changes in the last 5 days. Older alerts are auto-cleared.</div>}
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>eBay AU item</th><th>Seller</th><th>First price</th><th>Latest</th><th>Change</th><th>Data points</th><th></th></tr></thead>
          <tbody>
            {alerts.slice(0, 100).map(({ it, first, last, delta, pct, changes }) => {
              const linkedId = it.linked_product_id;
              const openProduct = () => { if (linkedId) openProductDetail?.(linkedId); };
              return (
                <tr
                  key={it.id}
                  ref={(el) => { if (el) rowRefs.current[it.item_id] = el; }}
                  data-testid="price-alert-row"
                  data-item-id={it.item_id}
                  onClick={openProduct}
                  title={linkedId ? "Open product detail" : "This scraped item hasn't been added to products yet"}
                  className={`transition-colors duration-500 ${linkedId ? "cursor-pointer hover:bg-slate-50" : "cursor-default"} ${pulseId === it.item_id ? "bg-amber-100 ring-2 ring-amber-400" : ""}`}
                >
                  <td>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border hairline shrink-0">
                        {it.images?.[0] ? <img src={proxyImg(it.images[0])} alt="" className="w-full h-full object-contain p-1"/> : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={14}/></div>}
                      </div>
                      <div className="min-w-0"><div className="text-sm font-medium truncate max-w-[280px]" title={it.title}>{it.title}</div><div className="text-[11px] text-slate-400 font-mono truncate">#{it.item_id}</div></div>
                    </div>
                  </td>
                  <td className="text-sm text-slate-600 truncate max-w-[160px]">{it.seller || "—"}</td>
                  <td className="font-mono text-slate-500">AU ${first.toFixed(2)}</td>
                  <td className="font-mono font-bold text-indigo-600">AU ${last.toFixed(2)}</td>
                  <td className={`font-mono font-bold ${delta > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                    {delta > 0 ? "▲" : "▼"} AU ${Math.abs(delta).toFixed(2)} <span className="text-xs">({pct.toFixed(1)}%)</span>
                  </td>
                  <td className="text-xs text-slate-500">{changes} change{changes===1?"":"s"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <a href={it.url} target="_blank" rel="noreferrer" className="btn btn-ghost text-xs !py-1 !px-2" data-testid={`price-alert-view-${it.item_id}`}><ExternalLink size={12}/> View</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

export function ProductCreate({ onCreated }) {
  const [cats, setCats] = useState([]);
  const empty = { title:"", price:0, cost:0, stock:10, category:"other", description:"", images:[], sku:"", active:true };
  const [f, setF] = useState(empty); const [saving, setSaving] = useState(false);
  useEffect(() => { axios.get(`${API}/categories`, { params: { active: true }}).then(r => { setCats(r.data.categories); setF(x => ({...x, category: r.data.categories[0]?.slug || "other" })); }); }, []);
  const save = async () => {
    if (!f.title.trim()) return toast.error("Title required");
    setSaving(true);
    try { await axios.post(`${API}/products`, { ...f, price:Number(f.price), cost:Number(f.cost), stock:Number(f.stock) }); toast.success("Product created"); setF(empty); onCreated(); }
    catch (e) { toast.error("Failed", { description: e?.response?.data?.detail?.slice(0,200) }); }
    finally { setSaving(false); }
  };
  return (
    <div className="card p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Title *" className="md:col-span-2"><input className="input px-3 py-2 w-full" value={f.title} onChange={(e)=>setF({...f, title:e.target.value})}/></Field>
        <Field label="SKU"><input className="input px-3 py-2 w-full font-mono" value={f.sku} onChange={(e)=>setF({...f, sku:e.target.value})}/></Field>
        <Field label="Category"><select className="input px-3 py-2 w-full" value={f.category} onChange={(e)=>setF({...f, category:e.target.value})}>{cats.map(c=><option key={c.slug} value={c.slug}>{c.group} · {c.name}</option>)}</select></Field>
        <Field label="Price (AUD)"><input type="number" className="input px-3 py-2 w-full font-mono" value={f.price} onChange={(e)=>setF({...f, price:e.target.value})}/></Field>
        <Field label="Cost (AUD)"><input type="number" className="input px-3 py-2 w-full font-mono" value={f.cost} onChange={(e)=>setF({...f, cost:e.target.value})}/></Field>
        <Field label="Stock"><input type="number" className="input px-3 py-2 w-full font-mono" value={f.stock} onChange={(e)=>setF({...f, stock:e.target.value})}/></Field>
        <Field label="Active"><select className="input px-3 py-2 w-full" value={f.active?"1":"0"} onChange={(e)=>setF({...f, active:e.target.value==="1"})}><option value="1">Yes</option><option value="0">No</option></select></Field>
        <Field label="Description" className="md:col-span-2"><textarea className="input px-3 py-2 w-full h-24" value={f.description} onChange={(e)=>setF({...f, description:e.target.value})}/></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><button onClick={()=>setF(empty)} className="btn btn-ghost">Reset</button><button disabled={saving} onClick={save} className="btn btn-primary">{saving?<Loader2 className="animate-spin" size={14}/>:<Plus size={14}/>} Create product</button></div>
    </div>
  );
}

export function ProductImagesView({ list }) {
  const withImages = list.filter(p => p.images?.length);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {withImages.length === 0 && <div className="col-span-full card p-10 text-center text-slate-500">No product images yet</div>}
      {withImages.map(p => (
        <div key={p.id} className="card overflow-hidden">
          <div className="aspect-square bg-slate-50"><img src={proxyImg(p.images[0])} alt="" className="w-full h-full object-cover"/></div>
          <div className="p-3"><div className="text-sm font-medium truncate">{p.title}</div><div className="text-[11px] text-slate-400">{p.images.length} image{p.images.length===1?"":"s"}</div></div>
        </div>
      ))}
    </div>
  );
}

export function BrandsView({ list }) {
  const brands = Array.from(new Set(list.map(p => (p.specifics?.Brand || p.brand || "Unbranded")))).sort();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {brands.map(b => (
        <div key={b} className="card p-4"><div className="w-10 h-10 rounded-xl grid place-items-center bg-indigo-50 text-indigo-600"><BadgeCheck size={16}/></div><div className="mt-2 font-medium">{b}</div><div className="text-xs text-slate-500">{list.filter(p => (p.specifics?.Brand || p.brand || "Unbranded") === b).length} products</div></div>
      ))}
    </div>
  );
}

export function PricingView({ list }) {
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
      <thead><tr><th>Product</th><th>Cost</th><th>Price</th><th>Margin</th></tr></thead>
      <tbody>{list.map(p => { const m = p.price ? ((p.price-(p.cost||0))/p.price)*100 : 0; return (
        <tr key={p.id}><td className="text-sm truncate max-w-[300px]">{p.title}</td><td className="font-mono">{moneyCents(p.cost)}</td><td className="font-mono font-bold text-indigo-600">{moneyCents(p.price)}</td><td className={`font-mono ${m>=40?"text-emerald-600":m>=20?"text-amber-600":"text-red-600"}`}>{m.toFixed(1)}%</td></tr>
      );})}</tbody>
    </table></div></div>
  );
}

export function ProfitView({ list }) {
  const totals = list.reduce((a,p) => { const profit = (p.price - (p.cost||0)) * (p.sold_count||0); a.rev += (p.price||0)*(p.sold_count||0); a.profit += profit; a.units += p.sold_count||0; return a; }, { rev:0, profit:0, units:0 });
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Revenue" value={moneyCents(totals.rev)}/>
        <StatBox label="Profit" value={moneyCents(totals.profit)} tone="success"/>
        <StatBox label="Units sold" value={totals.units.toLocaleString()}/>
        <StatBox label="Avg margin" value={totals.rev ? `${((totals.profit/totals.rev)*100).toFixed(1)}%` : "—"}/>
      </div>
      <div className="card overflow-hidden"><table className="tbl">
        <thead><tr><th>Product</th><th>Sold</th><th>Revenue</th><th>Profit</th></tr></thead>
        <tbody>{[...list].sort((a,b)=>((b.price-(b.cost||0))*(b.sold_count||0))-((a.price-(a.cost||0))*(a.sold_count||0))).slice(0,20).map(p => { const rev=(p.price||0)*(p.sold_count||0); const prof=(p.price-(p.cost||0))*(p.sold_count||0); return (
          <tr key={p.id}><td className="text-sm truncate max-w-[300px]">{p.title}</td><td>{p.sold_count||0}</td><td className="font-mono font-bold text-indigo-600">{moneyCents(rev)}</td><td className="font-mono text-emerald-600">{moneyCents(prof)}</td></tr>
        );})}</tbody>
      </table></div>
    </div>
  );
}

export function InventoryOverview({ inv, list }) {
  if (!inv) return <div className="text-slate-500">loading…</div>;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Products" value={inv.total_products}/>
        <StatBox label="Active" value={inv.active} tone="success"/>
        <StatBox label="Low stock" value={inv.low_stock}/>
        <StatBox label="Out of stock" value={inv.out_of_stock}/>
      </div>
      <StockList list={list}/>
    </div>
  );
}

export function StockAdjustPage({ list, kind, title }) {
  const [pid, setPid] = useState(list[0]?.id || "");
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  useEffect(() => { if (!pid && list.length) setPid(list[0].id); }, [list, pid]);
  const p = list.find(x => x.id === pid);
  const apply = async () => {
    if (!pid) return; if (!delta) return toast.error("Enter a non-zero delta");
    let d = Number(delta);
    if (kind === "count") d = d - (p?.stock || 0); // set-to
    if (kind === "opening") d = d - (p?.stock || 0);
    await axios.post(`${API}/stock/moves`, { product_id: pid, delta: d, kind, reason });
    toast.success(`${title} applied`); setDelta(0); setReason("");
  };
  return (
    <div className="card p-6 grid gap-3 max-w-2xl">
      <Field label="Product"><select value={pid} onChange={(e)=>setPid(e.target.value)} className="input px-3 py-2 w-full">{list.map(x=><option key={x.id} value={x.id}>{x.title} · stock {x.stock??0}</option>)}</select></Field>
      <Field label={kind === "adjustment" ? "Delta (+/-)" : "New stock value"}><input type="number" value={delta} onChange={(e)=>setDelta(e.target.value)} className="input px-3 py-2 w-full font-mono"/></Field>
      <Field label="Reason / reference"><input value={reason} onChange={(e)=>setReason(e.target.value)} className="input px-3 py-2 w-full" placeholder="Damage / return / stock-take etc."/></Field>
      <div className="flex justify-end"><button onClick={apply} className="btn btn-primary"><Activity size={14}/> Apply</button></div>
      <div className="text-xs text-slate-500">Current stock: <b>{p?.stock ?? 0}</b> → target: <b>{kind === "adjustment" ? (Number(p?.stock||0)+Number(delta||0)) : Number(delta||0)}</b></div>
    </div>
  );
}

export function StockList({ list, tone, openProductDetail }) {
  const empty =
    tone === "danger"
      ? "No out-of-stock products. Nice — everything's in stock."
      : tone === "warning"
      ? "Nothing running low. Nice."
      : "No products in this bucket.";
  return (
    <ProductGrid
      list={list}
      onOpen={(p) => openProductDetail && openProductDetail(p.id)}
      emptyLabel={empty}
      tone={tone || "default"}
      testId={`stock-grid-${tone || "default"}`}
    />
  );
}

export function StockHistoryView({ moves }) {
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
      <thead><tr><th>When</th><th>Kind</th><th>Δ</th><th>Before</th><th>After</th><th>Reason</th></tr></thead>
      <tbody>
        {moves.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No stock moves yet</td></tr>}
        {moves.map(m => (
          <tr key={m.id}><td className="text-xs font-mono text-slate-500">{fmtDate(m.created_at)}</td><td><span className="chip chip-neutral capitalize">{m.kind}</span></td><td className={`font-mono font-bold ${m.delta>0?"text-emerald-600":"text-red-600"}`}>{m.delta>0?`+${m.delta}`:m.delta}</td><td className="font-mono">{m.stock_before}</td><td className="font-mono">{m.stock_after}</td><td className="text-xs text-slate-500 truncate max-w-[240px]">{m.reason||"—"}</td></tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

/* --------------------------------- Orders --------------------------------- */
