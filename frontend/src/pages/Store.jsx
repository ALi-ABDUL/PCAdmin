import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Ban, Bell, Calculator, Clock as ClockIcon, ExternalLink, Eye, EyeOff, HelpCircle, History, Loader2, Plus, RefreshCw, Store, Trash2, X, XCircle, Zap } from "lucide-react";
import { Field } from "../components/atoms";
import { API } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { STORE_NAV } from "../lib/nav";
import { calcPricingWithRules, usePricingRules, _refreshPricingRules } from "../lib/pricing";
import { Analytics } from "./Analytics";
import { Dashboard } from "./Dashboard";

export function PricingRulesEditor() {
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null); // rule object or {} for new
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await _refreshPricingRules();
    setRules(rows);
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

export function PushNotificationSettings() {
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
      {/* ============= ADMIN NOTIFICATIONS ============= */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="font-display font-bold text-lg" data-testid="admin-notif-heading">Admin Notifications</div>
          <div className="text-xs text-slate-500">Internal alerts pushed to <em>you</em> — new orders, failed scrapes, low-stock, etc.</div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {/* Email channel */}
        <div className={`card p-5 ${emailOk ? "" : "border-dashed"}`} data-testid="push-email">
          <ChannelHeader name="Email · Resend" configured={emailOk} enabled={settings.email_enabled} onToggle={(v) => update({ email_enabled: v })}/>
          <div className="grid gap-3 mt-4">
            <CredField
              label="Resend API key"
              testId="fld-resend-key"
              type="password"
              placeholder={settings.resend_api_key_set ? `Saved · ${settings.resend_api_key_masked}` : "re_..."}
              value={draft.resend_api_key ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, resend_api_key: v }))}
              savedBadge={settings.resend_api_key_set}
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
              placeholder={settings.telegram_bot_token_set ? `Saved · ${settings.telegram_bot_token_masked}` : "123456:ABC-..."}
              value={draft.telegram_bot_token ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, telegram_bot_token: v }))}
              savedBadge={settings.telegram_bot_token_set}
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
        Credentials are stored in the database and read live on every send — no restart or <code className="chip chip-neutral">.env</code> edit needed. Secrets are masked when read back (only the last few characters are visible). Missing keys are silently skipped, so dashboard notifications keep working either way.
      </div>

      {/* ============= CUSTOMER NOTIFICATIONS ============= */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap mt-4 pt-4 border-t hairline">
        <div>
          <div className="font-display font-bold text-lg" data-testid="customer-notif-heading">Customer Notifications</div>
          <div className="text-xs text-slate-500">Transactional emails sent to <em>customers</em>. Uses the Resend API key configured above.</div>
        </div>
      </div>

      <div className="card p-5" data-testid="customer-notif-card">
        <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer border-b hairline pb-4 mb-1" data-testid="customer-master-toggle">
          <input type="checkbox" checked={!!settings.customer_email_enabled} onChange={(e) => update({ customer_email_enabled: e.target.checked })} className="accent-indigo-600 mt-1 w-4 h-4"/>
          <div className="flex-1">
            <div className="text-sm font-medium">Send customer emails</div>
            <div className="text-xs text-slate-500">
              Master switch. When OFF, none of the emails below are sent to customers — regardless of the individual toggles.
            </div>
          </div>
        </label>

        <div className={`grid gap-1 mt-2 ${settings.customer_email_enabled ? "" : "opacity-50 pointer-events-none"}`}>
          <CustomerEmailToggle
            testId="toggle-order-confirmation"
            title="Order confirmation email"
            desc="Sent to the customer immediately after they place an order."
            checked={!!settings.customer_order_confirmation}
            onChange={(v) => update({ customer_order_confirmation: v })}
          />
          <CustomerEmailToggle
            testId="toggle-order-status-update"
            title="Order status update email"
            desc="Sent when an order moves to Processing, Shipped, or Delivered."
            checked={!!settings.customer_order_status_update}
            onChange={(v) => update({ customer_order_status_update: v })}
          />
          <CustomerEmailToggle
            testId="toggle-order-cancellation"
            title="Order cancellation confirmation email"
            desc="Sent when an order is cancelled, with a note about the refund."
            checked={!!settings.customer_order_cancellation}
            onChange={(v) => update({ customer_order_cancellation: v })}
          />
          <CustomerEmailToggle
            testId="toggle-welcome"
            title="Welcome email on new registration"
            desc="Sent when a customer creates an account in the portal."
            checked={!!settings.customer_welcome_email}
            onChange={(v) => update({ customer_welcome_email: v })}
          />
        </div>
      </div>
    </div>
  );
}

function CustomerEmailToggle({ testId, title, desc, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer" data-testid={testId}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-600 mt-1 w-4 h-4"/>
      <div className="flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-slate-500">{desc}</div>
      </div>
      <span className={`chip ${checked ? "chip-success" : "chip-neutral"} font-mono text-[10px] shrink-0`}>{checked ? "ON" : "OFF"}</span>
    </label>
  );
}

export function ChannelHeader({ name, configured, enabled, onToggle }) {
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

export function CredField({ label, testId, type = "text", placeholder, value, onChange, savedBadge, onClear }) {
  const [reveal, setReveal] = useState(false);
  const isSecret = type === "password";
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</span>
        {savedBadge && <span className="chip chip-success !py-0 !px-1.5 text-[9px] font-mono"><BadgeCheck size={9}/> saved</span>}
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

export function ScraperScheduleEditor() {
  const RUN_HISTORY_LIMIT_UI = 20;
  const [sched, setSched] = useState(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/scraper/schedule`);
    setSched(data);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (!sched) return <div className="text-slate-500 py-24 text-center">loading…</div>;

  const patch = async (fields) => {
    setBusy(true);
    setSched((s) => ({ ...s, ...fields })); // optimistic
    try { const { data } = await axios.patch(`${API}/scraper/schedule`, fields); setSched(data); }
    catch (e) { toast.error("Save failed"); await load(); }
    finally { setBusy(false); }
  };

  const runNow = async () => {
    if (!window.confirm("Trigger a full re-fetch now? This may take several minutes for all items.")) return;
    setRunning(true);
    toast.loading("Running full refresh…", { id: "sched-run" });
    try {
      const { data } = await axios.post(`${API}/scraper/schedule/run-now`, {}, { timeout: 30 * 60 * 1000 });
      setSched(data.schedule);
      const s = data.summary || {};
      toast.success(`Refresh done · ${s.refreshed || 0}/${s.total || 0} refreshed · ${s.sold_found || 0} sold`, { id: "sched-run" });
    } catch (e) {
      toast.error("Refresh failed", { id: "sched-run", description: e?.response?.data?.detail?.slice(0, 200) || e.message });
    } finally { setRunning(false); }
  };

  const stopPassed = sched.stop_date ? new Date(sched.stop_date) <= new Date() : false;
  const disabledByStop = sched.enabled && stopPassed;
  const history = Array.isArray(sched.run_history) ? sched.run_history : [];
  const retryPending = sched.retry_pending && sched.retry_pending.retry_at ? sched.retry_pending : null;

  const clearHistory = async () => {
    if (!window.confirm("Clear the scraper run history log?")) return;
    try {
      const { data } = await axios.post(`${API}/scraper/schedule/clear-history`, {});
      setSched(data);
      toast.success("Run history cleared");
    } catch (e) { toast.error("Could not clear history"); }
  };

  const fmtDuration = (s) => {
    const n = Number(s) || 0;
    if (n < 60) return `${n.toFixed(1)}s`;
    const m = Math.floor(n / 60); const rem = Math.round(n - m * 60);
    return `${m}m ${rem}s`;
  };
  const statusChip = (status) => {
    if (status === "success") return <span className="chip chip-success"><BadgeCheck size={11}/> Success</span>;
    if (status === "failed")  return <span className="chip" style={{background:"#fef3c7",color:"#92400e"}}><AlertTriangle size={11}/> Failed · retry queued</span>;
    if (status === "dead")    return <span className="chip" style={{background:"#fee2e2",color:"#991b1b"}}><XCircle size={11}/> Dead · gave up</span>;
    return <span className="chip chip-neutral">{status || "—"}</span>;
  };
  const triggerLabel = (t) => t === "manual" ? "Manual" : t === "retry" ? "Retry" : "Scheduled";

  return (
    <div className="grid gap-4" data-testid="scraper-schedule">
      {/* Status strip */}
      <div className="card p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 flex items-center gap-1"><ClockIcon size={11}/> Status</div>
            <div className="mt-1 flex items-center gap-2">
              {sched.enabled && !disabledByStop
                ? <span className="chip chip-success"><BadgeCheck size={11}/> Active</span>
                : <span className="chip chip-neutral"><Ban size={11}/> {disabledByStop ? "Stopped (past stop date)" : "Disabled"}</span>}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Last run</div>
            <div className="mt-1 text-sm font-mono text-slate-800" data-testid="sched-last">
              {sched.last_run_at ? fmtDate(sched.last_run_at) : "—"}
              {sched.last_run_stats && (
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {sched.last_run_stats.refreshed}/{sched.last_run_stats.total} refreshed · {sched.last_run_stats.sold_found} sold
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Next run</div>
            <div className="mt-1 text-sm font-mono text-indigo-600 font-bold" data-testid="sched-next">
              {sched.next_run_at ? fmtDate(sched.next_run_at) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="font-display font-bold text-base">Schedule configuration</div>
            <div className="text-xs text-slate-500">Times use Australia/Sydney (AEST) for the start-time anchor.</div>
          </div>
          <button onClick={runNow} disabled={running} className="btn btn-primary text-sm" data-testid="sched-run-now">
            {running ? <Loader2 className="animate-spin" size={14}/> : <Zap size={14}/>} Run now
          </button>
        </div>

        <label className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 mb-3 cursor-pointer" data-testid="sched-enabled">
          <div className="flex-1">
            <div className="text-sm font-medium">Enable auto-refresh</div>
            <div className="text-xs text-slate-500">When off, the scraper only runs when you click <span className="font-mono">Run now</span> or <span className="font-mono">Refresh all now</span>.</div>
          </div>
          <input type="checkbox" checked={sched.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="accent-indigo-600 w-5 h-5"/>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Start time (AEST)">
            <input
              data-testid="sched-start"
              type="time"
              value={sched.start_time_hhmm}
              onChange={(e) => patch({ start_time_hhmm: e.target.value })}
              className="input px-3 py-2 w-full font-mono text-sm"
            />
          </Field>
          <Field label="Frequency">
            <select
              data-testid="sched-frequency"
              value={sched.frequency}
              onChange={(e) => patch({ frequency: e.target.value })}
              className="input px-3 py-2 w-full text-sm"
            >
              <option value="hourly">Every hour</option>
              <option value="every_6h">Every 6 hours</option>
              <option value="every_12h">Every 12 hours</option>
              <option value="daily">Once daily</option>
              <option value="weekly">Once weekly</option>
            </select>
          </Field>
          <Field label="Stop date (optional)">
            <div className="relative">
              <input
                data-testid="sched-stop"
                type="date"
                value={sched.stop_date || ""}
                onChange={(e) => patch({ stop_date: e.target.value })}
                className="input px-3 py-2 w-full font-mono text-sm pr-8"
              />
              {sched.stop_date && (
                <button
                  type="button"
                  onClick={() => patch({ stop_date: "" })}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-600 p-1"
                  title="Clear stop date"
                >
                  <X size={12}/>
                </button>
              )}
            </div>
          </Field>
        </div>

        {disabledByStop && (
          <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
            <AlertTriangle size={13}/> Stop date has passed — the schedule is paused. Clear the stop date to resume.
          </div>
        )}
        {busy && <div className="mt-2 text-[11px] text-slate-400 font-mono">saving…</div>}
      </div>

      {/* Retry pending banner */}
      {retryPending && (
        <div className="card p-4 border border-amber-200 bg-amber-50" data-testid="sched-retry-pending">
          <div className="flex items-center gap-3">
            <RefreshCw size={16} className="text-amber-700 animate-spin"/>
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900">Retry queued</div>
              <div className="text-xs text-amber-800">
                Last run failed. Auto-retry will fire at{" "}
                <span className="font-mono">{fmtDate(retryPending.retry_at)}</span>
                {" "}(15 minutes after the original attempt). If it fails again the run is marked <span className="font-mono">dead</span>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Run history */}
      <div className="card p-5" data-testid="sched-history">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="font-display font-bold text-base flex items-center gap-2"><History size={16}/> Run history</div>
            <div className="text-xs text-slate-500">Last {RUN_HISTORY_LIMIT_UI} refresh runs — scheduled, manual, and retries.</div>
          </div>
          {history.length > 0 && (
            <button onClick={clearHistory} className="btn btn-ghost text-xs" data-testid="sched-history-clear">
              <Trash2 size={12}/> Clear history
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="text-slate-500 text-sm py-10 text-center border border-dashed rounded-lg">
            No runs recorded yet. Click <span className="font-mono">Run now</span> or wait for the next scheduled run.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="sched-history-table">
              <thead>
                <tr className="text-left text-[10px] font-mono uppercase tracking-widest text-slate-500 border-b">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Trigger</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Duration</th>
                  <th className="py-2 pr-3">Refreshed</th>
                  <th className="py-2 pr-3">Sold</th>
                  <th className="py-2 pr-3">Failed</th>
                  <th className="py-2 pr-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => {
                  const s = r.stats || {};
                  return (
                    <tr key={r.id + "-" + r.attempt} className="border-b last:border-b-0 hover:bg-slate-50" data-testid={`sched-history-row-${r.id}`}>
                      <td className="py-2 pr-3 font-mono text-xs text-slate-700 whitespace-nowrap">{fmtDate(r.started_at)}</td>
                      <td className="py-2 pr-3">
                        <span className="chip chip-neutral">{triggerLabel(r.trigger)}{r.attempt > 1 ? ` · #${r.attempt}` : ""}</span>
                      </td>
                      <td className="py-2 pr-3">{statusChip(r.status)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{fmtDuration(r.duration_seconds)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{s.refreshed ?? 0}<span className="text-slate-400">/{s.total ?? 0}</span></td>
                      <td className="py-2 pr-3 font-mono text-xs text-emerald-700">{s.sold_found ?? 0}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-rose-700">{s.failed ?? 0}</td>
                      <td className="py-2 pr-3 text-xs text-slate-500 max-w-[280px] truncate" title={r.error || ""}>
                        {r.error ? r.error : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function StoreManagement({ section, setSection }) {
  const meta = STORE_NAV.find((s) => s.id === section) || STORE_NAV[0];
  const Icon = meta.icon;

  const sections = {
    "store-settings":      { hint: "Store name, brand, contact details, business hours and legal info.", fields: ["Store name","Legal business name","ABN","Contact email","Support phone","Business hours"] },
    "pricing-rules":       { hint: "Tiered profit rules the scraper uses when calculating sell prices for imported items.", fields: [], custom: <PricingRulesEditor/> },
    "scraper-schedule":    { hint: "Automate the eBay re-fetch: set a start time, frequency, optional stop date, or run one right now.", fields: [], custom: <ScraperScheduleEditor/> },
    "payment-gateway":     { hint: "Enable/disable payment providers and configure their credentials.", fields: ["Stripe","PayPal","Apple Pay","Google Pay","Afterpay","Zip Pay","Bank transfer","Cash on delivery"] },
    "shipping-methods":    { hint: "Zones, carriers, rates and free-shipping thresholds.", fields: ["Australia Post — Parcel Post","Australia Post — Express","Sendle","Aramex","Local delivery","Click & collect","Free shipping threshold"] },
    "tax-rates":           { hint: "GST and location-based tax rules.", fields: ["Australia — GST 10%","New Zealand — GST 15%","Tax-exempt customer groups","B2B / ABN entries"] },
    "checkout-settings":   { hint: "Fine-tune the buyer journey at checkout.", fields: ["Guest checkout","Require phone","Address auto-complete","Order note field","Marketing opt-in","Terms & conditions box"] },
    "email-notifications": { hint: "Admin alerts + transactional emails sent to customers. Configure the Resend API key and per-channel toggles here.", fields: [], custom: <PushNotificationSettings/> },
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
export function ProfitCalculator() {
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

