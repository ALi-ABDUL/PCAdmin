import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { BarChart3, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { API } from "../lib/api";

const currentPeriod = () => new Date().toISOString().slice(0, 7);

const formatLastUsed = (value) => {
  if (!value) return "Not used yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not used yet" : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
};

export function ScraperProviderUsageDashboard() {
  const [period, setPeriod] = useState(currentPeriod);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/scraper/provider-usage`, { params: { period } });
      setData(response.data);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const totals = data?.totals || { requests: 0, successful_requests: 0, failed_requests: 0 };
  const successRate = totals.requests ? Math.round((totals.successful_requests / totals.requests) * 100) : 0;

  return (
    <section className="card p-5" data-testid="scraper-provider-usage-dashboard">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-lg grid place-items-center shrink-0 bg-emerald-50 text-emerald-700"><BarChart3 size={19}/></div>
          <div>
            <div className="font-display font-bold text-base" data-testid="scraper-provider-usage-heading">Provider usage</div>
            <div className="text-xs text-slate-500 mt-0.5">Counts every third-party provider request, including failed fallback attempts.</div>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <label className="grid gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500" data-testid="scraper-provider-usage-period-label">
            Month
            <input type="month" value={period} onChange={(event) => setPeriod(event.target.value || currentPeriod())} className="input px-2.5 py-1.5 text-xs font-mono" data-testid="scraper-provider-usage-period" />
          </label>
          <button onClick={load} disabled={loading} className="btn btn-ghost !p-2" title="Refresh provider usage" data-testid="scraper-provider-usage-refresh">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""}/>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-5" data-testid="scraper-provider-usage-totals">
        <UsageStat label="Requests" value={totals.requests} testId="scraper-provider-usage-total-requests" />
        <UsageStat label="Success rate" value={`${successRate}%`} testId="scraper-provider-usage-success-rate" />
        <UsageStat label="Failed" value={totals.failed_requests} testId="scraper-provider-usage-total-failed" tone="red" />
      </div>

      <div className="mt-4 divide-y hairline border-t hairline" data-testid="scraper-provider-usage-list">
        {loading && !data ? <div className="py-8 text-sm text-slate-500" data-testid="scraper-provider-usage-loading">Loading provider usage…</div> : data?.providers?.map((provider) => {
          const rate = provider.requests ? Math.round((provider.successful_requests / provider.requests) * 100) : 0;
          return <div key={provider.id} className="grid grid-cols-2 md:grid-cols-[minmax(180px,1.5fr)_repeat(4,minmax(0,1fr))] gap-x-3 gap-y-2 py-3 items-center" data-testid={`scraper-provider-usage-row-${provider.id}`}>
            <div className="min-w-0 col-span-2 md:col-span-1">
              <div className="text-sm font-medium truncate" data-testid={`scraper-provider-usage-label-${provider.id}`}>{provider.label}</div>
              <div className="text-[10px] font-mono uppercase text-slate-400">{provider.type} · {provider.enabled ? "Enabled" : "Inactive"}</div>
            </div>
            <UsageCell label="Requests" value={provider.requests} testId={`scraper-provider-usage-requests-${provider.id}`} />
            <UsageCell label="Success" value={`${rate}%`} testId={`scraper-provider-usage-success-${provider.id}`} />
            <UsageCell label="Failed" value={provider.failed_requests} testId={`scraper-provider-usage-failed-${provider.id}`} danger={provider.failed_requests > 0} />
            <UsageCell label="Last used" value={formatLastUsed(provider.last_used_at)} testId={`scraper-provider-usage-last-used-${provider.id}`} small />
          </div>;
        })}
      </div>
    </section>
  );
}

function UsageStat({ label, value, testId, tone = "slate" }) {
  const color = tone === "red" ? "text-red-600" : "text-slate-900";
  return <div className="border hairline rounded-lg px-3 py-2.5"><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</div><div className={`text-lg font-display font-bold mt-0.5 ${color}`} data-testid={testId}>{value}</div></div>;
}

function UsageCell({ label, value, testId, danger = false, small = false }) {
  return <div className="min-w-0"><div className="text-[10px] font-mono uppercase tracking-widest text-slate-400">{label}</div><div className={`${small ? "text-[11px]" : "text-sm"} ${danger ? "text-red-600" : "text-slate-700"} truncate`} title={String(value)} data-testid={testId}>{value}</div></div>;
}