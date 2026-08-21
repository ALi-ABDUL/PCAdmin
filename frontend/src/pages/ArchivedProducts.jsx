import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ImageIcon, Trash2, Undo2 } from "lucide-react";
import { statusBadge } from "../components/atoms";
import { API, proxyImg } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { Products } from "./ProductsList";

export function ArchivedProducts({ openProductDetail }) {
  const [list, setList] = useState([]);
  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/products`, { params: { archived: true } });
    setList(data.products || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const restore = async (p) => { await axios.post(`${API}/products/${p.id}/restore`); toast.success(`Restored "${p.title.slice(0,40)}"`); load(); };
  const del     = async (p) => { if (!window.confirm(`Delete "${p.title}"? This can't be undone.`)) return; await axios.delete(`${API}/products/${p.id}`); toast.success("Deleted"); load(); };

  return (
    <div className="card overflow-hidden" data-testid="archived-products">
      {list.length === 0
        ? <div className="p-10 text-center text-slate-500">No archived products. Archive an inactive product from All Products and it'll appear here.</div>
        : <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Product</th><th>Status</th><th>Archived</th><th className="text-right">Sell</th><th className="text-right">Stock</th><th></th></tr></thead>
            <tbody>
              {list.map(p => {
                const badge = statusBadge(p);
                return (
                  <tr key={p.id} data-testid={`archived-row-${p.id}`} className="opacity-70">
                    <td>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border hairline shrink-0 grayscale">
                          {p.images?.[0] ? <img src={proxyImg(p.images[0])} alt="" className="w-full h-full object-cover"/> : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={16}/></div>}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate max-w-[360px]">{p.title}</div>
                          <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                            {p.product_code && <span className="text-indigo-600 font-bold">{p.product_code}</span>}
                            <span>·</span>
                            <span>{p.sku || "—"}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{badge ? <span className={`chip ${badge.cls}`}>{badge.label}</span> : <span className="chip chip-neutral">Archived</span>}</td>
                    <td className="text-xs text-slate-500 font-mono">{p.archived_at ? fmtDate(p.archived_at) : "—"}</td>
                    <td className="text-right font-mono">{moneyCents(p.price)}</td>
                    <td className="text-right">{p.stock ?? 0}</td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => restore(p)} className="btn btn-primary text-xs !py-1 !px-2" data-testid={`archived-restore-${p.id}`}>
                          <Undo2 size={12}/> Restore
                        </button>
                        <button onClick={() => del(p)} className="btn btn-danger text-xs !py-1 !px-2" data-testid={`archived-delete-${p.id}`}><Trash2 size={12}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
      }
    </div>
  );
}

/* -------------------------- Full product detail page -------------------------- */
