import { ArrowUpRight } from "lucide-react";
import { Products } from "../pages/ProductsList";

export function SubHero({ icon: Icon, group, label, hint, cta }) {
  return (
    <div className="card p-5 md:p-6 flex items-start gap-4">
      <div className="w-12 h-12 rounded-xl grid place-items-center text-white shrink-0" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}><Icon size={20}/></div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">{group}</div>
        <div className="font-display text-2xl font-bold tracking-tight">{label}</div>
        <div className="text-sm text-slate-500 mt-1">{hint}</div>
      </div>
      {cta}
    </div>
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

export function StatusChip({ status }) {
  const map = { paid: "chip-primary", shipped: "chip-primary", delivered: "chip-success", refunded: "chip-warning", cancelled: "chip-danger" };
  return <span className={`chip capitalize ${map[status] || "chip-neutral"}`}>{status}</span>;
}

export function KpiCard({ label, value, sub, icon: Icon, tone, onExpand, testId }) {
  const toneMap = {
    primary: "from-indigo-500 to-indigo-600",
    success: "from-emerald-500 to-emerald-600",
    violet:  "from-violet-500 to-violet-600",
    pink:    "from-pink-500 to-pink-600",
  };
  return (
    <div className="card p-5 relative overflow-hidden" data-testid={testId}>
      <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-20 blur-2xl bg-gradient-to-br pointer-events-none ${toneMap[tone]}`}/>
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 rounded-xl grid place-items-center text-white bg-gradient-to-br ${toneMap[tone]}`}><Icon size={18}/></div>
        {onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            className="kpi-expand-arrow p-1.5 -m-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
            aria-label={`Expand ${label}`}
            data-testid={testId ? `${testId}-expand` : "kpi-expand"}
          >
            <ArrowUpRight size={16}/>
          </button>
        ) : (
          <ArrowUpRight className="text-slate-300" size={16}/>
        )}
      </div>
      <div className="mt-4 font-display text-3xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label} · <span className="text-slate-400">{sub}</span></div>
    </div>
  );
}

/* -------------------------------- Products -------------------------------- */
export function statusBadge(p) {
  // Ordered: most severe first
  if (p.stock_status === "sold" || (p.is_sold && !p.stock_status)) return { label: "SOLD", cls: "chip-danger" };
  if (p.stock_status === "ended") return { label: "ENDED", cls: "chip-danger" };
  if (p.stock_status === "out_of_stock") return { label: "OUT OF STOCK", cls: "chip-danger" };
  if ((p.stock ?? 0) <= 0) return { label: "OUT OF STOCK", cls: "chip-danger" };
  if (!p.active) return { label: "DRAFT", cls: "chip-neutral" };
  return null;
}

export function Field({ label, className, children }) {
  return (<label className={`grid gap-1 ${className||""}`}>
    <span className="text-[11px] font-mono uppercase tracking-widest text-slate-500">{label}</span>
    {children}
  </label>);
}

/* --------------------------------- Scraper -------------------------------- */
export function StatBox({ label, value, tone }) {
  return (<div className="card p-5"><div className="text-xs text-slate-500 font-medium">{label}</div><div className={`font-display text-3xl font-bold mt-1 ${tone==='success'?'text-emerald-600':''}`}>{value}</div></div>);
}

/* -------------------------------- Settings -------------------------------- */
export function InfoBox({ icon, label, value, mono }) {
  return (
    <div className="card-flat p-3 min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 flex items-center gap-1.5">{icon}{label}</div>
      <div className={`mt-1 text-sm text-slate-800 truncate ${mono?"font-mono":""}`} title={value||""}>{value || "—"}</div>
    </div>
  );
}

