import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { RotateCcw, Timer, Trash2 } from "lucide-react";
import { Pagination, usePagePref } from "../components/Pagination";
import { ProductGrid } from "../components/ProductGrid";
import { API } from "../lib/api";

/**
 * Product Countdown — products whose limited-time sale ran to zero.
 *
 * The backend auto-inactivates every expired-countdown product and
 * flips `countdown_expired=True`. This page lists them so the admin
 * can either restore the product (`POST /products/{id}/countdown/restore`)
 * which clears the countdown fields + re-activates it, or delete it
 * outright. Same UI pattern as ArchivedProducts.
 */
export function CountdownProducts({ openProductDetail }) {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePagePref("products-countdown", 50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/products`, {
        params: {
          countdown_status: "expired",
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
  }, [page, pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get(`${API}/categories`, { params: { active: true } }).then(r => setCats(r.data.categories));
  }, []);
  useEffect(() => { setPage(1); }, [pageSize]);

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

  const extraActions = (p) => (
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

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex items-center gap-2 text-sm text-slate-500">
          <Timer size={13} className="text-rose-500"/>
          <span>Expired-countdown products live here until you restore or delete them.</span>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          {loading ? "Loading…" : `${total} expired`}
        </div>
      </div>

      <ProductGrid
        list={list}
        cats={cats}
        onOpen={(p) => openProductDetail && openProductDetail(p.id)}
        emptyLabel="Nothing here yet — every product with an active countdown will show up in the main Products list."
        extraActions={extraActions}
        testId="countdown-grid"
      />
      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        testPrefix="countdown"
      />
    </div>
  );
}
