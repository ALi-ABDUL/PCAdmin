import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronLeft, ImageIcon } from "lucide-react";
import { StatBox } from "../components/atoms";
import { API, proxyImg } from "../lib/api";
import { fmtDate, humaniseStatus, moneyCents } from "../lib/format";
import { ORDER_STATUSES } from "../lib/nav";

export function OrderDetailPage({ orderId, onBack }) {
  const [o, setO] = useState(null);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/orders/${orderId}`);
    setO(data);
  }, [orderId]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (status) => {
    // Silent success — order status update is an internal admin action.
    try {
      await axios.patch(`${API}/orders/${orderId}`, { status });
      load();
    } catch { toast.error("Update failed"); }
  };

  if (!o) return <div className="text-slate-500 py-24 text-center">loading order…</div>;

  const unitPrice = o.unit_price ?? (o.total / Math.max(1, o.quantity));
  const unitCost = o.unit_cost ?? 0;
  const profit = (unitPrice - unitCost) * o.quantity;
  const addr = o.shipping_address || {};

  return (
    <div className="grid gap-4 max-w-4xl mx-auto w-full" data-testid="order-detail-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={onBack} className="btn btn-ghost text-sm" data-testid="order-back-btn"><ChevronLeft size={14}/> Back to orders</button>
        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
          <span>Order</span>
          <span className="text-indigo-600 font-bold" data-testid="order-detail-ref">{o.reference || o.id.slice(0,8)}</span>
          <span className="text-slate-300">·</span>
          <span>{fmtDate(o.created_at)}</span>
        </div>
      </div>

      {/* Product summary */}
      <div className="card p-5">
        <div className="flex items-start gap-4 flex-wrap">
          {o.product_images?.[0] || o.image
            ? <img src={proxyImg(o.product_images?.[0] || o.image)} alt="" className="w-24 h-24 rounded-xl object-cover border hairline"/>
            : <div className="w-24 h-24 rounded-xl bg-slate-100 grid place-items-center text-slate-300"><ImageIcon size={22}/></div>}
          <div className="min-w-0 flex-1">
            <div className="font-display font-bold text-lg" title={o.product_title}>{o.product_title}</div>
            <div className="text-xs text-slate-500 font-mono mt-1">Product #{(o.product_id || "").slice(0,8)}</div>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <StatBox label="Qty" value={o.quantity}/>
              <StatBox label="Unit price" value={moneyCents(unitPrice)}/>
              <StatBox label="Unit cost" value={moneyCents(unitCost)}/>
              <StatBox label="Profit" value={moneyCents(profit)} tone={profit > 0 ? "success" : "danger"}/>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Total</div>
            <div className="font-mono font-bold text-2xl text-indigo-600">{moneyCents(o.total)}</div>
          </div>
        </div>
      </div>

      {/* Status tracker */}
      <div className="card p-5">
        <div className="font-display font-bold mb-3">Status</div>
        <div className="flex flex-wrap gap-2" data-testid="order-status-tracker">
          {ORDER_STATUSES.map((s) => {
            const on = s === o.status;
            return (
              <button
                key={s}
                onClick={() => setStatus(s)}
                data-testid={`order-status-${s}`}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${on ? "bg-indigo-600 text-white shadow-md" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {humaniseStatus(s)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Customer + Delivery */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5" data-testid="order-customer-card">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2">Customer</div>
          <div className="font-display font-bold text-base">{o.customer_name}</div>
          <div className="text-xs text-slate-500 font-mono mt-1">{o.customer_email}</div>
          {o.customer_phone && <div className="text-xs text-slate-500 font-mono mt-0.5">{o.customer_phone}</div>}
        </div>
        <div className="card p-5" data-testid="order-address-card">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2">Delivery address</div>
          {addr.full_name || addr.street ? (
            <div className="text-sm leading-relaxed">
              {addr.full_name && <div className="font-medium">{addr.full_name}</div>}
              {addr.street && <div>{addr.street}</div>}
              {(addr.suburb || addr.state || addr.postcode) && <div>{[addr.suburb, addr.state, addr.postcode].filter(Boolean).join(" ")}</div>}
              {addr.country && <div className="text-slate-500">{addr.country}</div>}
            </div>
          ) : <div className="text-sm text-slate-400 italic">No delivery address on file.</div>}
        </div>
      </div>
    </div>
  );
}


