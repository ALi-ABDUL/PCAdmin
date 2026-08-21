import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { BadgeCheck, Ban, CheckCircle2, Star as StarIcon, X } from "lucide-react";
import { Field } from "../atoms";
import { API } from "../../lib/api";
import { fmtDate, moneyCents } from "../../lib/format";
import { Categories } from "../../pages/Categories";

export function ProductEditModal({ product, categories = [], onClose, onSaved }) {
  const [f, setF] = useState({ ...product });
  const [full, setFull] = useState(product);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    axios.get(`${API}/products/${product.id}`).then(r => setFull(r.data)).catch(() => {});
    axios.get(`${API}/products/${product.id}/reviews`).then(r => setReviews(r.data.reviews || [])).catch(() => setReviews([]));
  }, [product.id]);

  const save = async () => {
    try { await axios.patch(`${API}/products/${product.id}`, { title: f.title, price: Number(f.price), cost: Number(f.cost), stock: Number(f.stock), category: f.category, active: !!f.active, description: f.description, sku: f.sku }); toast.success("Saved"); onSaved(); }
    catch { toast.error("Save failed"); }
  };
  const variants = full.variants || [];
  const variantsByType = variants.reduce((acc, v) => { (acc[v.type] = acc[v.type] || []).push(v); return acc; }, {});
  const avg = full.average_rating || 0;
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={onClose}>
      <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0, y:20}} onClick={(e)=>e.stopPropagation()} className="card max-w-3xl mx-auto my-10 p-6" data-testid="product-edit-modal">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-display font-bold text-xl truncate">Edit product</div>
            <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
              {full.product_code && <span className="text-indigo-600 font-bold">{full.product_code}</span>}
              {full.review_count > 0 && (
                <><span className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-1"><StarIcon size={11} className="text-amber-500" fill="currentColor"/> {avg.toFixed(1)} ({full.review_count})</span></>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost !p-2"><X size={16}/></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Title" className="md:col-span-2"><input className="input w-full px-3 py-2" value={f.title||""} onChange={(e)=>setF({...f, title:e.target.value})}/></Field>
          <Field label="SKU"><input className="input w-full px-3 py-2 font-mono" value={f.sku||""} onChange={(e)=>setF({...f, sku:e.target.value})}/></Field>
          <Field label="Category">
            <select className="input w-full px-3 py-2" value={f.category||"other"} onChange={(e)=>setF({...f, category:e.target.value})}>
              {categories.length === 0 && <option value="other">Other</option>}
              {categories.map(c=><option key={c.slug} value={c.slug}>{c.group} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Price (AUD)"><input type="number" className="input w-full px-3 py-2 font-mono" value={f.price||0} onChange={(e)=>setF({...f, price:e.target.value})}/></Field>
          <Field label="Cost (AUD)"><input type="number" className="input w-full px-3 py-2 font-mono" value={f.cost||0} onChange={(e)=>setF({...f, cost:e.target.value})}/></Field>
          <Field label="Stock"><input type="number" className="input w-full px-3 py-2 font-mono" value={f.stock||0} onChange={(e)=>setF({...f, stock:e.target.value})}/></Field>
          <Field label="Active">
            <select className="input w-full px-3 py-2" value={f.active ? "1" : "0"} onChange={(e)=>setF({...f, active: e.target.value === "1"})}>
              <option value="1">Yes</option><option value="0">No</option>
            </select>
          </Field>
          <Field label="Description" className="md:col-span-2"><textarea className="input w-full px-3 py-2 h-32 leading-relaxed" value={f.description||""} onChange={(e)=>setF({...f, description:e.target.value})}/></Field>
        </div>

        {variants.length > 0 && (
          <div className="mt-6" data-testid="product-variants">
            <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2">Variants · {variants.length}</div>
            <div className="border hairline rounded-lg overflow-hidden">
              <table className="tbl">
                <thead><tr><th>Type</th><th>Option</th><th className="text-right">Price</th><th>Status</th><th>SKU</th></tr></thead>
                <tbody>
                  {Object.entries(variantsByType).flatMap(([type, rows]) =>
                    rows.map((v, idx) => (
                      <tr key={`${type}-${idx}-${v.option}`} data-testid={`variant-row-${type}-${v.option}`.replace(/\s+/g,"-")}>
                        {idx === 0
                          ? <td rowSpan={rows.length} className="align-top font-mono text-xs text-slate-600 border-r hairline bg-slate-50">{type}</td>
                          : null}
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

        {reviews.length > 0 && (
          <div className="mt-6" data-testid="product-reviews-section">
            <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2">
              <span>Reviews · {reviews.length}</span>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1"><StarIcon size={11} className="text-amber-500" fill="currentColor"/> {avg.toFixed(1)}</span>
            </div>
            <div className="grid gap-2 max-h-64 overflow-y-auto">
              {reviews.slice(0, 5).map(r => (
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
                  {r.body && <div className="text-xs text-slate-700 mt-1 line-clamp-3">{r.body}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} className="btn btn-primary">Save</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------- Categories ------------------------------- */
