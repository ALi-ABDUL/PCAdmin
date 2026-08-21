import { motion } from "framer-motion";
import { Mail, MapPin, Percent, Receipt, User as UserIcon, X } from "lucide-react";
import { InfoBox, StatBox } from "../atoms";
import { fmtDate, humaniseStatus, moneyCents } from "../../lib/format";
import { ORDER_STATUSES, ORDER_STATUS_STYLE } from "../../lib/nav";

export function OrderDetailsModal({ order, onClose, onStatus }) {
  const addr = order.shipping_address;
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={onClose}>
      <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0, y:20}} onClick={(e)=>e.stopPropagation()} className="card max-w-2xl mx-auto my-10 p-6" data-testid="order-details-modal">
        <div className="flex items-center justify-between mb-4">
          <div><div className="text-[11px] font-mono text-slate-400">ORDER · #{order.id.slice(0,8)}</div><div className="font-display font-bold text-xl">{order.product_title}</div></div>
          <button onClick={onClose} className="btn btn-ghost !p-2"><X size={16}/></button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <StatBox label="Total" value={moneyCents(order.total)}/>
          <StatBox label="Profit" value={moneyCents(order.profit)} tone="success"/>
          <StatBox label="Qty" value={order.quantity}/>
          <StatBox label="Date" value={fmtDate(order.created_at).split(",")[0]}/>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <InfoBox icon={<UserIcon size={14}/>} label="Customer" value={order.customer_name}/>
          <InfoBox icon={<Mail size={14}/>} label="Email" value={order.customer_email} mono/>
          <InfoBox icon={<Receipt size={14}/>} label="Unit price" value={moneyCents(order.unit_price)}/>
          <InfoBox icon={<Percent size={14}/>} label="Unit cost" value={moneyCents(order.unit_cost)}/>
        </div>

        {/* Delivery address */}
        <div className="mt-5 card-flat p-4" data-testid="order-delivery-address">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg grid place-items-center bg-indigo-50 text-indigo-600"><MapPin size={14}/></div>
            <div className="font-display font-bold text-sm">Delivery address</div>
          </div>
          {addr ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Full name</div><div className="text-slate-800" data-testid="addr-name">{addr.full_name || order.customer_name || "—"}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Country</div><div className="text-slate-800" data-testid="addr-country">{addr.country || "—"}</div></div>
              <div className="col-span-2"><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Street address</div><div className="text-slate-800" data-testid="addr-street">{addr.street || "—"}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Suburb</div><div className="text-slate-800" data-testid="addr-suburb">{addr.suburb || "—"}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">State</div><div className="text-slate-800" data-testid="addr-state">{addr.state || "—"}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Postcode</div><div className="text-slate-800 font-mono" data-testid="addr-postcode">{addr.postcode || "—"}</div></div>
            </div>
          ) : (
            <div className="text-xs text-slate-500">No delivery address on this order.</div>
          )}
        </div>

        <div className="mt-4">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2">Update status</div>
          <div className="flex flex-wrap gap-2">
            {ORDER_STATUSES.map(s => (
              <button key={s} onClick={()=>onStatus(order, s)} className={`chip ${order.status === s ? ORDER_STATUS_STYLE[s] || "chip-primary" : "chip-neutral"} capitalize cursor-pointer`}>{humaniseStatus(s)}</button>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

