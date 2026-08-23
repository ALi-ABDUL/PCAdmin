import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BadgeCheck, ChevronLeft, Loader2, Mail, Phone, ShoppingBag, Trash2 } from "lucide-react";
import { Field, StatusChip } from "../components/atoms";
import { MessageCustomerDialog } from "../components/MessageCustomerDialog";
import { CustomerAvatar } from "./Customers";
import { API } from "../lib/api";
import { fmtDate, fmtLongDateTime, moneyCents } from "../lib/format";

export function CustomerDetailPage({ customerId, onBack, onDeleted }) {
  const [c, setC] = useState(null);
  const [orders, setOrders] = useState([]);
  const [f, setF] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/customers/${customerId}`);
      setC(data.customer);
      setOrders(data.orders || []);
      setF({
        name: data.customer.name || "",
        email: data.customer.email || "",
        phone: data.customer.phone || "",
        status: data.customer.status || "active",
        group: data.customer.group || "Retail",
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
          <span className="chip chip-neutral">{c.group}</span>
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
          <Field label="Group">
            <select className="input w-full px-3 py-2" value={f.group} onChange={(e) => setField("group", e.target.value)} data-testid="customer-group-select">
              {["Retail", "VIP", "Wholesale", "Trade"].map(g => <option key={g} value={g}>{g}</option>)}
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
        onClose={() => setMsgOpen(false)}
      />
    </div>
  );
}
