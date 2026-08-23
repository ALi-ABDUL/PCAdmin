import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BadgeCheck, Ban, Bell, BellOff, ChevronRight, DollarSign, HelpCircle, ImageIcon, Menu, PackageMinus, RefreshCw, Search, ShoppingBag, Store, TrendingDown, TrendingUp, UserPlus, XCircle } from "lucide-react";
import { API, proxyImg } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { CUSTOMER_NAV, ORDERS_NAV, PAYMENTS_NAV, PRODUCT_NAV, STORE_NAV, SUPPLIER_NAV } from "../lib/nav";
import { Analytics } from "../pages/Analytics";
import { Categories } from "../pages/Categories";
import { Dashboard } from "../pages/Dashboard";
import { Orders } from "../pages/Orders";
import { Products } from "../pages/ProductsList";
import { Suppliers } from "../pages/Suppliers";

export function GlobalSearch({ onNavigate }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);   // {products, orders}
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await axios.get(`${API}/search`, { params: { q: q.trim(), limit: 8 }});
        setResults(data);
      } catch { setResults({ products: [], orders: [] }); }
      finally { setBusy(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const openProduct = (p) => { setOpen(false); setQ(""); onNavigate?.({ tab: "products", section: "all", filter: { productId: p.id } }); };
  const openOrder   = (o) => { setOpen(false); setQ(""); onNavigate?.({ tab: "orders",   section: "all", filter: { orderId: o.id } }); };

  const hasHits = results && (results.products.length + results.orders.length) > 0;

  return (
    <div ref={ref} className="hidden lg:block relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--dim)]"/>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => q && setOpen(true)}
        placeholder="Search products, orders, or codes…"
        className="input pl-9 pr-3 py-2 text-sm w-72"
        data-testid="global-search-input"
      />
      {open && q && (
        <div className="absolute right-0 top-11 w-[420px] max-w-[92vw] bg-white border hairline shadow-2xl rounded-xl overflow-hidden z-50" data-testid="global-search-dropdown">
          {busy && <div className="p-3 text-xs text-slate-500 font-mono">searching…</div>}
          {!busy && !hasHits && <div className="p-6 text-center text-sm text-slate-500">No matches for <span className="font-mono">{q}</span></div>}
          {!busy && hasHits && (
            <div className="max-h-[440px] overflow-y-auto">
              {results.products.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-slate-500 bg-slate-50 border-b hairline">Products · {results.products.length}</div>
                  {results.products.map(p => (
                    <button key={p.id} onClick={() => openProduct(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-3 border-b hairline last:border-b-0" data-testid={`search-product-${p.id}`}>
                      <div className="w-9 h-9 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                        {p.images?.[0] ? <img src={proxyImg(p.images[0])} alt="" className="w-full h-full object-cover"/> : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={13}/></div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{p.title}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 font-mono">
                          {p.product_code && <span className="text-indigo-600 font-bold">{p.product_code}</span>}
                          <span className="text-slate-400">·</span>
                          <span>{moneyCents(p.price)}</span>
                          {p.archived && <span className="chip chip-neutral !text-[9px] !py-0">archived</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {results.orders.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-slate-500 bg-slate-50 border-b hairline">Orders · {results.orders.length}</div>
                  {results.orders.map(o => (
                    <button key={o.id} onClick={() => openOrder(o)} className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b hairline last:border-b-0" data-testid={`search-order-${o.id}`}>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-indigo-600 font-bold text-xs">{o.reference || o.id.slice(0,8)}</span>
                        <span className="text-slate-400">·</span>
                        <span className="truncate flex-1">{o.product_title}</span>
                        <span className="font-mono text-slate-600 shrink-0">{moneyCents(o.total)}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{o.customer_name} · {o.status}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export function NotificationBell({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  // Track the newest notification we've already surfaced so we don't re-toast on refresh.
  const seenIdsRef = useRef(null); // Set<id> — null = "first load, don't toast anything"

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/notifications`, { params: { limit: 25 } });
      const list = data.notifications || [];
      setRows(list);
      setUnread(data.unread_count || 0);

      // First run: prime the seen set silently.
      if (seenIdsRef.current === null) {
        seenIdsRef.current = new Set(list.map((n) => n.id));
        return;
      }
      // Toast anything that's new since last poll (unread only).
      const seen = seenIdsRef.current;
      const fresh = list.filter((n) => !seen.has(n.id) && !n.read);
      if (fresh.length) {
        // Newest first, but toast in reverse so newest appears on top.
        fresh
          .slice()
          .sort((a, b) => (a.at < b.at ? -1 : 1))
          .forEach((n) => {
            const meta = NOTIF_META[n.type] || NOTIF_META.price_change;
            const desc = (() => {
              if (n.type === "price_change") {
                const dir = (n.new_price ?? 0) < (n.old_price ?? 0) ? "↓" : "↑";
                return `${n.product_title || ""} · $${(n.old_price ?? 0).toFixed(2)} ${dir} $${(n.new_price ?? 0).toFixed(2)} · margin ${(n.delta_margin ?? 0) > 0 ? "+" : ""}${(n.delta_margin ?? 0).toFixed(1)}pp`;
              }
              return n.body || n.product_title || "";
            })();
            toast(n.title || "New notification", {
              description: desc,
              icon: <meta.icon size={16} style={{ color: meta.color }}/>,
              duration: 8000,
              action: {
                label: "Open",
                onClick: () => onClickRow(n),
              },
            });
          });
      }
      // Refresh the seen set to the union of previous + current (so read-away rows don't re-toast).
      seenIdsRef.current = new Set(list.map((n) => n.id));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const markOne = async (n) => {
    if (n.read) return;
    setRows((rs) => rs.map((r) => (r.id === n.id ? { ...r, read: true } : r)));
    setUnread((u) => Math.max(0, u - 1));
    try { await axios.post(`${API}/notifications/${n.id}/read`); } catch { load(); }
  };
  const markAll = async () => {
    if (unread === 0) return;
    setBusy(true);
    try { await axios.post(`${API}/notifications/mark-all-read`); await load(); toast.success("All notifications marked as read"); }
    finally { setBusy(false); }
  };

  const onClickRow = async (n) => {
    await markOne(n);
    setOpen(false);
    // Type-first routing so specific notification kinds land on the right page:
    //  • price_change → Products › Price Alerts, scrolled to & highlighting the row
    //  • new_customer → Customers › customer profile page (not the list)
    if (n.type === "price_change") {
      onNavigate?.({ tab: "products", section: "price-alerts", filter: { itemId: n.item_id, notifId: n.id } });
      return;
    }
    if (n.type === "new_customer" && n.customer_id) {
      onNavigate?.({ tab: "customers", filter: { customerId: n.customer_id } });
      return;
    }
    // Generic deep-link chain: prefer order → product → customer → item detail
    if (n.order_id) onNavigate?.({ tab: "orders", section: "all", filter: { orderId: n.order_id } });
    else if (n.product_id) onNavigate?.({ tab: "products", section: "all", filter: { productId: n.product_id } });
    else if (n.customer_id) onNavigate?.({ tab: "customers", filter: { customerId: n.customer_id } });
    else if (n.item_id) onNavigate?.({ tab: "scraper", filter: { itemId: n.item_id } });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn btn-ghost !p-2 relative"
        data-testid="notif-bell"
        title="Notifications"
        aria-label={`Notifications, ${unread} unread`}
      >
        <Bell size={16}/>
        {unread > 0 && (
          <span
            data-testid="notif-badge"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold grid place-items-center leading-none border-2 border-white"
          >{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      {open && (
        <div
          data-testid="notif-dropdown"
          className="fixed left-2 right-2 top-14 w-auto sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:w-[400px] sm:max-w-[92vw] bg-white border hairline shadow-2xl rounded-xl overflow-hidden z-50"
        >
          <div className="p-3 flex items-center justify-between border-b hairline bg-slate-50">
            <div className="font-display font-bold text-sm flex items-center gap-2"><Bell size={14}/> Notifications</div>
            <button onClick={markAll} disabled={busy || unread === 0} className="text-[11px] font-mono text-indigo-600 hover:underline disabled:text-slate-300 disabled:no-underline" data-testid="notif-mark-all">
              Mark all read
            </button>
          </div>

          <div className="max-h-[440px] overflow-y-auto">
            {rows.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">
                <BellOff size={20} className="mx-auto mb-2 text-slate-300"/>
                No notifications yet.
              </div>
            )}
            {rows.map((n) => (
              <NotifRow key={n.id} n={n} onClick={() => onClickRow(n)}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const NOTIF_META = {
  price_change:         { icon: TrendingDown, color: "#4F46E5", bg: "#EEF2FF" },
  new_order:            { icon: ShoppingBag,  color: "#059669", bg: "#ECFDF5" },
  new_payment:          { icon: DollarSign,   color: "#059669", bg: "#ECFDF5" },
  out_of_stock:         { icon: XCircle,      color: "#DC2626", bg: "#FEE2E2" },
  restock:              { icon: BadgeCheck,   color: "#059669", bg: "#ECFDF5" },
  low_stock:            { icon: PackageMinus, color: "#D97706", bg: "#FEF3C7" },
  cancellation_request: { icon: Ban,          color: "#DC2626", bg: "#FEE2E2" },
  new_customer:         { icon: UserPlus,     color: "#7C3AED", bg: "#EDE9FE" },
};

export function NotifRow({ n, onClick }) {
  const meta = NOTIF_META[n.type] || NOTIF_META.price_change;
  const Icon = meta.icon;

  const body = (() => {
    if (n.type === "price_change") {
      const dropped = (n.new_price ?? 0) < (n.old_price ?? 0);
      const marginBetter = (n.delta_margin ?? 0) > 0;
      return (
        <>
          <div className="text-xs font-mono flex items-center gap-1.5 mt-0.5">
            <span className="text-slate-500 line-through">${(n.old_price ?? 0).toFixed(2)}</span>
            {dropped ? <TrendingDown size={11} className="text-emerald-600"/> : <TrendingUp size={11} className="text-amber-600"/>}
            <span className={dropped ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>${(n.new_price ?? 0).toFixed(2)}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Margin {(n.old_margin_pct ?? 0).toFixed(1)}% → <span className={marginBetter ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>{(n.new_margin_pct ?? 0).toFixed(1)}%</span>
            <span className={marginBetter ? "text-emerald-600 ml-2" : "text-red-600 ml-2"}>({(n.delta_margin ?? 0) > 0 ? "+" : ""}{(n.delta_margin ?? 0).toFixed(1)}pp)</span>
          </div>
        </>
      );
    }
    return <div className="text-xs text-slate-500 mt-0.5">{n.body || ""}</div>;
  })();

  const thumb = n.image ? (
    <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border hairline shrink-0">
      <img src={proxyImg(n.image)} alt="" className="w-full h-full object-cover"/>
    </div>
  ) : (
    <div className="w-11 h-11 rounded-lg grid place-items-center shrink-0" style={{ background: meta.bg }}>
      <Icon size={18} style={{ color: meta.color }}/>
    </div>
  );

  return (
    <button
      onClick={onClick}
      data-testid="notif-item"
      data-notif-type={n.type}
      className={`w-full text-left flex gap-3 p-3 border-b hairline last:border-0 transition-colors ${n.read ? "bg-white hover:bg-slate-50" : "bg-indigo-50/50 hover:bg-indigo-50"}`}
    >
      {thumb}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {!n.read && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0"/>}
          <div className="text-sm font-medium truncate">{n.title || n.product_title || "Notification"}</div>
        </div>
        {body}
        <div className="mt-1 text-[10px] text-slate-400 font-mono">{fmtDate(n.at)}</div>
      </div>
    </button>
  );
}

export function TopHeader({ tab, storeSection, supplierSection, customerSection, productSection, ordersSection, paymentsSection, onMenu, onNavigate }) {
  const titles = {
    dashboard: "Dashboard", store: "Store Management", products: "Products", categories: "Categories",
    suppliers: "Suppliers", customers: "Customers",
    scraper: "Product Sourcing", orders: "Orders", payments: "Payments", analytics: "Analytics", settings: "Settings",
  };
  const subTitle = tab === "store"
    ? STORE_NAV.find((s) => s.id === storeSection)?.label
    : tab === "suppliers"
    ? SUPPLIER_NAV.find((s) => s.id === supplierSection)?.label
    : tab === "customers"
    ? CUSTOMER_NAV.find((s) => s.id === customerSection)?.label
    : tab === "products"
    ? PRODUCT_NAV.find((s) => s.id === productSection)?.label
    : tab === "orders"
    ? ORDERS_NAV.find((s) => s.id === ordersSection)?.label
    : tab === "payments"
    ? PAYMENTS_NAV.find((s) => s.id === paymentsSection)?.label
    : null;

  return (
    <div className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b hairline">
      <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8 h-16 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onMenu} className="lg:hidden btn btn-ghost !p-2 shrink-0" data-testid="mobile-menu-btn"><Menu size={18}/></button>
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-display text-base sm:text-lg font-bold tracking-tight truncate">{titles[tab]}</h1>
            {subTitle && (
              <>
                <ChevronRight size={14} className="text-slate-300 shrink-0"/>
                <span className="text-sm text-slate-600 truncate">{subTitle}</span>
              </>
            )}
          </div>
          <span className="hidden sm:inline chip chip-neutral shrink-0">AU · AUD</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <GlobalSearch onNavigate={onNavigate}/>
          <NotificationBell onNavigate={onNavigate}/>
          <button className="btn btn-ghost !p-2 hidden sm:grid" title="Help"><HelpCircle size={16}/></button>
          <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-xs" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}>AK</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Suppliers -------------------------------- */
