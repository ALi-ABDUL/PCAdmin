import { useState, useEffect, useCallback, useRef } from "react";
import "@/App.css";
import axios from "axios";
import { Toaster, toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Package, Zap, ShoppingCart, Users, BarChart3, Settings2, Search, Eye, EyeOff,
  Loader2, Trash2, Star, RefreshCw, MapPin, Truck, User as UserIcon, Box, ExternalLink,
  X, ChevronLeft, ChevronRight, ClipboardPaste, Plus, TrendingUp, TrendingDown, DollarSign,
  ShoppingBag, Percent, Boxes, ArrowUpRight, Filter, Download, ImageIcon, Sparkles,
  Smartphone, Laptop, Tv, Headphones, Camera, Gamepad2, Watch, Utensils, Armchair, Lamp,
  Bed, SprayCan, Flower2, Wrench, Car, Hammer, Shield, Shirt, Footprints, Dumbbell, Tent,
  Bike, Blocks, Puzzle, Tags, Palette,
  Store, CreditCard, Receipt, Undo2, Mail, MessageSquare, Menu, Layout, FileText, Building2,
  Globe, Activity, Cable, Lock, ChevronDown, Bell, BellOff, HelpCircle,
  Factory, UserPlus, Upload, List, Award, ShieldCheck, PackageSearch, ClipboardList, LineChart as LineChartIcon, TrendingDown as TrendingDownIcon, History, BadgeCheck, Star as StarIcon,
  UserCheck, UserX, Users2, Heart, MessageCircle, Ticket, MapPinned, StickyNote, Ban, Layers,
  Image as ImageLucide, GitBranch, Calculator, Boxes as BoxesIcon, PackagePlus, PackageMinus, PackageX, Warehouse, ClipboardCheck, XCircle,
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

// Pricing rules — loaded from /api/pricing-rules; fallback = 20% + $20 floor.
const PRICING_FALLBACK = { marginPct: 20, minProfit: 20 };
const calcPricingWithRules = (ebayPrice, rules) => {
  const ebay = Number(ebayPrice) || 0;
  if (ebay <= 0) return { ebay: 0, sell: 0, profit: 0, matched: null };
  const sorted = (rules || []).filter((r) => r.active).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  let matched = null;
  for (const r of sorted) {
    const min = Number(r.min_price) || 0;
    const max = r.max_price == null ? Infinity : Number(r.max_price);
    if (ebay >= min && ebay < max) { matched = r; break; }
  }
  let sell;
  if (matched) {
    sell = matched.kind === "percent" ? ebay * (1 + Number(matched.value) / 100) : ebay + Number(matched.value);
  } else {
    sell = ebay * (1 + PRICING_FALLBACK.marginPct / 100) + PRICING_FALLBACK.minProfit;
  }
  sell = Math.round(sell * 100) / 100;
  return { ebay, sell, profit: Math.round((sell - ebay) * 100) / 100, matched };
};
// Back-compat name used elsewhere in the file — now defers to rules-aware calc when
// callers pass a rules[] as the 2nd arg.
const calcPricing = (ebay, rules) => {
  const r = calcPricingWithRules(ebay, rules);
  return { ebay: r.ebay, sell: r.sell, profit: r.profit };
};

// Tiny global cache so components sharing this file all share one fetch.
let _pricingRulesCache = null;
let _pricingRulesPromise = null;
const _pricingRulesListeners = new Set();
const _refreshPricingRules = async () => {
  _pricingRulesPromise = axios.get(`${API}/pricing-rules`).then((r) => {
    _pricingRulesCache = r.data.rules || [];
    _pricingRulesListeners.forEach((fn) => fn(_pricingRulesCache));
    return _pricingRulesCache;
  });
  return _pricingRulesPromise;
};
const usePricingRules = () => {
  const [rules, setRules] = useState(_pricingRulesCache || []);
  useEffect(() => {
    _pricingRulesListeners.add(setRules);
    if (_pricingRulesCache == null && !_pricingRulesPromise) _refreshPricingRules();
    else if (_pricingRulesCache) setRules(_pricingRulesCache);
    return () => _pricingRulesListeners.delete(setRules);
  }, []);
  return [rules, _refreshPricingRules];
};

const ORDERS_NAV = [
  { id: "all",       label: "All Orders",         icon: ClipboardList, group: "Orders" },
  { id: "returns",   label: "Returns & Refunds",  icon: Undo2,         group: "Orders" },
  { id: "abandoned", label: "Abandoned Carts",    icon: ShoppingCart,  group: "Orders" },
];

const PAYMENTS_NAV = [
  { id: "transactions", label: "All Transactions",       icon: Receipt,     group: "Payments" },
  { id: "refunds",      label: "Refunds & Chargebacks",  icon: Undo2,       group: "Payments" },
];

const ORDER_STATUS_TABS = [
  { id: "",              label: "All" },
  { id: "new",           label: "New" },
  { id: "pending",       label: "Pending" },
  { id: "processing",    label: "Processing" },
  { id: "ready_to_ship", label: "Ready to Ship" },
  { id: "shipped",       label: "Shipped" },
  { id: "delivered",     label: "Delivered" },
  { id: "cancelled",     label: "Cancelled" },
];

const TRANSACTION_STATUS_TABS = [
  { id: "",           label: "All" },
  { id: "successful", label: "Successful" },
  { id: "pending",    label: "Pending" },
  { id: "failed",     label: "Failed" },
];

const SUPPLIER_NAV = [
  { id: "all",          label: "All Suppliers",        icon: List,           group: "Directory" },
  { id: "top",          label: "Top Suppliers",        icon: Award,          group: "Directory" },
  { id: "products",     label: "Supplier Products",    icon: PackageSearch,  group: "Sourcing" },
  { id: "orders",       label: "Supplier Orders",      icon: ClipboardList,  group: "Sourcing" },
  { id: "activity",     label: "Supplier Activity",    icon: History,        group: "Insights" },
];

const CUSTOMER_NAV = [
  { id: "create",     label: "Create Customer",     icon: UserPlus,       group: "Manage" },
  { id: "import",     label: "Import Customers",    icon: Upload,         group: "Manage" },
  { id: "all",        label: "All Customers",       icon: List,           group: "Directory" },
  { id: "pending",    label: "Pending",             icon: History,        group: "Directory" },
  { id: "active",     label: "Active",              icon: UserCheck,      group: "Directory" },
  { id: "guest",      label: "Guest customers",     icon: UserIcon,       group: "Directory" },
  { id: "registered", label: "Registered customers",icon: Users,          group: "Directory" },
  { id: "messages",   label: "Customer messages",   icon: MessageCircle,  group: "Engagement" },
  { id: "top",        label: "Top customers",       icon: Award,          group: "Engagement" },
  { id: "groups",     label: "Customer groups",     icon: Users2,         group: "Engagement" },
  { id: "addresses",  label: "Addresses",           icon: MapPinned,      group: "Data" },
  { id: "orders",     label: "Orders",              icon: ShoppingCart,   group: "Data" },
  { id: "wishlist",   label: "Wishlist",            icon: Heart,          group: "Data" },
  { id: "reviews",    label: "Reviews",             icon: StarIcon,       group: "Data" },
  { id: "coupons",    label: "Coupons",             icon: Ticket,         group: "Marketing" },
  { id: "activity",   label: "Activity",            icon: History,        group: "Marketing" },
  { id: "notes",      label: "Notes",               icon: StickyNote,     group: "Marketing" },
  { id: "blocked",    label: "Blocked customers",   icon: Ban,            group: "Security" },
];

const PRODUCT_NAV = [
  { id: "all",            label: "All Products",       icon: Package,         group: "Catalog" },
  { id: "low-stock",      label: "Low Stock",          icon: PackageMinus,    group: "Inventory" },
  { id: "out-of-stock",   label: "Out of Stock",       icon: PackageX,        group: "Inventory" },
  { id: "price-alerts",   label: "Price Alerts",       icon: TrendingDownIcon, group: "Insights" },
];

/* --------------------------- Store Management nav ------------------------- */
const STORE_NAV = [
  { id: "store-settings",      label: "Store Settings",       icon: Store,        group: "Configuration" },
  { id: "pricing-rules",       label: "Pricing Rules",        icon: Percent,      group: "Configuration" },
  { id: "notifications-push",  label: "Push Notifications",   icon: Bell,         group: "Configuration" },
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
  const [supplierSection, setSupplierSection] = useState("all");
  const [customerSection, setCustomerSection] = useState("all");
  const [productSection, setProductSection] = useState("all");
  const [ordersSection, setOrdersSection] = useState("all");
  const [paymentsSection, setPaymentsSection] = useState("transactions");
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

  const navigateTo = useCallback(({ tab: t, section }) => {
    if (t === "orders") { setTab("orders"); if (section) setOrdersSection(section); }
    else if (t === "products") { setTab("products"); if (section) setProductSection(section); }
    else if (t === "customers") { setTab("customers"); if (section) setCustomerSection(section); }
    else if (t === "scraper") { setTab("scraper"); }
    else if (t) setTab(t);
  }, []);

  const inStore = tab === "store";
  const inSuppliers = tab === "suppliers";
  const inCustomers = tab === "customers";
  const inProducts  = tab === "products";
  const inOrders    = tab === "orders";
  const inPayments  = tab === "payments";
  const subKey = inStore ? `store-${storeSection}` : inSuppliers ? `sup-${supplierSection}` : inCustomers ? `cus-${customerSection}` : inProducts ? `prd-${productSection}` : inOrders ? `ord-${ordersSection}` : inPayments ? `pay-${paymentsSection}` : tab;
  return (
    <div className="min-h-screen flex bg-[color:var(--bg)]">
      <Toaster theme="light" position="bottom-right" />

      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNavOpen(false)} className="lg:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm"/>
        )}
      </AnimatePresence>

      <Sidebar tab={tab} setTab={setTab} mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} />

      <AnimatePresence>
        {inStore && (
          <motion.aside key="store-sidebar" initial={{ opacity: 0, x: -20, width: 0 }} animate={{ opacity: 1, x: 0, width: 280 }} exit={{ opacity: 0, x: -20, width: 0 }} transition={{ duration: 0.22 }} className="hidden xl:flex flex-col shrink-0 border-r hairline bg-white/85 backdrop-blur-xl sticky top-0 h-screen overflow-hidden">
            <SubSideNav title="Store Management" subtitle="Configure your storefront" icon={Store} nav={STORE_NAV} testPrefix="store" active={storeSection} setActive={setStoreSection}/>
          </motion.aside>
        )}
        {inSuppliers && (
          <motion.aside key="supplier-sidebar" initial={{ opacity: 0, x: -20, width: 0 }} animate={{ opacity: 1, x: 0, width: 280 }} exit={{ opacity: 0, x: -20, width: 0 }} transition={{ duration: 0.22 }} className="hidden xl:flex flex-col shrink-0 border-r hairline bg-white/85 backdrop-blur-xl sticky top-0 h-screen overflow-hidden">
            <SubSideNav title="Suppliers" subtitle="Manage your sourcing network" icon={Factory} nav={SUPPLIER_NAV} testPrefix="sup" active={supplierSection} setActive={setSupplierSection}/>
          </motion.aside>
        )}
        {inCustomers && (
          <motion.aside key="customer-sidebar" initial={{ opacity: 0, x: -20, width: 0 }} animate={{ opacity: 1, x: 0, width: 280 }} exit={{ opacity: 0, x: -20, width: 0 }} transition={{ duration: 0.22 }} className="hidden xl:flex flex-col shrink-0 border-r hairline bg-white/85 backdrop-blur-xl sticky top-0 h-screen overflow-hidden">
            <SubSideNav title="Customers" subtitle="Grow and support your buyers" icon={Users} nav={CUSTOMER_NAV} testPrefix="cus" active={customerSection} setActive={setCustomerSection}/>
          </motion.aside>
        )}
        {inProducts && (
          <motion.aside key="product-sidebar" initial={{ opacity: 0, x: -20, width: 0 }} animate={{ opacity: 1, x: 0, width: 280 }} exit={{ opacity: 0, x: -20, width: 0 }} transition={{ duration: 0.22 }} className="hidden xl:flex flex-col shrink-0 border-r hairline bg-white/85 backdrop-blur-xl sticky top-0 h-screen overflow-hidden">
            <SubSideNav title="Products" subtitle="Catalog, inventory & pricing" icon={Package} nav={PRODUCT_NAV} testPrefix="prd" active={productSection} setActive={setProductSection}/>
          </motion.aside>
        )}
        {inOrders && (
          <motion.aside key="orders-sidebar" initial={{ opacity: 0, x: -20, width: 0 }} animate={{ opacity: 1, x: 0, width: 280 }} exit={{ opacity: 0, x: -20, width: 0 }} transition={{ duration: 0.22 }} className="hidden xl:flex flex-col shrink-0 border-r hairline bg-white/85 backdrop-blur-xl sticky top-0 h-screen overflow-hidden">
            <SubSideNav title="Orders" subtitle="Fulfilment & returns" icon={ShoppingCart} nav={ORDERS_NAV} testPrefix="ord" active={ordersSection} setActive={setOrdersSection}/>
          </motion.aside>
        )}
        {inPayments && (
          <motion.aside key="payments-sidebar" initial={{ opacity: 0, x: -20, width: 0 }} animate={{ opacity: 1, x: 0, width: 280 }} exit={{ opacity: 0, x: -20, width: 0 }} transition={{ duration: 0.22 }} className="hidden xl:flex flex-col shrink-0 border-r hairline bg-white/85 backdrop-blur-xl sticky top-0 h-screen overflow-hidden">
            <SubSideNav title="Payments" subtitle="Transactions & refunds" icon={CreditCard} nav={PAYMENTS_NAV} testPrefix="pay" active={paymentsSection} setActive={setPaymentsSection}/>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader tab={tab} storeSection={storeSection} supplierSection={supplierSection} customerSection={customerSection} productSection={productSection} ordersSection={ordersSection} paymentsSection={paymentsSection} onMenu={() => setMobileNavOpen(true)} onNavigate={navigateTo}/>
        {inStore     && <SubMobileNav nav={STORE_NAV}    testPrefix="store-m" active={storeSection}    setActive={setStoreSection}/>}
        {inSuppliers && <SubMobileNav nav={SUPPLIER_NAV} testPrefix="sup-m"   active={supplierSection} setActive={setSupplierSection}/>}
        {inCustomers && <SubMobileNav nav={CUSTOMER_NAV} testPrefix="cus-m"   active={customerSection} setActive={setCustomerSection}/>}
        {inProducts  && <SubMobileNav nav={PRODUCT_NAV}  testPrefix="prd-m"   active={productSection}  setActive={setProductSection}/>}
        {inOrders    && <SubMobileNav nav={ORDERS_NAV}   testPrefix="ord-m"   active={ordersSection}   setActive={setOrdersSection}/>}
        {inPayments  && <SubMobileNav nav={PAYMENTS_NAV} testPrefix="pay-m"   active={paymentsSection} setActive={setPaymentsSection}/>}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 xl:p-10">
          <AnimatePresence mode="wait">
            <motion.div key={subKey} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {tab === "dashboard" && <Dashboard />}
              {tab === "store"     && <StoreManagement section={storeSection} setSection={setStoreSection}/>}
              {tab === "suppliers" && <Suppliers section={supplierSection} setSection={setSupplierSection}/>}
              {tab === "customers" && <CustomersModule section={customerSection} setSection={setCustomerSection}/>}
              {tab === "products"  && <ProductsModule section={productSection} setSection={setProductSection}/>}
              {tab === "orders"    && <OrdersModule section={ordersSection} setSection={setOrdersSection}/>}
              {tab === "payments"  && <PaymentsModule section={paymentsSection} setSection={setPaymentsSection}/>}
              {tab === "categories" && <Categories />}
              {tab === "scraper"   && <ScraperPage onView={setSelectedItem} />}
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
    { id: "products",  label: "Products",   icon: Package,        group: "Catalog", hasSub: true },
    { id: "categories", label: "Categories", icon: Tags,          group: "Catalog" },
    { id: "suppliers", label: "Suppliers",  icon: Factory,        group: "Catalog", hasSub: true },
    { id: "scraper",   label: "Product Sourcing", icon: Zap, badge: "AU", group: "Catalog" },
    { id: "orders",    label: "Orders",     icon: ShoppingCart,   group: "Operations", hasSub: true },
    { id: "payments",  label: "Payments",   icon: CreditCard,     group: "Operations", hasSub: true },
    { id: "customers", label: "Customers",  icon: Users,          group: "Operations", hasSub: true },
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
          <button onClick={() => setTab("scraper")} className="btn btn-primary w-full mt-3 text-xs py-2">Open sourcing</button>
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

function SubSideNav({ title, subtitle, icon: HeaderIcon, nav, testPrefix, active, setActive }) {
  const grouped = nav.reduce((acc, n) => { (acc[n.group] = acc[n.group] || []).push(n); return acc; }, {});
  return (
    <>
      <div className="px-5 py-5 border-b hairline">
        <div className="flex items-center gap-2 text-slate-500 text-[11px] font-mono uppercase tracking-widest"><HeaderIcon size={12}/> {title}</div>
        <div className="font-display font-bold text-[15px] tracking-tight mt-1">{subtitle}</div>
      </div>
      <div className="px-3 py-4 overflow-y-auto flex-1">
        {Object.entries(grouped).map(([g, items]) => (
          <div key={g} className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--dim)] px-2 pb-1.5">{g}</div>
            <nav className="flex flex-col gap-0.5">
              {items.map((n) => {
                const Icon = n.icon; const on = active === n.id;
                return (
                  <button key={n.id} data-testid={`${testPrefix}-${n.id}`} onClick={() => setActive(n.id)} className={`sidebar-link ${on ? "active" : ""}`}>
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

function SubMobileNav({ nav, testPrefix, active, setActive }) {
  return (
    <div className="xl:hidden sticky top-16 z-20 bg-white/85 backdrop-blur-xl border-b hairline overflow-x-auto">
      <div className="flex items-center gap-1 px-4 py-2 min-w-max">
        {nav.map((n) => {
          const Icon = n.icon; const on = active === n.id;
          return (
            <button key={n.id} data-testid={`${testPrefix}-${n.id}`} onClick={() => setActive(n.id)} className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${on ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "text-slate-500 hover:bg-slate-50"}`}>
              <Icon size={13}/> {n.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NotificationBell({ onNavigate }) {
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
    // Deep-link: prefer order → product → customer → item detail
    if (n.order_id) onNavigate?.({ tab: "orders", section: "all", filter: { orderId: n.order_id } });
    else if (n.product_id) onNavigate?.({ tab: "products", section: "all", filter: { productId: n.product_id } });
    else if (n.customer_id) onNavigate?.({ tab: "customers", section: "all", filter: { customerId: n.customer_id } });
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
          className="absolute right-0 top-11 w-[400px] max-w-[92vw] bg-white border hairline shadow-2xl rounded-xl overflow-hidden z-50"
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

const NOTIF_META = {
  price_change:  { icon: TrendingDown, color: "#4F46E5", bg: "#EEF2FF" },
  new_order:     { icon: ShoppingBag,  color: "#059669", bg: "#ECFDF5" },
  out_of_stock:  { icon: XCircle,      color: "#DC2626", bg: "#FEE2E2" },
  low_stock:     { icon: PackageMinus, color: "#D97706", bg: "#FEF3C7" },
  order_status:  { icon: RefreshCw,    color: "#2563EB", bg: "#DBEAFE" },
  new_customer:  { icon: UserPlus,     color: "#7C3AED", bg: "#EDE9FE" },
};

function NotifRow({ n, onClick }) {
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

function TopHeader({ tab, storeSection, supplierSection, customerSection, productSection, ordersSection, paymentsSection, onMenu, onNavigate }) {
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
          <div className="hidden lg:flex relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--dim)]"/>
            <input placeholder="Search anything…" className="input pl-9 pr-3 py-2 text-sm w-64"/>
          </div>
          <NotificationBell onNavigate={onNavigate}/>
          <button className="btn btn-ghost !p-2 hidden sm:grid" title="Help"><HelpCircle size={16}/></button>
          <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-xs" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}>AK</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Suppliers -------------------------------- */
function Suppliers({ section, setSection }) {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("revenue_desc");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/suppliers`, { params: { q: q || undefined, status: status || undefined, sort } });
    setList(data.suppliers);
    setTotal(data.total);
  }, [q, status, sort]);
  const loadSummary = useCallback(async () => {
    const { data } = await axios.get(`${API}/suppliers/summary`);
    setSummary(data);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); }, [loadSummary, list.length]);

  const meta = SUPPLIER_NAV.find((s) => s.id === section) || SUPPLIER_NAV[0];
  const Icon = meta.icon;
  const descriptions = {
    all:      "Every eBay AU seller you have imported items from, with live product, order and revenue stats.",
    top:      "Top 5 sellers ranked by revenue generated from their imported items.",
    products: "Products sourced through each eBay seller.",
    orders:   "Orders fulfilled from products sourced via each seller.",
    activity: "Recent seller activity, driven by scrape / refresh times.",
  };

  return (
    <div className="grid gap-6">
      <div className="card p-5 md:p-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl grid place-items-center text-white shrink-0" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}><Icon size={20}/></div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">{meta.group}</div>
          <div className="font-display text-2xl font-bold tracking-tight">{meta.label}</div>
          <div className="text-sm text-slate-500 mt-1">{descriptions[section]}</div>
        </div>
      </div>

      {section === "all"      && <AllSuppliers list={list} total={total} q={q} setQ={setQ} sort={sort} setSort={setSort} status={status} setStatus={setStatus}/>}
      {section === "top"      && <TopSuppliers list={summary?.top_suppliers || []} agg={summary?.aggregate}/>}
      {section === "products" && <SupplierProducts list={list}/>}
      {section === "orders"   && <SupplierOrders list={list}/>}
      {section === "activity" && <SupplierActivity list={list}/>}
    </div>
  );
}

function SupplierAvatar({ s, size = 40 }) {
  const initials = (s.name || "").replace(/\(.*\)/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return <div className="rounded-full grid place-items-center text-white font-bold shrink-0" style={{ width: size, height: size, background: "linear-gradient(135deg,#4F46E5,#EC4899)", fontSize: size * 0.36 }}>{initials || "S"}</div>;
}

function SellerStatusChip({ status }) {
  const active = status === "active";
  return <span className={`chip ${active ? "chip-success" : "chip-neutral"}`} data-testid="sup-status">{active ? <BadgeCheck size={11}/> : <Ban size={11}/>} {active ? "Active" : "Inactive"}</span>;
}

function AllSuppliers({ list, total, q, setQ, sort, setSort, status, setStatus }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-slate-500 font-mono">{total} seller{total===1?"":"s"}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={(e)=>setQ(e.target.value)} data-testid="sup-search" placeholder="Search seller or location" className="input pl-9 pr-3 py-2 text-sm w-64"/></div>
          <select value={status} onChange={(e)=>setStatus(e.target.value)} className="input px-3 py-2 text-sm" data-testid="sup-status-filter">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={sort} onChange={(e)=>setSort(e.target.value)} className="input px-3 py-2 text-sm" data-testid="sup-sort">
            <option value="revenue_desc">Revenue ↓</option>
            <option value="orders_desc">Total orders ↓</option>
            <option value="products_desc">Total products ↓</option>
            <option value="last_active_desc">Last active ↓</option>
            <option value="name_asc">Seller A→Z</option>
          </select>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <th>Seller Name</th>
              <th className="text-right">Total Products</th>
              <th className="text-right">Total Orders</th>
              <th className="text-right">Revenue Generated</th>
              <th>Last Active</th>
              <th>Status</th>
            </tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No eBay sellers yet — import a listing on the Product Sourcing page.</td></tr>}
              {list.map((s) => (
                <tr key={s.id} className={s.status === "inactive" ? "opacity-60" : ""} data-testid="sup-row">
                  <td>
                    <div className="flex items-center gap-3 min-w-0">
                      <SupplierAvatar s={s} size={36}/>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate max-w-[280px]">{s.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">{s.location}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-right font-mono">{s.total_products}</td>
                  <td className="text-right font-mono">{s.total_orders}</td>
                  <td className="text-right font-mono font-bold text-indigo-600">{moneyCents(s.revenue_generated)}</td>
                  <td className="text-xs text-slate-500 font-mono">{s.last_active ? fmtDate(s.last_active) : "—"}</td>
                  <td><SellerStatusChip status={s.status}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TopSuppliers({ list, agg }) {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatBox label="Total revenue"  value={moneyCents(agg?.total_revenue || 0)} tone="success"/>
        <StatBox label="Total orders"   value={agg?.total_orders ?? 0}/>
        <StatBox label="Total products" value={agg?.total_products ?? 0}/>
      </div>
      <div className="card overflow-hidden">
        <div className="p-4 border-b hairline font-display font-bold">Top 5 by revenue</div>
        <div className="p-3">
          {list.length === 0 && <div className="text-sm text-slate-500 py-6 text-center">No eBay sellers yet</div>}
          {list.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
              <div className="w-8 h-8 grid place-items-center rounded-md font-display font-bold text-white text-xs" style={{ background: `linear-gradient(135deg,#4F46E5,#EC4899)`, opacity: 1 - i*0.12 }}>{i + 1}</div>
              <SupplierAvatar s={s} size={32}/>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{s.name}</div>
                <div className="text-xs text-slate-500">{s.total_orders} orders · {s.total_products} products</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-bold text-indigo-600 text-sm">{moneyCents(s.revenue_generated)}</div>
                <div className="text-[11px] text-slate-400">{s.location}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SupplierProducts({ list }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Seller</th><th>Location</th><th className="text-right">Total products</th><th>Status</th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td><div className="flex items-center gap-2"><SupplierAvatar s={s} size={28}/><span className="text-sm truncate max-w-[260px]">{s.name}</span></div></td>
              <td className="text-xs text-slate-500">{s.location}</td>
              <td className="text-right font-mono">{s.total_products}</td>
              <td><SellerStatusChip status={s.status}/></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={4} className="text-center text-slate-500 py-10">No seller products yet</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

function SupplierOrders({ list }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Seller</th><th className="text-right">Total orders</th><th className="text-right">Revenue</th><th>Status</th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td><div className="flex items-center gap-2"><SupplierAvatar s={s} size={28}/><span className="text-sm truncate max-w-[280px]">{s.name}</span></div></td>
              <td className="text-right font-mono">{s.total_orders}</td>
              <td className="text-right font-mono font-bold text-indigo-600">{moneyCents(s.revenue_generated)}</td>
              <td><SellerStatusChip status={s.status}/></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={4} className="text-center text-slate-500 py-10">No orders sourced from sellers yet</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

function SupplierActivity({ list }) {
  const events = list
    .filter((s) => s.last_active)
    .map((s) => ({ at: s.last_active, supplier: s }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 40);
  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b hairline font-display font-bold flex items-center gap-2"><History size={16}/> Recent seller activity</div>
      <div className="divide-y">
        {events.length === 0 && <div className="p-10 text-center text-slate-500">No activity yet</div>}
        {events.map((e, i) => (
          <div key={i} className="p-4 flex items-center gap-3 hover:bg-slate-50">
            <SupplierAvatar s={e.supplier} size={32}/>
            <div className="flex-1 min-w-0">
              <div className="text-sm"><span className="font-medium truncate">{e.supplier.name}</span> <span className="text-slate-500"> · last item refreshed</span></div>
              <div className="text-[11px] text-slate-400 font-mono">{fmtDate(e.at)}</div>
            </div>
            <SellerStatusChip status={e.supplier.status}/>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- Customers -------------------------------- */
function CustomersModule({ section, setSection }) {
  const [list, setList] = useState([]); const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [q, setQ] = useState(""); const [sort, setSort] = useState("created_at_desc"); const [group, setGroup] = useState("");
  const [messages, setMessages] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [reviews, setReviews] = useState([]);

  const params = {};
  if (["pending","active","blocked"].includes(section)) params.status = section;
  if (section === "guest") params.type = "guest";
  if (section === "registered") params.type = "registered";
  if (group) params.group = group;
  if (q) params.q = q;
  params.sort = sort;

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/customers`, { params });
    setList(data.customers); setTotal(data.total);
  }, [JSON.stringify(params)]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/customers/summary`).then(r => setSummary(r.data)); }, [list.length]);
  useEffect(() => { if (section === "messages") axios.get(`${API}/messages`).then(r => setMessages(r.data.messages)); }, [section]);
  useEffect(() => { if (section === "coupons") axios.get(`${API}/coupons`).then(r => setCoupons(r.data.coupons)); }, [section]);
  useEffect(() => { if (section === "reviews") axios.get(`${API}/reviews`).then(r => setReviews(r.data.reviews)); }, [section]);

  const meta = CUSTOMER_NAV.find((s) => s.id === section) || CUSTOMER_NAV[0];
  const Icon = meta.icon;
  const hints = {
    create:"Add a customer profile manually.", import:"Bulk-import customers via JSON.",
    all:"Every customer in your database.", pending:"Awaiting verification.", active:"Verified & shopping.",
    guest:"One-off shoppers without an account.", registered:"Customers with an account.",
    messages:"Inbound contact-form messages.", top:"Highest lifetime value.", groups:"Segments like VIP, Wholesale, Trade.",
    addresses:"Customer shipping & billing addresses.", orders:"All orders across all customers.",
    wishlist:"Products customers have starred.", reviews:"Product reviews left by customers.",
    coupons:"Discount codes and campaigns.", activity:"Recent customer activity.", notes:"Internal notes on customers.",
    blocked:"Restricted or blocked customers.",
  };

  return (
    <div className="grid gap-6">
      <SubHero icon={Icon} group={meta.group} label={meta.label} hint={hints[section]}/>
      {section === "create"     && <CreateCustomer onCreated={() => { load(); setSection("all"); }}/>}
      {section === "import"     && <ImportCustomers onImported={() => { load(); setSection("all"); }}/>}
      {(["all","pending","active","guest","registered","blocked"].includes(section)) && <CustomerTable list={list} total={total} q={q} setQ={setQ} sort={sort} setSort={setSort} group={group} setGroup={setGroup} groups={summary?.by_group?.map(g=>g.group)||[]} onChanged={load}/>}
      {section === "top"        && <TopCustomers list={summary?.top || []}/>}
      {section === "groups"     && <CustomerGroups groups={summary?.by_group || []}/>}
      {section === "messages"   && <CustomerMessages messages={messages} reload={() => axios.get(`${API}/messages`).then(r => setMessages(r.data.messages))}/>}
      {section === "coupons"    && <CouponsView coupons={coupons} reload={() => axios.get(`${API}/coupons`).then(r => setCoupons(r.data.coupons))}/>}
      {section === "reviews"    && <ReviewsView reviews={reviews} reload={() => axios.get(`${API}/reviews`).then(r => setReviews(r.data.reviews))}/>}
      {section === "orders"     && <CustomerOrdersView/>}
      {section === "wishlist"   && <ScaffoldList label="Wishlist items" hint="Customers can save products they love to buy later." rows={["Empty for now — hook up when storefront ships."]}/>}
      {section === "addresses"  && <ScaffoldList label="Saved addresses" hint="Shipping & billing addresses per customer." rows={list.slice(0,5).map(c => `${c.name} · ${[c.city, c.state, c.country].filter(Boolean).join(", ") || "no address"}`)}/>}
      {section === "activity"   && <CustomerActivity list={list}/>}
      {section === "notes"      && <NotesView list={list} onChanged={load}/>}
    </div>
  );
}

function SubHero({ icon: Icon, group, label, hint, cta }) {
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

function CustomerAvatar({ c, size = 36 }) {
  const initials = (c.name || "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return <div className="rounded-full grid place-items-center text-white font-bold shrink-0" style={{ width: size, height: size, background: "linear-gradient(135deg,#4F46E5,#EC4899)", fontSize: size * 0.34 }}>{initials || "C"}</div>;
}

function CreateCustomer({ onCreated }) {
  const empty = { name:"", email:"", phone:"", country:"Australia", state:"", city:"", address:"", postcode:"", status:"active", type:"registered", group:"Retail", tags:[], notes:"" };
  const [f, setF] = useState(empty); const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      await axios.post(`${API}/customers`, { ...f, tags: typeof f.tags === "string" ? f.tags.split(",").map(t=>t.trim()).filter(Boolean) : f.tags });
      toast.success("Customer created"); setF(empty); onCreated();
    } catch (e) { toast.error("Failed", { description: e?.response?.data?.detail?.slice(0,200) }); }
    finally { setSaving(false); }
  };
  const tagsStr = Array.isArray(f.tags) ? f.tags.join(", ") : (f.tags || "");
  return (
    <div className="card p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Name *"><input className="input px-3 py-2 w-full" value={f.name} onChange={(e)=>setF({...f, name:e.target.value})} data-testid="cus-name"/></Field>
        <Field label="Email"><input type="email" className="input px-3 py-2 w-full" value={f.email} onChange={(e)=>setF({...f, email:e.target.value})}/></Field>
        <Field label="Phone"><input className="input px-3 py-2 w-full" value={f.phone} onChange={(e)=>setF({...f, phone:e.target.value})}/></Field>
        <Field label="Group"><select className="input px-3 py-2 w-full" value={f.group} onChange={(e)=>setF({...f, group:e.target.value})}>{["Retail","VIP","Wholesale","Trade"].map(g=><option key={g}>{g}</option>)}</select></Field>
        <Field label="Status"><select className="input px-3 py-2 w-full" value={f.status} onChange={(e)=>setF({...f, status:e.target.value})}>{["pending","active","blocked"].map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="Type"><select className="input px-3 py-2 w-full" value={f.type} onChange={(e)=>setF({...f, type:e.target.value})}>{["registered","guest"].map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="City"><input className="input px-3 py-2 w-full" value={f.city} onChange={(e)=>setF({...f, city:e.target.value})}/></Field>
        <Field label="State"><select className="input px-3 py-2 w-full" value={f.state} onChange={(e)=>setF({...f, state:e.target.value})}><option value="">—</option>{["NSW","VIC","QLD","WA","SA","TAS","ACT","NT"].map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="Postcode"><input className="input px-3 py-2 w-full font-mono" value={f.postcode} onChange={(e)=>setF({...f, postcode:e.target.value})}/></Field>
        <Field label="Address" className="md:col-span-2"><input className="input px-3 py-2 w-full" value={f.address} onChange={(e)=>setF({...f, address:e.target.value})}/></Field>
        <Field label="Tags (comma separated)" className="md:col-span-2"><input className="input px-3 py-2 w-full" value={tagsStr} onChange={(e)=>setF({...f, tags:e.target.value})}/></Field>
        <Field label="Notes" className="md:col-span-2"><textarea className="input px-3 py-2 w-full h-24" value={f.notes} onChange={(e)=>setF({...f, notes:e.target.value})}/></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><button onClick={()=>setF(empty)} className="btn btn-ghost">Reset</button><button disabled={saving} onClick={save} className="btn btn-primary" data-testid="cus-create-btn">{saving?<Loader2 className="animate-spin" size={14}/>:<Plus size={14}/>} Create customer</button></div>
    </div>
  );
}

function ImportCustomers({ onImported }) {
  const [text, setText] = useState(`[
  { "name": "Sample User", "email": "sample@example.com", "group": "Retail", "status": "active", "type": "registered" }
]`);
  const [busy, setBusy] = useState(false);
  const doImport = async () => {
    setBusy(true);
    try {
      const arr = JSON.parse(text);
      const { data } = await axios.post(`${API}/customers/import`, { customers: Array.isArray(arr) ? arr : [arr] });
      toast.success(`Imported ${data.imported}`); onImported();
    } catch (e) { toast.error("Import failed", { description: (e?.message||"").slice(0,200) }); }
    finally { setBusy(false); }
  };
  const rebuild = async () => { const { data } = await axios.post(`${API}/customers/rebuild-from-orders`); toast.success(`Rebuilt · created ${data.created}`); onImported(); };
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-slate-500">Paste a JSON array of customer objects. Only <span className="font-mono">name</span> is required.</div>
        <button onClick={rebuild} className="btn btn-ghost text-xs"><History size={12}/> Rebuild from orders</button>
      </div>
      <textarea value={text} onChange={(e)=>setText(e.target.value)} className="input px-3 py-2 w-full font-mono text-xs" style={{ height: 260 }}/>
      <div className="mt-4 flex justify-end"><button disabled={busy} onClick={doImport} className="btn btn-primary">{busy?<Loader2 className="animate-spin" size={14}/>:<Upload size={14}/>} Import customers</button></div>
    </div>
  );
}

function CustomerTable({ list, total, q, setQ, sort, setSort, group, setGroup, groups, onChanged }) {
  const setStatus = async (c, status) => { await axios.patch(`${API}/customers/${c.id}`, { status }); onChanged(); };
  const del = async (c) => { if (!window.confirm(`Delete ${c.name}?`)) return; await axios.delete(`${API}/customers/${c.id}`); toast.success("Deleted"); onChanged(); };
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-slate-500 font-mono">{total} customer{total===1?"":"s"}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search name / email" className="input pl-9 pr-3 py-2 text-sm w-64"/></div>
          <select value={group} onChange={(e)=>setGroup(e.target.value)} className="input px-3 py-2 text-sm"><option value="">All groups</option>{["Retail","VIP","Wholesale","Trade"].map(g=><option key={g}>{g}</option>)}</select>
          <select value={sort} onChange={(e)=>setSort(e.target.value)} className="input px-3 py-2 text-sm">
            <option value="created_at_desc">Newest</option><option value="name_asc">Name A→Z</option><option value="spend_desc">Spend ↓</option><option value="orders_desc">Orders ↓</option>
          </select>
        </div>
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Customer</th><th>Code</th><th>Group</th><th>Type</th><th>Status</th><th>Orders</th><th>Spend</th><th></th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-slate-500">No customers</td></tr>}
          {list.map(c => (
            <tr key={c.id} data-testid="cus-row">
              <td><div className="flex items-center gap-3"><CustomerAvatar c={c}/><div className="min-w-0"><div className="text-sm font-medium truncate max-w-[240px]">{c.name}</div><div className="text-[11px] text-slate-400 truncate">{c.email || "—"}</div></div></div></td>
              <td className="font-mono text-xs text-slate-500">{c.code}</td>
              <td><span className="chip chip-primary">{c.group}</span></td>
              <td><span className="chip chip-neutral capitalize">{c.type}</span></td>
              <td>
                <select value={c.status} onChange={(e)=>setStatus(c, e.target.value)} className="input px-2 py-1 text-xs">
                  {["pending","active","blocked"].map(s=><option key={s}>{s}</option>)}
                </select>
              </td>
              <td>{c.orders_count}</td>
              <td className="font-mono font-bold text-indigo-600">{moneyCents(c.total_spend)}</td>
              <td><button onClick={()=>del(c)} className="btn btn-danger !p-2"><Trash2 size={12}/></button></td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </div>
  );
}

function TopCustomers({ list }) {
  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b hairline font-display font-bold flex items-center gap-2"><Award size={16}/> Top 10 by lifetime value</div>
      <div className="p-3">
        {list.length === 0 && <div className="text-sm text-slate-500 py-6 text-center">No customers yet</div>}
        {list.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
            <div className="w-8 h-8 grid place-items-center rounded-md font-display font-bold text-white text-xs" style={{ background: `linear-gradient(135deg,#4F46E5,#EC4899)`, opacity: 1 - i*0.08 }}>{i + 1}</div>
            <CustomerAvatar c={c} size={32}/>
            <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{c.name}</div><div className="text-xs text-slate-500 truncate">{c.email || "—"} · {c.orders_count} orders</div></div>
            <div className="font-mono font-bold text-indigo-600">{moneyCents(c.total_spend)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerGroups({ groups }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {groups.length === 0 && <div className="col-span-full card p-10 text-center text-slate-500">No group data yet</div>}
      {groups.map(g => (
        <div key={g.group} className="card p-5">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">{g.group}</div>
          <div className="font-display text-3xl font-bold mt-1">{g.count}</div>
          <div className="text-sm text-slate-500 mt-1">members · {moneyCents(g.spend)} lifetime</div>
        </div>
      ))}
    </div>
  );
}

function CustomerMessages({ messages, reload }) {
  const [f, setF] = useState({ customer_name:"", customer_email:"", subject:"", body:"" });
  const send = async () => { if(!f.customer_name || !f.body) return toast.error("Name & message required"); await axios.post(`${API}/messages`, f); setF({ customer_name:"", customer_email:"", subject:"", body:"" }); toast.success("Message added"); reload(); };
  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <div className="font-display font-bold mb-3">Log a message</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input placeholder="Customer name" className="input px-3 py-2" value={f.customer_name} onChange={(e)=>setF({...f, customer_name:e.target.value})}/>
          <input placeholder="Email" className="input px-3 py-2" value={f.customer_email} onChange={(e)=>setF({...f, customer_email:e.target.value})}/>
          <input placeholder="Subject" className="input px-3 py-2" value={f.subject} onChange={(e)=>setF({...f, subject:e.target.value})}/>
        </div>
        <textarea placeholder="Message body" className="input px-3 py-2 mt-2 w-full h-24" value={f.body} onChange={(e)=>setF({...f, body:e.target.value})}/>
        <div className="mt-3 flex justify-end"><button onClick={send} className="btn btn-primary text-sm"><MessageCircle size={14}/> Add message</button></div>
      </div>
      <div className="card overflow-hidden">
        {messages.length === 0 && <div className="p-10 text-center text-slate-500">No messages yet</div>}
        {messages.map(m => (
          <div key={m.id} className="p-4 border-b hairline last:border-0"><div className="flex items-center justify-between"><div className="font-medium text-sm">{m.customer_name} <span className="text-slate-400 text-xs font-mono">· {m.customer_email}</span></div><span className={`chip chip-${m.status==='new'?'primary':'neutral'}`}>{m.status}</span></div><div className="text-sm font-medium mt-1">{m.subject}</div><div className="text-sm text-slate-600 mt-1">{m.body}</div><div className="text-[11px] text-slate-400 mt-1 font-mono">{fmtDate(m.created_at)}</div></div>
        ))}
      </div>
    </div>
  );
}

function CouponsView({ coupons, reload }) {
  const [f, setF] = useState({ code:"", type:"percent", value:10, min_spend:0, max_uses:100, description:"" });
  const create = async () => { if(!f.code.trim()) return toast.error("Code required"); await axios.post(`${API}/coupons`, f); toast.success("Coupon created"); setF({ code:"", type:"percent", value:10, min_spend:0, max_uses:100, description:"" }); reload(); };
  const del = async (c) => { await axios.delete(`${API}/coupons/${c.id}`); toast.success("Deleted"); reload(); };
  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <div className="font-display font-bold mb-3">Create coupon</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <input placeholder="CODE" className="input px-3 py-2 font-mono uppercase" value={f.code} onChange={(e)=>setF({...f, code:e.target.value.toUpperCase()})}/>
          <select className="input px-3 py-2" value={f.type} onChange={(e)=>setF({...f, type:e.target.value})}><option value="percent">%</option><option value="fixed">AU$</option></select>
          <input type="number" placeholder="Value" className="input px-3 py-2 font-mono" value={f.value} onChange={(e)=>setF({...f, value:Number(e.target.value)})}/>
          <input type="number" placeholder="Min spend" className="input px-3 py-2 font-mono" value={f.min_spend} onChange={(e)=>setF({...f, min_spend:Number(e.target.value)})}/>
          <input type="number" placeholder="Max uses" className="input px-3 py-2 font-mono" value={f.max_uses} onChange={(e)=>setF({...f, max_uses:Number(e.target.value)})}/>
        </div>
        <input placeholder="Description" className="input px-3 py-2 mt-2 w-full" value={f.description} onChange={(e)=>setF({...f, description:e.target.value})}/>
        <div className="mt-3 flex justify-end"><button onClick={create} className="btn btn-primary text-sm"><Ticket size={14}/> Create</button></div>
      </div>
      <div className="card overflow-hidden"><table className="tbl">
        <thead><tr><th>Code</th><th>Discount</th><th>Min spend</th><th>Uses</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {coupons.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No coupons yet</td></tr>}
          {coupons.map(c => (
            <tr key={c.id}><td className="font-mono font-bold">{c.code}</td><td>{c.type === "percent" ? `${c.value}%` : moneyCents(c.value)}</td><td>{moneyCents(c.min_spend)}</td><td>{c.used}/{c.max_uses}</td><td><span className={`chip ${c.active?"chip-success":"chip-neutral"}`}>{c.active?"active":"disabled"}</span></td><td><button onClick={()=>del(c)} className="btn btn-danger !p-2"><Trash2 size={12}/></button></td></tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function ReviewsView({ reviews, reload }) {
  const setStatus = async (r, status) => { await axios.patch(`${API}/reviews/${r.id}`, { status }); reload(); };
  const del = async (r) => { await axios.delete(`${API}/reviews/${r.id}`); reload(); };
  return (
    <div className="card overflow-hidden">
      {reviews.length === 0 && <div className="p-10 text-center text-slate-500">No reviews yet · Post one via POST /api/reviews</div>}
      {reviews.map(r => (
        <div key={r.id} className="p-4 border-b hairline last:border-0 flex items-start gap-4">
          <div className="flex items-center gap-0.5 text-amber-500">{[1,2,3,4,5].map(i => <StarIcon key={i} size={12} fill={i<=r.rating?"currentColor":"none"}/>)}</div>
          <div className="flex-1 min-w-0"><div className="text-sm font-medium">{r.title || "Untitled"}</div><div className="text-xs text-slate-500">{r.customer_name} · {fmtDate(r.created_at)}</div><div className="text-sm text-slate-700 mt-1">{r.body}</div></div>
          <select value={r.status} onChange={(e)=>setStatus(r, e.target.value)} className="input px-2 py-1 text-xs">{["pending","approved","rejected"].map(s=><option key={s}>{s}</option>)}</select>
          <button onClick={()=>del(r)} className="btn btn-danger !p-2"><Trash2 size={12}/></button>
        </div>
      ))}
    </div>
  );
}

function CustomerOrdersView() {
  const [orders, setOrders] = useState([]);
  useEffect(() => { axios.get(`${API}/orders`, { params: { limit: 200 }}).then(r => setOrders(r.data.orders)); }, []);
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
      <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id}><td className="text-sm truncate max-w-[280px]" title={o.product_title}>{o.product_title}</td><td>{o.customer_name}</td><td className="font-mono font-bold text-indigo-600">{moneyCents(o.total)}</td><td><StatusChip status={o.status}/></td><td className="text-xs text-slate-500 font-mono">{fmtDate(o.created_at)}</td></tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

function ScaffoldList({ label, hint, rows = [] }) {
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

function CustomerActivity({ list }) {
  const rows = [...list].sort((a,b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 40);
  return (
    <div className="card overflow-hidden">
      {rows.length === 0 && <div className="p-10 text-center text-slate-500">No activity</div>}
      {rows.map(c => (
        <div key={c.id} className="p-4 border-b hairline last:border-0 flex items-center gap-3">
          <CustomerAvatar c={c} size={32}/><div className="flex-1 min-w-0"><div className="text-sm"><span className="font-medium">{c.name}</span> <span className="text-slate-500">joined as {c.group}</span></div><div className="text-[11px] text-slate-400 font-mono">{fmtDate(c.created_at)}</div></div><span className="chip chip-neutral">{c.status}</span>
        </div>
      ))}
    </div>
  );
}

function NotesView({ list, onChanged }) {
  const [id, setId] = useState(list[0]?.id || "");
  const cust = list.find(c => c.id === id) || list[0];
  const [note, setNote] = useState(cust?.notes || "");
  useEffect(() => { setNote(cust?.notes || ""); }, [cust?.id]); // eslint-disable-line
  if (!cust) return <div className="card p-10 text-center text-slate-500">No customers</div>;
  const save = async () => { await axios.patch(`${API}/customers/${cust.id}`, { notes: note }); toast.success("Note saved"); onChanged(); };
  return (
    <div className="card p-5 grid gap-3">
      <select value={id} onChange={(e)=>setId(e.target.value)} className="input px-3 py-2 max-w-md">{list.map(c => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}</select>
      <textarea className="input px-3 py-2 w-full h-40" value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Internal notes about this customer…"/>
      <div className="flex justify-end"><button onClick={save} className="btn btn-primary text-sm">Save note</button></div>
    </div>
  );
}

/* -------------------------- Products (module wrapper) --------------------- */
function ProductsModule({ section, setSection }) {
  const [products, setProducts] = useState([]);
  const [priceAlertItems, setPriceAlertItems] = useState([]);

  useEffect(() => { axios.get(`${API}/products`).then(r => setProducts(r.data.products)); }, [section]);
  useEffect(() => {
    if (section === "price-alerts") {
      axios.get(`${API}/items`, { params: { limit: 300 }}).then(r => setPriceAlertItems(r.data.items));
    }
  }, [section]);

  const meta = PRODUCT_NAV.find((s) => s.id === section) || PRODUCT_NAV[0];
  const Icon = meta.icon;
  const hints = {
    all: "Every product in your store.",
    "low-stock": "Items with 1–3 units remaining. Restock soon.",
    "out-of-stock": "Items at 0 or below. Hidden from storefront.",
    "price-alerts": "Scraped eBay AU items whose seller changed the price. Adjust your retail price to stay competitive.",
  };
  const filtered = section === "low-stock" ? products.filter(p => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= 3)
    : section === "out-of-stock" ? products.filter(p => (p.stock ?? 0) <= 0)
    : products;

  return (
    <div className="grid gap-6">
      <SubHero icon={Icon} group={meta.group} label={meta.label} hint={hints[section]}/>
      {section === "all"           && <Products />}
      {section === "low-stock"     && <StockList list={filtered} tone="warning"/>}
      {section === "out-of-stock"  && <StockList list={filtered} tone="danger"/>}
      {section === "price-alerts"  && <PriceAlertsView items={priceAlertItems}/>}
    </div>
  );
}

function PriceAlertsView({ items }) {
  const alerts = items
    .map(it => {
      const h = (it.price_history || []).filter(p => p.value != null);
      if (h.length < 2) return null;
      const first = h[0].value, last = h[h.length - 1].value;
      const delta = last - first;
      if (Math.abs(delta) < 0.01) return null;
      const pct = first ? (delta / first) * 100 : 0;
      return { it, first, last, delta, pct, changes: h.length - 1 };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  const drops = alerts.filter(a => a.delta < 0).length;
  const rises = alerts.filter(a => a.delta > 0).length;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Alerts" value={alerts.length}/>
        <StatBox label="Price drops" value={drops} tone="success"/>
        <StatBox label="Price rises" value={rises}/>
        <StatBox label="Items tracked" value={items.length}/>
      </div>
      <div className="card overflow-hidden">
        {alerts.length === 0 && <div className="p-10 text-center text-slate-500">No price changes yet. Once the nightly refresh detects a change, alerts will appear here.</div>}
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>eBay AU item</th><th>Seller</th><th>First price</th><th>Latest</th><th>Change</th><th>Data points</th><th></th></tr></thead>
          <tbody>
            {alerts.slice(0, 100).map(({ it, first, last, delta, pct, changes }) => (
              <tr key={it.id} data-testid="price-alert-row">
                <td>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border hairline shrink-0">
                      {it.images?.[0] ? <img src={proxyImg(it.images[0])} alt="" className="w-full h-full object-contain p-1"/> : <div className="w-full h-full grid place-items-center text-slate-300"><ImageIcon size={14}/></div>}
                    </div>
                    <div className="min-w-0"><div className="text-sm font-medium truncate max-w-[280px]" title={it.title}>{it.title}</div><div className="text-[11px] text-slate-400 font-mono truncate">#{it.item_id}</div></div>
                  </div>
                </td>
                <td className="text-sm text-slate-600 truncate max-w-[160px]">{it.seller || "—"}</td>
                <td className="font-mono text-slate-500">AU ${first.toFixed(2)}</td>
                <td className="font-mono font-bold text-indigo-600">AU ${last.toFixed(2)}</td>
                <td className={`font-mono font-bold ${delta > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                  {delta > 0 ? "▲" : "▼"} AU ${Math.abs(delta).toFixed(2)} <span className="text-xs">({pct.toFixed(1)}%)</span>
                </td>
                <td className="text-xs text-slate-500">{changes} change{changes===1?"":"s"}</td>
                <td><a href={it.url} target="_blank" rel="noreferrer" className="btn btn-ghost text-xs !py-1 !px-2"><ExternalLink size={12}/> View</a></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

function ProductCreate({ onCreated }) {
  const [cats, setCats] = useState([]);
  const empty = { title:"", price:0, cost:0, stock:10, category:"other", description:"", images:[], sku:"", active:true };
  const [f, setF] = useState(empty); const [saving, setSaving] = useState(false);
  useEffect(() => { axios.get(`${API}/categories`, { params: { active: true }}).then(r => { setCats(r.data.categories); setF(x => ({...x, category: r.data.categories[0]?.slug || "other" })); }); }, []);
  const save = async () => {
    if (!f.title.trim()) return toast.error("Title required");
    setSaving(true);
    try { await axios.post(`${API}/products`, { ...f, price:Number(f.price), cost:Number(f.cost), stock:Number(f.stock) }); toast.success("Product created"); setF(empty); onCreated(); }
    catch (e) { toast.error("Failed", { description: e?.response?.data?.detail?.slice(0,200) }); }
    finally { setSaving(false); }
  };
  return (
    <div className="card p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Title *" className="md:col-span-2"><input className="input px-3 py-2 w-full" value={f.title} onChange={(e)=>setF({...f, title:e.target.value})}/></Field>
        <Field label="SKU"><input className="input px-3 py-2 w-full font-mono" value={f.sku} onChange={(e)=>setF({...f, sku:e.target.value})}/></Field>
        <Field label="Category"><select className="input px-3 py-2 w-full" value={f.category} onChange={(e)=>setF({...f, category:e.target.value})}>{cats.map(c=><option key={c.slug} value={c.slug}>{c.group} · {c.name}</option>)}</select></Field>
        <Field label="Price (AUD)"><input type="number" className="input px-3 py-2 w-full font-mono" value={f.price} onChange={(e)=>setF({...f, price:e.target.value})}/></Field>
        <Field label="Cost (AUD)"><input type="number" className="input px-3 py-2 w-full font-mono" value={f.cost} onChange={(e)=>setF({...f, cost:e.target.value})}/></Field>
        <Field label="Stock"><input type="number" className="input px-3 py-2 w-full font-mono" value={f.stock} onChange={(e)=>setF({...f, stock:e.target.value})}/></Field>
        <Field label="Active"><select className="input px-3 py-2 w-full" value={f.active?"1":"0"} onChange={(e)=>setF({...f, active:e.target.value==="1"})}><option value="1">Yes</option><option value="0">No</option></select></Field>
        <Field label="Description" className="md:col-span-2"><textarea className="input px-3 py-2 w-full h-24" value={f.description} onChange={(e)=>setF({...f, description:e.target.value})}/></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><button onClick={()=>setF(empty)} className="btn btn-ghost">Reset</button><button disabled={saving} onClick={save} className="btn btn-primary">{saving?<Loader2 className="animate-spin" size={14}/>:<Plus size={14}/>} Create product</button></div>
    </div>
  );
}

function ProductImagesView({ list }) {
  const withImages = list.filter(p => p.images?.length);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {withImages.length === 0 && <div className="col-span-full card p-10 text-center text-slate-500">No product images yet</div>}
      {withImages.map(p => (
        <div key={p.id} className="card overflow-hidden">
          <div className="aspect-square bg-slate-50"><img src={proxyImg(p.images[0])} alt="" className="w-full h-full object-cover"/></div>
          <div className="p-3"><div className="text-sm font-medium truncate">{p.title}</div><div className="text-[11px] text-slate-400">{p.images.length} image{p.images.length===1?"":"s"}</div></div>
        </div>
      ))}
    </div>
  );
}

function BrandsView({ list }) {
  const brands = Array.from(new Set(list.map(p => (p.specifics?.Brand || p.brand || "Unbranded")))).sort();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {brands.map(b => (
        <div key={b} className="card p-4"><div className="w-10 h-10 rounded-xl grid place-items-center bg-indigo-50 text-indigo-600"><BadgeCheck size={16}/></div><div className="mt-2 font-medium">{b}</div><div className="text-xs text-slate-500">{list.filter(p => (p.specifics?.Brand || p.brand || "Unbranded") === b).length} products</div></div>
      ))}
    </div>
  );
}

function PricingView({ list }) {
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
      <thead><tr><th>Product</th><th>Cost</th><th>Price</th><th>Margin</th></tr></thead>
      <tbody>{list.map(p => { const m = p.price ? ((p.price-(p.cost||0))/p.price)*100 : 0; return (
        <tr key={p.id}><td className="text-sm truncate max-w-[300px]">{p.title}</td><td className="font-mono">{moneyCents(p.cost)}</td><td className="font-mono font-bold text-indigo-600">{moneyCents(p.price)}</td><td className={`font-mono ${m>=40?"text-emerald-600":m>=20?"text-amber-600":"text-red-600"}`}>{m.toFixed(1)}%</td></tr>
      );})}</tbody>
    </table></div></div>
  );
}

function ProfitView({ list }) {
  const totals = list.reduce((a,p) => { const profit = (p.price - (p.cost||0)) * (p.sold_count||0); a.rev += (p.price||0)*(p.sold_count||0); a.profit += profit; a.units += p.sold_count||0; return a; }, { rev:0, profit:0, units:0 });
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Revenue" value={moneyCents(totals.rev)}/>
        <StatBox label="Profit" value={moneyCents(totals.profit)} tone="success"/>
        <StatBox label="Units sold" value={totals.units.toLocaleString()}/>
        <StatBox label="Avg margin" value={totals.rev ? `${((totals.profit/totals.rev)*100).toFixed(1)}%` : "—"}/>
      </div>
      <div className="card overflow-hidden"><table className="tbl">
        <thead><tr><th>Product</th><th>Sold</th><th>Revenue</th><th>Profit</th></tr></thead>
        <tbody>{[...list].sort((a,b)=>((b.price-(b.cost||0))*(b.sold_count||0))-((a.price-(a.cost||0))*(a.sold_count||0))).slice(0,20).map(p => { const rev=(p.price||0)*(p.sold_count||0); const prof=(p.price-(p.cost||0))*(p.sold_count||0); return (
          <tr key={p.id}><td className="text-sm truncate max-w-[300px]">{p.title}</td><td>{p.sold_count||0}</td><td className="font-mono font-bold text-indigo-600">{moneyCents(rev)}</td><td className="font-mono text-emerald-600">{moneyCents(prof)}</td></tr>
        );})}</tbody>
      </table></div>
    </div>
  );
}

function InventoryOverview({ inv, list }) {
  if (!inv) return <div className="text-slate-500">loading…</div>;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Products" value={inv.total_products}/>
        <StatBox label="Active" value={inv.active} tone="success"/>
        <StatBox label="Low stock" value={inv.low_stock}/>
        <StatBox label="Out of stock" value={inv.out_of_stock}/>
      </div>
      <StockList list={list}/>
    </div>
  );
}

function StockAdjustPage({ list, kind, title }) {
  const [pid, setPid] = useState(list[0]?.id || "");
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  useEffect(() => { if (!pid && list.length) setPid(list[0].id); }, [list, pid]);
  const p = list.find(x => x.id === pid);
  const apply = async () => {
    if (!pid) return; if (!delta) return toast.error("Enter a non-zero delta");
    let d = Number(delta);
    if (kind === "count") d = d - (p?.stock || 0); // set-to
    if (kind === "opening") d = d - (p?.stock || 0);
    await axios.post(`${API}/stock/moves`, { product_id: pid, delta: d, kind, reason });
    toast.success(`${title} applied`); setDelta(0); setReason("");
  };
  return (
    <div className="card p-6 grid gap-3 max-w-2xl">
      <Field label="Product"><select value={pid} onChange={(e)=>setPid(e.target.value)} className="input px-3 py-2 w-full">{list.map(x=><option key={x.id} value={x.id}>{x.title} · stock {x.stock??0}</option>)}</select></Field>
      <Field label={kind === "adjustment" ? "Delta (+/-)" : "New stock value"}><input type="number" value={delta} onChange={(e)=>setDelta(e.target.value)} className="input px-3 py-2 w-full font-mono"/></Field>
      <Field label="Reason / reference"><input value={reason} onChange={(e)=>setReason(e.target.value)} className="input px-3 py-2 w-full" placeholder="Damage / return / stock-take etc."/></Field>
      <div className="flex justify-end"><button onClick={apply} className="btn btn-primary"><Activity size={14}/> Apply</button></div>
      <div className="text-xs text-slate-500">Current stock: <b>{p?.stock ?? 0}</b> → target: <b>{kind === "adjustment" ? (Number(p?.stock||0)+Number(delta||0)) : Number(delta||0)}</b></div>
    </div>
  );
}

function StockList({ list, tone }) {
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
      <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Sold</th></tr></thead>
      <tbody>
        {list.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-slate-500">No products in this bucket</td></tr>}
        {list.map(p => (
          <tr key={p.id}><td className="text-sm truncate max-w-[320px]">{p.title}</td><td className="font-mono text-xs text-slate-500">{p.sku||"—"}</td><td className={`font-mono ${tone==="danger"?"text-red-600 font-bold":tone==="warning"?"text-amber-600 font-bold":"text-slate-800"}`}>{p.stock ?? 0}</td><td>{p.sold_count||0}</td></tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

function StockHistoryView({ moves }) {
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
      <thead><tr><th>When</th><th>Kind</th><th>Δ</th><th>Before</th><th>After</th><th>Reason</th></tr></thead>
      <tbody>
        {moves.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No stock moves yet</td></tr>}
        {moves.map(m => (
          <tr key={m.id}><td className="text-xs font-mono text-slate-500">{fmtDate(m.created_at)}</td><td><span className="chip chip-neutral capitalize">{m.kind}</span></td><td className={`font-mono font-bold ${m.delta>0?"text-emerald-600":"text-red-600"}`}>{m.delta>0?`+${m.delta}`:m.delta}</td><td className="font-mono">{m.stock_before}</td><td className="font-mono">{m.stock_after}</td><td className="text-xs text-slate-500 truncate max-w-[240px]">{m.reason||"—"}</td></tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

/* --------------------------------- Orders --------------------------------- */
function OrdersModule({ section, setSection }) {
  const meta = ORDERS_NAV.find((s) => s.id === section) || ORDERS_NAV[0];
  const Icon = meta.icon;
  const hints = {
    all: "Every order across every status. Filter with the tabs.",
    returns: "Customer return requests & refunds.",
    abandoned: "Carts your buyers created but didn't complete — recover them.",
  };
  return (
    <div className="grid gap-6">
      <SubHero icon={Icon} group={meta.group} label={meta.label} hint={hints[section]}/>
      {section === "all"       && <AllOrdersView/>}
      {section === "returns"   && <ReturnsView/>}
      {section === "abandoned" && <AbandonedCartsView/>}
    </div>
  );
}

const ORDER_STATUS_STYLE = {
  new:           "chip-primary",
  pending:       "chip-warning",
  processing:    "chip-primary",
  ready_to_ship: "chip-warning",
  shipped:       "chip-primary",
  delivered:     "chip-success",
  cancelled:     "chip-danger",
  paid:          "chip-primary",
  refunded:      "chip-warning",
};
const humaniseStatus = (s) => (s || "").replace(/_/g, " ");

function AllOrdersView() {
  const [status, setStatus] = useState("");
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/orders`, { params: { status: status || undefined, limit: 300 }});
    setOrders(data.orders); setTotal(data.total);
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/orders/status-counts`).then(r => setCounts(r.data.counts || {})); }, [orders.length]);

  const setOrderStatus = async (o, s) => {
    try { await axios.patch(`${API}/orders/${o.id}`, { status: s }); toast.success(`Marked ${humaniseStatus(s)}`); await load(); }
    catch { toast.error("Update failed"); }
  };

  return (
    <div className="grid gap-4">
      <div className="card p-2 flex items-center gap-1 overflow-x-auto">
        {ORDER_STATUS_TABS.map(t => {
          const on = status === t.id;
          const count = t.id ? (counts[t.id] || 0) : Object.values(counts).reduce((a,b)=>a+b,0);
          return (
            <button key={t.id || "all"} data-testid={`ord-tab-${t.id || "all"}`} onClick={() => setStatus(t.id)}
              className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${on ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "text-slate-600 hover:bg-slate-50"}`}>
              {t.label}
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${on ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-500"}`}>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="text-xs text-slate-500 font-mono">{total} order{total===1?"":"s"} shown</div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Order ID</th><th>Product</th><th>Customer</th><th>Qty</th><th>Total</th><th>Status</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-slate-500">No orders in this bucket</td></tr>}
              {orders.map(o => (
                <tr key={o.id} data-testid="ord-row">
                  <td className="font-mono text-xs text-slate-500">{o.id.slice(0,8)}</td>
                  <td className="text-sm truncate max-w-[280px]" title={o.product_title}>{o.product_title}</td>
                  <td>{o.customer_name}</td>
                  <td>{o.quantity}</td>
                  <td className="font-mono font-bold text-indigo-600">{moneyCents(o.total)}</td>
                  <td>
                    <select value={o.status} onChange={(e)=>setOrderStatus(o, e.target.value)} className="input px-2 py-1 text-xs">
                      {ORDER_STATUSES.map(s => <option key={s} value={s}>{humaniseStatus(s)}</option>)}
                    </select>
                  </td>
                  <td className="text-xs text-slate-500 font-mono">{fmtDate(o.created_at)}</td>
                  <td><button onClick={()=>setSelected(o)} className="btn btn-ghost text-xs !py-1 !px-2"><Eye size={12}/> View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <AnimatePresence>{selected && <OrderDetailsModal order={selected} onClose={()=>setSelected(null)} onStatus={setOrderStatus}/>}</AnimatePresence>
    </div>
  );
}

const ORDER_STATUSES = ["new", "pending", "processing", "ready_to_ship", "shipped", "delivered", "cancelled"];

function OrderDetailsModal({ order, onClose, onStatus }) {
  const addr = order.shipping_address;
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={onClose}>
      <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0, y:20}} onClick={(e)=>e.stopPropagation()} className="card max-w-2xl mx-auto my-10 p-6" data-testid="order-details-modal">
        <div className="flex items-center justify-between mb-4">
          <div><div className="text-[11px] font-mono text-slate-400">ORDER · #{order.id.slice(0,8)}</div><div className="font-display font-bold text-xl">{order.product_title}</div></div>
          <button onClick={onClose} className="btn btn-ghost !p-2"><X size={16}/></button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <StatBox label="Total" value={moneyCents(order.total)}/>
          <StatBox label="Profit" value={moneyCents(order.profit)} tone="success"/>
          <StatBox label="Qty" value={order.quantity}/>
          <StatBox label="Date" value={fmtDate(order.created_at).split(",")[0]}/>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <InfoBox icon={<UserIcon size={14}/>} label="Customer" value={order.customer_name}/>
          <InfoBox icon={<Mail size={14}/>} label="Email" value={order.customer_email} mono/>
          <InfoBox icon={<Receipt size={14}/>} label="Unit price" value={moneyCents(order.unit_price)}/>
          <InfoBox icon={<Percent size={14}/>} label="Unit cost" value={moneyCents(order.unit_cost)}/>
        </div>

        {/* Delivery address */}
        <div className="mt-5 card-flat p-4" data-testid="order-delivery-address">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg grid place-items-center bg-indigo-50 text-indigo-600"><MapPin size={14}/></div>
            <div className="font-display font-bold text-sm">Delivery address</div>
          </div>
          {addr ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Full name</div><div className="text-slate-800" data-testid="addr-name">{addr.full_name || order.customer_name || "—"}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Country</div><div className="text-slate-800" data-testid="addr-country">{addr.country || "—"}</div></div>
              <div className="col-span-2"><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Street address</div><div className="text-slate-800" data-testid="addr-street">{addr.street || "—"}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Suburb</div><div className="text-slate-800" data-testid="addr-suburb">{addr.suburb || "—"}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">State</div><div className="text-slate-800" data-testid="addr-state">{addr.state || "—"}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Postcode</div><div className="text-slate-800 font-mono" data-testid="addr-postcode">{addr.postcode || "—"}</div></div>
            </div>
          ) : (
            <div className="text-xs text-slate-500">No delivery address on this order.</div>
          )}
        </div>

        <div className="mt-4">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2">Update status</div>
          <div className="flex flex-wrap gap-2">
            {ORDER_STATUSES.map(s => (
              <button key={s} onClick={()=>onStatus(order, s)} className={`chip ${order.status === s ? ORDER_STATUS_STYLE[s] || "chip-primary" : "chip-neutral"} capitalize cursor-pointer`}>{humaniseStatus(s)}</button>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ReturnsView() {
  const [returns, setReturns] = useState([]);
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/returns`, { params: { status: status || undefined }});
    setReturns(data.returns);
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const setStatusFor = async (r, s) => { await axios.patch(`${API}/returns/${r.id}`, { status: s }); toast.success(`Marked ${s}`); load(); };
  const stats = returns.reduce((a,r) => { a.total++; a.amount += r.amount || 0; if (r.status === "refunded") a.refunded += r.amount || 0; return a; }, { total:0, amount:0, refunded:0 });

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Return requests" value={stats.total}/>
        <StatBox label="Refunded value" value={moneyCents(stats.refunded)} tone="success"/>
        <StatBox label="Pending" value={returns.filter(r=>r.status==='pending').length}/>
        <StatBox label="Rejected" value={returns.filter(r=>r.status==='rejected').length}/>
      </div>
      <div className="card p-2 flex items-center gap-1 overflow-x-auto">
        {["", "pending", "approved", "refunded", "rejected"].map(s => (
          <button key={s||"all"} onClick={()=>setStatus(s)} className={`shrink-0 px-3 py-2 rounded-lg text-sm font-medium capitalize ${status===s?"bg-indigo-50 text-indigo-600 border border-indigo-100":"text-slate-600 hover:bg-slate-50"}`}>{s || "All"}</button>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Product</th><th>Customer</th><th>Reason</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            {returns.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">No returns</td></tr>}
            {returns.map(r => (
              <tr key={r.id}>
                <td className="text-sm truncate max-w-[280px]">{r.product_title}</td>
                <td>{r.customer_name}</td>
                <td className="text-xs text-slate-500">{r.reason}</td>
                <td className="font-mono font-bold text-indigo-600">{moneyCents(r.amount)}</td>
                <td><select value={r.status} onChange={(e)=>setStatusFor(r, e.target.value)} className="input px-2 py-1 text-xs">{["pending","approved","refunded","rejected"].map(s=><option key={s}>{s}</option>)}</select></td>
                <td className="text-xs text-slate-500 font-mono">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

function AbandonedCartsView() {
  const [carts, setCarts] = useState([]); const [totalValue, setTotalValue] = useState(0);
  const [recovered, setRecovered] = useState("");
  const load = useCallback(async () => {
    const params = recovered === "" ? {} : { recovered: recovered === "yes" };
    const { data } = await axios.get(`${API}/abandoned-carts`, { params });
    setCarts(data.carts); setTotalValue(data.total_value);
  }, [recovered]);
  useEffect(() => { load(); }, [load]);
  const markRecovered = async (c) => { await axios.patch(`${API}/abandoned-carts/${c.id}`, { recovered: true }); toast.success("Marked recovered"); load(); };

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Abandoned carts" value={carts.length}/>
        <StatBox label="Recoverable value" value={moneyCents(totalValue)}/>
        <StatBox label="Recovered" value={carts.filter(c=>c.recovered).length} tone="success"/>
        <StatBox label="Recovery rate" value={carts.length ? `${((carts.filter(c=>c.recovered).length / carts.length)*100).toFixed(1)}%` : "—"}/>
      </div>
      <div className="card p-2 flex items-center gap-1 overflow-x-auto">
        {[["","All"],["no","Not recovered"],["yes","Recovered"]].map(([v,l]) => (
          <button key={v||"all"} onClick={()=>setRecovered(v)} className={`shrink-0 px-3 py-2 rounded-lg text-sm font-medium ${recovered===v?"bg-indigo-50 text-indigo-600 border border-indigo-100":"text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Customer</th><th>Email</th><th>Items</th><th>Subtotal</th><th>Step</th><th>Age</th><th></th></tr></thead>
          <tbody>
            {carts.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-500">No abandoned carts</td></tr>}
            {carts.map(c => {
              const hours = Math.round((Date.now() - new Date(c.created_at).getTime()) / 3600000);
              return (
                <tr key={c.id} className={c.recovered ? "opacity-50" : ""}>
                  <td>{c.customer_name}</td>
                  <td className="font-mono text-xs text-slate-500">{c.customer_email}</td>
                  <td>{c.items}</td>
                  <td className="font-mono font-bold text-indigo-600">{moneyCents(c.subtotal)}</td>
                  <td><span className="chip chip-neutral capitalize">{c.step}</span></td>
                  <td className="text-xs text-slate-500">{hours < 24 ? `${hours}h ago` : `${Math.floor(hours/24)}d ago`}</td>
                  <td>{c.recovered ? <span className="chip chip-success">recovered</span> : <button onClick={()=>markRecovered(c)} className="btn btn-ghost text-xs !py-1 !px-2">Mark recovered</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

/* -------------------------------- Payments -------------------------------- */
function PaymentsModule({ section, setSection }) {
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

function AllTransactionsView() {
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

function RefundsChargebacksView() {
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
function PricingRulesEditor() {
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null); // rule object or {} for new
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/pricing-rules`);
    setRules(data.rules);
    _pricingRulesCache = data.rules;
    _pricingRulesListeners.forEach((fn) => fn(data.rules));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    if (editing.max_price !== null && editing.max_price !== "" && Number(editing.max_price) <= Number(editing.min_price || 0)) {
      return toast.error("Max price must be greater than min (leave blank for no upper bound)");
    }
    const body = {
      label: editing.label || "",
      min_price: Number(editing.min_price) || 0,
      max_price: editing.max_price === "" || editing.max_price == null ? null : Number(editing.max_price),
      kind: editing.kind || "flat",
      value: Number(editing.value) || 0,
      active: editing.active !== false,
      sort_order: Number(editing.sort_order) || 0,
    };
    setBusy(true);
    try {
      if (editing.id) {
        await axios.patch(`${API}/pricing-rules/${editing.id}`, body);
        toast.success("Rule updated");
      } else {
        await axios.post(`${API}/pricing-rules`, body);
        toast.success("Rule created");
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail?.slice(0, 200) || e.message });
    } finally { setBusy(false); }
  };

  const del = async (r) => {
    if (!window.confirm(`Delete rule "${r.label || `$${r.min_price}+`}"?`)) return;
    await axios.delete(`${API}/pricing-rules/${r.id}`);
    toast.success("Deleted");
    await load();
  };

  const toggleActive = async (r) => {
    await axios.patch(`${API}/pricing-rules/${r.id}`, { active: !r.active });
    await load();
  };

  const rangeLabel = (r) => {
    const min = `$${Number(r.min_price).toFixed(0)}`;
    const max = r.max_price == null ? "+" : ` – $${Number(r.max_price).toFixed(0)}`;
    return `${min}${max}`;
  };
  const addLabel = (r) => (r.kind === "percent" ? `+${r.value}%` : `+$${Number(r.value).toFixed(2)}`);

  const emptyRule = { label: "", min_price: "", max_price: "", kind: "flat", value: "", active: true, sort_order: (rules.length + 1) * 10 };

  return (
    <div className="grid gap-4" data-testid="pricing-rules-editor">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-500">
          Rules are checked in ascending <span className="font-mono">sort order</span>; the first match wins. If nothing matches, fallback is <span className="font-mono">20% + $20</span>.
        </div>
        <button onClick={() => setEditing(emptyRule)} className="btn btn-primary text-sm" data-testid="pr-add-btn"><Plus size={14}/> Add tier</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <th className="w-16">Order</th>
              <th>Label</th>
              <th>Range</th>
              <th>Adds</th>
              <th className="text-right">Preview</th>
              <th>Status</th>
              <th></th>
            </tr></thead>
            <tbody>
              {rules.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-500">No pricing rules yet — add your first tier.</td></tr>}
              {rules.map((r) => {
                const sample = ((Number(r.min_price) || 0) + (r.max_price ? Number(r.max_price) : Number(r.min_price) + 50)) / 2;
                const c = calcPricingWithRules(sample, rules);
                return (
                  <tr key={r.id} data-testid="pr-row" className={r.active ? "" : "opacity-50"}>
                    <td className="font-mono text-slate-500">{r.sort_order}</td>
                    <td className="text-sm font-medium">{r.label || "—"}</td>
                    <td className="font-mono text-sm">{rangeLabel(r)}</td>
                    <td><span className={`chip ${r.kind === "percent" ? "chip-primary" : "chip-success"} font-mono`}>{addLabel(r)}</span></td>
                    <td className="text-right text-[11px] font-mono text-slate-500">
                      ${sample.toFixed(2)} → <span className="text-indigo-600 font-bold">${c.sell.toFixed(2)}</span> <span className="text-emerald-600">(+${c.profit.toFixed(2)})</span>
                    </td>
                    <td>
                      <label className="flex items-center gap-1.5 text-[11px] font-mono uppercase text-slate-500 cursor-pointer">
                        <input type="checkbox" checked={r.active} onChange={() => toggleActive(r)} className="accent-indigo-600 w-3.5 h-3.5"/>
                        {r.active ? "Active" : "Off"}
                      </label>
                    </td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setEditing(r)} className="btn btn-ghost text-xs !py-1 !px-2" data-testid="pr-edit-btn">Edit</button>
                        <button onClick={() => del(r)} className="btn btn-danger text-xs !py-1 !px-2" data-testid="pr-del-btn"><Trash2 size={12}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="card max-w-lg mx-auto my-10 p-6" data-testid="pr-modal">
            <div className="flex items-center justify-between mb-5">
              <div className="font-display font-bold text-xl">{editing.id ? "Edit tier" : "New tier"}</div>
              <button onClick={() => setEditing(null)} className="btn btn-ghost !p-2"><X size={16}/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Label (optional)" className="col-span-2">
                <input className="input px-3 py-2 w-full" value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="e.g. Mid tier" data-testid="pr-label"/>
              </Field>
              <Field label="Min price (AUD)">
                <input type="number" min="0" step="0.01" className="input px-3 py-2 w-full font-mono" value={editing.min_price} onChange={(e) => setEditing({ ...editing, min_price: e.target.value })} data-testid="pr-min"/>
              </Field>
              <Field label="Max price (blank = ∞)">
                <input type="number" min="0" step="0.01" className="input px-3 py-2 w-full font-mono" value={editing.max_price ?? ""} onChange={(e) => setEditing({ ...editing, max_price: e.target.value })} data-testid="pr-max"/>
              </Field>
              <Field label="Adds">
                <select className="input px-3 py-2 w-full" value={editing.kind || "flat"} onChange={(e) => setEditing({ ...editing, kind: e.target.value })} data-testid="pr-kind">
                  <option value="flat">Flat $ profit</option>
                  <option value="percent">% margin</option>
                </select>
              </Field>
              <Field label={editing.kind === "percent" ? "Percentage" : "Dollar amount"}>
                <input type="number" min="0" step="0.01" className="input px-3 py-2 w-full font-mono" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} data-testid="pr-value"/>
              </Field>
              <Field label="Sort order (lower first)">
                <input type="number" className="input px-3 py-2 w-full font-mono" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })} data-testid="pr-order"/>
              </Field>
              <Field label="Active">
                <select className="input px-3 py-2 w-full" value={editing.active !== false ? "1" : "0"} onChange={(e) => setEditing({ ...editing, active: e.target.value === "1" })} data-testid="pr-active">
                  <option value="1">Yes</option><option value="0">No</option>
                </select>
              </Field>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setEditing(null)} className="btn btn-ghost">Cancel</button>
              <button onClick={save} disabled={busy} className="btn btn-primary" data-testid="pr-save-btn">{busy ? <Loader2 className="animate-spin" size={14}/> : <Plus size={14}/>} {editing.id ? "Save changes" : "Create tier"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PushNotificationSettings() {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({}); // holds unsaved input values
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/push/settings`);
    setSettings(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!settings) return <div className="text-slate-500 py-24 text-center">loading…</div>;

  const update = async (patch) => {
    setBusy(true);
    setSettings((s) => ({ ...s, ...patch })); // optimistic non-secret toggles
    try { const { data } = await axios.patch(`${API}/push/settings`, patch); setSettings(data); }
    catch { toast.error("Save failed"); await load(); }
    finally { setBusy(false); }
  };

  const saveCredentials = async () => {
    const patch = {};
    if (draft.resend_api_key !== undefined && draft.resend_api_key !== "") patch.resend_api_key = draft.resend_api_key.trim();
    if (draft.resend_to_email !== undefined) patch.resend_to_email = (draft.resend_to_email || "").trim();
    if (draft.resend_from_email !== undefined) patch.resend_from_email = (draft.resend_from_email || "").trim();
    if (draft.telegram_bot_token !== undefined && draft.telegram_bot_token !== "") patch.telegram_bot_token = draft.telegram_bot_token.trim();
    if (draft.telegram_chat_id !== undefined) patch.telegram_chat_id = (draft.telegram_chat_id || "").trim();
    if (Object.keys(patch).length === 0) { toast("Nothing to save"); return; }
    setBusy(true);
    try {
      const { data } = await axios.patch(`${API}/push/settings`, patch);
      setSettings(data);
      setDraft({}); // clear the input drafts
      toast.success("Credentials saved");
    } catch { toast.error("Save failed"); }
    finally { setBusy(false); }
  };

  const clearSecret = async (field) => {
    if (!window.confirm(`Clear stored ${field}? (will fall back to .env if that key is set)`)) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/push/settings/clear-secret?field=${field}`);
      setSettings(data);
      toast.success("Cleared");
    } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const { data } = await axios.post(`${API}/push/test`);
      const parts = [];
      if (data.email === "sent") parts.push("email");
      if (data.telegram === "sent") parts.push("Telegram");
      if (parts.length === 0) toast.error("No channels configured", { description: "Save your keys above first." });
      else toast.success(`Test push sent via ${parts.join(" + ")}`);
    } catch { toast.error("Test failed"); }
    finally { setTesting(false); }
  };

  const emailOk = settings.channels.email_configured;
  const telegramOk = settings.channels.telegram_configured;

  const dirty =
    (draft.resend_api_key ?? "") !== "" ||
    draft.resend_to_email !== undefined ||
    draft.resend_from_email !== undefined ||
    (draft.telegram_bot_token ?? "") !== "" ||
    draft.telegram_chat_id !== undefined;

  return (
    <div className="grid gap-4" data-testid="push-settings">
      <div className="grid md:grid-cols-2 gap-3">
        {/* Email channel */}
        <div className={`card p-5 ${emailOk ? "" : "border-dashed"}`} data-testid="push-email">
          <ChannelHeader name="Email · Resend" configured={emailOk} enabled={settings.email_enabled} onToggle={(v) => update({ email_enabled: v })}/>
          <div className="grid gap-3 mt-4">
            <CredField
              label="Resend API key"
              testId="fld-resend-key"
              type="password"
              placeholder={settings.resend_api_key_set ? `Saved · ${settings.resend_api_key_masked}` : (settings.resend_api_key_from_env ? "Using .env value" : "re_...")}
              value={draft.resend_api_key ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, resend_api_key: v }))}
              savedBadge={settings.resend_api_key_set}
              envBadge={settings.resend_api_key_from_env}
              onClear={settings.resend_api_key_set ? () => clearSecret("resend_api_key") : null}
            />
            <CredField
              label="Recipient email"
              testId="fld-resend-to"
              type="email"
              placeholder="you@example.com"
              value={draft.resend_to_email ?? settings.resend_to_email}
              onChange={(v) => setDraft((d) => ({ ...d, resend_to_email: v }))}
            />
            <CredField
              label="From address (optional)"
              testId="fld-resend-from"
              type="email"
              placeholder="onboarding@resend.dev"
              value={draft.resend_from_email ?? settings.resend_from_email}
              onChange={(v) => setDraft((d) => ({ ...d, resend_from_email: v }))}
            />
          </div>
          <a href="https://resend.com" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline">Get a Resend key <ExternalLink size={11}/></a>
        </div>

        {/* Telegram channel */}
        <div className={`card p-5 ${telegramOk ? "" : "border-dashed"}`} data-testid="push-telegram">
          <ChannelHeader name="Telegram · Bot API" configured={telegramOk} enabled={settings.telegram_enabled} onToggle={(v) => update({ telegram_enabled: v })}/>
          <div className="grid gap-3 mt-4">
            <CredField
              label="Bot token"
              testId="fld-tg-token"
              type="password"
              placeholder={settings.telegram_bot_token_set ? `Saved · ${settings.telegram_bot_token_masked}` : (settings.telegram_bot_token_from_env ? "Using .env value" : "123456:ABC-...")}
              value={draft.telegram_bot_token ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, telegram_bot_token: v }))}
              savedBadge={settings.telegram_bot_token_set}
              envBadge={settings.telegram_bot_token_from_env}
              onClear={settings.telegram_bot_token_set ? () => clearSecret("telegram_bot_token") : null}
            />
            <CredField
              label="Chat ID"
              testId="fld-tg-chat"
              type="text"
              placeholder="e.g. 987654321"
              value={draft.telegram_chat_id ?? settings.telegram_chat_id}
              onChange={(v) => setDraft((d) => ({ ...d, telegram_chat_id: v }))}
            />
          </div>
          <a href="https://core.telegram.org/bots#creating-a-new-bot" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline">Create a bot & get chat ID <ExternalLink size={11}/></a>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 flex-wrap">
        {dirty && <span className="text-xs text-amber-600 font-mono">Unsaved changes</span>}
        <button onClick={() => { setDraft({}); }} disabled={!dirty || busy} className="btn btn-ghost text-sm" data-testid="creds-cancel-btn">Discard</button>
        <button onClick={saveCredentials} disabled={busy || !dirty} className="btn btn-primary text-sm" data-testid="creds-save-btn">
          {busy ? <Loader2 className="animate-spin" size={14}/> : <BadgeCheck size={14}/>} Save credentials
        </button>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="font-display font-bold text-base">Filters</div>
            <div className="text-xs text-slate-500">Decide which events actually push to your phone.</div>
          </div>
          <button onClick={sendTest} disabled={busy || testing} className="btn btn-primary text-sm" data-testid="push-test-btn">
            {testing ? <Loader2 className="animate-spin" size={14}/> : <Bell size={14}/>} Send test push
          </button>
        </div>

        <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer" data-testid="push-critical-toggle">
          <input type="checkbox" checked={settings.critical_only} onChange={(e) => update({ critical_only: e.target.checked })} className="accent-indigo-600 mt-1 w-4 h-4"/>
          <div className="flex-1">
            <div className="text-sm font-medium">Only push critical events</div>
            <div className="text-xs text-slate-500">
              When ON: new orders, out-of-stock alerts, and price drops that hurt margin by ≥ the threshold below.
              When OFF: <span className="text-slate-700">every notification</span> pushes (chatty).
            </div>
          </div>
        </label>

        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <label className="text-[11px] font-mono uppercase text-slate-500">Margin-drop threshold (pp)</label>
          <input
            data-testid="push-threshold"
            type="number"
            min="0" step="0.5"
            value={settings.margin_drop_threshold_pp}
            onChange={(e) => update({ margin_drop_threshold_pp: parseFloat(e.target.value) || 0 })}
            className="input px-3 py-1.5 text-sm font-mono w-24"
          />
          <span className="text-xs text-slate-500">Price-change alerts push only when the new margin is at least this many percentage points lower.</span>
        </div>
      </div>

      <div className="card p-4 border-dashed border-2 text-xs text-slate-500 leading-relaxed">
        <div className="font-display font-bold text-slate-700 text-sm mb-1 flex items-center gap-2"><HelpCircle size={14}/> How storage works</div>
        Credentials you save here live in the database (secrets are masked when read back). If a field is left blank we fall back to the matching env variable in <code className="chip chip-neutral">/app/backend/.env</code>. Missing everywhere = silent skip, dashboard notifications keep working.
      </div>
    </div>
  );
}

function ChannelHeader({ name, configured, enabled, onToggle }) {
  return (
    <>
      <div className="flex items-center justify-between mb-1 gap-3">
        <div className="font-display font-bold text-base">{name}</div>
        <span className={`chip ${configured ? "chip-success" : "chip-neutral"} font-mono text-[10px]`}>{configured ? <><BadgeCheck size={11}/> Ready</> : <>Not configured</>}</span>
      </div>
      <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="accent-indigo-600 w-4 h-4"/>
        Send this channel
      </label>
    </>
  );
}

function CredField({ label, testId, type = "text", placeholder, value, onChange, savedBadge, envBadge, onClear }) {
  const [reveal, setReveal] = useState(false);
  const isSecret = type === "password";
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</span>
        <div className="flex items-center gap-1">
          {savedBadge && <span className="chip chip-success !py-0 !px-1.5 text-[9px] font-mono"><BadgeCheck size={9}/> saved</span>}
          {envBadge && !savedBadge && <span className="chip chip-primary !py-0 !px-1.5 text-[9px] font-mono">.env</span>}
        </div>
      </div>
      <div className="relative">
        <input
          data-testid={testId}
          type={isSecret && !reveal ? "password" : "text"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="input pr-16 pl-3 py-2 text-sm font-mono w-full"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isSecret && (
            <button type="button" onClick={() => setReveal((r) => !r)} className="text-slate-400 hover:text-slate-600 p-1" title={reveal ? "Hide" : "Show"}>
              {reveal ? <EyeOff size={13}/> : <Eye size={13}/>}
            </button>
          )}
          {onClear && (
            <button type="button" onClick={onClear} className="text-slate-400 hover:text-red-600 p-1" title="Clear stored value">
              <Trash2 size={13}/>
            </button>
          )}
        </div>
      </div>
    </label>
  );
}

function StoreManagement({ section, setSection }) {
  const meta = STORE_NAV.find((s) => s.id === section) || STORE_NAV[0];
  const Icon = meta.icon;

  const sections = {
    "store-settings":      { hint: "Store name, brand, contact details, business hours and legal info.", fields: ["Store name","Legal business name","ABN","Contact email","Support phone","Business hours"] },
    "pricing-rules":       { hint: "Tiered profit rules the scraper uses when calculating sell prices for imported items.", fields: [], custom: <PricingRulesEditor/> },
    "notifications-push":  { hint: "Deliver critical dashboard notifications to your phone via Email (Resend) and Telegram bot.", fields: [], custom: <PushNotificationSettings/> },
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
        {!sections.custom && <button className="btn btn-primary text-sm hidden sm:inline-flex" data-testid="store-save-btn"><Plus size={14}/> Add new</button>}
      </div>

      {sections.custom ? sections.custom : (
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
      )}

      {!sections.custom && (
        <div className="card p-5 border-dashed border-2 text-center text-slate-500 text-sm">
          <div className="font-display font-bold text-slate-700 mb-1">This is a scaffold — ready for your links & fields</div>
          Send more sub-links or specific fields for <span className="font-mono text-indigo-600">{meta.label}</span> and I&apos;ll wire them up.
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Dashboard -------------------------------- */
function ProfitCalculator() {
  const [ebay, setEbay] = useState("");
  const [rules] = usePricingRules();
  const num = parseFloat(ebay);
  const valid = !isNaN(num) && num > 0;
  const c = valid ? calcPricingWithRules(num, rules) : { ebay: 0, sell: 0, profit: 0, matched: null };
  const roi = valid && c.ebay ? (c.profit / c.ebay) * 100 : 0;
  const ruleLabel = c.matched
    ? `${c.matched.label || "Tier"} · ${c.matched.kind === "percent" ? `+${c.matched.value}%` : `+$${c.matched.value}`}`
    : "Fallback rule (20% + $20)";

  return (
    <div className="card p-5" data-testid="profit-calculator">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 grid place-items-center rounded-lg text-white" style={{ background: "linear-gradient(135deg,#4F46E5,#EC4899)" }}><Calculator size={16}/></div>
          <div>
            <div className="font-display font-bold text-lg">Profit calculator</div>
            <div className="text-xs text-slate-500 font-mono">Uses your Pricing Rules · edit in Store Management › Pricing Rules</div>
          </div>
        </div>
        {valid && (
          <span className="chip chip-primary" data-testid="pcalc-rule">{ruleLabel}</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-stretch">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Enter eBay price (AUD)</span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm">$</span>
            <input
              data-testid="pcalc-input"
              type="number"
              min="0"
              step="0.01"
              value={ebay}
              onChange={(e) => setEbay(e.target.value)}
              placeholder="0.00"
              className="input pl-7 pr-3 py-2 w-full text-lg font-mono font-bold"
            />
          </div>
        </label>

        <div className="rounded-lg bg-slate-50 border hairline p-3 flex flex-col justify-center">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">eBay price</div>
          <div className="font-display text-2xl font-bold text-slate-800 mt-1" data-testid="pcalc-ebay">{valid ? moneyCents(c.ebay) : "—"}</div>
        </div>

        <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 flex flex-col justify-center">
          <div className="text-[10px] font-mono uppercase tracking-widest text-indigo-500">Suggested sell price</div>
          <div className="font-display text-2xl font-bold text-indigo-700 mt-1" data-testid="pcalc-sell">{valid ? moneyCents(c.sell) : "—"}</div>
        </div>

        <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 flex flex-col justify-center">
          <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-600">Expected profit</div>
          <div className="font-display text-2xl font-bold text-emerald-700 mt-1" data-testid="pcalc-profit">{valid ? moneyCents(c.profit) : "—"}</div>
          {valid && <div className="text-[11px] font-mono text-emerald-600/70 mt-0.5">{roi.toFixed(1)}% ROI</div>}
        </div>
      </div>
    </div>
  );
}

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

      {/* Profit calculator */}
      <ProfitCalculator/>

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
            <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th className="text-right">eBay</th><th className="text-right">Sell</th><th className="text-right">Profit</th><th className="text-right">Stock</th><th className="text-right">Sold</th><th></th></tr></thead>
            <tbody>
              {list.length === 0
                ? <tr><td colSpan={9} className="text-center py-10 text-slate-500">No products yet. Head to <b>Product Sourcing</b> and import your first one.</td></tr>
                : list.map((p) => {
                    const c = catByslug(p.category);
                    const ebay = Number(p.cost) || 0;
                    const sell = Number(p.price) || 0;
                    const profit = ebay > 0 ? Math.round((sell - ebay) * 100) / 100 : 0;
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
                    <td className="text-right font-mono text-slate-500">{ebay > 0 ? moneyCents(ebay) : "—"}</td>
                    <td className="text-right font-mono font-bold text-indigo-600">{moneyCents(sell)}</td>
                    <td className="text-right font-mono font-bold text-emerald-600">{ebay > 0 ? moneyCents(profit) : "—"}</td>
                    <td className={`text-right ${p.stock <= 3 ? "text-red-600 font-bold" : "text-slate-700"}`}>{p.stock}</td>
                    <td className="text-right">{p.sold_count || 0}</td>
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
  const [sortBy, setSortBy] = useState("created_at_desc");
  const [statusFilter, setStatusFilter] = useState("");
  const [rules] = usePricingRules();

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/items`, { params: { q: q || undefined, sort: sortBy, status: statusFilter || undefined }});
    setItems(data.items);
  }, [q, sortBy, statusFilter]);
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
          <div className="font-display text-2xl font-bold tracking-tight">Product Sourcing</div>
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
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="font-display font-bold text-lg">Scraped items</div>
            <div className="text-xs text-slate-500">{items.length} imported · click to view details, then add to products</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input data-testid="scraper-search" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search title, seller, location" className="input pl-9 pr-3 py-2 text-sm w-64"/></div>
            <select data-testid="scraper-status-filter" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)} className="input px-3 py-2 text-sm">
              <option value="">All statuses</option>
              <option value="live">Live</option>
              <option value="sold">Sold</option>
            </select>
            <select data-testid="scraper-sort" value={sortBy} onChange={(e)=>setSortBy(e.target.value)} className="input px-3 py-2 text-sm">
              <option value="created_at_desc">Newest</option>
              <option value="created_at_asc">Oldest</option>
              <option value="price_desc">Price ↓</option>
              <option value="price_asc">Price ↑</option>
              <option value="title_asc">Title A→Z</option>
            </select>
          </div>
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
                  {(() => {
                    const c = calcPricing(it.price_value, rules);
                    return c.ebay > 0 && (
                      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] font-mono" data-testid="scraped-card-pricing">
                        <div className="rounded-md bg-slate-50 border hairline p-1.5">
                          <div className="text-slate-400 uppercase tracking-widest text-[9px]">eBay</div>
                          <div className="text-slate-700 font-bold">${c.ebay.toFixed(2)}</div>
                        </div>
                        <div className="rounded-md bg-indigo-50 border border-indigo-100 p-1.5">
                          <div className="text-indigo-500 uppercase tracking-widest text-[9px]">Sell</div>
                          <div className="text-indigo-700 font-bold">${c.sell.toFixed(2)}</div>
                        </div>
                        <div className="rounded-md bg-emerald-50 border border-emerald-100 p-1.5">
                          <div className="text-emerald-600 uppercase tracking-widest text-[9px]">Profit</div>
                          <div className="text-emerald-700 font-bold">${c.profit.toFixed(2)}</div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    {it.category && <span className="chip chip-primary text-[10px]" data-testid="scraped-card-category" title={(it.ebay_category_path || []).join(" › ")}><Tags size={10}/> {it.category}</span>}
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
/* ------------------------------- Analytics -------------------------------- */
function Analytics() {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/analytics/report`).then(r => setData(r.data)); }, []);
  if (!data) return <div className="text-slate-500 py-24 text-center">loading…</div>;
  return (
    <div className="grid gap-6">
      <div>
        <div className="font-display text-2xl font-bold tracking-tight">Reporting</div>
        <div className="text-xs text-slate-500 mt-1">Deeper insights beyond the daily overview — supplier performance, margin trends, category comparison & product profitability.</div>
      </div>

      <TopSuppliersReport list={data.top_suppliers}/>
      <MarginTrendReport data={data.margin_trend}/>
      <CategoryPerformanceReport data={data.category_performance}/>
      <BestMarginProductsReport rows={data.best_margin_products}/>
    </div>
  );
}

function TopSuppliersReport({ list }) {
  const max = Math.max(1, ...list.map((s) => s.revenue_generated));
  return (
    <div className="card overflow-hidden" data-testid="rep-top-suppliers">
      <div className="p-5 border-b hairline flex items-center gap-2">
        <Factory size={16} className="text-indigo-600"/>
        <div className="font-display font-bold text-lg">Top 5 suppliers by revenue</div>
      </div>
      {list.length === 0 ? (
        <div className="p-10 text-center text-slate-500">No supplier revenue yet — link imported eBay items to products with orders to see rankings.</div>
      ) : (
        <div className="p-3">
          {list.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
              <div className="w-8 h-8 grid place-items-center rounded-md font-display font-bold text-white text-xs" style={{ background: "linear-gradient(135deg,#4F46E5,#EC4899)", opacity: 1 - i * 0.12 }}>{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="font-mono font-bold text-indigo-600 text-sm shrink-0">{moneyCents(s.revenue_generated)}</div>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(s.revenue_generated / max) * 100}%`, background: "linear-gradient(90deg,#4F46E5,#EC4899)" }}/>
                </div>
                <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
                  <span>{s.total_orders} orders</span>
                  <span>·</span>
                  <span>{s.total_products} products</span>
                  <span>·</span>
                  <span className="truncate">{s.location}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarginTrendReport({ data }) {
  const nonZero = data.filter((d) => d.margin_pct > 0);
  const avg = nonZero.length ? nonZero.reduce((a, b) => a + b.margin_pct, 0) / nonZero.length : 0;
  return (
    <div className="card p-5" data-testid="rep-margin-trend">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-emerald-600"/>
          <div className="font-display font-bold text-lg">Margin trend — last 30 days</div>
        </div>
        <div className="text-xs text-slate-500 font-mono">30-day avg margin <span className="text-emerald-600 font-bold">{avg.toFixed(1)}%</span></div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
            <YAxis tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`}/>
            <Tooltip
              labelFormatter={fmtDay}
              contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
              formatter={(v, name) => name === "margin_pct" ? [`${Number(v).toFixed(1)}%`, "Margin"] : [v, name]}
            />
            <Line type="monotone" dataKey="margin_pct" stroke="#10B981" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CategoryPerformanceReport({ data }) {
  const chartData = data.slice(0, 10).map((c) => ({
    ...c,
    label: c.category.length > 14 ? c.category.slice(0, 12) + "…" : c.category,
  }));
  return (
    <div className="card p-5" data-testid="rep-category-perf">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={16} className="text-pink-600"/>
        <div className="font-display font-bold text-lg">Category performance</div>
      </div>
      {data.length === 0 ? (
        <div className="p-10 text-center text-slate-500">No category revenue yet — create some orders against products to populate this chart.</div>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="label" tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false}/>
              <YAxis tick={{ fill: "#94A3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => `$${v >= 1000 ? (v/1000).toFixed(0)+"k" : v}`}/>
              <Tooltip
                contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
                formatter={(v, name) => [`AU $${Number(v).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`, name === "revenue" ? "Revenue" : "Profit"]}
              />
              <Bar dataKey="revenue" name="revenue" fill="#4F46E5" radius={[4, 4, 0, 0]}/>
              <Bar dataKey="profit"  name="profit"  fill="#EC4899" radius={[4, 4, 0, 0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function BestMarginProductsReport({ rows }) {
  return (
    <div className="card overflow-hidden" data-testid="rep-best-margin">
      <div className="p-5 border-b hairline flex items-center gap-2">
        <Percent size={16} className="text-emerald-600"/>
        <div className="font-display font-bold text-lg">Best margin products</div>
        <span className="chip chip-neutral ml-1">Top 20</span>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr>
            <th>Product</th>
            <th className="text-right">Buy price</th>
            <th className="text-right">Sell price</th>
            <th className="text-right">Margin %</th>
            <th className="text-right">Units sold</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-slate-500">No sold products yet.</td></tr>}
            {rows.map((p) => (
              <tr key={p.product_id} data-testid="best-margin-row">
                <td className="text-sm truncate max-w-[420px]" title={p.title}>{p.title}</td>
                <td className="text-right font-mono text-slate-500">{moneyCents(p.buy_price)}</td>
                <td className="text-right font-mono font-bold text-indigo-600">{moneyCents(p.sell_price)}</td>
                <td className="text-right"><span className={`chip ${p.margin_pct >= 40 ? "chip-success" : p.margin_pct >= 20 ? "chip-primary" : "chip-neutral"} font-mono`}>{p.margin_pct.toFixed(1)}%</span></td>
                <td className="text-right font-mono">{p.units_sold}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
              <InfoBox icon={<Tags size={14}/>} label="Detected category" value={it.category || "—"}/>
            </div>

            {(it.ebay_category_path || []).length > 0 && (
              <div className="mt-3 text-[11px] text-slate-500 font-mono flex items-center gap-1 flex-wrap" data-testid="ebay-breadcrumbs">
                <Tags size={11}/>
                {it.ebay_category_path.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span>{crumb}</span>
                    {i < it.ebay_category_path.length - 1 && <span className="text-slate-300">›</span>}
                  </span>
                ))}
              </div>
            )}

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

            {/* Price history */}
            <PriceHistoryChart history={it.price_history}/>

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

function PriceHistoryChart({ history }) {
  const points = (history || []).filter(p => p && p.value != null);
  if (points.length < 2) {
    return (
      <div className="mt-6 card-flat p-4" data-testid="price-history-chart">
        <div className="font-display font-bold text-sm mb-1">Price history</div>
        <div className="text-xs text-slate-500">Only one data point so far. Refresh this item over time to build a price trend.</div>
      </div>
    );
  }
  const data = points.map(p => ({ at: p.at, value: p.value, label: (p.at || "").slice(5, 10) }));
  const first = points[0].value, last = points[points.length - 1].value;
  const delta = last - first;
  const pct = first ? (delta / first) * 100 : 0;
  const trending = delta === 0 ? "flat" : delta < 0 ? "down" : "up";
  const min = Math.min(...points.map(p => p.value));
  const max = Math.max(...points.map(p => p.value));
  return (
    <div className="mt-6 card-flat p-4" data-testid="price-history-chart">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="font-display font-bold text-sm flex items-center gap-2">
          {trending === "down" ? <TrendingDown size={14} className="text-emerald-600"/> : trending === "up" ? <TrendingUp size={14} className="text-amber-600"/> : <LineChartIcon size={14} className="text-slate-500"/>}
          Price history
        </div>
        <div className="text-[11px] font-mono text-slate-500">
          {points.length} points · min AU ${min.toFixed(2)} · max AU ${max.toFixed(2)}
          <span className={`ml-2 font-bold ${delta < 0 ? "text-emerald-600" : delta > 0 ? "text-amber-600" : "text-slate-500"}`}>
            {delta === 0 ? "no change" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`}
          </span>
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F5" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="label" tick={{ fill: "#94A3B8", fontSize: 10 }} tickLine={false} axisLine={false}/>
            <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `$${v}`}/>
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #EAEAF0", borderRadius: 10, fontSize: 12 }}
              formatter={(v) => [`AU $${Number(v).toFixed(2)}`, "Price"]}
              labelFormatter={(l, payload) => payload?.[0]?.payload?.at ? fmtDate(payload[0].payload.at) : l}
            />
            <Line type="monotone" dataKey="value" stroke="#4F46E5" strokeWidth={2} dot={{ r: 3, fill: "#4F46E5" }} activeDot={{ r: 5 }}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
