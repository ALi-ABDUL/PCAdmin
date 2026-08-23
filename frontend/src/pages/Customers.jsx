import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Award, BadgeCheck, History, Loader2, MessageCircle, Plus, Search, Star as StarIcon, Tags, Ticket, Trash2, Upload } from "lucide-react";
import { Field, StatusChip, SubHero } from "../components/atoms";
import { API } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { CUSTOMER_NAV } from "../lib/nav";
import { CustomerPortal } from "./CustomerPortal";
import { CustomerDetailPage } from "./CustomerDetail";
import { Orders } from "./Orders";
import { Products } from "./ProductsList";

export function CustomersModule({ section, setSection, customerDetailId, openCustomerDetail }) {
  const [list, setList] = useState([]); const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [q, setQ] = useState(""); const [sort, setSort] = useState("created_at_desc"); const [group, setGroup] = useState("");
  const [messages, setMessages] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [reviews, setReviews] = useState([]);

  const params = {};
  if (["pending","active","blocked"].includes(section)) params.status = section;
  if (section === "guest") params.type = "guest";
  if (section === "registered") params.type = "registered";
  if (group) params.group = group;
  if (q) params.q = q;
  params.sort = sort;

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/customers`, { params });
    setList(data.customers); setTotal(data.total);
  }, [JSON.stringify(params)]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/customers/summary`).then(r => setSummary(r.data)); }, [list.length]);
  useEffect(() => { if (section === "messages") axios.get(`${API}/messages`).then(r => setMessages(r.data.messages)); }, [section]);
  useEffect(() => { if (section === "coupons") axios.get(`${API}/coupons`).then(r => setCoupons(r.data.coupons)); }, [section]);
  useEffect(() => { if (section === "reviews") axios.get(`${API}/reviews`).then(r => setReviews(r.data.reviews)); }, [section]);

  // Customer detail takes over the module UI when a specific customer is open.
  if (customerDetailId) {
    return <CustomerDetailPage
      customerId={customerDetailId}
      onBack={() => openCustomerDetail?.(null)}
      onDeleted={() => { openCustomerDetail?.(null); load(); }}
    />;
  }

  const meta = CUSTOMER_NAV.find((s) => s.id === section) || CUSTOMER_NAV[0];
  const Icon = meta.icon;
  const hints = {
    portal:"Customer-facing area — sign in with a purchaser email to see orders and leave verified reviews.",
    create:"Add a customer profile manually.", import:"Bulk-import customers via JSON.",
    all:"Every customer in your database.", pending:"Awaiting verification.", active:"Verified & shopping.",
    guest:"One-off shoppers without an account.", registered:"Customers with an account.",
    messages:"Inbound contact-form messages.", top:"Highest lifetime value.", groups:"Segments like VIP, Wholesale, Trade.",
    addresses:"Customer shipping & billing addresses.", orders:"All orders across all customers.",
    wishlist:"Products customers have starred.", reviews:"Product reviews left by customers.",
    coupons:"Discount codes and campaigns.", activity:"Recent customer activity.", notes:"Internal notes on customers.",
    blocked:"Restricted or blocked customers.",
  };

  return (
    <div className="grid gap-6">
      <SubHero icon={Icon} group={meta.group} label={meta.label} hint={hints[section]}/>
      {section === "portal"     && <CustomerPortal/>}
      {section === "create"     && <CreateCustomer onCreated={() => { load(); setSection("all"); }}/>}
      {section === "import"     && <ImportCustomers onImported={() => { load(); setSection("all"); }}/>}
      {(["all","pending","active","guest","registered","blocked"].includes(section)) && <CustomerTable list={list} total={total} q={q} setQ={setQ} sort={sort} setSort={setSort} group={group} setGroup={setGroup} groups={summary?.by_group?.map(g=>g.group)||[]} onChanged={load} onOpen={openCustomerDetail}/>}
      {section === "top"        && <TopCustomers list={summary?.top || []}/>}
      {section === "groups"     && <CustomerGroups groups={summary?.by_group || []}/>}
      {section === "messages"   && <CustomerMessages messages={messages} reload={() => axios.get(`${API}/messages`).then(r => setMessages(r.data.messages))}/>}
      {section === "coupons"    && <CouponsView coupons={coupons} reload={() => axios.get(`${API}/coupons`).then(r => setCoupons(r.data.coupons))}/>}
      {section === "reviews"    && <ReviewsView reviews={reviews} reload={() => axios.get(`${API}/reviews`).then(r => setReviews(r.data.reviews))}/>}
      {section === "orders"     && <CustomerOrdersView/>}
      {section === "wishlist"   && <ScaffoldList label="Wishlist items" hint="Customers can save products they love to buy later." rows={["Empty for now — hook up when storefront ships."]}/>}
      {section === "addresses"  && <ScaffoldList label="Saved addresses" hint="Shipping & billing addresses per customer." rows={list.slice(0,5).map(c => `${c.name} · ${[c.city, c.state, c.country].filter(Boolean).join(", ") || "no address"}`)}/>}
      {section === "activity"   && <CustomerActivity list={list}/>}
      {section === "notes"      && <NotesView list={list} onChanged={load}/>}
    </div>
  );
}

export function CustomerAvatar({ c, size = 36 }) {
  const initials = (c.name || "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return <div className="rounded-full grid place-items-center text-white font-bold shrink-0" style={{ width: size, height: size, background: "linear-gradient(135deg,#4F46E5,#EC4899)", fontSize: size * 0.34 }}>{initials || "C"}</div>;
}

export function CreateCustomer({ onCreated }) {
  const empty = { name:"", email:"", phone:"", country:"Australia", state:"", city:"", address:"", postcode:"", status:"active", type:"registered", group:"Retail", tags:[], notes:"" };
  const [f, setF] = useState(empty); const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      await axios.post(`${API}/customers`, { ...f, tags: typeof f.tags === "string" ? f.tags.split(",").map(t=>t.trim()).filter(Boolean) : f.tags });
      toast.success("Customer created"); setF(empty); onCreated();
    } catch (e) { toast.error("Failed", { description: e?.response?.data?.detail?.slice(0,200) }); }
    finally { setSaving(false); }
  };
  const tagsStr = Array.isArray(f.tags) ? f.tags.join(", ") : (f.tags || "");
  return (
    <div className="card p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Name *"><input className="input px-3 py-2 w-full" value={f.name} onChange={(e)=>setF({...f, name:e.target.value})} data-testid="cus-name"/></Field>
        <Field label="Email"><input type="email" className="input px-3 py-2 w-full" value={f.email} onChange={(e)=>setF({...f, email:e.target.value})}/></Field>
        <Field label="Phone"><input className="input px-3 py-2 w-full" value={f.phone} onChange={(e)=>setF({...f, phone:e.target.value})}/></Field>
        <Field label="Group"><select className="input px-3 py-2 w-full" value={f.group} onChange={(e)=>setF({...f, group:e.target.value})}>{["Retail","VIP","Wholesale","Trade"].map(g=><option key={g}>{g}</option>)}</select></Field>
        <Field label="Status"><select className="input px-3 py-2 w-full" value={f.status} onChange={(e)=>setF({...f, status:e.target.value})}>{["pending","active","blocked"].map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="Type"><select className="input px-3 py-2 w-full" value={f.type} onChange={(e)=>setF({...f, type:e.target.value})}>{["registered","guest"].map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="City"><input className="input px-3 py-2 w-full" value={f.city} onChange={(e)=>setF({...f, city:e.target.value})}/></Field>
        <Field label="State"><select className="input px-3 py-2 w-full" value={f.state} onChange={(e)=>setF({...f, state:e.target.value})}><option value="">—</option>{["NSW","VIC","QLD","WA","SA","TAS","ACT","NT"].map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="Postcode"><input className="input px-3 py-2 w-full font-mono" value={f.postcode} onChange={(e)=>setF({...f, postcode:e.target.value})}/></Field>
        <Field label="Address" className="md:col-span-2"><input className="input px-3 py-2 w-full" value={f.address} onChange={(e)=>setF({...f, address:e.target.value})}/></Field>
        <Field label="Tags (comma separated)" className="md:col-span-2"><input className="input px-3 py-2 w-full" value={tagsStr} onChange={(e)=>setF({...f, tags:e.target.value})}/></Field>
        <Field label="Notes" className="md:col-span-2"><textarea className="input px-3 py-2 w-full h-24" value={f.notes} onChange={(e)=>setF({...f, notes:e.target.value})}/></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><button onClick={()=>setF(empty)} className="btn btn-ghost">Reset</button><button disabled={saving} onClick={save} className="btn btn-primary" data-testid="cus-create-btn">{saving?<Loader2 className="animate-spin" size={14}/>:<Plus size={14}/>} Create customer</button></div>
    </div>
  );
}

export function ImportCustomers({ onImported }) {
  const [text, setText] = useState(`[
  { "name": "Sample User", "email": "sample@example.com", "group": "Retail", "status": "active", "type": "registered" }
]`);
  const [busy, setBusy] = useState(false);
  const doImport = async () => {
    setBusy(true);
    try {
      const arr = JSON.parse(text);
      const { data } = await axios.post(`${API}/customers/import`, { customers: Array.isArray(arr) ? arr : [arr] });
      toast.success(`Imported ${data.imported}`); onImported();
    } catch (e) { toast.error("Import failed", { description: (e?.message||"").slice(0,200) }); }
    finally { setBusy(false); }
  };
  const rebuild = async () => { const { data } = await axios.post(`${API}/customers/rebuild-from-orders`); toast.success(`Rebuilt · created ${data.created}`); onImported(); };
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-slate-500">Paste a JSON array of customer objects. Only <span className="font-mono">name</span> is required.</div>
        <button onClick={rebuild} className="btn btn-ghost text-xs"><History size={12}/> Rebuild from orders</button>
      </div>
      <textarea value={text} onChange={(e)=>setText(e.target.value)} className="input px-3 py-2 w-full font-mono text-xs" style={{ height: 260 }}/>
      <div className="mt-4 flex justify-end"><button disabled={busy} onClick={doImport} className="btn btn-primary">{busy?<Loader2 className="animate-spin" size={14}/>:<Upload size={14}/>} Import customers</button></div>
    </div>
  );
}

export function CustomerTable({ list, total, q, setQ, sort, setSort, group, setGroup, groups, onChanged, onOpen }) {
  const setStatus = async (c, status) => { await axios.patch(`${API}/customers/${c.id}`, { status }); onChanged(); };
  const del = async (c) => { if (!window.confirm(`Delete ${c.name}?`)) return; await axios.delete(`${API}/customers/${c.id}`); toast.success("Deleted"); onChanged(); };
  const stop = (e) => e.stopPropagation();
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-slate-500 font-mono">{total} customer{total===1?"":"s"}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search name / email" className="input pl-9 pr-3 py-2 text-sm w-64"/></div>
          <select value={group} onChange={(e)=>setGroup(e.target.value)} className="input px-3 py-2 text-sm"><option value="">All groups</option>{["Retail","VIP","Wholesale","Trade"].map(g=><option key={g}>{g}</option>)}</select>
          <select value={sort} onChange={(e)=>setSort(e.target.value)} className="input px-3 py-2 text-sm">
            <option value="created_at_desc">Newest</option><option value="name_asc">Name A→Z</option><option value="spend_desc">Spend ↓</option><option value="orders_desc">Orders ↓</option>
          </select>
        </div>
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Customer</th><th>Code</th><th>Group</th><th>Type</th><th>Status</th><th>Orders</th><th>Spend</th><th></th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-slate-500">No customers</td></tr>}
          {list.map(c => (
            <tr key={c.id} data-testid="cus-row" onClick={() => onOpen?.(c.id)} className="cursor-pointer hover:bg-slate-50 transition-colors">
              <td><div className="flex items-center gap-3"><CustomerAvatar c={c}/><div className="min-w-0"><div className="text-sm font-medium truncate max-w-[240px]">{c.name}</div><div className="text-[11px] text-slate-400 truncate">{c.email || "—"}</div></div></div></td>
              <td className="font-mono text-xs text-slate-500">{c.code}</td>
              <td><span className="chip chip-primary">{c.group}</span></td>
              <td><span className="chip chip-neutral capitalize">{c.type}</span></td>
              <td onClick={stop}>
                <select value={c.status} onChange={(e)=>setStatus(c, e.target.value)} className="input px-2 py-1 text-xs">
                  {["pending","active","blocked"].map(s=><option key={s}>{s}</option>)}
                </select>
              </td>
              <td>{c.orders_count}</td>
              <td className="font-mono font-bold text-indigo-600">{moneyCents(c.total_spend)}</td>
              <td onClick={stop}><button onClick={()=>del(c)} className="btn btn-danger !p-2"><Trash2 size={12}/></button></td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </div>
  );
}

export function TopCustomers({ list }) {
  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b hairline font-display font-bold flex items-center gap-2"><Award size={16}/> Top 10 by lifetime value</div>
      <div className="p-3">
        {list.length === 0 && <div className="text-sm text-slate-500 py-6 text-center">No customers yet</div>}
        {list.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
            <div className="w-8 h-8 grid place-items-center rounded-md font-display font-bold text-white text-xs" style={{ background: `linear-gradient(135deg,#4F46E5,#EC4899)`, opacity: 1 - i*0.08 }}>{i + 1}</div>
            <CustomerAvatar c={c} size={32}/>
            <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{c.name}</div><div className="text-xs text-slate-500 truncate">{c.email || "—"} · {c.orders_count} orders</div></div>
            <div className="font-mono font-bold text-indigo-600">{moneyCents(c.total_spend)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CustomerGroups({ groups }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {groups.length === 0 && <div className="col-span-full card p-10 text-center text-slate-500">No group data yet</div>}
      {groups.map(g => (
        <div key={g.group} className="card p-5">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">{g.group}</div>
          <div className="font-display text-3xl font-bold mt-1">{g.count}</div>
          <div className="text-sm text-slate-500 mt-1">members · {moneyCents(g.spend)} lifetime</div>
        </div>
      ))}
    </div>
  );
}

export function CustomerMessages({ messages, reload }) {
  const [f, setF] = useState({ customer_name:"", customer_email:"", subject:"", body:"" });
  const send = async () => { if(!f.customer_name || !f.body) return toast.error("Name & message required"); await axios.post(`${API}/messages`, f); setF({ customer_name:"", customer_email:"", subject:"", body:"" }); toast.success("Message added"); reload(); };
  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <div className="font-display font-bold mb-3">Log a message</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input placeholder="Customer name" className="input px-3 py-2" value={f.customer_name} onChange={(e)=>setF({...f, customer_name:e.target.value})}/>
          <input placeholder="Email" className="input px-3 py-2" value={f.customer_email} onChange={(e)=>setF({...f, customer_email:e.target.value})}/>
          <input placeholder="Subject" className="input px-3 py-2" value={f.subject} onChange={(e)=>setF({...f, subject:e.target.value})}/>
        </div>
        <textarea placeholder="Message body" className="input px-3 py-2 mt-2 w-full h-24" value={f.body} onChange={(e)=>setF({...f, body:e.target.value})}/>
        <div className="mt-3 flex justify-end"><button onClick={send} className="btn btn-primary text-sm"><MessageCircle size={14}/> Add message</button></div>
      </div>
      <div className="card overflow-hidden">
        {messages.length === 0 && <div className="p-10 text-center text-slate-500">No messages yet</div>}
        {messages.map(m => (
          <div key={m.id} className="p-4 border-b hairline last:border-0"><div className="flex items-center justify-between"><div className="font-medium text-sm">{m.customer_name} <span className="text-slate-400 text-xs font-mono">· {m.customer_email}</span></div><span className={`chip chip-${m.status==='new'?'primary':'neutral'}`}>{m.status}</span></div><div className="text-sm font-medium mt-1">{m.subject}</div><div className="text-sm text-slate-600 mt-1">{m.body}</div><div className="text-[11px] text-slate-400 mt-1 font-mono">{fmtDate(m.created_at)}</div></div>
        ))}
      </div>
    </div>
  );
}

export function CustomerOrdersView() {
  const [orders, setOrders] = useState([]);
  useEffect(() => { axios.get(`${API}/orders`, { params: { limit: 200 }}).then(r => setOrders(r.data.orders)); }, []);
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
      <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id}><td className="text-sm truncate max-w-[280px]" title={o.product_title}>{o.product_title}</td><td>{o.customer_name}</td><td className="font-mono font-bold text-indigo-600">{moneyCents(o.total)}</td><td><StatusChip status={o.status}/></td><td className="text-xs text-slate-500 font-mono">{fmtDate(o.created_at)}</td></tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

export function ScaffoldList({ label, hint, rows = [] }) {
  return (
    <div className="card p-6">
      <div className="font-display font-bold">{label}</div>
      <div className="text-sm text-slate-500 mt-1">{hint}</div>
      <div className="mt-4 divide-y">
        {rows.length === 0 && <div className="py-8 text-center text-slate-400 text-sm">No data yet</div>}
        {rows.map((r, i) => <div key={i} className="py-2 text-sm text-slate-700">{r}</div>)}
      </div>
    </div>
  );
}

export function CustomerActivity({ list }) {
  const rows = [...list].sort((a,b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 40);
  return (
    <div className="card overflow-hidden">
      {rows.length === 0 && <div className="p-10 text-center text-slate-500">No activity</div>}
      {rows.map(c => (
        <div key={c.id} className="p-4 border-b hairline last:border-0 flex items-center gap-3">
          <CustomerAvatar c={c} size={32}/><div className="flex-1 min-w-0"><div className="text-sm"><span className="font-medium">{c.name}</span> <span className="text-slate-500">joined as {c.group}</span></div><div className="text-[11px] text-slate-400 font-mono">{fmtDate(c.created_at)}</div></div><span className="chip chip-neutral">{c.status}</span>
        </div>
      ))}
    </div>
  );
}

export function NotesView({ list, onChanged }) {
  const [id, setId] = useState(list[0]?.id || "");
  const cust = list.find(c => c.id === id) || list[0];
  const [note, setNote] = useState(cust?.notes || "");
  useEffect(() => { setNote(cust?.notes || ""); }, [cust?.id]); // eslint-disable-line
  if (!cust) return <div className="card p-10 text-center text-slate-500">No customers</div>;
  const save = async () => { await axios.patch(`${API}/customers/${cust.id}`, { notes: note }); toast.success("Note saved"); onChanged(); };
  return (
    <div className="card p-5 grid gap-3">
      <select value={id} onChange={(e)=>setId(e.target.value)} className="input px-3 py-2 max-w-md">{list.map(c => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}</select>
      <textarea className="input px-3 py-2 w-full h-40" value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Internal notes about this customer…"/>
      <div className="flex justify-end"><button onClick={save} className="btn btn-primary text-sm">Save note</button></div>
    </div>
  );
}

/* -------------------------- Products (module wrapper) --------------------- */
export function CouponsView({ coupons, reload }) {
  const [f, setF] = useState({ code:"", type:"percent", value:10, min_spend:0, max_uses:100, description:"" });
  const create = async () => { if(!f.code.trim()) return toast.error("Code required"); await axios.post(`${API}/coupons`, f); toast.success("Coupon created"); setF({ code:"", type:"percent", value:10, min_spend:0, max_uses:100, description:"" }); reload(); };
  const del = async (c) => { await axios.delete(`${API}/coupons/${c.id}`); toast.success("Deleted"); reload(); };
  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <div className="font-display font-bold mb-3">Create coupon</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <input placeholder="CODE" className="input px-3 py-2 font-mono uppercase" value={f.code} onChange={(e)=>setF({...f, code:e.target.value.toUpperCase()})}/>
          <select className="input px-3 py-2" value={f.type} onChange={(e)=>setF({...f, type:e.target.value})}><option value="percent">%</option><option value="fixed">AU$</option></select>
          <input type="number" placeholder="Value" className="input px-3 py-2 font-mono" value={f.value} onChange={(e)=>setF({...f, value:Number(e.target.value)})}/>
          <input type="number" placeholder="Min spend" className="input px-3 py-2 font-mono" value={f.min_spend} onChange={(e)=>setF({...f, min_spend:Number(e.target.value)})}/>
          <input type="number" placeholder="Max uses" className="input px-3 py-2 font-mono" value={f.max_uses} onChange={(e)=>setF({...f, max_uses:Number(e.target.value)})}/>
        </div>
        <input placeholder="Description" className="input px-3 py-2 mt-2 w-full" value={f.description} onChange={(e)=>setF({...f, description:e.target.value})}/>
        <div className="mt-3 flex justify-end"><button onClick={create} className="btn btn-primary text-sm"><Ticket size={14}/> Create</button></div>
      </div>
      <div className="card overflow-hidden"><table className="tbl">
        <thead><tr><th>Code</th><th>Discount</th><th>Min spend</th><th>Uses</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {coupons.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No coupons yet</td></tr>}
          {coupons.map(c => (
            <tr key={c.id}><td className="font-mono font-bold">{c.code}</td><td>{c.type === "percent" ? `${c.value}%` : moneyCents(c.value)}</td><td>{moneyCents(c.min_spend)}</td><td>{c.used}/{c.max_uses}</td><td><span className={`chip ${c.active?"chip-success":"chip-neutral"}`}>{c.active?"active":"disabled"}</span></td><td><button onClick={()=>del(c)} className="btn btn-danger !p-2"><Trash2 size={12}/></button></td></tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export function ReviewsView({ reviews, reload }) {
  const setStatus = async (r, status) => { await axios.patch(`${API}/reviews/${r.id}`, { status }); reload(); };
  const del = async (r) => { if (!window.confirm("Delete this review?")) return; await axios.delete(`${API}/reviews/${r.id}`); reload(); };
  const total = reviews.length;
  const avg = total ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / total) : 0;
  const dist = [1,2,3,4,5].map(n => reviews.filter(r => r.rating === n).length);
  const maxD = Math.max(1, ...dist);
  return (
    <div className="grid gap-4" data-testid="admin-reviews">
      <div className="card p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Average rating</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-3xl font-display font-bold">{avg.toFixed(1)}</span>
              <div className="flex text-amber-500">{[1,2,3,4,5].map(i => <StarIcon key={i} size={16} fill={i<=Math.round(avg)?"currentColor":"none"}/>)}</div>
            </div>
            <div className="text-xs text-slate-500 mt-1">{total} review{total===1?"":"s"} total</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Distribution</div>
            {[5,4,3,2,1].map(n => (
              <div key={n} className="flex items-center gap-2 text-xs mb-1">
                <span className="w-4 font-mono">{n}</span>
                <StarIcon size={11} className="text-amber-500" fill="currentColor"/>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-amber-400" style={{width: `${(dist[n-1]/maxD)*100}%`}}/></div>
                <span className="w-8 text-right font-mono text-slate-500">{dist[n-1]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card overflow-hidden">
        {reviews.length === 0 && <div className="p-10 text-center text-slate-500">No reviews yet — customers can leave reviews from the <span className="font-mono">My Orders Portal</span>.</div>}
        {reviews.map(r => (
          <div key={r.id} className="p-4 border-b hairline last:border-0 flex items-start gap-4" data-testid={`admin-review-${r.id}`}>
            <div className="flex flex-col items-start gap-1 pt-0.5">
              <div className="flex items-center gap-0.5 text-amber-500">{[1,2,3,4,5].map(i => <StarIcon key={i} size={12} fill={i<=r.rating?"currentColor":"none"}/>)}</div>
              {r.verified_purchase && <span className="chip chip-success !text-[10px] !py-0.5"><BadgeCheck size={10}/> Verified</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{r.title || "Untitled"}</div>
              <div className="text-xs text-slate-500">{r.customer_name} · {fmtDate(r.created_at)}</div>
              <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{r.body}</div>
              <div className="text-[11px] text-slate-400 mt-2 font-mono">
                Product: <span className="text-slate-600">{r.product_id?.slice(0, 8)}…</span>
                <span className="mx-2">·</span>👍 {r.helpful_count || 0}<span className="mx-2">·</span>👎 {r.not_helpful_count || 0}
              </div>
            </div>
            <select value={r.status} onChange={(e)=>setStatus(r, e.target.value)} className="input px-2 py-1 text-xs">{["pending","approved","rejected"].map(s=><option key={s}>{s}</option>)}</select>
            <button onClick={()=>del(r)} className="btn btn-danger !p-2" data-testid={`admin-review-delete-${r.id}`}><Trash2 size={12}/></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------- Customer Portal --------------------------- */

