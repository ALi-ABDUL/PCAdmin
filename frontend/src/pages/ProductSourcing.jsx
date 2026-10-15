import { BarChart3, CalendarClock, KeyRound, Zap } from "lucide-react";
import { ScraperApiSettingsCard } from "../components/ScraperApiSettingsCard";
import { ScraperProviderUsageDashboard } from "../components/ScraperProviderUsageDashboard";
import { ScraperPage } from "./Scraper";
import { ScraperScheduleEditor } from "./Store";

const SOURCING_TABS = [
  { id: "sourcing", label: "Product Sourcing", icon: Zap },
  { id: "schedule", label: "Scraper Schedule", icon: CalendarClock },
  { id: "apis", label: "Scraper APIs", icon: KeyRound },
  { id: "usage", label: "Provider Usage", icon: BarChart3 },
];

export function ProductSourcingWorkspace({ section, setSection, onView, onEditProduct }) {
  const activeTab = SOURCING_TABS.some((tab) => tab.id === section) ? section : "sourcing";
  const active = SOURCING_TABS.find((tab) => tab.id === activeTab);

  return (
    <div className="grid gap-6" data-testid="product-sourcing-workspace">
      <div>
        <div className="font-display text-2xl font-bold tracking-tight" data-testid="product-sourcing-page-title">Product Sourcing</div>
        <div className="text-xs text-slate-500 font-mono mt-1">eBay AU imports · provider controls · scheduled refreshes</div>
      </div>
      <div className="rounded-xl border border-indigo-100 bg-white/90 p-1.5 shadow-sm" role="tablist" aria-label="Product sourcing sections" data-testid="product-sourcing-tabs">
        <div className="flex gap-1 overflow-x-auto" data-testid="product-sourcing-tab-list">
          {SOURCING_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.id === activeTab;
            return <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSection(tab.id)}
              className={`shrink-0 inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition-[background-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${selected ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 hover:shadow-sm active:translate-y-px"}`}
              data-testid={`product-sourcing-tab-${tab.id}`}
            ><span className={`grid h-6 w-6 place-items-center rounded-full transition-colors ${selected ? "bg-white/15 text-white" : "bg-indigo-50 text-indigo-600"}`}><Icon size={16} strokeWidth={2.25}/></span>{tab.label}</button>;
          })}
        </div>
      </div>
      <div role="tabpanel" aria-label={active.label} data-testid={`product-sourcing-panel-${activeTab}`}>
        {activeTab === "sourcing" && <ScraperPage embedded onView={onView} onEditProduct={onEditProduct}/>} 
        {activeTab === "schedule" && <ScraperScheduleEditor/>}
        {activeTab === "apis" && <ScraperApiSettingsCard/>}
        {activeTab === "usage" && <ScraperProviderUsageDashboard/>}
      </div>
    </div>
  );
}