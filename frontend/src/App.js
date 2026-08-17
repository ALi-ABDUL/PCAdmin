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
  Smartphone, Laptop, Tv, Headphones, Camera, Gamepad2, Watch, Utensils, Armchair, Lamp,
  Bed, SprayCan, Flower2, Wrench, Car, Hammer, Shield, Shirt, Footprints, Dumbbell, Tent,
  Bike, Blocks, Puzzle, Tags, Palette,
  Store, CreditCard, Receipt, Undo2, Mail, MessageSquare, Menu, Layout, FileText, Building2,
  Globe, Activity, Cable, Lock, ChevronDown, Bell, HelpCircle,
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

/* --------------------------- Store Management nav ------------------------- */
const STORE_NAV = [
  { id: "store-settings",      label: "Store Settings",       icon: Store,        group: "Configuration" },
  { id: "payment-gateway",     label: "Payment Gateway",      icon: CreditCard,   group: "Configuration" },
  { id: "shipping-methods",    label: "Shipping Methods",     icon: Truck,        group: "Configuration" },
  { id: "tax-rates",           label: "Tax Rates",            icon: Receipt,      group: "Configuration" },
  { id: "checkout-settings",   label: "Checkout Settings",    icon: ShoppingCart, group: "Configuration" },
  { id: "returns-refunds",     label: "Returns & Refunds",    icon: Undo2,        group: "Configuration" },
  { id: "email-notifications", label: "Email & Notifications",icon: Mail,         group: "Content" },
  { id: "popup-messages",      label: "Popup Messages",       icon: MessageSquare,group: "Content" },
  { id: "site-menus",          label: "Site Menus",           icon: Menu,         group: "Content" },
  { id: "pages",               label: "Pages",                icon: FileText,     group: "Content" },
  { id: "locations",           label: "Locations",            icon: Building2,    group: "Business" },
  { id: "seo-settings",        label: "SEO Settings",         icon: Globe,        group: "Marketing" },
  { id: "analytics-tracking",  label: "Analytics & Tracking", icon: Activity,     group: "Marketing" },
  { id: "integrations",        label: "Integrations",         icon: Cable,        group: "Advanced" },
  { id: "security",            label: "Security",             icon: Lock,         group: "Advanced" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [storeSection, setStoreSection] = useState("store-settings");
  const [selectedItem, setSelectedItem] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => { setMobileNavOpen(false); }, [tab]);

  // Poll for new sold events every 60s and fire toasts
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { data } = await axios.get(`${API}/sold-events`, { params: { unread_only: true, mark_seen: true, limit: 20 } });
        if (cancelled || !data.events?.length) return;
        data.events.forEach((e) => {
          toast.error(`SOLD · ${e.title?.slice(0, 60) || "Item"}`, {
            description: `Detected during auto-refresh · ${fmtDate(e.detected_at)}`,
            duration: 15000,
            action: e.url ? { label: "Open", onClick: () => window.open(e.url, "_blank") } : undefined,
          });
        });
      } catch { /* silent */ }
    };
    check();
    const iv = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const inStore = tab === "store";
  return (
    <div className="min-h-screen flex bg-[color:var(--bg)]">
      <Toaster theme="light" position="bottom-right" />

      {/* Mobile overlay backdrop */}
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNavOpen(false)} className="lg:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm"/>
        )}
      </AnimatePresence>

      {/* Primary sidebar */}
      <Sidebar tab={tab} setTab={setTab} mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} />

      {/* Secondary store sidebar */}
      <AnimatePresence>
        {inStore && (
          <motion.aside
            key="store-sidebar"
            initial={{ opacity: 0, x: -20, width: 0 }}
            animate={{ opacity: 1, x: 0, width: 280 }}
            exit={{ opacity: 0, x: -20, width: 0 }}
            transition={{ duration: 0.22 }}
            className="hidden xl:flex flex-col shrink-0 border-r hairline bg-white/85 backdrop-blur-xl sticky top-0 h-screen overflow-hidden"
          >
            <StoreSideNav active={storeSection} setActive={setStoreSection} />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader tab={tab} storeSection={storeSection} onMenu={() => setMobileNavOpen(true)}/>
        {/* On smaller screens, show Store nav as a horizontal scroller above content */}
        {inStore && <StoreMobileNav active={storeSection} setActive={setStoreSection} />}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 xl:p-10">
          <AnimatePresence mode="wait">
            <motion.div key={inStore ? `store-${storeSection}` : tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {tab === "dashboard" && <Dashboard />}
              {tab === "store"     && <StoreManagement section={storeSection} setSection={setStoreSection}/>}
              {tab === "products"  && <Products />}
              {tab === "categories" && <Categories />}
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

/* ------------------------- Category icon mapping ------------------------- */
const ICON_MAP = {
  smartphone: Smartphone, laptop: Laptop, tv: Tv, headphones: Headphones, camera: Camera,
  "gamepad-2": Gamepad2, watch: Watch, utensils: Utensils, armchair: Armchair, lamp: Lamp,
  bed: Bed, "spray-can": SprayCan, "flower-2": Flower2, drill: Wrench, wrench: Wrench,
  car: Car, hammer: Hammer, shield: Shield, shirt: Shirt, footprints: Footprints,
  dumbbell: Dumbbell, tent: Tent, bike: Bike, blocks: Blocks, puzzle: Puzzle,
  star: Star, package: Package,
};
const CatIcon = ({ name, size = 16, ...p }) => {
  const C = ICON_MAP[name] || Package;
  return <C size={size} {...p} />;
};

/* --------------------------------- Sidebar -------------------------------- */
function Sidebar({ tab, setTab, mobileOpen, setMobileOpen }) {
  const nav = [
    { id: "dashboard", label: "Dashboard",  icon: LayoutDashboard, group: "General" },
    { id: "store",     label: "Store Management", icon: Store, group: "General", hasSub: true },
    { id: "products",  label: "Products",   icon: Package,        group: "Catalog" },
    { id: "categories", label: "Categories", icon: Tags,          group: "Catalog" },
    { id: "scraper",   label: "eBay AU Scraper", icon: Zap, badge: "AU", group: "Catalog" },
    { id: "orders",    label: "Orders",     icon: ShoppingCart,   group: "Operations" },
    { id: "customers", label: "Customers",  icon: Users,          group: "Operations" },
    { id: "analytics", label: "Analytics",  icon: BarChart3,      group: "Insights" },
    { id: "settings",  label: "Settings",   icon: Settings2,      group: "System" },
  ];
  const grouped = nav.reduce((acc, n) => { (acc[n.group] = acc[n.group] || []).push(n); return acc; }, {});

  const content = (
    <>
      <div className="px-5 py-5 flex items-center gap-3">
        <div className="w-9 h-9 grid place-items-center rounded-xl text-white font-black font-display shrink-0" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}>A</div>
        <div className="min-w-0">
          <div className="font-display font-bold text-[15px] tracking-tight truncate">Aussie Admin</div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--dim)]">v1.1 · AU</div>
        </div>
        <button className="ml-auto lg:hidden btn btn-ghost !p-1.5" onClick={() => setMobileOpen && setMobileOpen(false)}><X size={16}/></button>
      </div>
      <div className="px-3 pb-4 overflow-y-auto flex-1">
        {Object.entries(grouped).map(([g, items]) => (
          <div key={g} className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--dim)] px-2 pb-1.5">{g}</div>
            <nav className="flex flex-col gap-0.5">
              {items.map((n) => {
                const Icon = n.icon; const active = tab === n.id;
                return (
                  <button key={n.id} data-testid={`nav-${n.id}`} onClick={() => setTab(n.id)} className={`sidebar-link ${active ? "active" : ""}`}>
                    <Icon size={16} className="sidebar-icon" />
                    <span className="flex-1 text-left">{n.label}</span>
                    {n.hasSub && <ChevronRight size={13} className={`transition-transform ${active ? "rotate-90 text-indigo-500" : "text-slate-300"}`}/>}
                    {n.badge && <span className="chip chip-primary">{n.badge}</span>}
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
      </div>
      <div className="p-4 border-t hairline">
        <div className="card p-4 bg-gradient-to-br from-indigo-50 to-pink-50 border-indigo-100">
          <div className="flex items-center gap-2 text-indigo-700 font-display font-bold text-sm"><Sparkles size={14}/> Import from eBay</div>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">Paste any ebay.com.au URL to add a new product.</p>
          <button onClick={() => setTab("scraper")} className="btn btn-primary w-full mt-3 text-xs py-2">Open scraper</button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r hairline bg-white/80 backdrop-blur-xl sticky top-0 h-screen">{content}</aside>
      <AnimatePresence>
        {mobileOpen && (
          <motion.aside
            key="mobile-sidebar"
            initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: "tween", duration: 0.22 }}
            className="lg:hidden fixed inset-y-0 left-0 z-50 w-72 bg-white border-r hairline flex flex-col shadow-2xl"
          >{content}</motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function StoreSideNav({ active, setActive }) {
  const grouped = STORE_NAV.reduce((acc, n) => { (acc[n.group] = acc[n.group] || []).push(n); return acc; }, {});
  return (
    <>
      <div className="px-5 py-5 border-b hairline">
        <div className="flex items-center gap-2 text-slate-500 text-[11px] font-mono uppercase tracking-widest"><Store size={12}/> Store Management</div>
        <div className="font-display font-bold text-[15px] tracking-tight mt-1">Configure your storefront</div>
      </div>
      <div className="px-3 py-4 overflow-y-auto flex-1">
        {Object.entries(grouped).map(([g, items]) => (
          <div key={g} className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--dim)] px-2 pb-1.5">{g}</div>
            <nav className="flex flex-col gap-0.5">
              {items.map((n) => {
                const Icon = n.icon; const on = active === n.id;
                return (
                  <button key={n.id} data-testid={`store-${n.id}`} onClick={() => setActive(n.id)} className={`sidebar-link ${on ? "active" : ""}`}>
                    <Icon size={15} className="sidebar-icon"/>
                    <span className="text-left flex-1">{n.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
      </div>
    </>
  );
}

function StoreMobileNav({ active, setActive }) {
  return (
    <div className="xl:hidden sticky top-16 z-20 bg-white/85 backdrop-blur-xl border-b hairline overflow-x-auto">
      <div className="flex items-center gap-1 px-4 py-2 min-w-max">
        {STORE_NAV.map((n) => {
          const Icon = n.icon; const on = active === n.id;
          return (
            <button key={n.id} data-testid={`store-m-${n.id}`} onClick={() => setActive(n.id)} className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${on ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "text-slate-500 hover:bg-slate-50"}`}>
              <Icon size={13}/> {n.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TopHeader({ tab, storeSection, onMenu }) {
  const titles = {
    dashboard: "Dashboard", store: "Store Management", products: "Products", categories: "Categories",
    scraper: "eBay AU Scraper", orders: "Orders", customers: "Customers", analytics: "Analytics", settings: "Settings",
  };
  const subTitle = tab === "store" ? STORE_NAV.find((s) => s.id === storeSection)?.label : null;

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
          <div className="hidden lg:flex relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--dim)]"/>
            <input placeholder="Search anything…" className="input pl-9 pr-3 py-2 text-sm w-64"/>
          </div>
          <button className="btn btn-ghost !p-2 relative" title="Notifications"><Bell size={16}/></button>
          <button className="btn btn-ghost !p-2 hidden sm:grid" title="Help"><HelpCircle size={16}/></button>
          <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-xs" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}>AK</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Store Management ---------------------------- */
function StoreManagement({ section, setSection }) {
  const meta = STORE_NAV.find((s) => s.id === section) || STORE_NAV[0];
  const Icon = meta.icon;

  const sections = {
    "store-settings":      { hint: "Store name, brand, contact details, business hours and legal info.", fields: ["Store name","Legal business name","ABN","Contact email","Support phone","Business hours"] },
    "payment-gateway":     { hint: "Enable/disable payment providers and configure their credentials.", fields: ["Stripe","PayPal","Apple Pay","Google Pay","Afterpay","Zip Pay","Bank transfer","Cash on delivery"] },
    "shipping-methods":    { hint: "Zones, carriers, rates and free-shipping thresholds.", fields: ["Australia Post — Parcel Post","Australia Post — Express","Sendle","Aramex","Local delivery","Click & collect","Free shipping threshold"] },
    "tax-rates":           { hint: "GST and location-based tax rules.", fields: ["Australia — GST 10%","New Zealand — GST 15%","Tax-exempt customer groups","B2B / ABN entries"] },
    "checkout-settings":   { hint: "Fine-tune the buyer journey at checkout.", fields: ["Guest checkout","Require phone","Address auto-complete","Order note field","Marketing opt-in","Terms & conditions box"] },
    "returns-refunds":     { hint: "Return window, restocking fees and refund policies.", fields: ["Return window (days)","Restocking fee","Return shipping paid by","Refund method","Auto-approve returns"] },
    "email-notifications": { hint: "Transactional emails sent to customers and staff.", fields: ["Order confirmation","Order shipped","Order delivered","Refund issued","Abandoned cart","New review request","Admin alerts"] },
    "popup-messages":      { hint: "On-site banners, promos and pop-ups.", fields: ["Announcement bar","Welcome popup","Exit-intent offer","Free-shipping banner","Cookie consent","Age gate"] },
    "site-menus":          { hint: "Header, footer and mobile navigation menus.", fields: ["Main navigation","Footer — Shop","Footer — Support","Footer — Legal","Mobile drawer","Utility bar"] },
    "pages":               { hint: "Static content pages (About, Contact, Policies…).", fields: ["Home","About us","Contact","Shipping policy","Returns policy","Privacy policy","Terms of service","FAQ"] },
    "locations":           { hint: "Physical stores, warehouses and pickup points.", fields: ["Bellara HQ, QLD","Sydney warehouse, NSW","Melbourne showroom, VIC","Pickup: 3rd party locker"] },
    "seo-settings":        { hint: "Global SEO defaults, sitemaps and social cards.", fields: ["Meta title template","Meta description default","Open Graph image","Twitter card","Sitemap URL","robots.txt"] },
    "analytics-tracking":  { hint: "Attach analytics and tracking pixels.", fields: ["Google Analytics 4","Google Tag Manager","Meta pixel","TikTok pixel","Hotjar","Server-side conversions"] },
    "integrations":        { hint: "Third-party apps and API connections.", fields: ["eBay Australia (source)","Xero","MYOB","Klaviyo","Mailchimp","Zapier","Slack","Discord"] },
    "security":            { hint: "Admin access controls, password rules and audit logs.", fields: ["Two-factor authentication","Session timeout","IP allowlist","Password strength","Failed-login lockout","Audit log retention"] },
  }[section] || { hint: "", fields: [] };

  return (
    <div className="grid gap-6">
      <div className="card p-5 md:p-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl grid place-items-center text-white shrink-0" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}><Icon size={20}/></div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">{meta.group}</div>
          <div className="font-display text-2xl font-bold tracking-tight">{meta.label}</div>
          <div className="text-sm text-slate-500 mt-1">{sections.hint}</div>
        </div>
        <button className="btn btn-primary text-sm hidden sm:inline-flex" data-testid="store-save-btn"><Plus size={14}/> Add new</button>
      </div>

      <div className="grid gap-3">
        {sections.fields.length === 0 ? (
          <div className="card p-10 text-center text-slate-500">Configuration for this section coming soon.</div>
        ) : sections.fields.map((f, i) => (
          <div key={f} className="card p-4 md:p-5 flex items-center justify-between gap-4 group hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-indigo-50 text-indigo-500"><Icon size={16}/></div>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{f}</div>
                <div className="text-[11px] text-slate-400 font-mono">Not configured</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="flex items-center gap-2 text-[11px] font-mono uppercase text-slate-500 cursor-pointer">
                <input type="checkbox" defaultChecked={i < 2} className="accent-indigo-600 w-3.5 h-3.5"/>Enabled
              </label>
              <button className="btn btn-ghost text-xs !py-1 !px-2">Configure</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-5 border-dashed border-2 text-center text-slate-500 text-sm">
        <div className="font-display font-bold text-slate-700 mb-1">This is a scaffold — ready for your links & fields</div>
        Send more sub-links or specific fields for <span className="font-mono text-indigo-600">{meta.label}</span> and I&apos;ll wire them up.
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
  const [cats, setCats] = useState([]);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/products`, { params: { q: q || undefined, category: cat || undefined, sort } });
    setList(data.products); setTotal(data.total);
  }, [q, cat, sort]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/categories`, { params: { active: true }}).then(r => setCats(r.data.categories)); }, []);

  const del = async (p) => { if (!window.confirm(`Delete "${p.title}"?`)) return; await axios.delete(`${API}/products/${p.id}`); toast.success("Deleted"); load(); };
  const catByslug = (slug) => cats.find(c => c.slug === slug);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-500 font-mono">{total} product{total===1?"":"s"}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={(e)=>setQ(e.target.value)} data-testid="product-search" placeholder="Search title / SKU" className="input pl-9 pr-3 py-2 text-sm w-56"/></div>
          <select value={cat} onChange={(e)=>setCat(e.target.value)} className="input px-3 py-2 text-sm" data-testid="product-cat">
            <option value="">All categories</option>
            {cats.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}
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
                : list.map((p) => {
                    const c = catByslug(p.category);
                    return (
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
                    <td>
                      {c ? (
                        <span className="chip inline-flex items-center gap-1.5" style={{ background: `${c.color}18`, color: c.color }}>
                          <CatIcon name={c.icon} size={11}/> {c.name}
                        </span>
                      ) : <span className="chip chip-neutral capitalize">{p.category || "—"}</span>}
                    </td>
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
                );})}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {editing && <ProductEditModal product={editing} categories={cats} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }}/>}
      </AnimatePresence>
    </div>
  );
}

function ProductEditModal({ product, categories = [], onClose, onSaved }) {
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
            <select className="input w-full px-3 py-2" value={f.category||"other"} onChange={(e)=>setF({...f, category:e.target.value})}>
              {categories.length === 0 && <option value="other">Other</option>}
              {categories.map(c=><option key={c.slug} value={c.slug}>{c.group} · {c.name}</option>)}
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

/* ------------------------------- Categories ------------------------------- */
function Categories() {
  const [cats, setCats] = useState([]);
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/categories`);
    setCats(data.categories); setGroups(data.groups);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = group ? cats.filter(c => c.group === group) : cats;
  const grouped = filtered.reduce((acc, c) => { (acc[c.group] = acc[c.group] || []).push(c); return acc; }, {});

  const del = async (c) => {
    if (!window.confirm(`Delete category "${c.name}"?`)) return;
    try { await axios.delete(`${API}/categories/${c.id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error("Delete failed", { description: e?.response?.data?.detail }); }
  };
  const toggleActive = async (c) => {
    try { await axios.patch(`${API}/categories/${c.id}`, { active: !c.active }); load(); }
    catch { toast.error("Update failed"); }
  };
  const reseed = async () => {
    if (!window.confirm("Reseed defaults? Existing categories will remain; only missing defaults are added.")) return;
    try { await axios.post(`${API}/categories/reseed`, null); toast.success("Reseeded"); load(); }
    catch (e) { toast.error("Reseed failed", { description: e?.response?.data?.detail }); }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-display text-2xl font-bold tracking-tight">Categories</div>
          <div className="text-xs text-slate-500 font-mono">{cats.length} categories across {groups.length} groups · used to tag products in your storefront</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={group} onChange={(e)=>setGroup(e.target.value)} className="input px-3 py-2 text-sm" data-testid="cat-group-filter">
            <option value="">All groups</option>
            {groups.map(g => <option key={g}>{g}</option>)}
          </select>
          <button onClick={reseed} className="btn btn-ghost text-sm"><Sparkles size={13}/> Reseed defaults</button>
          <button onClick={() => setCreating(true)} className="btn btn-primary text-sm" data-testid="add-category-btn"><Plus size={14}/> New category</button>
        </div>
      </div>

      {Object.keys(grouped).sort().map((g) => (
        <div key={g}>
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2">
            <span>{g}</span><span className="text-slate-300">·</span><span>{grouped[g].length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {grouped[g].map((c) => (
              <div key={c.id} className={`card p-4 group hover:shadow-lg transition-shadow ${!c.active ? "opacity-50" : ""}`} data-testid="category-card">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl grid place-items-center shrink-0" style={{ background: `${c.color}20`, color: c.color }}>
                    <CatIcon name={c.icon} size={18}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-semibold truncate">{c.name}</div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">/{c.slug}</div>
                  </div>
                  <span className="chip chip-neutral">{c.product_count}</span>
                </div>
                <div className="text-xs text-slate-500 mt-3 leading-relaxed line-clamp-2 min-h-[2.4em]">{c.description || "—"}</div>
                <div className="mt-3 pt-3 border-t hairline flex items-center gap-1">
                  <label className="flex items-center gap-1.5 text-[11px] font-mono uppercase text-slate-500 cursor-pointer mr-auto">
                    <input type="checkbox" checked={c.active} onChange={()=>toggleActive(c)} className="accent-indigo-600 w-3.5 h-3.5"/>Active
                  </label>
                  <button onClick={()=>setEditing(c)} className="btn btn-ghost text-xs !py-1 !px-2">Edit</button>
                  <button onClick={()=>del(c)} className="btn btn-danger text-xs !py-1 !px-2"><Trash2 size={12}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <AnimatePresence>
        {(creating || editing) && <CategoryEditModal cat={editing} groups={groups} onClose={()=>{ setCreating(false); setEditing(null); }} onSaved={()=>{ setCreating(false); setEditing(null); load(); }}/>}
      </AnimatePresence>
    </div>
  );
}

function CategoryEditModal({ cat, groups, onClose, onSaved }) {
  const isNew = !cat;
  const [f, setF] = useState(cat || { name: "", group: groups[0] || "General", icon: "package", color: "#4F46E5", description: "", active: true });
  const iconOptions = Object.keys(ICON_MAP);
  const colorPresets = ["#4F46E5","#EC4899","#0EA5E9","#10B981","#F59E0B","#8B5CF6","#EF4444","#0891B2","#14B8A6","#F97316","#65A30D","#DC2626","#6B7280"];

  const save = async () => {
    try {
      if (isNew) await axios.post(`${API}/categories`, { name: f.name, group: f.group, icon: f.icon, color: f.color, description: f.description, active: !!f.active });
      else await axios.patch(`${API}/categories/${cat.id}`, { name: f.name, group: f.group, icon: f.icon, color: f.color, description: f.description, active: !!f.active });
      toast.success(isNew ? "Category created" : "Saved"); onSaved();
    } catch (e) { toast.error("Failed", { description: e?.response?.data?.detail }); }
  };

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={onClose}>
      <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0, y:20}} onClick={(e)=>e.stopPropagation()} className="card max-w-lg mx-auto my-10 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="font-display font-bold text-xl">{isNew ? "New category" : "Edit category"}</div>
          <button onClick={onClose} className="btn btn-ghost !p-2"><X size={16}/></button>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-2xl grid place-items-center shrink-0" style={{ background: `${f.color}22`, color: f.color }}>
            <CatIcon name={f.icon} size={24}/>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-bold truncate">{f.name || "Category name"}</div>
            <div className="text-[11px] font-mono text-slate-400">preview</div>
          </div>
        </div>
        <div className="grid gap-3">
          <Field label="Name"><input className="input px-3 py-2 w-full" value={f.name} onChange={(e)=>setF({...f, name:e.target.value})} data-testid="cat-name"/></Field>
          <Field label="Group">
            <input list="cat-groups" className="input px-3 py-2 w-full" value={f.group} onChange={(e)=>setF({...f, group:e.target.value})}/>
            <datalist id="cat-groups">{groups.map(g => <option key={g} value={g}/>)}</datalist>
          </Field>
          <Field label="Description"><textarea className="input px-3 py-2 w-full h-20" value={f.description||""} onChange={(e)=>setF({...f, description:e.target.value})}/></Field>
          <Field label="Icon">
            <div className="grid grid-cols-8 gap-1.5">
              {iconOptions.map(n => (
                <button key={n} onClick={()=>setF({...f, icon:n})} className={`aspect-square rounded-lg grid place-items-center border ${f.icon===n?"border-indigo-500 bg-indigo-50 text-indigo-600":"hairline text-slate-500 hover:bg-slate-50"}`} title={n}>
                  <CatIcon name={n} size={14}/>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Colour">
            <div className="flex items-center gap-2 flex-wrap">
              {colorPresets.map(c => (
                <button key={c} onClick={()=>setF({...f, color:c})} className={`w-7 h-7 rounded-full border-2 ${f.color===c?"border-slate-900":"border-white shadow"}`} style={{ background: c }} title={c}/>
              ))}
              <input type="color" value={f.color} onChange={(e)=>setF({...f, color:e.target.value})} className="w-9 h-9 rounded cursor-pointer"/>
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} className="btn btn-primary" data-testid="cat-save">{isNew ? "Create" : "Save"}</button>
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
