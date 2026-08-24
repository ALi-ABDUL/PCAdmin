import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckSquare, PackageX, Square, Trash2, Undo2 } from "lucide-react";
import { Pagination, usePagePref } from "../components/Pagination";
import { ProductGrid } from "../components/ProductGrid";
import { API } from "../lib/api";

export function ArchivedProducts({ openProductDetail }) {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePagePref("products-archived", 50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/products`, {
        params: {
          archived: true,
          sort: "created_at_desc",
          limit: pageSize,
          skip: (page - 1) * pageSize,
        },
      });
      setList(data.products);
      setTotal(data.total);
      // Prune selection to only ids that still exist in the fresh list.
      setSelected((prev) => {
        const alive = new Set(data.products.map((p) => p.id));
        const next = new Set([...prev].filter((id) => alive.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get(`${API}/categories`, { params: { active: true } }).then(r => setCats(r.data.categories));
  }, []);
  useEffect(() => { setPage(1); }, [pageSize]);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allChecked = list.length > 0 && selected.size === list.length;
  const someChecked = selected.size > 0 && !allChecked;
  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(list.map((p) => p.id)));
  };

  const restore = async (p) => {
    await axios.post(`${API}/products/${p.id}/restore`);
    toast.success(`Restored "${p.title.slice(0, 32)}"`);
    load();
  };
  const purge = async (p) => {
    if (!window.confirm(`Permanently delete "${p.title}"? This cannot be undone.`)) return;
    await axios.delete(`${API}/products/${p.id}`);
    toast.success("Deleted permanently");
    load();
  };

  const bulkRestore = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/products/bulk-restore`, { product_ids: ids });
      toast.success(`Restored ${data.restored} product${data.restored === 1 ? "" : "s"}`);
      setSelected(new Set());
      await load();
    } catch { toast.error("Restore failed"); }
    finally { setBusy(false); }
  };
  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Permanently delete ${ids.length} product${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/products/bulk-delete`, { product_ids: ids });
      toast.success(`Deleted ${data.deleted} product${data.deleted === 1 ? "" : "s"} permanently`);
      setSelected(new Set());
      await load();
    } catch { toast.error("Delete failed"); }
    finally { setBusy(false); }
  };

  const extraActions = (p) => (
    <>
      <button
        onClick={() => restore(p)}
        className="btn btn-primary text-xs !py-1 !px-2"
        data-testid={`product-restore-${p.id}`}
        title="Restore — return to All Products"
      >
        Restore
      </button>
      <button
        onClick={() => purge(p)}
        className="btn btn-danger text-xs !py-1 !px-2"
        data-testid={`product-purge-${p.id}`}
        title="Delete permanently"
      >
        <PackageX size={12} />
      </button>
    </>
  );

  const hasSelection = selected.size > 0;

  return (
    <div className="grid gap-4">
      {/* Toolbar: Select-all + bulk actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <label
          className={`inline-flex items-center gap-2 text-sm font-medium select-none cursor-pointer ${list.length === 0 ? "opacity-50 pointer-events-none" : ""}`}
          data-testid="archived-select-all"
        >
          <input
            type="checkbox"
            className="accent-indigo-600 w-4 h-4"
            checked={allChecked}
            ref={(el) => { if (el) el.indeterminate = someChecked; }}
            onChange={toggleAll}
            aria-label="Select all archived products"
          />
          {allChecked ? <CheckSquare size={14}/> : <Square size={14}/>}
          <span>{selected.size > 0 ? `${selected.size} selected` : `Select all${list.length ? ` (${list.length})` : ""}`}</span>
        </label>

        <div className="flex items-center gap-2 min-h-[36px]">
          {hasSelection && (
            <>
              <button
                onClick={bulkRestore}
                disabled={busy}
                className="btn btn-primary text-sm"
                data-testid="archived-bulk-restore"
              >
                <Undo2 size={13}/> Restore ({selected.size})
              </button>
              <button
                onClick={bulkDelete}
                disabled={busy}
                className="btn btn-danger text-sm"
                data-testid="archived-bulk-delete"
              >
                <Trash2 size={13}/> Delete ({selected.size})
              </button>
            </>
          )}
          <div className="text-xs text-slate-500 font-mono ml-2">
            {loading ? "Loading…" : `${total} archived`}
          </div>
        </div>
      </div>

      <ProductGrid
        list={list}
        cats={cats}
        onOpen={(p) => openProductDetail && openProductDetail(p.id)}
        emptyLabel="Nothing archived yet."
        extraActions={extraActions}
        showBulkCheckbox
        selected={selected}
        onToggleSelect={toggle}
        testId="archived-grid"
      />
      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        testPrefix="archived"
      />
    </div>
  );
}
