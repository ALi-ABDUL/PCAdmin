import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronLeft, ImageIcon, CreditCard, Wallet, Landmark, CheckCircle2, Clock, PackageCheck, PackageSearch, Truck } from "lucide-react";
import { StatBox } from "../components/atoms";
import { API, proxyImg } from "../lib/api";
import { fmtDate, humaniseStatus, moneyCents } from "../lib/format";
import { ORDER_STATUSES } from "../lib/nav";

export function OrderDetailPage({ orderId, onBack }) {
  const [o, setO] = useState(null);
  const [updatingLineId, setUpdatingLineId] = useState(null);

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

  const setPayment = async (fields) => {
    try {
      await axios.patch(`${API}/orders/${orderId}`, fields);
      load();
    } catch { toast.error("Update failed"); }
  };

  const setLineFulfillment = async (line, status) => {
    if (!line.line_id || line.fulfillment_status === status) return;
    setUpdatingLineId(line.line_id);
    try {
      const { data } = await axios.patch(`${API}/orders/${orderId}/items/${line.line_id}/fulfillment`, { status });
      setO(data.order);
      toast.success(`${line.title || "Item"} marked ${status}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update item fulfilment");
    } finally {
      setUpdatingLineId(null);
    }
  };

  if (!o) return <div className="text-slate-500 py-24 text-center">loading order…</div>;

  const unitPrice = o.unit_price ?? (o.total / Math.max(1, o.quantity));
  const unitCost = o.unit_cost ?? 0;
  const profit = (unitPrice - unitCost) * o.quantity;
  const addr = o.shipping_address || {};

  const PAYMENT_METHODS = ["Card", "PayPal", "Bank Transfer"];
  const methodIcon = { Card: CreditCard, PayPal: Wallet, "Bank Transfer": Landmark };
  const normMethod = (m) => {
    const k = (m || "").toLowerCase().replace(/[\s_]+/g, "");
    return { card: "Card", creditcard: "Card", paypal: "PayPal", banktransfer: "Bank Transfer" }[k] || "Card";
  };
  const paymentMethod = normMethod(o.payment_method);
  const paymentStatus = o.payment_status || "pending";
  const MethodIcon = methodIcon[paymentMethod] || CreditCard;
  const isPaid = paymentStatus === "paid";

  const hasLineItems = Array.isArray(o.items) && o.items.length > 0;
  const FULFILLMENT_STATUSES = [
    { id: "pending", label: "Pending", icon: Clock },
    { id: "processing", label: "Processing", icon: PackageSearch },
    { id: "shipped", label: "Shipped", icon: Truck },
    { id: "delivered", label: "Delivered", icon: PackageCheck },
  ];

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

      {/* Product summary — single-product orders only (multi-item orders show the line-items list below) */}
      {!hasLineItems && (
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
      )}

      {/* Line items — multi-item orders carry an `items` array */}
      {hasLineItems && (
        <div className="card p-5" data-testid="order-line-items">
          <div className="font-display font-bold mb-4">Line items ({o.items.length})</div>
          <div className="grid gap-2">
            {o.items.map((li, i) => (
              <div key={li.line_id || `${li.product_id}-${i}`} className="flex items-center gap-3 rounded-xl border hairline p-3 flex-wrap sm:flex-nowrap" data-testid={`order-line-item-${i}`}>
                {li.image
                  ? <img src={proxyImg(li.image)} alt="" className="w-12 h-12 rounded-lg object-cover border hairline shrink-0"/>
                  : <div className="w-12 h-12 rounded-lg bg-slate-100 grid place-items-center text-slate-300 shrink-0"><ImageIcon size={16}/></div>}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate" title={li.title}>{li.title || "Untitled item"}</div>
                  {(li.variant_type || li.variant_option) && (
                    <div className="mt-0.5" data-testid={`order-line-item-variant-${i}`}>
                      <span className="chip chip-neutral !text-[10px]">{[li.variant_type, li.variant_option].filter(Boolean).join(": ")}</span>
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    Qty {li.quantity ?? 1} × {moneyCents(li.unit_price)}
                    {li.product_id ? <span className="text-slate-400"> · #{String(li.product_id).slice(0, 8)}</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-auto shrink-0 flex-wrap justify-end">
                  <div className="font-mono font-bold text-indigo-600">{moneyCents(li.line_total ?? (li.unit_price || 0) * (li.quantity || 1))}</div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={`chip ${li.fulfillment_status === "delivered" ? "chip-success" : li.fulfillment_status === "shipped" ? "chip-primary" : li.fulfillment_status === "processing" ? "chip-warning" : "chip-neutral"} !text-[10px]`} data-testid={`order-line-item-fulfillment-status-${i}`}>
                      {humaniseStatus(li.fulfillment_status || "pending")}
                    </span>
                    <div className="flex items-center gap-1" data-testid={`order-line-item-fulfillment-controls-${i}`}>
                      {FULFILLMENT_STATUSES.map(({ id, label, icon: Icon }) => {
                        const active = (li.fulfillment_status || "pending") === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setLineFulfillment(li, id)}
                            disabled={active || updatingLineId === li.line_id}
                            title={`Mark this item ${label.toLowerCase()}`}
                            data-testid={`order-line-item-fulfillment-${i}-${id}`}
                            className={`w-8 h-8 grid place-items-center rounded-md border transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-600"} disabled:cursor-default disabled:opacity-70`}
                            aria-label={`Mark ${li.title || "item"} ${label.toLowerCase()}`}
                          ><Icon size={14}/></button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t hairline flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Order total</span>
            <span className="font-mono font-bold text-2xl text-indigo-600" data-testid="order-line-items-total">{moneyCents(o.total)}</span>
          </div>
        </div>
      )}

      {/* Status tracker */}
      <div className="card p-5">
        <div className="font-display font-bold mb-3">Status</div>
        {hasLineItems ? (
          <div className="flex items-center gap-3 flex-wrap" data-testid="order-status-auto-tracker">
            <span className="chip chip-primary !text-xs !py-1 !px-3" data-testid="order-status-auto-badge">{humaniseStatus(o.status)}</span>
            <span className="text-xs text-slate-500" data-testid="order-status-auto-note">Updates automatically once every line item is processing, shipped, or delivered.</span>
          </div>
        ) : <div className="flex flex-wrap gap-2" data-testid="order-status-tracker">
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
        </div>}
      </div>

      {/* Payment */}
      <div className="card p-5" data-testid="order-payment-card">
        <div className="font-display font-bold mb-4">Payment</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2">Payment method</div>
            <div className="flex flex-wrap gap-2" data-testid="order-payment-method">
              {PAYMENT_METHODS.map((m) => {
                const Icon = methodIcon[m] || CreditCard;
                const on = m === paymentMethod;
                return (
                  <button
                    key={m}
                    onClick={() => setPayment({ payment_method: m })}
                    data-testid={`order-payment-method-${m.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${on ? "bg-indigo-600 text-white shadow-md" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    <Icon size={13}/> {m}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2">Payment status</div>
            <div className="flex items-center gap-3 flex-wrap">
              <span
                data-testid="order-payment-status-badge"
                className={`chip ${isPaid ? "chip-success" : ""} !text-xs !py-1 !px-3`}
                style={isPaid ? undefined : { background: "#fef3c7", color: "#92400e" }}
              >
                {isPaid ? <CheckCircle2 size={13}/> : <Clock size={13}/>}
                {isPaid ? "Paid" : "Pending"}
              </span>
              <button
                onClick={() => setPayment({ payment_status: isPaid ? "pending" : "paid" })}
                className="btn btn-ghost text-xs"
                data-testid="order-payment-status-toggle"
              >
                Mark as {isPaid ? "pending" : "paid"}
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <MethodIcon size={15} className="text-slate-400"/>
              <span>Paid via <span className="font-medium text-slate-800">{paymentMethod}</span></span>
            </div>
          </div>
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


