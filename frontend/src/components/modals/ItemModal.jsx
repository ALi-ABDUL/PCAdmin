import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Box, ChevronLeft, ChevronRight, ExternalLink, ImageIcon, LineChart as LineChartIcon, MapPin, Tags, TrendingDown, TrendingUp, User as UserIcon, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InfoBox } from "../atoms";
import { API, proxyImg } from "../../lib/api";
import { fmtDate } from "../../lib/format";

export function ItemModal({ item, onClose }) {
  const [imgIdx, setImgIdx] = useState(0);
  const [it, setIt] = useState(item);
  const images = it.images || [];
  const specifics = it.specifics ? Object.entries(it.specifics) : [];
  useEffect(() => { setImgIdx(0); setIt(item); }, [item]);

  const ff = it.feature_flags || { show_postage:true, show_delivery:true, show_collection:true, show_returns:true, show_payments:true, show_seller:true, show_description:true, show_specifics:true, visible:true };
  const toggle = async (key) => {
    const next = { ...ff, [key]: !ff[key] };
    setIt({ ...it, feature_flags: next });
    try { await axios.patch(`${API}/items/${it.id}/features`, next); toast.success("Updated"); }
    catch { toast.error("Save failed"); }
  };
  const shipFields = [
    ["show_postage", "Postage", it.postage_display || (it.postage_fee != null ? `AU $${it.postage_fee.toFixed(2)}` : null) || it.shipping],
    ["show_delivery", "Delivery estimate", it.delivery_estimate],
    ["show_collection", "Collection / Pickup", it.collection],
    ["show_returns", "Returns", it.returns_policy],
    ["show_payments", "Payment methods", it.payment_methods],
  ].filter(([_, __, v]) => v);

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={onClose}>
      <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0, y:20}} onClick={(e)=>e.stopPropagation()} className="card max-w-6xl mx-auto my-6 md:my-10">
        <div className="sticky top-0 z-10 backdrop-blur-xl bg-white/85 border-b hairline flex items-center justify-between px-5 md:px-8 py-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="chip chip-neutral">{it.method_used || "manual"}</span>
            {it.is_sold && <span className="chip chip-danger">SOLD</span>}
            {it.item_id && <span className="text-xs font-mono text-slate-500 truncate">#{it.item_id}</span>}
          </div>
          <div className="flex items-center gap-2">
            <a href={it.url} target="_blank" rel="noreferrer" className="btn btn-ghost text-xs !py-1.5"><ExternalLink size={12}/> Open on eBay</a>
            <button onClick={onClose} className="btn btn-ghost !p-2"><X size={16}/></button>
          </div>
        </div>
        <div className="p-5 md:p-8 grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-8">
          <div>
            <div className={`aspect-square bg-slate-50 border hairline rounded-xl overflow-hidden relative ${it.is_sold?"grayscale":""}`}>
              {images[imgIdx] ? (
                <AnimatePresence mode="wait">
                  <motion.img key={imgIdx} src={proxyImg(images[imgIdx])} alt="" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.2}} className="w-full h-full object-contain p-4"/>
                </AnimatePresence>
              ) : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={28}/></div>}
              {images.length > 1 && (
                <>
                  <button onClick={()=>setImgIdx((i)=>(i-1+images.length)%images.length)} className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center bg-white/90 border hairline rounded-full hover:bg-white shadow"><ChevronLeft size={16}/></button>
                  <button onClick={()=>setImgIdx((i)=>(i+1)%images.length)} className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center bg-white/90 border hairline rounded-full hover:bg-white shadow"><ChevronRight size={16}/></button>
                  <span className="absolute bottom-2 right-2 text-[10px] font-mono px-2 py-1 bg-white/90 border hairline rounded-md">{imgIdx+1} / {images.length}</span>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="mt-3 grid grid-cols-6 gap-2">
                {images.slice(0, 12).map((u, i) => (
                  <button key={i} onClick={()=>setImgIdx(i)} className={`aspect-square bg-slate-50 border rounded-md overflow-hidden ${i===imgIdx?"border-indigo-500 ring-2 ring-indigo-100":"hairline"}`}>
                    <img src={proxyImg(u)} alt="" className="w-full h-full object-contain p-1"/>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight leading-tight">{it.title || "Untitled"}</h2>
            <div className="mt-3 flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-3xl font-black text-indigo-600">{it.price_display || "—"}</span>
              {it.condition && <span className="chip chip-neutral">{it.condition.split(" ").slice(0, 3).join(" ")}</span>}
              {it.availability && <span className="chip chip-neutral">{it.availability}</span>}
            </div>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ff.show_seller !== false && <InfoBox icon={<UserIcon size={14}/>} label="Seller" value={it.seller}/>}
              <InfoBox icon={<MapPin size={14}/>} label="Located in" value={it.location}/>
              <InfoBox icon={<Box size={14}/>} label="Item ID" value={it.item_id} mono/>
              <InfoBox icon={<Tags size={14}/>} label="Detected category" value={it.category || "—"}/>
            </div>

            {(it.ebay_category_path || []).length > 0 && (
              <div className="mt-3 text-[11px] text-slate-500 font-mono flex items-center gap-1 flex-wrap" data-testid="ebay-breadcrumbs">
                <Tags size={11}/>
                {it.ebay_category_path.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span>{crumb}</span>
                    {i < it.ebay_category_path.length - 1 && <span className="text-slate-300">›</span>}
                  </span>
                ))}
              </div>
            )}

            {/* Postage, returns and payments */}
            <div className="mt-6 card-flat p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-display font-bold text-sm">Postage, returns & payments</div>
                {it.delivery_estimate_updated_at && <span className="text-[10px] font-mono text-slate-400">updated {fmtDate(it.delivery_estimate_updated_at)}</span>}
              </div>
              {shipFields.length === 0 ? (
                <div className="text-xs text-slate-500">No postage/delivery data returned by eBay for this listing.</div>
              ) : (
                <div className="grid gap-2">
                  {shipFields.map(([key, label, value]) => (
                    <div key={key} className={`flex items-start gap-3 p-2 rounded-lg ${ff[key] ? "" : "opacity-40"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</div>
                        <div className="text-sm text-slate-800 break-words">{value}</div>
                      </div>
                      <label className="cursor-pointer flex items-center gap-1 text-[10px] font-mono uppercase text-slate-500">
                        <input type="checkbox" checked={!!ff[key]} onChange={()=>toggle(key)} data-testid={`ff-${key}`} className="accent-indigo-600 w-4 h-4"/>
                        Show
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Price history */}
            <PriceHistoryChart history={it.price_history}/>

            {it.description && ff.show_description !== false && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Description (from seller)</div>
                  <label className="text-[10px] font-mono uppercase text-slate-500 flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={!!ff.show_description} onChange={()=>toggle("show_description")} className="accent-indigo-600 w-3.5 h-3.5"/>Show</label>
                </div>
                <div className="text-sm text-slate-700 leading-relaxed max-h-64 overflow-y-auto pr-2 border hairline rounded-xl p-4 bg-slate-50 whitespace-pre-wrap">{it.description}</div>
              </div>
            )}

            {specifics.length > 0 && ff.show_specifics !== false && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Item specifics</div>
                  <label className="text-[10px] font-mono uppercase text-slate-500 flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={!!ff.show_specifics} onChange={()=>toggle("show_specifics")} className="accent-indigo-600 w-3.5 h-3.5"/>Show</label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  {specifics.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-dashed hairline py-1.5">
                      <span className="text-xs text-slate-500">{k}</span>
                      <span className="text-xs text-slate-800 text-right font-mono truncate max-w-[60%]" title={v}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function PriceHistoryChart({ history }) {
  const points = (history || []).filter(p => p && p.value != null);
  if (points.length < 2) {
    return (
      <div className="mt-6 card-flat p-4" data-testid="price-history-chart">
        <div className="font-display font-bold text-sm mb-1">Price history</div>
        <div className="text-xs text-slate-500">Only one data point so far. Refresh this item over time to build a price trend.</div>
      </div>
    );
  }
  const data = points.map(p => ({ at: p.at, value: p.value, label: (p.at || "").slice(5, 10) }));
  const first = points[0].value, last = points[points.length - 1].value;
  const delta = last - first;
  const pct = first ? (delta / first) * 100 : 0;
  const trending = delta === 0 ? "flat" : delta < 0 ? "down" : "up";
  const min = Math.min(...points.map(p => p.value));
  const max = Math.max(...points.map(p => p.value));
  return (
    <div className="mt-6 card-flat p-4" data-testid="price-history-chart">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="font-display font-bold text-sm flex items-center gap-2">
          {trending === "down" ? <TrendingDown size={14} className="text-emerald-600"/> : trending === "up" ? <TrendingUp size={14} className="text-amber-600"/> : <LineChartIcon size={14} className="text-slate-500"/>}
          Price history
        </div>
        <div className="text-[11px] font-mono text-slate-500">
          {points.length} points · min AU ${min.toFixed(2)} · max AU ${max.toFixed(2)}
          <span className={`ml-2 font-bold ${delta < 0 ? "text-emerald-600" : delta > 0 ? "text-amber-600" : "text-slate-500"}`}>
            {delta === 0 ? "no change" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`}
          </span>
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="label" tick={{ fill: "#94A3B8", fontSize: 10 }} tickLine={false} axisLine={false}/>
            <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `$${v}`}/>
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
              formatter={(v) => [`AU $${Number(v).toFixed(2)}`, "Price"]}
              labelFormatter={(l, payload) => payload?.[0]?.payload?.at ? fmtDate(payload[0].payload.at) : l}
            />
            <Line type="monotone" dataKey="value" stroke="#4F46E5" strokeWidth={2} dot={{ r: 3, fill: "#4F46E5" }} activeDot={{ r: 5 }}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
