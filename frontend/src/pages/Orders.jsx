import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Eye, Filter } from "lucide-react";
import { StatBox, StatusChip, SubHero } from "../components/atoms";
import { Pagination, usePagePref } from "../components/Pagination";
import { SortableTh, useSortPref } from "../components/SortableTh";
import { API } from "../lib/api";
import { fmtDate, humaniseStatus, moneyCents } from "../lib/format";
import { ORDERS_NAV, ORDER_STATUSES, ORDER_STATUS_TABS } from "../lib/nav";
import { Analytics } from "./Analytics";
import { OrderDetailPage } from "./OrderDetail";

export function OrdersModule({ section, setSection, deepLink, clearDeepLink, openOrderDetail, orderDetailId }) {
  const meta = ORDERS_NAV.find((s) => s.id === section) || ORDERS_NAV[0];
  const Icon = meta.icon;
  const hints = {
    all: "Every order across every status. Filter with the tabs.",
    returns: "Customer return requests & refunds.",
    abandoned: "Carts your buyers created but didn't complete — recover them.",
  };
  if (orderDetailId) {
    return <OrderDetailPage orderId={orderDetailId} onBack={() => openOrderDetail(null)}/>;
  }
  return (
    <div className="grid gap-6">
      <SubHero icon={Icon} group={meta.group} label={meta.label} hint={hints[section]}/>
      {section === "all"       && <AllOrdersView deepLink={deepLink} clearDeepLink={clearDeepLink} openOrderDetail={openOrderDetail}/>}
      {section === "returns"   && <ReturnsView/>}
      {section === "abandoned" && <AbandonedCartsView/>}
    </div>
  );
}

export function AllOrdersView({ deepLink, clearDeepLink, openOrderDetail }) {
  const [status, setStatus] = useState("");
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePagePref("orders", 50);
  const { field: sortField, dir: sortDir, sortParam, toggle: toggleSort } = useSortPref("orders", "created_at", "desc");

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/orders`, {
      params: {
        status: status || undefined,
        limit: pageSize,
        skip: (page - 1) * pageSize,
        sort: sortParam,
      },
    });
    setOrders(data.orders); setTotal(data.total);
  }, [status, page, pageSize, sortParam]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/orders/status-counts`).then(r => setCounts(r.data.counts || {})); }, [orders.length]);
  useEffect(() => { setPage(1); }, [status, pageSize, sortParam]);

  useEffect(() => {
    if (!deepLink?.orderId) return;
    openOrderDetail(deepLink.orderId);
    clearDeepLink && clearDeepLink();
  }, [deepLink, openOrderDetail, clearDeepLink]);

  const setOrderStatus = async (o, s) => {
    // Silent success — order status update is an internal admin action.
    try { await axios.patch(`${API}/orders/${o.id}`, { status: s }); await load(); }
    catch { toast.error("Update failed"); }
  };

  return (
    <div className="grid gap-4">
      <div className="card p-2 flex items-center gap-1 overflow-x-auto">
        {ORDER_STATUS_TABS.map(t => {
          const on = status === t.id;
          const count = t.id ? (counts[t.id] || 0) : Object.values(counts).reduce((a,b)=>a+b,0);
          return (
            <button key={t.id || "all"} data-testid={`ord-tab-${t.id || "all"}`} onClick={() => setStatus(t.id)}
              className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${on ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "text-slate-600 hover:bg-slate-50"}`}>
              {t.label}
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${on ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-500"}`}>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="text-xs text-slate-500 font-mono">{total} order{total===1?"":"s"} · page {page}</div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <SortableTh label="Reference" field="reference" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="ord"/>
              <SortableTh label="Product" field="product_title" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="ord"/>
              <SortableTh label="Customer" field="customer_name" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="ord"/>
              <SortableTh label="Qty" field="quantity" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="ord"/>
              <SortableTh label="Total" field="total" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="ord"/>
              <SortableTh label="Status" field="status" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="ord"/>
              <SortableTh label="Date" field="created_at" active={sortField} dir={sortDir} onSort={toggleSort} testPrefix="ord"/>
              <th></th>
            </tr></thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-slate-500">No orders in this bucket</td></tr>}
              {orders.map(o => (
                <tr key={o.id} data-testid="ord-row" className="cursor-pointer hover:bg-slate-50" onClick={() => openOrderDetail(o.id)}>
                  <td className="font-mono text-xs font-bold text-indigo-600" data-testid={`ord-ref-${o.id}`}>{o.reference || o.id.slice(0,8)}</td>
                  <td className="text-sm truncate max-w-[280px]" title={o.product_title}>{o.product_title}</td>
                  <td>{o.customer_name}</td>
                  <td>{o.quantity}</td>
                  <td className="font-mono font-bold text-indigo-600">{moneyCents(o.total)}</td>
                  <td onClick={(e)=>e.stopPropagation()}>
                    <select value={o.status} onChange={(e)=>setOrderStatus(o, e.target.value)} className="input px-2 py-1 text-xs">
                      {ORDER_STATUSES.map(s => <option key={s} value={s}>{humaniseStatus(s)}</option>)}
                    </select>
                  </td>
                  <td className="text-xs text-slate-500 font-mono">{fmtDate(o.created_at)}</td>
                  <td onClick={(e)=>e.stopPropagation()}><button onClick={()=>openOrderDetail(o.id)} className="btn btn-ghost text-xs !py-1 !px-2" data-testid={`ord-view-${o.id}`}><Eye size={12}/> Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        testPrefix="orders"
      />
    </div>
  );
}

export function ReturnsView() {
  const [returns, setReturns] = useState([]);
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/returns`, { params: { status: status || undefined }});
    setReturns(data.returns);
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const setStatusFor = async (r, s) => { await axios.patch(`${API}/returns/${r.id}`, { status: s }); toast.success(`Marked ${s}`); load(); };
  const stats = returns.reduce((a,r) => { a.total++; a.amount += r.amount || 0; if (r.status === "refunded") a.refunded += r.amount || 0; return a; }, { total:0, amount:0, refunded:0 });

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Return requests" value={stats.total}/>
        <StatBox label="Refunded value" value={moneyCents(stats.refunded)} tone="success"/>
        <StatBox label="Pending" value={returns.filter(r=>r.status==='pending').length}/>
        <StatBox label="Rejected" value={returns.filter(r=>r.status==='rejected').length}/>
      </div>
      <div className="card p-2 flex items-center gap-1 overflow-x-auto">
        {["", "pending", "approved", "refunded", "rejected"].map(s => (
          <button key={s||"all"} onClick={()=>setStatus(s)} className={`shrink-0 px-3 py-2 rounded-lg text-sm font-medium capitalize ${status===s?"bg-indigo-50 text-indigo-600 border border-indigo-100":"text-slate-600 hover:bg-slate-50"}`}>{s || "All"}</button>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Product</th><th>Customer</th><th>Reason</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            {returns.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No returns</td></tr>}
            {returns.map(r => (
              <tr key={r.id}>
                <td className="text-sm truncate max-w-[280px]">{r.product_title}</td>
                <td>{r.customer_name}</td>
                <td className="text-xs text-slate-500">{r.reason}</td>
                <td className="font-mono font-bold text-indigo-600">{moneyCents(r.amount)}</td>
                <td><select value={r.status} onChange={(e)=>setStatusFor(r, e.target.value)} className="input px-2 py-1 text-xs">{["pending","approved","refunded","rejected"].map(s=><option key={s}>{s}</option>)}</select></td>
                <td className="text-xs text-slate-500 font-mono">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

export function AbandonedCartsView() {
  const [carts, setCarts] = useState([]); const [totalValue, setTotalValue] = useState(0);
  const [recovered, setRecovered] = useState("");
  const load = useCallback(async () => {
    const params = recovered === "" ? {} : { recovered: recovered === "yes" };
    const { data } = await axios.get(`${API}/abandoned-carts`, { params });
    setCarts(data.carts); setTotalValue(data.total_value);
  }, [recovered]);
  useEffect(() => { load(); }, [load]);
  const markRecovered = async (c) => { await axios.patch(`${API}/abandoned-carts/${c.id}`, { recovered: true }); toast.success("Marked recovered"); load(); };

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Abandoned carts" value={carts.length}/>
        <StatBox label="Recoverable value" value={moneyCents(totalValue)}/>
        <StatBox label="Recovered" value={carts.filter(c=>c.recovered).length} tone="success"/>
        <StatBox label="Recovery rate" value={carts.length ? `${((carts.filter(c=>c.recovered).length / carts.length)*100).toFixed(1)}%` : "—"}/>
      </div>
      <div className="card p-2 flex items-center gap-1 overflow-x-auto">
        {[["","All"],["no","Not recovered"],["yes","Recovered"]].map(([v,l]) => (
          <button key={v||"all"} onClick={()=>setRecovered(v)} className={`shrink-0 px-3 py-2 rounded-lg text-sm font-medium ${recovered===v?"bg-indigo-50 text-indigo-600 border border-indigo-100":"text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Customer</th><th>Email</th><th>Items</th><th>Subtotal</th><th>Step</th><th>Age</th><th></th></tr></thead>
          <tbody>
            {carts.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-500">No abandoned carts</td></tr>}
            {carts.map(c => {
              const hours = Math.round((Date.now() - new Date(c.created_at).getTime()) / 3600000);
              return (
                <tr key={c.id} className={c.recovered ? "opacity-50" : ""}>
                  <td>{c.customer_name}</td>
                  <td className="font-mono text-xs text-slate-500">{c.customer_email}</td>
                  <td>{c.items}</td>
                  <td className="font-mono font-bold text-indigo-600">{moneyCents(c.subtotal)}</td>
                  <td><span className="chip chip-neutral capitalize">{c.step}</span></td>
                  <td className="text-xs text-slate-500">{hours < 24 ? `${hours}h ago` : `${Math.floor(hours/24)}d ago`}</td>
                  <td>{c.recovered ? <span className="chip chip-success">recovered</span> : <button onClick={()=>markRecovered(c)} className="btn btn-ghost text-xs !py-1 !px-2">Mark recovered</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

/* -------------------------------- Payments -------------------------------- */
export function Orders() {
  const [orders, setOrders] = useState([]); const [status, setStatus] = useState("");
  useEffect(() => { axios.get(`${API}/orders`, { params: { status: status || undefined } }).then(r => setOrders(r.data.orders)); }, [status]);
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500 font-mono">{orders.length} orders</div>
        <select value={status} onChange={(e)=>setStatus(e.target.value)} className="input px-3 py-2 text-sm">
          <option value="">All statuses</option>{["paid","shipped","delivered","refunded","cancelled"].map(s=><option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Order ID</th><th>Product</th><th>Customer</th><th>Qty</th><th>Total</th><th>Profit</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>
          {orders.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-slate-500">No orders</td></tr>}
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="font-mono text-xs text-slate-500">{o.id.slice(0, 8)}</td>
              <td className="text-sm truncate max-w-[280px]" title={o.product_title}>{o.product_title}</td>
              <td>{o.customer_name}</td>
              <td>{o.quantity}</td>
              <td className="font-mono font-bold text-indigo-600">{moneyCents(o.total)}</td>
              <td className="font-mono text-emerald-600">{moneyCents(o.profit)}</td>
              <td><StatusChip status={o.status}/></td>
              <td className="text-xs text-slate-500 font-mono">{fmtDate(o.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </div>
  );
}

/* -------------------------------- Customers ------------------------------- */
/* ------------------------------- Analytics -------------------------------- */
