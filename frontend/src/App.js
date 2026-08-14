import { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { Toaster, toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Package, Zap, ShoppingCart, Users, BarChart3, Settings2, Search,
  Loader2, Trash2, Star, RefreshCw, MapPin, Truck, User as UserIcon, Box, ExternalLink,
  X, ChevronLeft, ChevronRight, ClipboardPaste, Plus, TrendingUp, TrendingDown, DollarSign,
  ShoppingBag, Percent, Boxes, ArrowUpRight, Filter, Download, ImageIcon, Sparkles,
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const KEYS = { sb: "adm_sb", sa: "adm_sa", method: "adm_method" };
const loadKeys = () => ({
  scrapingbee_key: localStorage.getItem(KEYS.sb) || "",
  scraperapi_key:  localStorage.getItem(KEYS.sa) || "",
  method: localStorage.getItem(KEYS.method) || "auto",
});
const proxyImg = (u) => `${API}/image-proxy?url=${encodeURIComponent(u)}`;
const money = (n, cur = "AUD") => (n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n));
const moneyCents = (n) => (n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n));
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } };
const fmtDay = (iso) => { try { return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); } catch { return iso; } };

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [selectedItem, setSelectedItem] = useState(null);

  return (
    <div className="min-h-screen flex">
      <Toaster theme="light" position="bottom-right" />
      <Sidebar tab={tab} setTab={setTab} />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader tab={tab} />
        <main className="flex-1 min-w-0 p-6 lg:p-10">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {tab === "dashboard" && <Dashboard />}
              {tab === "products"  && <Products />}
              {tab === "scraper"   && <ScraperPage onView={setSelectedItem} />}
              {tab === "orders"    && <Orders />}
              {tab === "customers" && <Customers />}
              {tab === "analytics" && <Analytics />}
              {tab === "settings"  && <SettingsPage />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <AnimatePresence>
        {selectedItem && <ItemModal item={selectedItem} onClose={() => setSelectedItem(null)} />}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------------- Sidebar -------------------------------- */
function Sidebar({ tab, setTab }) {
  const nav = [
    { id: "dashboard", label: "Dashboard",  icon: LayoutDashboard },
    { id: "products",  label: "Products",   icon: Package },
    { id: "scraper",   label: "eBay AU Scraper", icon: Zap, badge: "AU" },
    { id: "orders",    label: "Orders",     icon: ShoppingCart },
    { id: "customers", label: "Customers",  icon: Users },
    { id: "analytics", label: "Analytics",  icon: BarChart3 },
    { id: "settings",  label: "Settings",   icon: Settings2 },
  ];
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r hairline bg-white/70 backdrop-blur-xl sticky top-0 h-screen">
      <div className="px-5 py-5 flex items-center gap-3">
        <div className="w-9 h-9 grid place-items-center rounded-xl text-white font-black font-display" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}>A</div>
        <div>
          <div className="font-display font-bold text-[15px] tracking-tight">Aussie Admin</div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--dim)]">v1.0 · AU</div>
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--dim)] px-2 pb-1.5">General</div>
        <nav className="flex flex-col gap-0.5">
          {nav.map((n) => {
            const Icon = n.icon; const active = tab === n.id;
            return (
              <button key={n.id} data-testid={`nav-${n.id}`} onClick={() => setTab(n.id)} className={`sidebar-link ${active ? "active" : ""}`}>
                <Icon size={16} className="sidebar-icon" />
                <span className="flex-1 text-left">{n.label}</span>
                {n.badge && <span className="chip chip-primary">{n.badge}</span>}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto p-4">
        <div className="card p-4 bg-gradient-to-br from-indigo-50 to-pink-50 border-indigo-100">
          <div className="flex items-center gap-2 text-indigo-700 font-display font-bold text-sm"><Sparkles size={14}/> Import from eBay</div>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">Paste any ebay.com.au URL to add a new product to your catalog.</p>
          <button onClick={() => setTab("scraper")} className="btn btn-primary w-full mt-3 text-xs py-2">Open scraper</button>
        </div>
      </div>
    </aside>
  );
}

function TopHeader({ tab }) {
  const titles = {
    dashboard: "Dashboard", products: "Products", scraper: "eBay AU Scraper",
    orders: "Orders", customers: "Customers", analytics: "Analytics", settings: "Settings",
  };
  return (
    <div className="sticky top-0 z-30 backdrop-blur-xl bg-white/75 border-b hairline">
      <div className="flex items-center justify-between px-6 lg:px-10 h-16">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg font-bold tracking-tight">{titles[tab]}</h1>
          <span className="hidden sm:inline chip chip-neutral">AU · AUD</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--dim)]"/>
            <input placeholder="Search anything…" className="input pl-9 pr-3 py-2 text-sm w-72" />
          </div>
          <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}>AK</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Dashboard -------------------------------- */
function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/analytics/overview`); setData(r.data); }
    catch { toast.error("Failed to load analytics"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    toast.loading("Seeding demo data…", { id: "seed" });
    try { await axios.post(`${API}/demo/seed`, null, { params: { reset: true }}); toast.success("Demo data reseeded", { id: "seed" }); await load(); }
    catch { toast.error("Seed failed", { id: "seed" }); }
  };

  if (loading || !data) return <div className="text-slate-500 flex items-center gap-2 py-24 justify-center"><Loader2 className="animate-spin" size={16}/> loading dashboard…</div>;

  const kpis = [
    { label: "Revenue (YTD)",  value: moneyCents(data.ytd.revenue), sub: `${data.ytd.orders} orders`, icon: DollarSign, tone: "primary" },
    { label: "Profit (YTD)",   value: moneyCents(data.ytd.profit),  sub: `${data.ytd.revenue ? ((data.ytd.profit / data.ytd.revenue) * 100).toFixed(1) : 0}% margin`, icon: TrendingUp, tone: "success" },
    { label: "Units sold",     value: (data.ytd.units || 0).toLocaleString("en-AU"), sub: "this year", icon: ShoppingBag, tone: "violet" },
    { label: "Avg order value",value: data.ytd.orders ? moneyCents(data.ytd.revenue / data.ytd.orders) : "—", sub: "YTD", icon: Percent, tone: "pink" },
  ];

  const kpi2 = [
    { label: "Revenue (Month)", value: moneyCents(data.mtd.revenue), sub: `${data.mtd.orders} orders`, delta: "+12.4%" },
    { label: "Revenue (7d)",    value: moneyCents(data.last7.revenue), sub: `${data.last7.orders} orders`, delta: "+4.1%" },
    { label: "Products",        value: data.totals.products, sub: `${data.totals.active_products} active`, delta: null },
    { label: "Low stock",       value: data.totals.low_stock, sub: "≤ 3 in stock", delta: null, danger: data.totals.low_stock > 0 },
  ];

  const catColors = ["#4F46E5", "#EC4899", "#0EA5E9", "#10B981", "#F59E0B"];
  const noOrders = (data.all_time?.orders || 0) === 0;

  return (
    <div className="grid gap-6">
      {noOrders && (
        <div className="card p-5 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="font-display font-bold">No sales data yet</div>
            <div className="text-sm text-slate-500">Seed some realistic demo orders so you can see the dashboard come alive.</div>
          </div>
          <button data-testid="seed-btn" onClick={seed} className="btn btn-primary"><Sparkles size={14}/> Seed demo data</button>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* Secondary row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi2.map((k) => (
          <div key={k.label} className="card p-4">
            <div className="text-xs text-slate-500 font-medium">{k.label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <div className={`font-display text-2xl font-bold ${k.danger ? "text-red-600" : ""}`}>{k.value}</div>
              {k.delta && <span className="chip chip-success">{k.delta}</span>}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Revenue chart + category donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="card p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-display font-bold text-lg">Revenue · Last 30 days</div>
              <div className="text-xs text-slate-500">Revenue vs profit</div>
            </div>
            <span className="chip chip-primary">AUD</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4F46E5" stopOpacity={0.35}/><stop offset="100%" stopColor="#4F46E5" stopOpacity={0.03}/></linearGradient>
                  <linearGradient id="prf" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.35}/><stop offset="100%" stopColor="#10B981" stopOpacity={0.02}/></linearGradient>
                </defs>
                <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
                <YAxis tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={44}/>
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
                  labelFormatter={(l) => fmtDay(l)}
                  formatter={(v, name) => [moneyCents(v), name === "revenue" ? "Revenue" : "Profit"]}/>
                <Area type="monotone" dataKey="revenue" stroke="#4F46E5" strokeWidth={2} fill="url(#rev)"/>
                <Area type="monotone" dataKey="profit"  stroke="#10B981" strokeWidth={2} fill="url(#prf)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-display font-bold text-lg">By category</div>
              <div className="text-xs text-slate-500">Revenue split</div>
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.by_category} dataKey="revenue" nameKey="category" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {data.by_category.map((_, i) => <Cell key={i} fill={catColors[i % catColors.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => moneyCents(v)} contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 space-y-2">
            {data.by_category.map((c, i) => (
              <div key={c.category} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: catColors[i % catColors.length] }}/>
                <span className="capitalize text-slate-700 flex-1">{c.category}</span>
                <span className="font-mono text-slate-500">{moneyCents(c.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top products + recent orders */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card overflow-hidden">
          <div className="p-5 border-b hairline flex items-center justify-between">
            <div>
              <div className="font-display font-bold text-lg">Top products</div>
              <div className="text-xs text-slate-500">By revenue</div>
            </div>
          </div>
          <div className="p-3">
            {data.top_products.length === 0
              ? <div className="text-sm text-slate-500 py-6 text-center">No sales yet.</div>
              : data.top_products.map((p, i) => (
                  <div key={p.product_id} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
                    <div className="w-8 h-8 grid place-items-center rounded-md font-display font-bold text-white" style={{ background: `linear-gradient(135deg, #4F46E5, #EC4899)`, opacity: 1 - i * 0.14 }}>{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-xs text-slate-500">{p.units} units</div>
                    </div>
                    <div className="font-mono text-sm font-bold text-indigo-600">{moneyCents(p.revenue)}</div>
                  </div>
                ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-5 border-b hairline flex items-center justify-between">
            <div>
              <div className="font-display font-bold text-lg">Recent orders</div>
              <div className="text-xs text-slate-500">Latest 8 orders</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>
                {data.recent_orders.length === 0
                  ? <tr><td colSpan={4} className="text-center text-slate-500 py-6">No orders yet</td></tr>
                  : data.recent_orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <div className="text-slate-800 font-medium truncate max-w-[260px]" title={o.product_title}>{o.product_title}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{fmtDate(o.created_at)}</div>
                      </td>
                      <td className="text-slate-700">{o.customer_name}</td>
                      <td className="font-mono font-bold text-indigo-600">{moneyCents(o.total)}</td>
                      <td><StatusChip status={o.status}/></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }) {
  const map = { paid: "chip-primary", shipped: "chip-primary", delivered: "chip-success", refunded: "chip-warning", cancelled: "chip-danger" };
  return <span className={`chip capitalize ${map[status] || "chip-neutral"}`}>{status}</span>;
}

function KpiCard({ label, value, sub, icon: Icon, tone }) {
  const toneMap = {
    primary: "from-indigo-500 to-indigo-600",
    success: "from-emerald-500 to-emerald-600",
    violet:  "from-violet-500 to-violet-600",
    pink:    "from-pink-500 to-pink-600",
  };
  return (
    <div className="card p-5 relative overflow-hidden">
      <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-20 blur-2xl bg-gradient-to-br ${toneMap[tone]}`}/>
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 rounded-xl grid place-items-center text-white bg-gradient-to-br ${toneMap[tone]}`}><Icon size={18}/></div>
        <ArrowUpRight className="text-slate-300" size={16}/>
      </div>
      <div className="mt-4 font-display text-3xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label} · <span className="text-slate-400">{sub}</span></div>
    </div>
  );
}

/* -------------------------------- Products -------------------------------- */
function Products() {
  const [list, setList] = useState([]); const [total, setTotal] = useState(0);
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [sort, setSort] = useState("created_at_desc");
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/products`, { params: { q: q || undefined, category: cat || undefined, sort } });
    setList(data.products); setTotal(data.total);
  }, [q, cat, sort]);
  useEffect(() => { load(); }, [load]);

  const del = async (p) => { if (!window.confirm(`Delete "${p.title}"?`)) return; await axios.delete(`${API}/products/${p.id}`); toast.success("Deleted"); load(); };

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-500 font-mono">{total} product{total===1?"":"s"}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={(e)=>setQ(e.target.value)} data-testid="product-search" placeholder="Search title / SKU" className="input pl-9 pr-3 py-2 text-sm w-56"/></div>
          <select value={cat} onChange={(e)=>setCat(e.target.value)} className="input px-3 py-2 text-sm" data-testid="product-cat">
            <option value="">All categories</option>
            {["electronics","home","tools","apparel","other"].map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sort} onChange={(e)=>setSort(e.target.value)} className="input px-3 py-2 text-sm">
            <option value="created_at_desc">Newest</option>
            <option value="price_desc">Price ↓</option>
            <option value="price_asc">Price ↑</option>
            <option value="stock_asc">Stock ↑</option>
            <option value="sold_desc">Best sellers</option>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Sold</th><th></th></tr></thead>
            <tbody>
              {list.length === 0
                ? <tr><td colSpan={7} className="text-center py-10 text-slate-500">No products yet. Head to the <b>eBay Scraper</b> and import your first one.</td></tr>
                : list.map((p) => (
                  <tr key={p.id} data-testid="product-row" className={p.is_sold || !p.active ? "opacity-50" : ""}>
                    <td>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border hairline shrink-0 ${p.is_sold ? "grayscale" : ""}`}>
                          {p.images?.[0] ? <img src={proxyImg(p.images[0])} alt="" className="w-full h-full object-cover"/> : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={16}/></div>}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate max-w-[320px] flex items-center gap-2">{p.title}{p.is_sold && <span className="chip chip-danger">SOLD</span>}</div>
                          <div className="text-[11px] text-slate-400 truncate">{p.is_sold ? "Sold — disabled" : (p.active ? "Active" : "Draft")}</div>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-slate-500">{p.sku || "—"}</td>
                    <td><span className="chip chip-neutral capitalize">{p.category}</span></td>
                    <td className="font-mono font-bold text-indigo-600">{moneyCents(p.price)}</td>
                    <td className={p.stock <= 3 ? "text-red-600 font-bold" : "text-slate-700"}>{p.stock}</td>
                    <td>{p.sold_count || 0}</td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setEditing(p)} className="btn btn-ghost text-xs !py-1 !px-2">Edit</button>
                        <button onClick={() => del(p)} className="btn btn-danger text-xs !py-1 !px-2"><Trash2 size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {editing && <ProductEditModal product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }}/>}
      </AnimatePresence>
    </div>
  );
}

function ProductEditModal({ product, onClose, onSaved }) {
  const [f, setF] = useState({ ...product });
  const save = async () => {
    try { await axios.patch(`${API}/products/${product.id}`, { title: f.title, price: Number(f.price), cost: Number(f.cost), stock: Number(f.stock), category: f.category, active: !!f.active, description: f.description, sku: f.sku }); toast.success("Saved"); onSaved(); }
    catch { toast.error("Save failed"); }
  };
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={onClose}>
      <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0, y:20}} onClick={(e)=>e.stopPropagation()} className="card max-w-2xl mx-auto my-10 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display font-bold text-xl">Edit product</div>
          <button onClick={onClose} className="btn btn-ghost !p-2"><X size={16}/></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Title" className="md:col-span-2"><input className="input w-full px-3 py-2" value={f.title||""} onChange={(e)=>setF({...f, title:e.target.value})}/></Field>
          <Field label="SKU"><input className="input w-full px-3 py-2 font-mono" value={f.sku||""} onChange={(e)=>setF({...f, sku:e.target.value})}/></Field>
          <Field label="Category">
            <select className="input w-full px-3 py-2" value={f.category} onChange={(e)=>setF({...f, category:e.target.value})}>
              {["electronics","home","tools","apparel","other"].map(c=><option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Price (AUD)"><input type="number" className="input w-full px-3 py-2 font-mono" value={f.price||0} onChange={(e)=>setF({...f, price:e.target.value})}/></Field>
          <Field label="Cost (AUD)"><input type="number" className="input w-full px-3 py-2 font-mono" value={f.cost||0} onChange={(e)=>setF({...f, cost:e.target.value})}/></Field>
          <Field label="Stock"><input type="number" className="input w-full px-3 py-2 font-mono" value={f.stock||0} onChange={(e)=>setF({...f, stock:e.target.value})}/></Field>
          <Field label="Active">
            <select className="input w-full px-3 py-2" value={f.active ? "1" : "0"} onChange={(e)=>setF({...f, active: e.target.value === "1"})}>
              <option value="1">Yes</option><option value="0">No</option>
            </select>
          </Field>
          <Field label="Description" className="md:col-span-2"><textarea className="input w-full px-3 py-2 h-32 leading-relaxed" value={f.description||""} onChange={(e)=>setF({...f, description:e.target.value})}/></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} className="btn btn-primary">Save</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, className, children }) {
  return (<label className={`grid gap-1 ${className||""}`}>
    <span className="text-[11px] font-mono uppercase tracking-widest text-slate-500">{label}</span>
    {children}
  </label>);
}

/* --------------------------------- Scraper -------------------------------- */
function ScraperPage({ onView }) {
  const [url, setUrl] = useState(""); const [method, setMethod] = useState(loadKeys().method);
  const [loading, setLoading] = useState(false); const [status, setStatus] = useState("");
  const [items, setItems] = useState([]); const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/items`, { params: { q: q || undefined, sort: "created_at_desc" }});
    setItems(data.items);
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!url.trim()) return toast.error("Paste an eBay Australia URL");
    if (!/ebay\.com\.au/i.test(url)) return toast.error("Only ebay.com.au URLs are supported");
    const keys = loadKeys(); setLoading(true);
    setStatus(method === "auto" ? "Trying stealth Chrome fingerprint (curl_cffi) …" : method === "manual" ? "Manual scrape (browser TLS impersonation) …" : `Requesting via ${method} …`);
    try {
      const { data } = await axios.post(`${API}/scrape`, { url: url.trim(), method, save: true, scrapingbee_key: keys.scrapingbee_key || undefined, scraperapi_key: keys.scraperapi_key || undefined }, { timeout: 120000 });
      toast.success(`Imported via ${data.method_used}`, { description: data.item?.title?.slice(0, 90) });
      setUrl(""); await load();
    } catch (e) { toast.error("Import failed", { description: e?.response?.data?.detail?.slice(0, 220) || e.message }); }
    finally { setLoading(false); setStatus(""); }
  };

  const paste = async () => { try { const t = await navigator.clipboard.readText(); if (t) setUrl(t.trim()); } catch { toast.error("Clipboard blocked"); } };

  const addToProducts = async (it) => {
    try { const { data } = await axios.post(`${API}/products/from-item/${it.id}`, null, { params: { markup_pct: 25 } });
      toast.success("Added to products", { description: `${data.title} · ${moneyCents(data.price)} · SKU ${data.sku}` });
      await load();
    } catch (e) { toast.error("Failed", { description: e?.response?.data?.detail || e.message }); }
  };

  const del = async (it) => { if (!window.confirm("Delete this scraped item?")) return; await axios.delete(`${API}/items/${it.id}`); toast.success("Deleted"); load(); };
  const refresh = async (it) => {
    const keys = loadKeys();
    toast.loading("Refreshing…", { id: it.id });
    try { await axios.post(`${API}/items/${it.id}/refresh`, { url: it.url, method: keys.method || "auto", scrapingbee_key: keys.scrapingbee_key || undefined, scraperapi_key: keys.scraperapi_key || undefined, save: true }, { timeout: 120000 });
      toast.success("Refreshed", { id: it.id }); load(); }
    catch (e) { toast.error("Failed", { id: it.id, description: e?.response?.data?.detail?.slice(0,150) || e.message }); }
  };

  const [refreshingAll, setRefreshingAll] = useState(false);
  const refreshAll = async () => {
    if (!window.confirm("Re-scrape ALL eBay AU items now? This may take a while.")) return;
    const keys = loadKeys();
    setRefreshingAll(true); toast.loading("Refreshing all items…", { id: "ra" });
    try {
      const { data } = await axios.post(`${API}/items/refresh-all`, { method: keys.method || "auto", scrapingbee_key: keys.scrapingbee_key || undefined, scraperapi_key: keys.scraperapi_key || undefined }, { timeout: 30 * 60 * 1000 });
      toast.success(`Done · ${data.refreshed}/${data.total} refreshed · ${data.sold_found} sold`, { id: "ra", description: data.failed ? `${data.failed} failed` : undefined });
      await load();
    } catch (e) { toast.error("Refresh failed", { id: "ra", description: e?.response?.data?.detail?.slice(0,200) || e.message }); }
    finally { setRefreshingAll(false); }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-display text-2xl font-bold tracking-tight">eBay AU Scraper</div>
          <div className="text-xs text-slate-500 font-mono">stealth scrape · nightly auto-refresh · sold detection</div>
        </div>
        <button data-testid="refresh-all-btn" onClick={refreshAll} disabled={refreshingAll} className="btn btn-primary">
          {refreshingAll ? <Loader2 className="animate-spin" size={14}/> : <RefreshCw size={14}/>}
          {refreshingAll ? "Refreshing all…" : "Refresh all now"}
        </button>
      </div>
      <section className={`card p-6 md:p-8 ${loading ? "scanning" : ""}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="chip chip-primary">ebay.com.au only</span>
          <span className="chip chip-success">Chrome TLS fingerprint</span>
        </div>
        <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Paste an eBay Australia item URL to import</h2>
        <p className="text-slate-500 text-sm mt-1">Manual server-side stealth scrape (curl_cffi Chrome impersonation) with ScrapingBee & ScraperAPI as fallback. Auto-refreshes every night.</p>

        <div className="mt-5 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <input data-testid="ebay-url-input" value={url} onChange={(e)=>setUrl(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&!loading&&submit()} placeholder="https://www.ebay.com.au/itm/1234567890…" className="input w-full pl-4 pr-24 py-3.5 text-base font-mono"/>
            <button type="button" onClick={paste} data-testid="paste-btn" className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost text-xs !py-1.5 !px-2.5"><ClipboardPaste size={12}/> Paste</button>
          </div>
          <button data-testid="import-item-button" onClick={submit} disabled={loading} className="btn btn-primary px-6 py-3.5 min-w-[160px]">
            {loading ? <Loader2 className="animate-spin" size={16}/> : <Zap size={16}/>} {loading ? "Importing…" : "Import item"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mr-1">Method:</span>
          {[
            {id:"auto", label:"Auto"}, {id:"manual", label:"Manual"}, {id:"scrapingbee", label:"ScrapingBee"}, {id:"scraperapi", label:"ScraperAPI"},
          ].map((m) => (
            <button key={m.id} data-testid={`method-${m.id}`} onClick={()=>{setMethod(m.id); localStorage.setItem(KEYS.method, m.id);}}
              className={`chip cursor-pointer ${method===m.id ? "chip-primary" : "chip-neutral hover:bg-slate-100"}`}>{m.label}</button>
          ))}
        </div>

        {status && <div className="mt-4 text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin"/>{status}</div>}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-display font-bold text-lg">Scraped items</div>
            <div className="text-xs text-slate-500">{items.length} imported · click to view details, then add to products</div>
          </div>
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search…" className="input pl-9 pr-3 py-2 text-sm w-56"/></div>
        </div>

        {items.length === 0 ? (
          <div className="card p-16 text-center border-dashed">
            <Boxes size={28} className="mx-auto text-slate-300"/>
            <div className="font-display font-bold mt-2">No items yet</div>
            <div className="text-sm text-slate-500 mt-1">Paste an eBay Australia URL above to import your first item.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => (
              <div key={it.id} className={`card overflow-hidden hover:shadow-lg transition-shadow relative ${it.is_sold ? "opacity-60 grayscale" : ""}`} data-testid="scraped-card">
                {it.is_sold && <div className="absolute top-2 left-2 chip chip-danger z-10">SOLD</div>}
                <div className="aspect-[4/3] bg-slate-50 relative cursor-pointer" onClick={()=>onView(it)}>
                  {it.images?.[0]
                    ? <img src={proxyImg(it.images[0])} alt="" className="w-full h-full object-contain p-2"/>
                    : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={22}/></div>}
                  {it.added_to_products && <span className="absolute top-2 left-2 chip chip-success">✓ In products</span>}
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-semibold line-clamp-2 min-h-[2.6em] cursor-pointer" onClick={()=>onView(it)}>{it.title || "Untitled"}</h3>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-lg font-bold text-indigo-600">{it.price_display || "—"}</span>
                    {it.condition && <span className="chip chip-neutral">{it.condition.split(" ").slice(0, 2).join(" ")}</span>}
                  </div>
                  <div className="mt-2 text-xs text-slate-500 truncate"><MapPin size={11} className="inline"/> {it.location || "—"}</div>
                  <div className="mt-3 flex items-center gap-1">
                    <button onClick={()=>addToProducts(it)} disabled={it.added_to_products} className="btn btn-primary text-xs !py-1.5 flex-1"><Plus size={12}/> {it.added_to_products ? "Added" : "Add to products"}</button>
                    <button onClick={()=>refresh(it)} className="btn btn-ghost !p-2" title="Refresh"><RefreshCw size={13}/></button>
                    <button onClick={()=>del(it)} className="btn btn-danger !p-2" title="Delete"><Trash2 size={13}/></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* --------------------------------- Orders --------------------------------- */
function Orders() {
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
function Customers() {
  const [orders, setOrders] = useState([]);
  useEffect(() => { axios.get(`${API}/orders`, { params: { limit: 1000 }}).then(r => setOrders(r.data.orders)); }, []);
  const byCustomer = {};
  orders.forEach(o => {
    if (!o.customer_name) return;
    if (!byCustomer[o.customer_name]) byCustomer[o.customer_name] = { name: o.customer_name, email: o.customer_email, orders: 0, revenue: 0 };
    byCustomer[o.customer_name].orders += 1; byCustomer[o.customer_name].revenue += o.total;
  });
  const rows = Object.values(byCustomer).sort((a,b) => b.revenue - a.revenue).slice(0, 200);
  return (
    <div className="grid gap-4">
      <div className="text-sm text-slate-500 font-mono">{rows.length} unique customers · derived from orders</div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Customer</th><th>Email</th><th>Orders</th><th>Lifetime value</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-slate-500">No customers yet</td></tr>}
          {rows.map((c, i) => (
            <tr key={i}>
              <td><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full grid place-items-center text-white font-bold text-xs" style={{background:"linear-gradient(135deg,#4F46E5,#EC4899)"}}>{c.name.split(" ").map(s=>s[0]).join("").slice(0,2)}</div><span className="font-medium">{c.name}</span></div></td>
              <td className="text-slate-500 text-xs font-mono">{c.email}</td>
              <td>{c.orders}</td>
              <td className="font-mono font-bold text-indigo-600">{moneyCents(c.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </div>
  );
}

/* ------------------------------- Analytics -------------------------------- */
function Analytics() {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/analytics/overview`).then(r => setData(r.data)); }, []);
  if (!data) return <div className="text-slate-500 py-24 text-center">loading…</div>;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBox label="Revenue (all-time)" value={moneyCents(data.all_time.revenue)}/>
        <StatBox label="Profit (all-time)"  value={moneyCents(data.all_time.profit)} tone="success"/>
        <StatBox label="Orders (all-time)"  value={data.all_time.orders.toLocaleString("en-AU")}/>
        <StatBox label="Avg margin"         value={data.all_time.revenue ? `${((data.all_time.profit/data.all_time.revenue)*100).toFixed(1)}%` : "—"}/>
      </div>
      <div className="card p-5">
        <div className="font-display font-bold text-lg mb-3">Daily orders — last 30 days</div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily}>
              <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
              <YAxis tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={30}/>
              <Tooltip labelFormatter={fmtDay} contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}/>
              <Bar dataKey="orders" fill="#4F46E5" radius={[4, 4, 0, 0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
function StatBox({ label, value, tone }) {
  return (<div className="card p-5"><div className="text-xs text-slate-500 font-medium">{label}</div><div className={`font-display text-3xl font-bold mt-1 ${tone==='success'?'text-emerald-600':''}`}>{value}</div></div>);
}

/* -------------------------------- Settings -------------------------------- */
function SettingsPage() {
  const [s, setS] = useState({ store_name:"", store_email:"", currency:"AUD", country:"Australia", tax_rate:10.0, accent_color:"indigo" });
  const [sb, setSb] = useState(""); const [sa, setSa] = useState(""); const [method, setMethod] = useState("auto");

  useEffect(() => { axios.get(`${API}/settings`).then(r => setS(r.data)); const k = loadKeys(); setSb(k.scrapingbee_key); setSa(k.scraperapi_key); setMethod(k.method); }, []);

  const saveStore = async () => { try { await axios.put(`${API}/settings`, s); toast.success("Store settings saved"); } catch { toast.error("Save failed"); } };
  const saveKeys = () => { localStorage.setItem(KEYS.sb, sb.trim()); localStorage.setItem(KEYS.sa, sa.trim()); localStorage.setItem(KEYS.method, method); toast.success("Scraper settings saved locally"); };

  return (
    <div className="grid gap-6 max-w-4xl">
      <div className="card p-6">
        <div className="font-display font-bold text-lg mb-1">Store settings</div>
        <div className="text-xs text-slate-500 mb-4">Global settings for your storefront and admin.</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Store name"><input className="input px-3 py-2 w-full" value={s.store_name||""} onChange={(e)=>setS({...s, store_name:e.target.value})}/></Field>
          <Field label="Store email"><input className="input px-3 py-2 w-full" value={s.store_email||""} onChange={(e)=>setS({...s, store_email:e.target.value})}/></Field>
          <Field label="Currency"><input className="input px-3 py-2 w-full font-mono" value={s.currency||"AUD"} onChange={(e)=>setS({...s, currency:e.target.value})}/></Field>
          <Field label="Country"><input className="input px-3 py-2 w-full" value={s.country||"Australia"} onChange={(e)=>setS({...s, country:e.target.value})}/></Field>
          <Field label="Tax rate (%)"><input type="number" className="input px-3 py-2 w-full font-mono" value={s.tax_rate||0} onChange={(e)=>setS({...s, tax_rate: Number(e.target.value)})}/></Field>
          <Field label="Accent theme">
            <select className="input px-3 py-2 w-full" value={s.accent_color||"indigo"} onChange={(e)=>setS({...s, accent_color:e.target.value})}>
              {["indigo","violet","pink","emerald","sky"].map(x=><option key={x}>{x}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex justify-end"><button onClick={saveStore} className="btn btn-primary">Save store settings</button></div>
      </div>

      <div className="card p-6">
        <div className="font-display font-bold text-lg mb-1">eBay scraper settings</div>
        <div className="text-xs text-slate-500 mb-4">API keys are stored in your browser only.</div>
        <div className="grid gap-3">
          <Field label="Default method">
            <div className="flex flex-wrap gap-2">
              {[{id:"auto",label:"Auto (manual → ScrapingBee → ScraperAPI)"}, {id:"manual",label:"Manual only"}, {id:"scrapingbee",label:"ScrapingBee only"}, {id:"scraperapi",label:"ScraperAPI only"}].map(m=>(
                <button key={m.id} onClick={()=>setMethod(m.id)} className={`chip cursor-pointer ${method===m.id?"chip-primary":"chip-neutral"}`}>{m.label}</button>
              ))}
            </div>
          </Field>
          <Field label="ScrapingBee API key"><input type="password" className="input px-3 py-2 w-full font-mono" placeholder="sb-…" value={sb} onChange={(e)=>setSb(e.target.value)}/></Field>
          <div className="text-xs text-slate-500 -mt-2">Free 1,000 credits at <a className="text-indigo-600 hover:underline" href="https://app.scrapingbee.com/account/api_key" target="_blank" rel="noreferrer">scrapingbee.com</a></div>
          <Field label="ScraperAPI API key"><input type="password" className="input px-3 py-2 w-full font-mono" placeholder="…" value={sa} onChange={(e)=>setSa(e.target.value)}/></Field>
          <div className="text-xs text-slate-500 -mt-2">Free 5,000 credits at <a className="text-indigo-600 hover:underline" href="https://www.scraperapi.com/" target="_blank" rel="noreferrer">scraperapi.com</a></div>
        </div>
        <div className="mt-4 flex justify-end"><button onClick={saveKeys} className="btn btn-primary">Save scraper settings</button></div>
      </div>
    </div>
  );
}

/* -------------------------------- Item modal ------------------------------ */
function ItemModal({ item, onClose }) {
  const [imgIdx, setImgIdx] = useState(0);
  const [it, setIt] = useState(item);
  const images = it.images || [];
  const specifics = it.specifics ? Object.entries(it.specifics) : [];
  useEffect(() => { setImgIdx(0); setIt(item); }, [item]);

  const ff = it.feature_flags || { show_postage:true, show_delivery:true, show_collection:true, show_returns:true, show_payments:true, show_seller:true, show_description:true, show_specifics:true, visible:true };
  const toggle = async (key) => {
    const next = { ...ff, [key]: !ff[key] };
    setIt({ ...it, feature_flags: next });
    try { await axios.patch(`${API}/items/${it.id}/features`, next); toast.success("Updated"); }
    catch { toast.error("Save failed"); }
  };
  const shipFields = [
    ["show_postage", "Postage", it.postage_display || (it.postage_fee != null ? `AU $${it.postage_fee.toFixed(2)}` : null) || it.shipping],
    ["show_delivery", "Delivery estimate", it.delivery_estimate],
    ["show_collection", "Collection / Pickup", it.collection],
    ["show_returns", "Returns", it.returns_policy],
    ["show_payments", "Payment methods", it.payment_methods],
  ].filter(([_, __, v]) => v);

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={onClose}>
      <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0, y:20}} onClick={(e)=>e.stopPropagation()} className="card max-w-6xl mx-auto my-6 md:my-10">
        <div className="sticky top-0 z-10 backdrop-blur-xl bg-white/85 border-b hairline flex items-center justify-between px-5 md:px-8 py-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="chip chip-neutral">{it.method_used || "manual"}</span>
            {it.is_sold && <span className="chip chip-danger">SOLD</span>}
            {it.item_id && <span className="text-xs font-mono text-slate-500 truncate">#{it.item_id}</span>}
          </div>
          <div className="flex items-center gap-2">
            <a href={it.url} target="_blank" rel="noreferrer" className="btn btn-ghost text-xs !py-1.5"><ExternalLink size={12}/> Open on eBay</a>
            <button onClick={onClose} className="btn btn-ghost !p-2"><X size={16}/></button>
          </div>
        </div>
        <div className="p-5 md:p-8 grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-8">
          <div>
            <div className={`aspect-square bg-slate-50 border hairline rounded-xl overflow-hidden relative ${it.is_sold?"grayscale":""}`}>
              {images[imgIdx] ? (
                <AnimatePresence mode="wait">
                  <motion.img key={imgIdx} src={proxyImg(images[imgIdx])} alt="" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.2}} className="w-full h-full object-contain p-4"/>
                </AnimatePresence>
              ) : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={28}/></div>}
              {images.length > 1 && (
                <>
                  <button onClick={()=>setImgIdx((i)=>(i-1+images.length)%images.length)} className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center bg-white/90 border hairline rounded-full hover:bg-white shadow"><ChevronLeft size={16}/></button>
                  <button onClick={()=>setImgIdx((i)=>(i+1)%images.length)} className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center bg-white/90 border hairline rounded-full hover:bg-white shadow"><ChevronRight size={16}/></button>
                  <span className="absolute bottom-2 right-2 text-[10px] font-mono px-2 py-1 bg-white/90 border hairline rounded-md">{imgIdx+1} / {images.length}</span>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="mt-3 grid grid-cols-6 gap-2">
                {images.slice(0, 12).map((u, i) => (
                  <button key={i} onClick={()=>setImgIdx(i)} className={`aspect-square bg-slate-50 border rounded-md overflow-hidden ${i===imgIdx?"border-indigo-500 ring-2 ring-indigo-100":"hairline"}`}>
                    <img src={proxyImg(u)} alt="" className="w-full h-full object-contain p-1"/>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight leading-tight">{it.title || "Untitled"}</h2>
            <div className="mt-3 flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-3xl font-black text-indigo-600">{it.price_display || "—"}</span>
              {it.condition && <span className="chip chip-neutral">{it.condition.split(" ").slice(0, 3).join(" ")}</span>}
              {it.availability && <span className="chip chip-neutral">{it.availability}</span>}
            </div>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ff.show_seller !== false && <InfoBox icon={<UserIcon size={14}/>} label="Seller" value={it.seller}/>}
              <InfoBox icon={<MapPin size={14}/>} label="Located in" value={it.location}/>
              <InfoBox icon={<Box size={14}/>} label="Item ID" value={it.item_id} mono/>
            </div>

            {/* Postage, returns and payments */}
            <div className="mt-6 card-flat p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-display font-bold text-sm">Postage, returns & payments</div>
                {it.delivery_estimate_updated_at && <span className="text-[10px] font-mono text-slate-400">updated {fmtDate(it.delivery_estimate_updated_at)}</span>}
              </div>
              {shipFields.length === 0 ? (
                <div className="text-xs text-slate-500">No postage/delivery data returned by eBay for this listing.</div>
              ) : (
                <div className="grid gap-2">
                  {shipFields.map(([key, label, value]) => (
                    <div key={key} className={`flex items-start gap-3 p-2 rounded-lg ${ff[key] ? "" : "opacity-40"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</div>
                        <div className="text-sm text-slate-800 break-words">{value}</div>
                      </div>
                      <label className="cursor-pointer flex items-center gap-1 text-[10px] font-mono uppercase text-slate-500">
                        <input type="checkbox" checked={!!ff[key]} onChange={()=>toggle(key)} data-testid={`ff-${key}`} className="accent-indigo-600 w-4 h-4"/>
                        Show
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {it.description && ff.show_description !== false && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Description (from seller)</div>
                  <label className="text-[10px] font-mono uppercase text-slate-500 flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={!!ff.show_description} onChange={()=>toggle("show_description")} className="accent-indigo-600 w-3.5 h-3.5"/>Show</label>
                </div>
                <div className="text-sm text-slate-700 leading-relaxed max-h-64 overflow-y-auto pr-2 border hairline rounded-xl p-4 bg-slate-50 whitespace-pre-wrap">{it.description}</div>
              </div>
            )}

            {specifics.length > 0 && ff.show_specifics !== false && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Item specifics</div>
                  <label className="text-[10px] font-mono uppercase text-slate-500 flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={!!ff.show_specifics} onChange={()=>toggle("show_specifics")} className="accent-indigo-600 w-3.5 h-3.5"/>Show</label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  {specifics.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-dashed hairline py-1.5">
                      <span className="text-xs text-slate-500">{k}</span>
                      <span className="text-xs text-slate-800 text-right font-mono truncate max-w-[60%]" title={v}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function InfoBox({ icon, label, value, mono }) {
  return (
    <div className="card-flat p-3 min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 flex items-center gap-1.5">{icon}{label}</div>
      <div className={`mt-1 text-sm text-slate-800 truncate ${mono?"font-mono":""}`} title={value||""}>{value || "—"}</div>
    </div>
  );
}
