import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { BarChart3, ChevronRight, CreditCard, Factory, LayoutDashboard, Package, Settings2, ShoppingCart, Sparkles, Store, Tags, Users, X, Zap } from "lucide-react";
import { Analytics } from "../pages/Analytics";
import { Categories } from "../pages/Categories";
import { Dashboard } from "../pages/Dashboard";
import { Orders } from "../pages/Orders";
import { Products } from "../pages/ProductsList";
import { Suppliers } from "../pages/Suppliers";
import { canAccess, loadAdminSession } from "../lib/adminSession";

export function Sidebar({ tab, setTab, mobileOpen, setMobileOpen, unreadCustomerCount = 0, onCustomersBadgeClick }) {
  // Track the active admin session so the sidebar can hide Store /
  // Payments / Settings for Managers. The Settings › Accounts UI dispatches
  // `adminsessionchange` whenever the admin swaps identity.
  const [role, setRole] = useState(loadAdminSession().role);
  useEffect(() => {
    const on = (e) => setRole(e?.detail?.role || loadAdminSession().role);
    window.addEventListener("adminsessionchange", on);
    return () => window.removeEventListener("adminsessionchange", on);
  }, []);

  const nav = [
    { id: "dashboard", label: "Dashboard",  icon: LayoutDashboard, group: "General" },
    { id: "store",     label: "Store Management", icon: Store, group: "General", hasSub: true },
    { id: "products",  label: "Products",   icon: Package,        group: "Catalog", hasSub: true },
    { id: "categories", label: "Categories", icon: Tags,          group: "Catalog" },
    { id: "suppliers", label: "Suppliers",  icon: Factory,        group: "Catalog", hasSub: true },
    { id: "scraper",   label: "Product Sourcing", icon: Zap, badge: "AU", group: "Catalog" },
    { id: "orders",    label: "Orders",     icon: ShoppingCart,   group: "Operations", hasSub: true },
    { id: "payments",  label: "Payments",   icon: CreditCard,     group: "Operations", hasSub: true },
    { id: "customers", label: "Customers",  icon: Users,          group: "Operations", hasSub: true, count: unreadCustomerCount, onBadgeClick: onCustomersBadgeClick },
    { id: "analytics", label: "Analytics",  icon: BarChart3,      group: "Insights" },
    { id: "settings",  label: "Settings",   icon: Settings2,      group: "System" },
  ].filter(n => canAccess(role, n.id));
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
                    <span className="relative shrink-0">
                      <Icon size={16} className="sidebar-icon" />
                      {n.count > 0 && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(ev) => { ev.stopPropagation(); n.onBadgeClick?.(); }}
                          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); n.onBadgeClick?.(); } }}
                          className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] leading-none font-bold shadow ring-2 ring-white animate-pulse cursor-pointer hover:bg-red-600 hover:scale-110 transition"
                          data-testid={`nav-${n.id}-unread-badge`}
                          title={`${n.count} customer${n.count === 1 ? "" : "s"} waiting for a reply — click to open messages`}
                          aria-label={`${n.count} unread — open messages`}
                        >
                          {n.count > 99 ? "99+" : n.count}
                        </span>
                      )}
                    </span>
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
        {/* Mobile variant (< 768px): quick access to the eBay sourcing flow. */}
        <div className="md:hidden card p-4 bg-gradient-to-br from-indigo-50 to-pink-50 border-indigo-100" data-testid="sidebar-cta-mobile">
          <div className="flex items-center gap-2 text-indigo-700 font-display font-bold text-sm"><Sparkles size={14}/> Product Sourcing</div>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">Discover and import new products directly into your store.</p>
          <button onClick={() => setTab("scraper")} className="btn btn-primary w-full mt-3 text-xs py-2" data-testid="sidebar-cta-mobile-btn">Open Sourcing</button>
        </div>
        {/* Desktop variant (≥ 768px): shortcut to Admin Settings — hidden
            entirely for Managers, whose role excludes Settings access. */}
        {role !== "manager" && (
          <div className="hidden md:block card p-4 bg-gradient-to-br from-indigo-50 to-pink-50 border-indigo-100" data-testid="sidebar-cta-desktop">
            <div className="flex items-center gap-2 text-indigo-700 font-display font-bold text-sm"><Settings2 size={14}/> Admin Settings</div>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">Configure system preferences, security, access, and administrator controls.</p>
            <button onClick={() => setTab("settings")} className="btn btn-primary w-full mt-3 text-xs py-2" data-testid="sidebar-cta-desktop-btn">Open Settings</button>
          </div>
        )}
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

export function SubSideNav({ title, subtitle, icon: HeaderIcon, nav, testPrefix, active, setActive }) {
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

export function SubMobileNav({ nav, testPrefix, active, setActive }) {
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

/* -------------------------- Global (top-bar) search -------------------------- */
