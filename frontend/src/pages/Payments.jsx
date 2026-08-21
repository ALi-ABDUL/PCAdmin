import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Store } from "lucide-react";
import { StatBox, SubHero } from "../components/atoms";
import { API } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { PAYMENTS_NAV, TRANSACTION_STATUS_TABS } from "../lib/nav";

export function PaymentsModule({ section, setSection }) {
  const meta = PAYMENTS_NAV.find((s) => s.id === section) || PAYMENTS_NAV[0];
  const Icon = meta.icon;
  const hints = {
    transactions: "Every payment attempt across your store.",
    refunds: "Refunded charges and disputed chargebacks.",
  };
  return (
    <div className="grid gap-6">
      <SubHero icon={Icon} group={meta.group} label={meta.label} hint={hints[section]}/>
      {section === "transactions" && <AllTransactionsView/>}
      {section === "refunds"      && <RefundsChargebacksView/>}
    </div>
  );
}

export function AllTransactionsView() {
  const [status, setStatus] = useState("");
  const [tx, setTx] = useState([]); const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/transactions`, { params: { status: status || undefined, kind: "charge" }});
    setTx(data.transactions); setTotal(data.total); setCounts(data.counts || {});
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Total charges" value={total}/>
        <StatBox label="Successful" value={counts.successful?.count || 0} tone="success"/>
        <StatBox label="Pending"    value={counts.pending?.count || 0}/>
        <StatBox label="Failed"     value={counts.failed?.count || 0}/>
      </div>
      <div className="card p-2 flex items-center gap-1 overflow-x-auto">
        {TRANSACTION_STATUS_TABS.map(t => {
          const on = status === t.id;
          const info = t.id ? counts[t.id] : { count: Object.values(counts).reduce((a,b)=>a+(b?.count||0),0), amount: Object.values(counts).reduce((a,b)=>a+(b?.amount||0),0) };
          return (
            <button key={t.id||"all"} data-testid={`tx-tab-${t.id||"all"}`} onClick={() => setStatus(t.id)}
              className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${on ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "text-slate-600 hover:bg-slate-50"}`}>
              {t.label}
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${on ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-500"}`}>{info?.count || 0}</span>
            </button>
          );
        })}
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Reference</th><th>Customer</th><th>Method</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            {tx.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No transactions</td></tr>}
            {tx.map(t => (
              <tr key={t.id} data-testid="tx-row">
                <td className="font-mono text-xs text-slate-500">{t.reference || t.id.slice(0,10)}</td>
                <td>{t.customer_name}</td>
                <td><span className="chip chip-neutral capitalize">{t.method}</span></td>
                <td className="font-mono font-bold text-indigo-600">{moneyCents(t.amount)}</td>
                <td><span className={`chip capitalize ${t.status==='successful'?'chip-success':t.status==='pending'?'chip-warning':'chip-danger'}`}>{t.status}</span></td>
                <td className="text-xs text-slate-500 font-mono">{fmtDate(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

export function RefundsChargebacksView() {
  const [kind, setKind] = useState("");
  const [tx, setTx] = useState([]);
  const load = useCallback(async () => {
    const { data: refunds } = await axios.get(`${API}/transactions`, { params: { kind: "refund" }});
    const { data: cb } = await axios.get(`${API}/transactions`, { params: { kind: "chargeback" }});
    let all = [...refunds.transactions, ...cb.transactions].sort((a,b) => (a.created_at < b.created_at ? 1 : -1));
    if (kind) all = all.filter(t => t.kind === kind);
    setTx(all);
  }, [kind]);
  useEffect(() => { load(); }, [load]);
  const total = tx.reduce((a,t) => a + (t.amount || 0), 0);
  const refunds = tx.filter(t => t.kind === "refund").reduce((a,t)=>a+(t.amount||0),0);
  const chargebacks = tx.filter(t => t.kind === "chargeback").reduce((a,t)=>a+(t.amount||0),0);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Refunds" value={moneyCents(refunds)}/>
        <StatBox label="Chargebacks" value={moneyCents(chargebacks)} tone="success"/>
        <StatBox label="Combined" value={moneyCents(total)}/>
        <StatBox label="Records" value={tx.length}/>
      </div>
      <div className="card p-2 flex items-center gap-1 overflow-x-auto">
        {[["","All"],["refund","Refunds"],["chargeback","Chargebacks"]].map(([v,l]) => (
          <button key={v||"all"} onClick={()=>setKind(v)} className={`shrink-0 px-3 py-2 rounded-lg text-sm font-medium ${kind===v?"bg-indigo-50 text-indigo-600 border border-indigo-100":"text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Reference</th><th>Customer</th><th>Kind</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            {tx.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-500">No refunds or chargebacks</td></tr>}
            {tx.map(t => (
              <tr key={t.id}>
                <td className="font-mono text-xs text-slate-500">{t.reference || t.id.slice(0,10)}</td>
                <td>{t.customer_name}</td>
                <td><span className={`chip capitalize ${t.kind==='chargeback'?'chip-danger':'chip-warning'}`}>{t.kind}</span></td>
                <td className="font-mono font-bold text-indigo-600">{moneyCents(t.amount)}</td>
                <td><span className="chip chip-neutral capitalize">{t.method}</span></td>
                <td><span className={`chip capitalize ${t.status==='successful'?'chip-success':t.status==='pending'?'chip-warning':'chip-danger'}`}>{t.status}</span></td>
                <td className="text-xs text-slate-500 font-mono">{fmtDate(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

/* ---------------------------- Store Management ---------------------------- */
