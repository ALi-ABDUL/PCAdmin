import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BadgeCheck, ChevronLeft, Circle, Loader2, Mail, MessageSquare, PackagePlus, Phone, Reply, ShoppingBag, Trash2 } from "lucide-react";
import { Field, StatusChip } from "../components/atoms";
import { MessageCustomerDialog } from "../components/MessageCustomerDialog";
import { CustomerAvatar } from "./Customers";
import { API } from "../lib/api";
import { fmtDate, fmtLongDateTime, moneyCents } from "../lib/format";

export function CustomerDetailPage({ customerId, onBack, onDeleted }) {
  const [c, setC] = useState(null);
  const [orders, setOrders] = useState([]);
  const [thread, setThread] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [f, setF] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/customers/${customerId}`);
      setC(data.customer);
      setOrders(data.orders || []);
      setThread(data.thread || []);
      setTimeline(data.timeline || []);
      setF({
        name: data.customer.name || "",
        email: data.customer.email || "",
        phone: data.customer.phone || "",
        status: data.customer.status || "active",
        notes: data.customer.notes || "",
      });
      setDirty(false);
    } catch (e) {
      toast.error("Customer not found");
      onBack();
    }
  }, [customerId, onBack]);
  useEffect(() => { load(); }, [load]);

  const setField = (k, v) => { setF((prev) => ({ ...prev, [k]: v })); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/customers/${customerId}`, f);
      toast.success("Customer saved");
      await load();
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail });
    } finally { setSaving(false); }
  };

  const del = async () => {
    if (!window.confirm(`Delete ${c.name}? This can't be undone.`)) return;
    try { await axios.delete(`${API}/customers/${customerId}`); toast.success("Deleted"); onDeleted?.(); }
    catch { toast.error("Delete failed"); }
  };

  if (!c) return <div className="text-slate-500 py-24 text-center">loading customer…</div>;

  const totalSpend = c.total_spend || 0;
  const ordersCount = c.orders_count || orders.length;

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full min-w-0 px-1 sm:px-2" data-testid="customer-detail-page">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={onBack} className="btn btn-ghost text-sm" data-testid="customer-back-btn">
          <ChevronLeft size={14}/> Back to customers
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setMsgOpen(true)}
            disabled={!c.email}
            className="btn btn-ghost text-sm"
            data-testid="customer-message-btn"
            title={c.email ? "Send an email to this customer" : "Add an email address first"}
          >
            <Mail size={13}/> Message customer
          </button>
          <button onClick={del} className="btn btn-danger text-sm" data-testid="customer-delete-btn">
            <Trash2 size={13}/> Delete
          </button>
          <button onClick={save} disabled={!dirty || saving} className="btn btn-primary text-sm" data-testid="customer-save-btn">
            {saving ? <Loader2 className="animate-spin" size={13}/> : <BadgeCheck size={13}/>} Save
          </button>
        </div>
      </div>

      {/* Identity card */}
      <div className="card p-5 flex items-center gap-4 flex-wrap" data-testid="customer-detail-identity">
        <CustomerAvatar c={c} size={56}/>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-display font-bold truncate">{c.name}</div>
          <div className="text-xs text-slate-500 font-mono truncate flex items-center gap-3 flex-wrap mt-0.5">
            {c.email && <span className="inline-flex items-center gap-1"><Mail size={11}/> {c.email}</span>}
            {c.phone && <span className="inline-flex items-center gap-1"><Phone size={11}/> {c.phone}</span>}
            <span className="text-slate-400">·</span>
            <span className="text-indigo-600 font-bold">{c.code}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={c.status}/>
          <span className="chip chip-primary capitalize">{c.type}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4"><div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono">Total spend</div><div className="text-xl font-display font-bold text-indigo-600 mt-1">{moneyCents(totalSpend)}</div></div>
        <div className="card p-4"><div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono">Orders</div><div className="text-xl font-display font-bold mt-1">{ordersCount}</div></div>
        <div className="card p-4 col-span-2"><div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono">Joined</div><div className="text-sm mt-1 text-slate-800 font-medium" data-testid="customer-joined-long">{fmtLongDateTime(c.created_at)}</div></div>
        <div className="card p-4"><div className="text-[11px] text-slate-500 uppercase tracking-wider font-mono">Location</div><div className="text-xs mt-1 text-slate-600 truncate">{[c.city, c.state, c.country].filter(Boolean).join(", ") || "—"}</div></div>
      </div>

      {/* Editable profile */}
      <div className="card p-5">
        <div className="font-display font-bold mb-3">Profile</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Name"><input className="input w-full px-3 py-2" value={f.name} onChange={(e) => setField("name", e.target.value)} data-testid="customer-name-input"/></Field>
          <Field label="Email"><input className="input w-full px-3 py-2 font-mono text-sm" value={f.email} onChange={(e) => setField("email", e.target.value)} data-testid="customer-email-input"/></Field>
          <Field label="Phone"><input className="input w-full px-3 py-2 font-mono text-sm" value={f.phone} onChange={(e) => setField("phone", e.target.value)} data-testid="customer-phone-input"/></Field>
          <Field label="Status">
            <select className="input w-full px-3 py-2" value={f.status} onChange={(e) => setField("status", e.target.value)} data-testid="customer-status-select">
              {["active", "pending", "blocked"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notes" className="mt-3">
          <textarea className="input w-full px-3 py-2 min-h-[100px] leading-relaxed" value={f.notes} onChange={(e) => setField("notes", e.target.value)} data-testid="customer-notes-input"/>
        </Field>
      </div>

      {/* Orders */}
      <div className="card overflow-hidden" data-testid="customer-detail-orders">
        <div className="p-4 border-b hairline font-display font-bold flex items-center gap-2">
          <ShoppingBag size={14}/> Recent orders · <span className="text-slate-500 font-mono text-sm">{orders.length}</span>
        </div>
        {orders.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No orders yet.</div>
        ) : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Reference</th><th>Status</th><th>Items</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono text-indigo-600 font-bold">{o.reference}</td>
                  <td><StatusChip status={o.status}/></td>
                  <td>{o.items || 1}</td>
                  <td className="font-mono font-bold">{moneyCents(o.total)}</td>
                  <td className="text-xs text-slate-500">{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {/* Order timeline */}
      <div className="card overflow-hidden" data-testid="customer-detail-timeline">
        <div className="p-4 border-b hairline font-display font-bold flex items-center gap-2">
          <Circle size={14}/> Order timeline · <span className="text-slate-500 font-mono text-sm">{timeline.length}</span>
        </div>
        {timeline.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Once this customer places an order, its lifecycle will appear here.</div>
        ) : (
          <div className="p-5 pl-6 relative">
            {/* vertical rail */}
            <div className="absolute left-[27px] top-6 bottom-6 w-px bg-slate-200" aria-hidden="true"/>
            <ol className="space-y-4">
              {timeline.map((e, idx) => (
                <TimelineEvent key={`${e.type}-${e.order_id}-${e.ts}-${idx}`} event={e}/>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Messages thread */}
      <div className="card overflow-hidden" data-testid="customer-detail-thread">
        <div className="p-4 border-b hairline flex items-center justify-between">
          <div className="font-display font-bold flex items-center gap-2">
            <MessageSquare size={14}/> Messages · <span className="text-slate-500 font-mono text-sm">{thread.length}</span>
          </div>
          <button
            onClick={() => { setReplyTo(null); setMsgOpen(true); }}
            disabled={!c.email}
            className="btn btn-ghost text-xs"
            data-testid="thread-new-message-btn"
          >
            <Mail size={12}/> New message
          </button>
        </div>
        {thread.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No messages yet. Send the first one from the "Message customer" button above.
          </div>
        ) : (
          <div className="p-4 space-y-3 max-h-[520px] overflow-y-auto">
            {thread.map((m) => {
              const isOut = m.direction === "outbound";
              return (
                <div
                  key={m.id}
                  className={`flex ${isOut ? "justify-end" : "justify-start"}`}
                  data-testid={`thread-msg-${m.direction}`}
                >
                  <div
                    className={`rounded-2xl px-4 py-3 max-w-[80%] shadow-sm ${
                      isOut
                        ? "bg-indigo-600 text-white rounded-tr-md"
                        : "bg-slate-100 text-slate-800 rounded-tl-md"
                    }`}
                  >
                    <div className={`text-[10px] font-mono uppercase tracking-widest mb-1 ${isOut ? "text-indigo-200" : "text-slate-500"}`}>
                      {isOut ? "You" : (m.customer_name || "Customer")} · {fmtDate(m.created_at)}
                    </div>
                    {m.subject && (
                      <div className={`text-sm font-bold mb-1 ${isOut ? "text-white" : "text-slate-900"}`}>{m.subject}</div>
                    )}
                    <div className={`text-sm leading-relaxed whitespace-pre-wrap ${isOut ? "text-white/95" : "text-slate-700"}`}>{m.body}</div>
                    {!isOut && (
                      <button
                        onClick={() => {
                          setReplyTo(m);
                          setMsgOpen(true);
                        }}
                        disabled={!c.email}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
                        data-testid={`thread-reply-${m.id}`}
                      >
                        <Reply size={11}/> Reply
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky footer save */}
      <div className="sticky bottom-4 flex items-center justify-end gap-2 py-2 z-20">
        <button onClick={onBack} className="btn btn-ghost text-sm">Cancel</button>
        <button onClick={save} disabled={!dirty || saving} className="btn btn-primary text-sm shadow-lg" data-testid="customer-save-btn-footer">
          {saving ? <Loader2 className="animate-spin" size={13}/> : <BadgeCheck size={13}/>} Save changes
        </button>
      </div>

      <MessageCustomerDialog
        open={msgOpen}
        customer={c}
        replyTo={replyTo}
        onClose={() => setMsgOpen(false)}
        onSent={() => load()}
      />
    </div>
  );
}


/**
 * A single row in the customer's order lifecycle timeline.
 *
 * The vertical rail is drawn by the parent (absolute-positioned line); each
 * event just needs a status-tinted dot on the rail + a label / meta line.
 */
const STATUS_TONE = {
  pending:    { bg: "bg-slate-400",   ring: "ring-slate-100",   text: "Pending" },
  paid:       { bg: "bg-sky-500",     ring: "ring-sky-100",     text: "Paid" },
  processing: { bg: "bg-indigo-500",  ring: "ring-indigo-100",  text: "Processing" },
  shipped:    { bg: "bg-amber-500",   ring: "ring-amber-100",   text: "Shipped" },
  delivered:  { bg: "bg-emerald-500", ring: "ring-emerald-100", text: "Delivered" },
  cancelled:  { bg: "bg-red-500",     ring: "ring-red-100",     text: "Cancelled" },
  refunded:   { bg: "bg-fuchsia-500", ring: "ring-fuchsia-100", text: "Refunded" },
};
const _tone = (s) => STATUS_TONE[s] || { bg: "bg-slate-400", ring: "ring-slate-100", text: (s || "unknown").replace(/_/g, " ") };

function TimelineEvent({ event: e }) {
  const isCreate = e.type === "order_created";
  const tone = isCreate ? _tone(e.status) : _tone(e.to);
  const Icon = isCreate ? PackagePlus : Circle;
  return (
    <li className="relative pl-8" data-testid={`timeline-event-${e.type}`}>
      <span
        className={`absolute -left-[3px] top-1 w-4 h-4 rounded-full ${tone.bg} ring-4 ${tone.ring} shadow-sm flex items-center justify-center`}
        aria-hidden="true"
      >
        <Icon size={9} className="text-white"/>
      </span>
      <div className="text-sm text-slate-800">
        {isCreate ? (
          <>
            <span className="font-bold">Order placed</span>
            {" "}
            <span className="text-slate-500">·</span>{" "}
            <span className="font-mono text-indigo-600 font-bold">{e.order_reference}</span>
            {e.total != null && (
              <>
                {" "}
                <span className="text-slate-400">·</span>{" "}
                <span className="font-mono font-bold">{moneyCents(e.total)}</span>
              </>
            )}
          </>
        ) : (
          <>
            <span className="font-bold capitalize">{tone.text}</span>
            <span className="text-slate-500"> · </span>
            <span className="font-mono text-indigo-600 font-bold">{e.order_reference}</span>
            {e.from && (
              <>
                <span className="text-slate-400"> · </span>
                <span className="text-slate-500 text-xs">from {(_tone(e.from).text)}</span>
              </>
            )}
          </>
        )}
      </div>
      {isCreate && e.product_title && (
        <div className="text-xs text-slate-500 truncate mt-0.5" title={e.product_title}>{e.product_title}</div>
      )}
      <div className="text-[11px] text-slate-400 font-mono mt-0.5">{fmtDate(e.ts)}</div>
    </li>
  );
}
