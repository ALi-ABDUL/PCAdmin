import "@/App.css";
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Toaster, toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { CreditCard, Factory, Package, ShoppingCart, Store, Users } from "lucide-react";
import { TopHeader } from "./components/header";
import { Sidebar, SubMobileNav, SubSideNav } from "./components/layout";
import { ItemModal } from "./components/modals/ItemModal";
import { API } from "./lib/api";
import { fmtDate } from "./lib/format";
import { CUSTOMER_NAV, ORDERS_NAV, PAYMENTS_NAV, PRODUCT_NAV, STORE_NAV, SUPPLIER_NAV } from "./lib/nav";
import { Analytics } from "./pages/Analytics";
import { Categories } from "./pages/Categories";
import { CustomersModule } from "./pages/Customers";
import { Dashboard } from "./pages/Dashboard";
import { Orders, OrdersModule } from "./pages/Orders";
import { PaymentsModule } from "./pages/Payments";
import { ProductsModule } from "./pages/Products";
import { Products } from "./pages/ProductsList";
import { ScraperPage } from "./pages/Scraper";
import { SettingsPage } from "./pages/Settings";
import { StoreManagement } from "./pages/Store";
import { Suppliers } from "./pages/Suppliers";

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
  const [deepLink, setDeepLink] = useState(null); // { orderId?: str, productId?: str, itemId?: str }
  const [productDetailId, setProductDetailId] = useState(null);
  const [orderDetailId, setOrderDetailId] = useState(null);
  const [customerDetailId, setCustomerDetailId] = useState(null);
  const [unreadCustomerCount, setUnreadCustomerCount] = useState(0);

  useEffect(() => { setMobileNavOpen(false); }, [tab]);

  // Poll the "customers waiting for a reply" count and keep the sidebar badge
  // fresh. 20s cadence matches the notification poll and keeps the badge
  // effectively real-time without hammering the API.
  const refreshUnread = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/customers/unread-count`);
      setUnreadCustomerCount(data?.count || 0);
    } catch { /* silent — sidebar just won't update this cycle */ }
  }, []);
  // Advance the admin's "last seen" watermark on the messages inbox — clears
  // the sidebar badge until a genuinely new inbound message arrives. Called
  // when the admin opens the Messages section or clicks the sidebar badge.
  const markMessagesSeen = useCallback(async () => {
    setUnreadCustomerCount(0); // optimistic: badge disappears immediately
    try { await axios.post(`${API}/customers/messages/mark-seen`); } catch { /* silent */ }
  }, []);
  useEffect(() => {
    refreshUnread();
    const iv = setInterval(refreshUnread, 20000);
    return () => clearInterval(iv);
  }, [refreshUnread]);
  // Refresh immediately when the user navigates in/out of Customers so a
  // just-sent reply clears the badge without waiting for the next poll tick.
  useEffect(() => { if (tab === "customers") refreshUnread(); }, [tab, customerDetailId, refreshUnread]);
  // Landing on the Messages inbox counts as "seen" — advance the watermark.
  useEffect(() => {
    if (tab === "customers" && customerSection === "messages") markMessagesSeen();
  }, [tab, customerSection, markMessagesSeen]);

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

  const navigateTo = useCallback(({ tab: t, section, filter }) => {
    // Any navigation collapses currently open detail pages first — a deep-link with a
    // filter re-opens the appropriate one below.
    setProductDetailId(null);
    setOrderDetailId(null);
    setCustomerDetailId(null);
    if (t === "orders") { setTab("orders"); if (section) setOrdersSection(section); }
    else if (t === "products") { setTab("products"); if (section) setProductSection(section); }
    else if (t === "customers") { setTab("customers"); if (section) setCustomerSection(section); }
    else if (t === "scraper") { setTab("scraper"); }
    else if (t) setTab(t);
    // Detail-page deep-links (from notifications / global search)
    if (filter?.productId) setProductDetailId(filter.productId);
    else if (filter?.orderId) setOrderDetailId(filter.orderId);
    else if (filter?.customerId) setCustomerDetailId(filter.customerId);
    if (filter) setDeepLink({ ...filter, ts: Date.now() });
  }, []);
  const clearDeepLink = useCallback(() => setDeepLink(null), []);

  // Wrapped setters ensure that ANY sidebar / submenu / top-nav click collapses an
  // open detail page — the edit view should only survive when explicitly opened by
  // clicking a product/order/customer card. Direct setTab / setProductSection calls
  // would skip this because React bails out on same-value updates and useEffect
  // wouldn't fire.
  const changeTab = useCallback((t) => {
    setProductDetailId(null);
    setOrderDetailId(null);
    setCustomerDetailId(null);
    setTab(t);
  }, []);
  const changeProductSection = useCallback((s) => {
    setProductDetailId(null);
    setProductSection(s);
  }, []);
  const changeOrdersSection = useCallback((s) => {
    setOrderDetailId(null);
    setOrdersSection(s);
  }, []);
  const changeCustomerSection = useCallback((s) => {
    setCustomerDetailId(null);
    setCustomerSection(s);
  }, []);

  // Safety net: leaving the module entirely still collapses the detail.
  useEffect(() => { if (tab !== "products")  setProductDetailId(null); }, [tab]);
  useEffect(() => { if (tab !== "orders")    setOrderDetailId(null); }, [tab]);
  useEffect(() => { if (tab !== "customers") setCustomerDetailId(null); }, [tab]);

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

      <Sidebar tab={tab} setTab={changeTab} mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} unreadCustomerCount={unreadCustomerCount} onCustomersBadgeClick={() => { markMessagesSeen(); navigateTo({ tab: "customers", section: "messages" }); }}/>

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
            <SubSideNav title="Customers" subtitle="Grow and support your buyers" icon={Users} nav={CUSTOMER_NAV} testPrefix="cus" active={customerSection} setActive={changeCustomerSection}/>
          </motion.aside>
        )}
        {inProducts && (
          <motion.aside key="product-sidebar" initial={{ opacity: 0, x: -20, width: 0 }} animate={{ opacity: 1, x: 0, width: 280 }} exit={{ opacity: 0, x: -20, width: 0 }} transition={{ duration: 0.22 }} className="hidden xl:flex flex-col shrink-0 border-r hairline bg-white/85 backdrop-blur-xl sticky top-0 h-screen overflow-hidden">
            <SubSideNav title="Products" subtitle="Catalog, inventory & pricing" icon={Package} nav={PRODUCT_NAV} testPrefix="prd" active={productSection} setActive={changeProductSection}/>
          </motion.aside>
        )}
        {inOrders && (
          <motion.aside key="orders-sidebar" initial={{ opacity: 0, x: -20, width: 0 }} animate={{ opacity: 1, x: 0, width: 280 }} exit={{ opacity: 0, x: -20, width: 0 }} transition={{ duration: 0.22 }} className="hidden xl:flex flex-col shrink-0 border-r hairline bg-white/85 backdrop-blur-xl sticky top-0 h-screen overflow-hidden">
            <SubSideNav title="Orders" subtitle="Fulfilment & returns" icon={ShoppingCart} nav={ORDERS_NAV} testPrefix="ord" active={ordersSection} setActive={changeOrdersSection}/>
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
        {inCustomers && <SubMobileNav nav={CUSTOMER_NAV} testPrefix="cus-m"   active={customerSection} setActive={changeCustomerSection}/>}
        {inProducts  && <SubMobileNav nav={PRODUCT_NAV}  testPrefix="prd-m"   active={productSection}  setActive={changeProductSection}/>}
        {inOrders    && <SubMobileNav nav={ORDERS_NAV}   testPrefix="ord-m"   active={ordersSection}   setActive={changeOrdersSection}/>}
        {inPayments  && <SubMobileNav nav={PAYMENTS_NAV} testPrefix="pay-m"   active={paymentsSection} setActive={setPaymentsSection}/>}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 xl:p-10">
          <AnimatePresence mode="wait">
            <motion.div key={subKey} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {tab === "dashboard" && <Dashboard navigateTo={navigateTo}/>}
              {tab === "store"     && <StoreManagement section={storeSection} setSection={setStoreSection}/>}
              {tab === "suppliers" && <Suppliers section={supplierSection} setSection={setSupplierSection}/>}
              {tab === "customers" && <CustomersModule section={customerSection} setSection={changeCustomerSection} customerDetailId={customerDetailId} openCustomerDetail={setCustomerDetailId} onMessageSent={refreshUnread} navigateTo={navigateTo}/>}
              {tab === "products"  && <ProductsModule section={productSection} setSection={changeProductSection} deepLink={deepLink} clearDeepLink={clearDeepLink} openProductDetail={setProductDetailId} productDetailId={productDetailId}/>}
              {tab === "orders"    && <OrdersModule section={ordersSection} setSection={changeOrdersSection} deepLink={deepLink} clearDeepLink={clearDeepLink} openOrderDetail={setOrderDetailId} orderDetailId={orderDetailId}/>}
              {tab === "payments"  && <PaymentsModule section={paymentsSection} setSection={setPaymentsSection}/>}
              {tab === "categories" && <Categories navigateTo={navigateTo}/>}
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
