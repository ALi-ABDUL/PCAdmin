import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { PackageX } from "lucide-react";
import { ProductGrid } from "../components/ProductGrid";
import { API } from "../lib/api";

export function ArchivedProducts({ openProductDetail }) {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/products`, { params: { archived: true, sort: "created_at_desc" } });
      setList(data.products);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get(`${API}/categories`, { params: { active: true } }).then(r => setCats(r.data.categories));
  }, []);

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

  return (
    <div className="grid gap-4">
      <div className="text-sm text-slate-500 font-mono">
        {loading ? "Loading…" : `${total} archived product${total === 1 ? "" : "s"}`}
      </div>
      <ProductGrid
        list={list}
        cats={cats}
        onOpen={(p) => openProductDetail && openProductDetail(p.id)}
        emptyLabel="Nothing archived yet."
        extraActions={extraActions}
        testId="archived-grid"
      />
    </div>
  );
}
