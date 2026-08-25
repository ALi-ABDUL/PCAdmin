import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BadgeCheck, LogIn, Moon, Pencil, Plus, ShieldCheck, Sun, Trash2, UserPlus, X } from "lucide-react";
import { Field } from "../components/atoms";
import { API, KEYS, loadKeys } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { ADMIN_ROLES, loadAdminSession, saveAdminSession } from "../lib/adminSession";

export function SettingsPage() {
  const [s, setS] = useState({ store_name:"", store_email:"", currency:"AUD", country:"Australia", tax_rate:10.0, accent_color:"indigo", theme:"light" });
  const [sb, setSb] = useState(""); const [sa, setSa] = useState(""); const [method, setMethod] = useState("auto");
  const [themeSaving, setThemeSaving] = useState(false);

  useEffect(() => { axios.get(`${API}/settings`).then(r => setS(prev => ({ ...prev, ...r.data }))); const k = loadKeys(); setSb(k.scrapingbee_key); setSa(k.scraperapi_key); setMethod(k.method); }, []);

  // Stay in sync with the header ThemeToggle — when it fires `themechange`
  // we mirror the value into local state so the "Active" chip reflects the
  // current theme even if the user toggled from the top bar.
  useEffect(() => {
    const on = (e) => setS(prev => ({ ...prev, theme: e?.detail?.theme || prev.theme }));
    window.addEventListener("themechange", on);
    return () => window.removeEventListener("themechange", on);
  }, []);

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

      <AccountsCard/>

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


/* -------------------------- Admin accounts card ---------------------------
 *
 * Lists every Admin/Manager account, lets the main admin create / edit /
 * delete additional accounts, and provides a "Sign in as this account"
 * action so we can demo the role-scoped sidebar (Managers see Orders /
 * Customers / Products only). The main admin is flagged with a badge and
 * has no Delete button.
 * ------------------------------------------------------------------------- */
export function AccountsCard() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);   // account object or {} for new
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(loadAdminSession());

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/admin-accounts`);
    setRows(data.accounts || []);
    // On first load, default the session to the main admin if nothing set.
    if (!loadAdminSession().id) {
      const main = (data.accounts || []).find(a => a.is_main);
      if (main) { saveAdminSession(main); setSession(loadAdminSession()); }
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const signInAs = (a) => {
    saveAdminSession(a);
    setSession(loadAdminSession());
    toast.success(`Signed in as ${a.name} (${a.role})`);
  };

  const save = async () => {
    if (!editing) return;
    const name = (editing.name || "").trim();
    const email = (editing.email || "").trim().toLowerCase();
    const role = editing.role || "manager";
    const password = editing.password || "";
    if (!name) return toast.error("Name is required");
    if (!email) return toast.error("Email is required");
    if (!editing.id && password.length < 8) return toast.error("Password must be at least 8 characters");
    if (editing.id && password && password.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy(true);
    try {
      if (editing.id) {
        const body = { name, email, role };
        if (password) body.password = password;
        await axios.patch(`${API}/admin-accounts/${editing.id}`, body);
        toast.success("Account updated");
      } else {
        await axios.post(`${API}/admin-accounts`, { name, email, role, password });
        toast.success("Account created");
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail?.slice(0, 200) || e.message });
    } finally { setBusy(false); }
  };

  const del = async (a) => {
    if (!window.confirm(`Delete "${a.name}"? They'll lose dashboard access immediately.`)) return;
    try {
      await axios.delete(`${API}/admin-accounts/${a.id}`);
      // If we deleted the currently-signed-in account, fall back to main admin.
      if (session.id === a.id) {
        const main = rows.find(r => r.is_main);
        if (main) { saveAdminSession(main); setSession(loadAdminSession()); }
      }
      toast.success("Deleted");
      await load();
    } catch (e) {
      toast.error("Delete failed", { description: e?.response?.data?.detail?.slice(0, 200) || e.message });
    }
  };

  const emptyDraft = { name: "", email: "", role: "manager", password: "" };
  const roleChip = (r) => r === "admin" ? "chip-primary" : "chip-neutral";

  return (
    <div className="card p-6" data-testid="accounts-card">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="font-display font-bold text-lg mb-1 flex items-center gap-2"><ShieldCheck size={18} className="text-indigo-600"/> Accounts</div>
          <div className="text-xs text-slate-500 max-w-lg">Create Admins and Managers. <span className="font-mono">Admin</span> has full access. <span className="font-mono">Manager</span> only sees Orders, Customers, and Products — no Store Management, Payments, or Admin Settings.</div>
        </div>
        <button onClick={() => setEditing(emptyDraft)} className="btn btn-primary text-sm" data-testid="account-add-btn"><UserPlus size={14}/> Add account</button>
      </div>

      <div className="overflow-hidden rounded-lg border hairline">
        <table className="tbl">
          <thead><tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Session</th>
            <th className="text-right">Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-slate-500">Loading…</td></tr>}
            {rows.map(a => {
              const isCurrent = session.id === a.id;
              return (
                <tr key={a.id} data-testid={`account-row-${a.id}`}>
                  <td className="font-medium">
                    <div className="flex items-center gap-2">
                      {a.name}
                      {a.is_main && <span className="chip chip-success font-mono text-[10px]">Main</span>}
                    </div>
                  </td>
                  <td className="text-slate-600 font-mono text-xs">{a.email}</td>
                  <td><span className={`chip ${roleChip(a.role)} font-mono text-[10px]`}>{a.role}</span></td>
                  <td>
                    {isCurrent
                      ? <span className="chip chip-primary font-mono text-[10px] flex items-center gap-1 w-max"><BadgeCheck size={11}/> Signed in</span>
                      : <button onClick={() => signInAs(a)} className="btn btn-ghost text-xs !py-1 !px-2" data-testid={`account-signin-${a.id}`}><LogIn size={11}/> Sign in as</button>}
                  </td>
                  <td>
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => setEditing({ ...a, password: "" })} className="btn btn-ghost text-xs !py-1 !px-2" data-testid={`account-edit-${a.id}`}><Pencil size={11}/> Edit</button>
                      {a.is_main
                        ? <span className="chip chip-neutral text-[10px] font-mono">Protected</span>
                        : <button onClick={() => del(a)} className="btn btn-danger text-xs !py-1 !px-2" data-testid={`account-del-${a.id}`}><Trash2 size={11}/></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="card max-w-md mx-auto my-10 p-6" data-testid="account-modal">
            <div className="flex items-center justify-between mb-5">
              <div className="font-display font-bold text-xl flex items-center gap-2"><ShieldCheck size={18} className="text-indigo-600"/> {editing.id ? "Edit account" : "New account"}</div>
              <button onClick={() => setEditing(null)} className="btn btn-ghost !p-2"><X size={16}/></button>
            </div>
            <div className="grid gap-3">
              <Field label="Full name">
                <input className="input px-3 py-2 w-full" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Jane Manager" data-testid="account-name"/>
              </Field>
              <Field label="Email">
                <input type="email" className="input px-3 py-2 w-full font-mono" value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="jane@example.com" data-testid="account-email"/>
              </Field>
              <Field label={editing.id ? "New password (leave blank to keep)" : "Password (min 8 characters)"}>
                <input type="password" className="input px-3 py-2 w-full font-mono" value={editing.password || ""} onChange={(e) => setEditing({ ...editing, password: e.target.value })} placeholder={editing.id ? "••••••••" : "at least 8 characters"} data-testid="account-password"/>
              </Field>
              <Field label="Role">
                <select className="input px-3 py-2 w-full" value={editing.role || "manager"} onChange={(e) => setEditing({ ...editing, role: e.target.value })} disabled={editing.is_main} data-testid="account-role">
                  {ADMIN_ROLES.map(r => <option key={r} value={r}>{r === "admin" ? "Admin — full access" : "Manager — Orders, Customers, Products"}</option>)}
                </select>
                {editing.is_main && <div className="text-[11px] text-slate-500 mt-1">The main admin role is locked to Admin.</div>}
              </Field>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setEditing(null)} className="btn btn-ghost">Cancel</button>
              <button onClick={save} disabled={busy} className="btn btn-primary" data-testid="account-save-btn"><Plus size={14}/> {editing.id ? "Save changes" : "Create account"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Item modal ------------------------------ */
