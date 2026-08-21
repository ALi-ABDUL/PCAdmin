import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Store } from "lucide-react";
import { Field } from "../components/atoms";
import { API, KEYS, loadKeys } from "../lib/api";

export function SettingsPage() {
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
