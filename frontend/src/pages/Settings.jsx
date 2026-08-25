import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Moon, Sun } from "lucide-react";
import { Field } from "../components/atoms";
import { API, KEYS, loadKeys } from "../lib/api";
import { applyTheme } from "../lib/theme";

export function SettingsPage() {
  const [s, setS] = useState({ store_name:"", store_email:"", currency:"AUD", country:"Australia", tax_rate:10.0, accent_color:"indigo", theme:"light" });
  const [sb, setSb] = useState(""); const [sa, setSa] = useState(""); const [method, setMethod] = useState("auto");
  const [themeSaving, setThemeSaving] = useState(false);

  useEffect(() => { axios.get(`${API}/settings`).then(r => setS(prev => ({ ...prev, ...r.data }))); const k = loadKeys(); setSb(k.scrapingbee_key); setSa(k.scraperapi_key); setMethod(k.method); }, []);

  const saveStore = async () => { try { await axios.put(`${API}/settings`, s); toast.success("Store settings saved"); } catch { toast.error("Save failed"); } };
  const saveKeys = () => { localStorage.setItem(KEYS.sb, sb.trim()); localStorage.setItem(KEYS.sa, sa.trim()); localStorage.setItem(KEYS.method, method); toast.success("Scraper settings saved locally"); };

  // Toggling the theme should feel instant: apply the class immediately
  // for the visual flip, then PUT the full settings doc so the choice
  // survives logout / new browsers.
  const pickTheme = async (next) => {
    if (next === s.theme) return;
    applyTheme(next);
    const merged = { ...s, theme: next };
    setS(merged);
    setThemeSaving(true);
    try {
      await axios.put(`${API}/settings`, merged);
      toast.success(`${next === "dark" ? "Dark" : "Light"} theme saved`);
    } catch {
      toast.error("Couldn't save theme");
    } finally { setThemeSaving(false); }
  };

  return (
    <div className="grid gap-6 max-w-4xl">
      <div className="card p-6" data-testid="theme-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-display font-bold text-lg mb-1">Theme</div>
            <div className="text-xs text-slate-500">Applies instantly across the admin dashboard and stays with your account after logout.</div>
          </div>
          {themeSaving && <span className="text-xs text-slate-500 font-mono">Saving…</span>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 max-w-md">
          {[
            { id: "light", label: "Light", icon: Sun,  swatch: ["#F7F8FB", "#FFFFFF", "#0B1020"] },
            { id: "dark",  label: "Dark",  icon: Moon, swatch: ["#0B1020", "#14192B", "#E4E7F1"] },
          ].map(opt => {
            const active = s.theme === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => pickTheme(opt.id)}
                className={`text-left rounded-xl p-4 border-2 transition-all ${active ? "border-indigo-500 shadow-md shadow-indigo-500/10" : "border-slate-200 hover:border-slate-300"}`}
                data-testid={`theme-option-${opt.id}`}
                aria-pressed={active}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-8 h-8 grid place-items-center rounded-lg"
                    style={{ background: opt.swatch[1], color: opt.swatch[2], boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }}
                  >
                    <Icon size={15}/>
                  </div>
                  <div className="font-display font-bold text-sm">{opt.label}</div>
                  {active && <span className="chip chip-primary text-[10px] font-mono ml-auto">Active</span>}
                </div>
                {/* Mini preview swatch */}
                <div className="flex gap-1.5">
                  {opt.swatch.map((c, i) => (
                    <div key={i} className="flex-1 h-6 rounded" style={{ background: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.06)" }}/>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

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
