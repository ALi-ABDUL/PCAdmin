import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Database, Download, LayoutGrid, LogIn, Moon, Palette, Pencil, Plus, RotateCcw, ShieldCheck, Sun, Trash2, Upload, UserPlus, X } from "lucide-react";
import { Field } from "../components/atoms";
import { API, KEYS, loadKeys } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { ADMIN_ROLES, loadAdminSession, saveAdminSession } from "../lib/adminSession";
import { DASHBOARD_WIDGETS, loadDashboardLayout, resetDashboardLayout, saveDashboardLayout } from "../lib/dashboardLayout";

const TABS = [
  { id: "theme",     label: "Theme",            icon: Palette },
  { id: "accounts",  label: "Accounts",         icon: ShieldCheck },
  { id: "layout",    label: "Dashboard Layout", icon: LayoutGrid },
  { id: "cache",     label: "Cache",            icon: RotateCcw },
  { id: "backup",    label: "Backup",           icon: Database },
];

const TAB_STORAGE = "settings_active_tab";

export function SettingsPage() {
  // Persist the active tab so returning to Settings lands the admin
  // where they left off. Small quality-of-life win when hopping between
  // Accounts + Backup during onboarding.
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem(TAB_STORAGE) || "theme"; } catch { return "theme"; }
  });
  const pickTab = (id) => {
    setActiveTab(id);
    try { localStorage.setItem(TAB_STORAGE, id); } catch { /* ignore */ }
  };

  return (
    <div className="grid gap-6 max-w-5xl" data-testid="settings-page">
      <div className="card p-2 sticky top-16 z-10 flex flex-wrap gap-1 backdrop-blur-md" data-testid="settings-tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => pickTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${active ? "bg-indigo-50 text-indigo-700 shadow-inner" : "text-slate-500 hover:bg-slate-50"}`}
              data-testid={`settings-tab-${t.id}`}
              aria-pressed={active}
            >
              <Icon size={14}/>
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "theme"    && <ThemeCard/>}
      {activeTab === "accounts" && <AccountsCard/>}
      {activeTab === "layout"   && <DashboardLayoutCard/>}
      {activeTab === "cache"    && <CacheCard/>}
      {activeTab === "backup"   && <BackupCard/>}
    </div>
  );
}


/* --------------------------------- Theme --------------------------------- */
export function ThemeCard() {
  const [s, setS] = useState({ theme: "light" });
  const [themeSaving, setThemeSaving] = useState(false);

  useEffect(() => { axios.get(`${API}/settings`).then(r => setS(prev => ({ ...prev, ...r.data }))); }, []);
  useEffect(() => {
    const on = (e) => setS(prev => ({ ...prev, theme: e?.detail?.theme || prev.theme }));
    window.addEventListener("themechange", on);
    return () => window.removeEventListener("themechange", on);
  }, []);

  const pickTheme = async (next) => {
    if (next === s.theme) return;
    applyTheme(next);
    const merged = { ...s, theme: next };
    setS(merged);
    setThemeSaving(true);
    try {
      const cur = (await axios.get(`${API}/settings`)).data || {};
      await axios.put(`${API}/settings`, { ...cur, theme: next });
      toast.success(`${next === "dark" ? "Dark" : "Light"} theme saved`);
    } catch { toast.error("Couldn't save theme"); }
    finally { setThemeSaving(false); }
  };

  return (
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
                <div className="w-8 h-8 grid place-items-center rounded-lg" style={{ background: opt.swatch[1], color: opt.swatch[2], boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }}>
                  <Icon size={15}/>
                </div>
                <div className="font-display font-bold text-sm">{opt.label}</div>
                {active && <span className="chip chip-primary text-[10px] font-mono ml-auto">Active</span>}
              </div>
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
  );
}


/* ---------------------------- Dashboard Layout --------------------------- */
export function DashboardLayoutCard() {
  const [layout, setLayout] = useState(loadDashboardLayout());
  const toggle = (id) => {
    const next = { ...layout, [id]: !layout[id] };
    setLayout(next);
    saveDashboardLayout(next);
  };
  const reset = () => {
    resetDashboardLayout();
    setLayout(loadDashboardLayout());
    toast.success("Dashboard layout reset");
  };
  const shown = DASHBOARD_WIDGETS.filter(w => layout[w.id]).length;
  return (
    <div className="card p-6" data-testid="layout-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-display font-bold text-lg mb-1 flex items-center gap-2"><LayoutGrid size={18} className="text-indigo-600"/> Dashboard Layout</div>
          <div className="text-xs text-slate-500 max-w-lg">Hide or show individual widgets on the Dashboard. Changes apply instantly and stay with this browser.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="chip chip-neutral font-mono text-[10px]">{shown} / {DASHBOARD_WIDGETS.length} visible</span>
          <button onClick={reset} className="btn btn-ghost text-sm" data-testid="layout-reset-btn"><RotateCcw size={13}/> Reset</button>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        {DASHBOARD_WIDGETS.map(w => {
          const on = !!layout[w.id];
          return (
            <label key={w.id} className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${on ? "border-indigo-500 bg-indigo-50/40" : "border-slate-200 hover:border-slate-300"}`} data-testid={`layout-toggle-${w.id}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(w.id)} className="accent-indigo-600 mt-1 w-4 h-4"/>
              <div className="flex-1">
                <div className="text-sm font-medium">{w.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{w.hint}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}


/* ---------------------------------- Cache -------------------------------- */
export function CacheCard() {
  const [busy, setBusy] = useState(null);

  // Everything we let the admin nuke from the browser. Keys are namespaces
  // rather than exact keys because Pagination/sort prefs use dynamic keys.
  const CACHE_GROUPS = [
    { id: "prefs",   label: "UI preferences",       hint: "Pagination sizes, column sort orders, dashboard layout, settings tab.", prefixes: ["page_size_", "sort_", "dashboard_", "settings_active_tab"] },
    { id: "scraper", label: "Scraper API keys",     hint: "ScrapingBee / ScraperAPI keys stored in this browser.", prefixes: [KEYS.sb, KEYS.sa, KEYS.method] },
    { id: "session", label: "Admin session",        hint: "Signs you out of the current admin/manager profile. Main admin restores on next load.", prefixes: ["admin_current_id", "admin_current_role"] },
    { id: "all",     label: "Everything (nuclear)", hint: "Wipes every key in localStorage for this browser. Theme falls back to Light.", prefixes: ["*"] },
  ];

  const clearGroup = async (g) => {
    if (!window.confirm(`Clear "${g.label}"? This only affects this browser.`)) return;
    setBusy(g.id);
    try {
      if (g.prefixes.includes("*")) {
        localStorage.clear();
      } else {
        const remove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (g.prefixes.some(p => key === p || key.startsWith(p))) remove.push(key);
        }
        remove.forEach(k => localStorage.removeItem(k));
      }
      toast.success(`${g.label} cleared`);
      // Fire the events so subscribers (theme, admin session, layout) resync.
      window.dispatchEvent(new CustomEvent("adminsessionchange", { detail: loadAdminSession() }));
      window.dispatchEvent(new CustomEvent("dashboardlayoutchange", { detail: loadDashboardLayout() }));
    } catch (e) { toast.error("Clear failed", { description: e.message }); }
    finally { setBusy(null); }
  };

  return (
    <div className="card p-6" data-testid="cache-card">
      <div className="font-display font-bold text-lg mb-1 flex items-center gap-2"><RotateCcw size={18} className="text-indigo-600"/> Cache</div>
      <div className="text-xs text-slate-500 mb-4 max-w-lg">Local browser storage the admin dashboard writes to. Clearing these buckets only affects this browser — server data is never touched.</div>
      <div className="grid gap-3">
        {CACHE_GROUPS.map(g => (
          <div key={g.id} className="flex items-start gap-4 p-4 rounded-lg border hairline" data-testid={`cache-group-${g.id}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{g.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{g.hint}</div>
            </div>
            <button
              onClick={() => clearGroup(g)}
              disabled={busy === g.id}
              className={`btn ${g.id === "all" ? "btn-danger" : "btn-ghost"} text-sm shrink-0`}
              data-testid={`cache-clear-${g.id}`}
            >
              <Trash2 size={13}/> Clear
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}


/* --------------------------------- Backup -------------------------------- */
export function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [lastPreview, setLastPreview] = useState(null);

  const downloadBackup = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/backup/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `admin-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setLastPreview(data.counts);
      toast.success("Backup downloaded");
    } catch (e) { toast.error("Export failed", { description: e?.response?.data?.detail || e.message }); }
    finally { setBusy(false); }
  };

  const restoreBackup = async (evt) => {
    const file = evt.target.files?.[0];
    evt.target.value = ""; // allow same file to be picked again later
    if (!file) return;
    if (!window.confirm(`Restore from "${file.name}"?\n\nThis WIPES the current data for every collection in the backup and cannot be undone.`)) return;
    setBusy(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const { data } = await axios.post(`${API}/backup/import`, payload);
      setLastPreview(data.restored);
      toast.success(`Restored ${Object.keys(data.restored || {}).length} collections`);
    } catch (e) {
      toast.error("Restore failed", { description: e?.response?.data?.detail?.slice(0, 200) || (e.message || "Bad JSON") });
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-6" data-testid="backup-card">
      <div className="font-display font-bold text-lg mb-1 flex items-center gap-2"><Database size={18} className="text-indigo-600"/> Backup</div>
      <div className="text-xs text-slate-500 mb-4 max-w-lg">Download a JSON snapshot of every collection (products, orders, customers, categories, suppliers, reviews, messages, settings, presets, delivery config, coupons, notifications) or restore one you saved earlier.</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button onClick={downloadBackup} disabled={busy} className="flex items-center justify-center gap-2 rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-6 hover:border-indigo-400 transition-all" data-testid="backup-export-btn">
          <Download size={22} className="text-indigo-600"/>
          <div className="text-left">
            <div className="font-display font-bold text-sm">Download backup</div>
            <div className="text-xs text-slate-500">Saves an <span className="font-mono">admin-backup-YYYY-MM-DD.json</span> file.</div>
          </div>
        </button>

        <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-slate-200 p-6 hover:border-amber-300 cursor-pointer transition-all" data-testid="backup-import-label">
          <Upload size={22} className="text-amber-600"/>
          <div className="text-left">
            <div className="font-display font-bold text-sm">Restore from file</div>
            <div className="text-xs text-slate-500">Wipes current data — this is destructive.</div>
          </div>
          <input type="file" accept="application/json,.json" className="hidden" onChange={restoreBackup} disabled={busy} data-testid="backup-import-input"/>
        </label>
      </div>

      {lastPreview && (
        <div className="mt-4 p-3 rounded-lg border hairline bg-slate-50/60" data-testid="backup-last-preview">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Last operation</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(lastPreview).map(([name, count]) => (
              <span key={name} className="chip chip-neutral font-mono text-[10px]">{name}: {count}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50/60 text-xs text-amber-800 flex items-start gap-2">
        <AlertTriangle size={13} className="mt-0.5 shrink-0"/>
        Admin passwords are intentionally excluded from backup files. Restore is all-or-nothing and cannot be reversed — download a fresh backup first.
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
  const mainAcct = rows.find(a => a.is_main);
  const isMainActive = mainAcct ? session.id === mainAcct.id : true;

  return (
    <div className="card p-6" data-testid="accounts-card">
      {/* Quick-switch banner — shows only when the active session isn't the
          main admin AND has admin role. Managers cannot switch back to the
          main admin (they can't reach this screen anyway, but the check
          documents intent). */}
      {mainAcct && !isMainActive && session.role === "admin" && (
        <div
          className="mb-5 flex items-center justify-between gap-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50/60 flex-wrap"
          data-testid="accounts-switch-banner"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 grid place-items-center shrink-0"><ShieldCheck size={16}/></div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800">You're signed in as <span className="font-mono">{session.role}</span></div>
              <div className="text-xs text-slate-500 truncate">Switch back to <span className="font-mono">{mainAcct.email}</span> to regain full access.</div>
            </div>
          </div>
          <button
            onClick={() => signInAs(mainAcct)}
            className="btn btn-primary text-sm shrink-0"
            data-testid="switch-to-main-admin-btn"
          >
            <LogIn size={14}/> Switch to main admin
          </button>
        </div>
      )}

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
