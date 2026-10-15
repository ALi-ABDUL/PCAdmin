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
      <div className="border-b hairline" role="tablist" aria-label="Product sourcing sections" data-testid="product-sourcing-tabs">
        <div className="flex gap-1 overflow-x-auto">
          {SOURCING_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.id === activeTab;
            return <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSection(tab.id)}
              className={`shrink-0 inline-flex items-center gap-2 px-3 py-2.5 border-b-2 text-sm font-medium transition-colors ${selected ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-200"}`}
              data-testid={`product-sourcing-tab-${tab.id}`}
            ><Icon size={15}/>{tab.label}</button>;
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