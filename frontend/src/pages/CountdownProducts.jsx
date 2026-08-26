import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { PlayCircle, RotateCcw, Timer, Trash2 } from "lucide-react";
import { Pagination, usePagePref } from "../components/Pagination";
import { ProductGrid } from "../components/ProductGrid";
import { API } from "../lib/api";

/**
 * Product Countdown — two sub-tabs.
 *   • Active   → products with a currently running sale (`countdown_status=active`)
 *                Each card shows the live D·H·M·S chip and the sale price.
 *   • Expired  → products whose countdown ran to zero (`countdown_status=expired`)
 *                Each card gets a Restore + Delete action.
 *
 * The tab state is local (no URL param) — kept intentionally simple so the
 * sidebar link always deep-links to Active. Admins can flip to Expired
 * with a single click on the same page.
 */

const TABS = [
  { id: "active",  label: "Active Countdowns",  icon: PlayCircle,
    testId: "countdown-tab-active",
    empty: "No products are running a countdown right now. Start one from any product's detail page." },
  { id: "expired", label: "Expired Countdowns", icon: Timer,
    testId: "countdown-tab-expired",
    empty: "Nothing here yet — expired-countdown products land here so you can restore or delete them." },
];


export function CountdownProducts({ openProductDetail }) {
  const [tab, setTab] = useState("active");
  const active = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-1 border-b hairline" data-testid="countdown-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? "text-rose-700 border-rose-500"
                  : "text-slate-500 border-transparent hover:text-slate-700 hover:border-slate-300"
              }`}
              data-testid={t.testId}
            >
              <Icon size={14}/>
              {t.label}
            </button>
          );
        })}
      </div>
      <CountdownList
        key={tab}                      /* remount on tab switch — resets page + state */
        tabId={tab}
        emptyLabel={active.empty}
        openProductDetail={openProductDetail}
      />
    </div>
  );
}


function CountdownList({ tabId, emptyLabel, openProductDetail }) {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePagePref(`products-countdown-${tabId}`, 50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/products`, {
        params: {
          countdown_status: tabId,             /* "active" or "expired" */
          sort: "created_at_desc",
          limit: pageSize,
          skip: (page - 1) * pageSize,
        },
      });
      setList(data.products);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [tabId, page, pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get(`${API}/categories`, { params: { active: true } }).then((r) => setCats(r.data.categories));
  }, []);
  useEffect(() => { setPage(1); }, [pageSize]);

  const stop = async (p) => {
    if (!window.confirm(`Cancel the countdown on "${p.title}"?`)) return;
    await axios.post(`${API}/products/${p.id}/countdown/stop`);
    toast.success("Countdown cancelled");
    load();
  };
  const restore = async (p) => {
    await axios.post(`${API}/products/${p.id}/countdown/restore`);
    toast.success(`Restored "${p.title.slice(0, 32)}"`);
    load();
  };
  const purge = async (p) => {
    if (!window.confirm(`Permanently delete "${p.title}"? This cannot be undone.`)) return;
    await axios.delete(`${API}/products/${p.id}`);
    toast.success("Deleted permanently");
    load();
  };

  const extraActions = (p) => {
    if (tabId === "active") {
      // Days remaining pill — mirrors the requirement "remaining days
      // displayed on each card". The live H:M:S chip already renders
      // inside the product card via ProductGrid.CountdownChip; this
      // pill is the coarser "N days left" summary the request called
      // out.
      const remaining = p.countdown_ends_at
        ? Math.max(0, new Date(p.countdown_ends_at).getTime() - Date.now())
        : 0;
      const days = Math.ceil(remaining / 86_400_000);
      return (
        <>
          <span
            className="chip !bg-rose-100 !text-rose-800 !border-rose-200 !text-[10px] font-mono"
            data-testid={`countdown-days-left-${p.id}`}
          >
            {days === 0 ? "< 1 day left" : `${days} day${days === 1 ? "" : "s"} left`}
          </span>
          <button
            onClick={() => stop(p)}
            className="btn btn-ghost text-rose-700 hover:bg-rose-50 text-xs !py-1 !px-2"
            data-testid={`countdown-cancel-${p.id}`}
            title="Cancel countdown"
          >
            Cancel
          </button>
        </>
      );
    }
    // Expired tab
    return (
      <>
        <button
          onClick={() => restore(p)}
          className="btn btn-primary text-xs !py-1 !px-2"
          data-testid={`countdown-restore-${p.id}`}
          title="Restore — clears countdown and moves back to All Products"
        >
          <RotateCcw size={12}/> Restore
        </button>
        <button
          onClick={() => purge(p)}
          className="btn btn-danger text-xs !py-1 !px-2"
          data-testid={`countdown-purge-${p.id}`}
          title="Delete permanently"
        >
          <Trash2 size={12}/>
        </button>
      </>
    );
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-end">
        <div className="text-xs text-slate-500 font-mono" data-testid={`countdown-count-${tabId}`}>
          {loading ? "Loading…" : `${total} ${tabId === "active" ? "active" : "expired"}`}
        </div>
      </div>
      <ProductGrid
        list={list}
        cats={cats}
        onOpen={(p) => openProductDetail && openProductDetail(p.id)}
        emptyLabel={emptyLabel}
        extraActions={extraActions}
        testId={`countdown-grid-${tabId}`}
      />
      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        testPrefix={`countdown-${tabId}`}
      />
    </div>
  );
}
