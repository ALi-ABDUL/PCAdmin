import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Ban, Bell, Calculator, Calendar, Clock as ClockIcon, ExternalLink, Eye, EyeOff, HelpCircle, History, Link2, Loader2, Mail, MapPin, Menu, Package, Plus, RefreshCw, Store, Trash2, X, XCircle, Zap } from "lucide-react";
import { Field } from "../components/atoms";
import { API } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { computeDeliveryEstimate, formatCutoffLabel } from "../lib/delivery";
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

export function PostagePresetsEditor() {
  const [presets, setPresets] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/postage-presets`);
    setPresets(data.presets || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const kindLabel = (k) => k === "free" ? "Free" : k === "large_item" ? "Large Item" : "Standard";
  const kindChip = (k) => k === "free" ? "chip-success" : k === "large_item" ? "chip-warning" : "chip-primary";

  const save = async () => {
    if (!editing) return;
    const name = (editing.name || "").trim();
    if (!name) return toast.error("Name is required");
    const kind = editing.kind || "standard";
    const postage = kind === "free" ? 0 : (Number(editing.postage_amount) || 0);
    const insurance = kind === "large_item" ? (Number(editing.insurance_amount) || 0) : 0;
    if (postage < 0 || insurance < 0) return toast.error("Amounts must be zero or positive");
    const body = { name, kind, postage_amount: postage, insurance_amount: insurance,
                   active: editing.active !== false, sort_order: Number(editing.sort_order) || 0 };
    setBusy(true);
    try {
      if (editing.id) {
        await axios.patch(`${API}/postage-presets/${editing.id}`, body);
        toast.success("Preset updated");
      } else {
        await axios.post(`${API}/postage-presets`, body);
        toast.success("Preset created");
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail?.slice(0, 200) || e.message });
    } finally { setBusy(false); }
  };

  const del = async (r) => {
    if (!window.confirm(`Delete postage preset "${r.name}"? Products using it will be reset to "Not selected".`)) return;
    try {
      await axios.delete(`${API}/postage-presets/${r.id}`);
      toast.success("Deleted");
      await load();
    } catch (e) {
      toast.error("Delete failed", { description: e?.response?.data?.detail?.slice(0, 200) || e.message });
    }
  };

  const toggleActive = async (r) => {
    await axios.patch(`${API}/postage-presets/${r.id}`, { active: !r.active });
    await load();
  };

  const emptyPreset = { name: "", kind: "standard", postage_amount: "", insurance_amount: "", active: true, sort_order: (presets.length + 1) * 10 };

  const fmtMoney = (n) => `$${(Number(n) || 0).toFixed(2)}`;

  return (
    <div className="grid gap-4" data-testid="postage-presets-editor">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-500">
          Presets appear as a dropdown on every product. <span className="font-mono">Large Item</span> presets carry an extra insurance amount.
        </div>
        <button onClick={() => setEditing(emptyPreset)} className="btn btn-primary text-sm" data-testid="pp-add-btn"><Plus size={14}/> Add preset</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <th className="w-16">Order</th>
              <th>Name</th>
              <th>Type</th>
              <th className="text-right">Postage</th>
              <th className="text-right">Insurance</th>
              <th>Status</th>
              <th></th>
            </tr></thead>
            <tbody>
              {presets.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-500">No postage presets yet — add your first one.</td></tr>}
              {presets.map((r) => (
                <tr key={r.id} data-testid={`pp-row-${r.id}`} className={r.active ? "" : "opacity-50"}>
                  <td className="font-mono text-slate-500">{r.sort_order}</td>
                  <td className="text-sm font-medium">{r.name}</td>
                  <td><span className={`chip ${kindChip(r.kind)} font-mono text-[10px]`}>{kindLabel(r.kind)}</span></td>
                  <td className="text-right font-mono text-sm">{r.kind === "free" ? "—" : fmtMoney(r.postage_amount)}</td>
                  <td className="text-right font-mono text-sm">{r.kind === "large_item" ? fmtMoney(r.insurance_amount) : "—"}</td>
                  <td>
                    <label className="flex items-center gap-1.5 text-[11px] font-mono uppercase text-slate-500 cursor-pointer">
                      <input type="checkbox" checked={r.active} onChange={() => toggleActive(r)} className="accent-indigo-600 w-3.5 h-3.5"/>
                      {r.active ? "Active" : "Off"}
                    </label>
                  </td>
                  <td>
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => setEditing(r)} className="btn btn-ghost text-xs !py-1 !px-2" data-testid={`pp-edit-btn-${r.id}`}>Edit</button>
                      <button onClick={() => del(r)} className="btn btn-danger text-xs !py-1 !px-2" data-testid={`pp-del-btn-${r.id}`}><Trash2 size={12}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="card max-w-lg mx-auto my-10 p-6" data-testid="pp-modal">
            <div className="flex items-center justify-between mb-5">
              <div className="font-display font-bold text-xl">{editing.id ? "Edit preset" : "New preset"}</div>
              <button onClick={() => setEditing(null)} className="btn btn-ghost !p-2"><X size={16}/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" className="col-span-2">
                <input className="input px-3 py-2 w-full" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Express Post" data-testid="pp-name"/>
              </Field>
              <Field label="Type" className="col-span-2">
                <select className="input px-3 py-2 w-full" value={editing.kind || "standard"} onChange={(e) => setEditing({ ...editing, kind: e.target.value })} data-testid="pp-kind">
                  <option value="free">Free Postage (always $0)</option>
                  <option value="standard">Standard Postage (fixed amount)</option>
                  <option value="large_item">Large Item (postage + insurance)</option>
                </select>
              </Field>
              {editing.kind !== "free" && (
                <Field label="Postage amount (AUD)">
                  <input type="number" min="0" step="0.01" className="input px-3 py-2 w-full font-mono" value={editing.postage_amount} onChange={(e) => setEditing({ ...editing, postage_amount: e.target.value })} data-testid="pp-postage-amount"/>
                </Field>
              )}
              {editing.kind === "large_item" && (
                <Field label="Insurance amount (AUD)">
                  <input type="number" min="0" step="0.01" className="input px-3 py-2 w-full font-mono" value={editing.insurance_amount} onChange={(e) => setEditing({ ...editing, insurance_amount: e.target.value })} data-testid="pp-insurance-amount"/>
                </Field>
              )}
              <Field label="Sort order (lower first)">
                <input type="number" className="input px-3 py-2 w-full font-mono" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })} data-testid="pp-sort-order"/>
              </Field>
              <Field label="Active">
                <select className="input px-3 py-2 w-full" value={editing.active !== false ? "1" : "0"} onChange={(e) => setEditing({ ...editing, active: e.target.value === "1" })} data-testid="pp-active">
                  <option value="1">Yes</option><option value="0">No</option>
                </select>
              </Field>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setEditing(null)} className="btn btn-ghost">Cancel</button>
              <button onClick={save} disabled={busy} className="btn btn-primary" data-testid="pp-save-btn">{busy ? <Loader2 className="animate-spin" size={14}/> : <Plus size={14}/>} {editing.id ? "Save changes" : "Create preset"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export function DeliverySettingsEditor() {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({ default_min_days: "", default_max_days: "", cutoff_enabled: true, cutoff_hhmm: "14:00" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/delivery-settings`);
    setSettings(data);
    setDraft({
      default_min_days: data.default_min_days,
      default_max_days: data.default_max_days,
      cutoff_enabled: !!data.cutoff_enabled,
      cutoff_hhmm: data.cutoff_hhmm || "14:00",
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!settings) return <div className="text-slate-500 py-24 text-center">loading…</div>;

  const min = Number(draft.default_min_days) || 0;
  const max = Number(draft.default_max_days) || 0;
  const invalid = max < min;
  const dirty = min !== settings.default_min_days
    || max !== settings.default_max_days
    || !!draft.cutoff_enabled !== !!settings.cutoff_enabled
    || (draft.cutoff_hhmm || "") !== (settings.cutoff_hhmm || "");
  const preview = computeDeliveryEstimate(min, max, new Date(), {
    enabled: draft.cutoff_enabled, hhmm: draft.cutoff_hhmm,
  });

  const save = async () => {
    if (invalid) return toast.error("Max days must be greater than or equal to min days");
    setBusy(true);
    try {
      const { data } = await axios.patch(`${API}/delivery-settings`, {
        default_min_days: min,
        default_max_days: max,
        cutoff_enabled: !!draft.cutoff_enabled,
        cutoff_hhmm: draft.cutoff_hhmm,
      });
      setSettings(data);
      toast.success("Delivery settings saved");
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail?.slice(0, 200) || e.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4" data-testid="delivery-settings-editor">
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 grid place-items-center rounded-lg text-white shrink-0" style={{ background: "linear-gradient(135deg,#4F46E5,#0891B2)" }}><Calendar size={16}/></div>
          <div>
            <div className="font-display font-bold text-base">Store-wide default</div>
            <div className="text-xs text-slate-500">Applied to every product that doesn't set its own delivery window.</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <Field label="Minimum business days">
            <input
              type="number" min="0" max="365" step="1"
              className="input w-full px-3 py-2 font-mono text-lg"
              value={draft.default_min_days}
              onChange={(e) => setDraft(d => ({ ...d, default_min_days: e.target.value }))}
              data-testid="delivery-default-min-input"
            />
          </Field>
          <Field label="Maximum business days">
            <input
              type="number" min="0" max="365" step="1"
              className="input w-full px-3 py-2 font-mono text-lg"
              value={draft.default_max_days}
              onChange={(e) => setDraft(d => ({ ...d, default_max_days: e.target.value }))}
              data-testid="delivery-default-max-input"
            />
          </Field>
        </div>

        {/* Same-day cutoff — orders placed before this time still ship today. */}
        <div className="mt-4 pt-4 border-t hairline">
          <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer" data-testid="delivery-cutoff-toggle">
            <input
              type="checkbox"
              checked={!!draft.cutoff_enabled}
              onChange={(e) => setDraft(d => ({ ...d, cutoff_enabled: e.target.checked }))}
              className="accent-indigo-600 mt-1 w-4 h-4"
            />
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-2"><ClockIcon size={14} className="text-slate-500"/> Same-day ship cutoff</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Orders placed before the cutoff still ship today. Anything later shifts the estimate to start counting from the next business day.
              </div>
            </div>
            <span className={`chip ${draft.cutoff_enabled ? "chip-success" : "chip-neutral"} font-mono text-[10px] shrink-0`}>{draft.cutoff_enabled ? "ON" : "OFF"}</span>
          </label>

          {draft.cutoff_enabled && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Cutoff time (24h, store-local)">
                <input
                  type="time" step="60"
                  className="input w-full px-3 py-2 font-mono text-lg"
                  value={draft.cutoff_hhmm}
                  onChange={(e) => setDraft(d => ({ ...d, cutoff_hhmm: e.target.value }))}
                  data-testid="delivery-cutoff-input"
                />
              </Field>
              <div className="md:col-span-2 rounded-lg border hairline bg-slate-50/60 p-3 flex flex-col justify-center">
                <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Currently</div>
                <div className="text-sm text-slate-800 mt-0.5 font-medium">
                  Ships same-day until <span className="font-mono">{formatCutoffLabel(draft.cutoff_hhmm)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {invalid ? (
          <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
            <AlertTriangle size={13}/> Maximum days must be greater than or equal to minimum days.
          </div>
        ) : (
          <div className="mt-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50/60" data-testid="delivery-default-preview">
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-700">Live preview · updates every day</div>
              {preview.shifted && (
                <span className="chip chip-warning font-mono text-[10px]" data-testid="delivery-shift-chip">
                  {preview.shiftReason === "cutoff"
                    ? `After ${formatCutoffLabel(draft.cutoff_hhmm)} cutoff · shipping next business day`
                    : "Weekend order · shipping Monday"}
                </span>
              )}
            </div>
            <div className="text-sm text-slate-800 mt-0.5 font-medium" data-testid="delivery-default-preview-label">{preview.label}</div>
            <div className="text-[11px] text-slate-500 font-mono mt-0.5">{min}–{max} business days · weekends skipped</div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2 flex-wrap">
          {dirty && !invalid && <span className="text-xs text-amber-600 font-mono">Unsaved changes</span>}
          <button onClick={() => setDraft({
            default_min_days: settings.default_min_days,
            default_max_days: settings.default_max_days,
            cutoff_enabled: !!settings.cutoff_enabled,
            cutoff_hhmm: settings.cutoff_hhmm || "14:00",
          })} disabled={!dirty || busy} className="btn btn-ghost text-sm" data-testid="delivery-default-cancel">Discard</button>
          <button onClick={save} disabled={busy || !dirty || invalid} className="btn btn-primary text-sm" data-testid="delivery-default-save">
            {busy ? <Loader2 className="animate-spin" size={14}/> : <BadgeCheck size={14}/>} Save default
          </button>
        </div>
      </div>

      <div className="card p-4 border-dashed border-2 text-xs text-slate-500 leading-relaxed">
        <div className="font-display font-bold text-slate-700 text-sm mb-1 flex items-center gap-2"><HelpCircle size={14}/> How it works</div>
        Every product page shows an <span className="font-mono">"Estimated delivery between [date] and [date]"</span> line computed live in the browser using today's date + this window. Weekends are always skipped. Orders placed after the cutoff (or on a weekend) start counting from the next business day. To override the window for a specific product (e.g. large items), open the product and switch on <span className="font-mono">Custom delivery window</span>.
      </div>
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
              When ON: new orders, out-of-stock alerts, countdown-sale expiries, and price drops that hurt margin by ≥ the threshold below.
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

/* --------------------------- Resend integration --------------------------
 * Configure panel on Store Management → Integrations. Stores the Resend API
 * key + sender address in `push_settings` (GET/PATCH /api/push/settings) and
 * flips the `customer_email_enabled` master switch so verification / order
 * emails actually go out. The key powers `_send_verification_email`.
 * ------------------------------------------------------------------------- */
export function ResendIntegrationCard() {
  const [settings, setSettings] = useState(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/push/settings`);
    setSettings(data);
    if (!data.resend_api_key_set) setOpen(true); // auto-open until configured
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!settings) return <div className="card p-5 text-slate-500 text-sm" data-testid="resend-integration-loading">Loading integration…</div>;

  const connected = settings.resend_api_key_set;
  const active = connected && settings.customer_email_enabled;

  const clearSecret = async () => {
    if (!window.confirm("Disconnect Resend? Customer emails will stop sending until you add a key again.")) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/push/settings/clear-secret?field=resend_api_key`);
      setSettings(data);
      setDraft({});
      toast.success("Resend disconnected");
    } catch { toast.error("Could not disconnect"); }
    finally { setBusy(false); }
  };

  const toggleEmails = async (val) => {
    setBusy(true);
    setSettings((s) => ({ ...s, customer_email_enabled: val }));
    try { const { data } = await axios.patch(`${API}/push/settings`, { customer_email_enabled: val }); setSettings(data); }
    catch { toast.error("Save failed"); await load(); }
    finally { setBusy(false); }
  };

  const save = async () => {
    const patch = {};
    if ((draft.resend_api_key ?? "") !== "") patch.resend_api_key = draft.resend_api_key.trim();
    if (draft.resend_from_email !== undefined) patch.resend_from_email = (draft.resend_from_email || "").trim();
    if (Object.keys(patch).length === 0) { toast("Nothing to save"); return; }
    setBusy(true);
    try {
      const { data } = await axios.patch(`${API}/push/settings`, patch);
      setSettings(data);
      setDraft({});
      toast.success("Resend settings saved");
    } catch (e) { toast.error("Save failed", { description: e?.response?.data?.detail || e.message }); }
    finally { setBusy(false); }
  };

  const dirty = (draft.resend_api_key ?? "") !== "" || draft.resend_from_email !== undefined;

  return (
    <div className="card p-5" data-testid="resend-integration">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl grid place-items-center shrink-0 text-white" style={{ background: "linear-gradient(135deg,#0F172A,#4F46E5)" }}>
            <Mail size={18}/>
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-base flex items-center gap-2">
              Resend
              {active
                ? <span className="chip chip-success text-[10px]" data-testid="resend-status"><BadgeCheck size={11}/> Connected</span>
                : connected
                  ? <span className="chip text-[10px]" style={{ background: "#fef3c7", color: "#92400e" }} data-testid="resend-status"><Ban size={11}/> Paused</span>
                  : <span className="chip chip-neutral text-[10px]" data-testid="resend-status">Not configured</span>}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Transactional email — sends customer verification &amp; order emails.</div>
          </div>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost text-sm" data-testid="resend-configure-toggle">
          {open ? "Close" : "Configure"}
        </button>
      </div>

      {open && (
        <div className="mt-5 pt-5 border-t hairline grid gap-4" data-testid="resend-configure-panel">
          <CredField
            label="Resend API key"
            testId="resend-api-key"
            type="password"
            placeholder={connected ? `Saved · ${settings.resend_api_key_masked}` : "re_..."}
            value={draft.resend_api_key ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, resend_api_key: v }))}
            savedBadge={connected}
            onClear={connected ? clearSecret : null}
          />
          <CredField
            label="Sender email address (from)"
            testId="resend-from-email"
            type="email"
            placeholder="noreply@yourstore.com"
            value={draft.resend_from_email ?? settings.resend_from_email}
            onChange={(v) => setDraft((d) => ({ ...d, resend_from_email: v }))}
          />
          <div className="text-[11px] text-slate-400 -mt-1">
            The sender domain must be verified in Resend. Leave blank to use Resend&apos;s
            <span className="font-mono"> onboarding@resend.dev </span>sandbox address.
          </div>

          <label className="flex items-start gap-2 p-3 rounded-lg bg-slate-50 border hairline cursor-pointer">
            <input
              type="checkbox"
              checked={!!settings.customer_email_enabled}
              onChange={(e) => toggleEmails(e.target.checked)}
              className="accent-indigo-600 mt-0.5 w-4 h-4"
              data-testid="resend-customer-emails-toggle"
            />
            <div>
              <div className="text-sm font-medium">Send customer emails</div>
              <div className="text-xs text-slate-500">Master switch for verification, welcome, and order emails. Must be on for the verification link to send.</div>
            </div>
          </label>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline">
              Get a Resend API key <ExternalLink size={11}/>
            </a>
            <div className="flex items-center gap-2">
              {dirty && <span className="text-[11px] text-amber-600 font-mono">unsaved changes</span>}
              <button onClick={save} disabled={busy || !dirty} className="btn btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed" data-testid="resend-save-btn">
                {busy ? <Loader2 size={14} className="animate-spin"/> : <BadgeCheck size={14}/>} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function IntegrationsPanel() {
  const others = ["eBay Australia (source)", "Xero", "MYOB", "Klaviyo", "Mailchimp", "Zapier", "Slack", "Discord"];
  return (
    <div className="grid gap-3" data-testid="integrations-panel">
      <ResendIntegrationCard/>
      {others.map((f, i) => (
        <div key={f} className="card p-4 md:p-5 flex items-center justify-between gap-4 group hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-indigo-50 text-indigo-500"><ExternalLink size={16}/></div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{f}</div>
              <div className="text-[11px] text-slate-400 font-mono">{i === 0 ? "Connected · scraper source" : "Not configured"}</div>
            </div>
          </div>
          <button className="btn btn-ghost text-xs !py-1 !px-2" disabled>Configure</button>
        </div>
      ))}
    </div>
  );
}


const FREQ_OPTS = [
  { value: "hourly", label: "Every hour" },
  { value: "every_6h", label: "Every 6 hours" },
  { value: "every_12h", label: "Every 12 hours" },
  { value: "daily", label: "Once daily" },
  { value: "weekly", label: "Once weekly" },
];
const _newScheduleRow = () => ({
  id: `new-${Math.random().toString(36).slice(2, 10)}`,
  _new: true,
  enabled: true,
  start_time_hhmm: "02:00",
  frequency: "daily",
  stop_date: null,
});
const _rowsFromSched = (data) =>
  (Array.isArray(data?.schedules) ? data.schedules : []).map((s) => ({
    id: s.id,
    enabled: !!s.enabled,
    start_time_hhmm: s.start_time_hhmm || "02:00",
    frequency: s.frequency || "daily",
    stop_date: s.stop_date || null,
    next_run_at: s.next_run_at || null,
  }));

export function ScraperScheduleEditor() {
  const RUN_HISTORY_LIMIT_UI = 20;
  const [sched, setSched] = useState(null);
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [retryingIds, setRetryingIds] = useState([]);
  const [retryingAll, setRetryingAll] = useState(false);
  const [arLocal, setArLocal] = useState(null);
  const [arDirty, setArDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/scraper/schedule`);
    setSched(data);
    // Don't clobber unsaved edits while the admin is mid-change.
    if (!dirtyRef.current) setRows(_rowsFromSched(data));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  // Keep the auto-retry settings form in sync with the server unless the admin
  // is mid-edit.
  useEffect(() => {
    if (sched?.auto_retry && !arDirty) setArLocal(sched.auto_retry);
  }, [sched, arDirty]);

  if (!sched) return <div className="text-slate-500 py-24 text-center">loading…</div>;

  const updateRow = (idx, patch) => {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = () => { setRows((rs) => [...rs, _newScheduleRow()]); setDirty(true); };
  const removeRow = (idx) => { setRows((rs) => rs.filter((_, i) => i !== idx)); setDirty(true); };

  const saveAll = async () => {
    setBusy(true);
    try {
      const payload = {
        schedules: rows.map((r) => ({
          ...(r._new ? {} : { id: r.id }),
          enabled: r.enabled,
          start_time_hhmm: r.start_time_hhmm,
          frequency: r.frequency,
          stop_date: r.stop_date || null,
        })),
      };
      const { data } = await axios.put(`${API}/scraper/schedules`, payload);
      setSched(data);
      setRows(_rowsFromSched(data));
      setDirty(false);
      toast.success(rows.length ? `Saved ${rows.length} schedule${rows.length === 1 ? "" : "s"}` : "All schedules removed");
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail || e.message });
    } finally { setBusy(false); }
  };

  const discard = () => { setRows(_rowsFromSched(sched)); setDirty(false); };

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

  const retryItem = async (id) => {
    setRetryingIds((ids) => [...ids, id]);
    try {
      const { data } = await axios.post(`${API}/scraper/retry-item`, { id }, { timeout: 5 * 60 * 1000 });
      setSched(data.schedule);
      const row = (data.results || []).find((r) => r.id === id);
      if (row?.ok) toast.success("Item refreshed"); else toast.error("Retry failed", { description: row?.error?.slice(0, 160) });
    } catch (e) {
      toast.error("Retry failed", { description: e?.response?.data?.detail?.slice(0, 160) || e.message });
    } finally { setRetryingIds((ids) => ids.filter((x) => x !== id)); }
  };

  const retryAllFailed = async () => {
    setRetryingAll(true);
    toast.loading("Retrying all failed items…", { id: "retry-all" });
    try {
      const { data } = await axios.post(`${API}/scraper/retry-failed`, {}, { timeout: 30 * 60 * 1000 });
      setSched(data.schedule);
      const s = data.stats || {};
      toast.success(`Done · ${s.refreshed || 0}/${s.total || 0} now refreshed · ${s.failed || 0} still failing`, { id: "retry-all" });
    } catch (e) {
      toast.error("Retry failed", { id: "retry-all", description: e?.response?.data?.detail?.slice(0, 160) || e.message });
    } finally { setRetryingAll(false); }
  };

  const saveAutoRetry = async (patch) => {
    setArLocal((p) => ({ ...(p || {}), ...patch }));
    setArDirty(false);
    try {
      const { data } = await axios.patch(`${API}/scraper/auto-retry`, patch);
      setSched(data);
      toast.success("Auto-retry settings saved");
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail || e.message });
    }
  };

  const activeCount = rows.filter((r) => {
    if (!r.enabled) return false;
    const passed = r.stop_date ? new Date(r.stop_date) <= new Date() : false;
    return !passed;
  }).length;
  const nextRun = rows
    .map((r) => r.next_run_at)
    .filter(Boolean)
    .sort()[0] || sched.next_run_at || null;
  const history = Array.isArray(sched.run_history) ? sched.run_history : [];
  const results = Array.isArray(sched.last_run_results) ? sched.last_run_results : [];
  const failedResults = results.filter((r) => !r.ok);
  const okResults = results.filter((r) => r.ok);
  const itemRetry = sched.failed_retry_pending && sched.failed_retry_pending.retry_at ? sched.failed_retry_pending : null;
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
  const triggerLabel = (t) => t === "manual" ? "Manual" : t === "retry" ? "Retry" : t === "item_retry" ? "Auto-retry" : "Scheduled";

  return (
    <div className="grid gap-4" data-testid="scraper-schedule">
      {/* Status strip */}
      <div className="card p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 flex items-center gap-1"><ClockIcon size={11}/> Status</div>
            <div className="mt-1 flex items-center gap-2">
              {activeCount > 0
                ? <span className="chip chip-success" data-testid="sched-status-chip"><BadgeCheck size={11}/> {activeCount} active schedule{activeCount === 1 ? "" : "s"}</span>
                : <span className="chip chip-neutral" data-testid="sched-status-chip"><Ban size={11}/> No active schedules</span>}
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
              {nextRun ? fmtDate(nextRun) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Configuration — multiple independent schedules */}
      <div className="card p-5" data-testid="sched-config">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="font-display font-bold text-base">Schedule configuration</div>
            <div className="text-xs text-slate-500">Add as many schedules as you like — each fires independently. Times use Australia/Sydney (AEST) for the start-time anchor.</div>
          </div>
          <button onClick={runNow} disabled={running} className="btn btn-primary text-sm" data-testid="sched-run-now">
            {running ? <Loader2 className="animate-spin" size={14}/> : <Zap size={14}/>} Run now
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="text-slate-500 text-sm py-8 text-center border border-dashed rounded-lg" data-testid="sched-empty">
            No schedules configured. The scraper only runs when you click <span className="font-mono">Run now</span>.
            Add a schedule below to automate refreshes.
          </div>
        ) : (
          <div className="grid gap-3">
            {rows.map((r, idx) => {
              const passed = r.stop_date ? new Date(r.stop_date) <= new Date() : false;
              return (
                <div key={r.id} className="rounded-xl border hairline p-3 md:p-4 bg-slate-50/50" data-testid={`sched-row-${idx}`}>
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => updateRow(idx, { enabled: e.target.checked })}
                        className="accent-indigo-600 w-4 h-4"
                        data-testid={`sched-row-enabled-${idx}`}
                      />
                      <span className="text-sm font-medium">{r.enabled ? "Enabled" : "Disabled"}</span>
                      {r.enabled && passed && <span className="chip chip-neutral text-[10px]"><Ban size={10}/> stopped</span>}
                    </label>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                      title="Remove schedule"
                      data-testid={`sched-row-remove-${idx}`}
                    >
                      <Trash2 size={15}/>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Field label="Start time (AEST)">
                      <input
                        data-testid={`sched-row-start-${idx}`}
                        type="time"
                        value={r.start_time_hhmm}
                        onChange={(e) => updateRow(idx, { start_time_hhmm: e.target.value })}
                        className="input px-3 py-2 w-full font-mono text-sm"
                      />
                    </Field>
                    <Field label="Frequency">
                      <select
                        data-testid={`sched-row-frequency-${idx}`}
                        value={r.frequency}
                        onChange={(e) => updateRow(idx, { frequency: e.target.value })}
                        className="input px-3 py-2 w-full text-sm"
                      >
                        {FREQ_OPTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Stop date (optional)">
                      <div className="relative">
                        <input
                          data-testid={`sched-row-stop-${idx}`}
                          type="date"
                          value={r.stop_date || ""}
                          onChange={(e) => updateRow(idx, { stop_date: e.target.value || null })}
                          className="input px-3 py-2 w-full font-mono text-sm pr-8"
                        />
                        {r.stop_date && (
                          <button
                            type="button"
                            onClick={() => updateRow(idx, { stop_date: null })}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-600 p-1"
                            title="Clear stop date"
                          >
                            <X size={12}/>
                          </button>
                        )}
                      </div>
                    </Field>
                  </div>
                  {r.next_run_at && !passed && (
                    <div className="mt-2 text-[11px] font-mono text-indigo-600/80">
                      Next run · {fmtDate(r.next_run_at)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
          <button onClick={addRow} className="btn btn-ghost text-sm" data-testid="sched-add-row">
            <Plus size={14}/> Add schedule
          </button>
          <div className="flex items-center gap-2">
            {dirty && <span className="text-[11px] text-amber-600 font-mono">unsaved changes</span>}
            {dirty && (
              <button onClick={discard} disabled={busy} className="btn btn-ghost text-sm" data-testid="sched-discard">
                Discard
              </button>
            )}
            <button onClick={saveAll} disabled={busy || !dirty} className="btn btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed" data-testid="sched-save">
              {busy ? <Loader2 size={14} className="animate-spin"/> : <BadgeCheck size={14}/>} Save schedules
            </button>
          </div>
        </div>
      </div>

      {/* Auto-retry settings */}
      {arLocal && (
        <div className="card p-5" data-testid="sched-auto-retry-card">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="font-display font-bold text-base flex items-center gap-2"><RefreshCw size={15}/> Auto-retry failed items</div>
              <div className="text-xs text-slate-500 mt-0.5">After a scheduled run, automatically re-fetch just the items that failed — not the whole batch.</div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={!!arLocal.enabled}
                onChange={(e) => saveAutoRetry({ enabled: e.target.checked })}
                className="accent-indigo-600 w-4 h-4"
                data-testid="sched-auto-retry-toggle"
              />
              <span className="text-sm font-medium">{arLocal.enabled ? "On" : "Off"}</span>
            </label>
          </div>
          {arLocal.enabled && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <Field label="Retry after (minutes)">
                <input
                  type="number" min={1} max={180}
                  value={arLocal.delay_minutes ?? 3}
                  onChange={(e) => { setArLocal((p) => ({ ...p, delay_minutes: e.target.value === "" ? "" : Number(e.target.value) })); setArDirty(true); }}
                  className="input px-3 py-2 w-full font-mono text-sm"
                  data-testid="sched-auto-retry-delay"
                />
              </Field>
              <Field label="Max attempts">
                <input
                  type="number" min={1} max={10}
                  value={arLocal.max_attempts ?? 2}
                  onChange={(e) => { setArLocal((p) => ({ ...p, max_attempts: e.target.value === "" ? "" : Number(e.target.value) })); setArDirty(true); }}
                  className="input px-3 py-2 w-full font-mono text-sm"
                  data-testid="sched-auto-retry-attempts"
                />
              </Field>
              <button
                onClick={() => saveAutoRetry({ delay_minutes: Math.max(1, Math.min(180, Number(arLocal.delay_minutes) || 3)), max_attempts: Math.max(1, Math.min(10, Number(arLocal.max_attempts) || 2)) })}
                disabled={!arDirty}
                className="btn btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="sched-auto-retry-save"
              >
                <BadgeCheck size={14}/> Save
              </button>
            </div>
          )}
        </div>
      )}

      {/* Retry pending banners */}
      {itemRetry && (
        <div className="card p-4 border border-amber-200 bg-amber-50" data-testid="sched-item-retry-pending">
          <div className="flex items-center gap-3">
            <RefreshCw size={16} className="text-amber-700 animate-spin"/>
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900">Auto-retry queued for {itemRetry.item_ids?.length || 0} failed item{(itemRetry.item_ids?.length || 0) === 1 ? "" : "s"}</div>
              <div className="text-xs text-amber-800">
                The scheduler will re-fetch just the failed items at{" "}
                <span className="font-mono">{fmtDate(itemRetry.retry_at)}</span>
                {" "}(attempt {itemRetry.attempt} of {2}). You can also retry now from the breakdown below.
              </div>
            </div>
          </div>
        </div>
      )}
      {retryPending && (
        <div className="card p-4 border border-amber-200 bg-amber-50" data-testid="sched-retry-pending">
          <div className="flex items-center gap-3">
            <RefreshCw size={16} className="text-amber-700 animate-spin"/>
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900">Retry queued</div>
              <div className="text-xs text-amber-800">
                Last run failed. Auto-retry will fire at{" "}
                <span className="font-mono">{fmtDate(retryPending.retry_at)}</span>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results breakdown — per-item outcome of the most recent run */}
      {results.length > 0 && (
        <div className="card p-5" data-testid="sched-results">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <div className="font-display font-bold text-base flex items-center gap-2"><BadgeCheck size={16}/> Last run breakdown</div>
              <div className="text-xs text-slate-500">
                <span className="text-emerald-600 font-medium">{okResults.length} refreshed</span>
                {" · "}
                <span className={failedResults.length ? "text-red-600 font-medium" : "text-slate-400"}>{failedResults.length} failed</span>
                {" · "}{results.length} total
              </div>
            </div>
            {failedResults.length > 0 && (
              <button onClick={retryAllFailed} disabled={retryingAll} className="btn btn-primary text-sm disabled:opacity-50" data-testid="sched-retry-all">
                {retryingAll ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>} Retry all failed ({failedResults.length})
              </button>
            )}
          </div>

          <div className="grid gap-2">
            {/* Failed first so they're front-and-centre */}
            {[...failedResults, ...okResults].map((r) => {
              const isRetrying = retryingIds.includes(r.id) || (retryingAll && !r.ok);
              return (
                <div key={r.id || r.item_id} className={`flex items-center gap-3 rounded-xl border hairline p-3 ${r.ok ? "bg-white" : "bg-red-50/40"}`} data-testid={`sched-result-row-${r.item_id}`}>
                  {r.image
                    ? <img src={r.image} alt="" className="w-10 h-10 rounded-lg object-cover border hairline shrink-0"/>
                    : <div className="w-10 h-10 rounded-lg bg-slate-100 grid place-items-center text-slate-300 shrink-0"><Store size={16}/></div>}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate" title={r.title}>{r.title || `Item ${r.item_id}`}</div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">
                      #{r.item_id}
                      {!r.ok && r.error && <span className="text-red-500"> · {r.error}</span>}
                    </div>
                  </div>
                  {r.ok
                    ? (r.sold
                        ? <span className="chip text-[10px]" style={{ background: "#fef3c7", color: "#92400e" }}><Zap size={10}/> Sold</span>
                        : <span className="chip chip-success text-[10px]"><BadgeCheck size={10}/> Refreshed</span>)
                    : <span className="chip text-[10px]" style={{ background: "#fee2e2", color: "#b91c1c" }}><XCircle size={10}/> Failed</span>}
                  {!r.ok && (
                    <button
                      onClick={() => retryItem(r.id)}
                      disabled={isRetrying}
                      className="btn btn-ghost !py-1.5 !px-2.5 text-xs shrink-0 disabled:opacity-50"
                      data-testid={`sched-retry-item-${r.item_id}`}
                      title="Re-fetch this item"
                    >
                      {isRetrying ? <Loader2 size={13} className="animate-spin"/> : <RefreshCw size={13}/>} Retry
                    </button>
                  )}
                </div>
              );
            })}
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
                  const isItemRetry = r.trigger === "item_retry";
                  // item_retry rows carry {retried, recovered, still_failed, total};
                  // map them into the shared Refreshed/Failed columns.
                  const refreshedCell = isItemRetry ? (s.recovered ?? 0) : (s.refreshed ?? 0);
                  const failedCell = isItemRetry ? (s.still_failed ?? 0) : (s.failed ?? 0);
                  const detail = r.error
                    ? r.error
                    : isItemRetry
                      ? `retried ${s.retried ?? 0} · recovered ${s.recovered ?? 0} · still failing ${s.still_failed ?? 0}`
                      : "—";
                  return (
                    <tr key={r.id + "-" + r.attempt} className="border-b last:border-b-0 hover:bg-slate-50" data-testid={`sched-history-row-${r.id}`}>
                      <td className="py-2 pr-3 font-mono text-xs text-slate-700 whitespace-nowrap">{fmtDate(r.started_at)}</td>
                      <td className="py-2 pr-3">
                        <span className="chip chip-neutral">{triggerLabel(r.trigger)}{r.attempt > 1 ? ` · #${r.attempt}` : ""}</span>
                      </td>
                      <td className="py-2 pr-3">{statusChip(r.status)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{fmtDuration(r.duration_seconds)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{refreshedCell}<span className="text-slate-400">/{s.total ?? 0}</span></td>
                      <td className="py-2 pr-3 font-mono text-xs text-emerald-700">{s.sold_found ?? 0}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-rose-700">{failedCell}</td>
                      <td className="py-2 pr-3 text-xs text-slate-500 max-w-[280px] truncate" title={detail}>
                        {detail}
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


/* -------------------------- Email Templates editor ------------------------
 *
 * Customise the account-verification email (subject / heading / body /
 * button / footer / accent + logo) plus the PCStore base URL the activation
 * link points at. Live preview mirrors the server-side render. Backed by
 * GET/PATCH /api/email-templates.
 * ------------------------------------------------------------------------- */

function EmailTemplatesEditor() {
  const [tpl, setTpl] = useState(null);
  const [portalUrl, setPortalUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    axios.get(`${API}/email-templates`).then(({ data }) => {
      setTpl(data.verification || {});
      setPortalUrl(data.portal_base_url || "");
    }).catch((e) => toast.error("Failed to load templates", { description: e?.response?.data?.detail || e.message }));
  }, []);

  const setField = (k, v) => { setTpl((t) => ({ ...t, [k]: v })); setDirty(true); };

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await axios.patch(`${API}/email-templates`, {
        portal_base_url: portalUrl,
        verification: tpl,
      });
      setTpl(data.verification || {});
      setPortalUrl(data.portal_base_url || "");
      setDirty(false);
      toast.success("Email template saved");
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail || e.message });
    } finally { setBusy(false); }
  };

  if (tpl === null) {
    return <div className="card p-6 text-slate-500 text-sm" data-testid="email-templates-loading">Loading email templates…</div>;
  }

  const accent = tpl.accent_color || "#4F46E5";
  const previewName = "Jordan";
  const sub = (s) => (s || "").replace(/\{name\}/g, previewName).replace(/\{email\}/g, "jordan@example.com");

  return (
    <div className="grid lg:grid-cols-2 gap-4" data-testid="email-templates-card">
      {/* Editor */}
      <div className="card p-5 grid gap-4">
        <div className="flex items-center gap-2">
          <Mail size={16} className="text-indigo-500"/>
          <div className="font-display font-bold">Verification email</div>
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1 flex items-center gap-1"><Link2 size={11}/> PCStore portal URL</label>
          <input value={portalUrl} onChange={(e) => { setPortalUrl(e.target.value); setDirty(true); }}
            placeholder="https://your-pcstore.com"
            className="input w-full px-3 py-2 text-sm font-mono" data-testid="et-portal-url"/>
          <div className="text-[11px] text-slate-400 mt-1">
            Activation links become <span className="font-mono">{(portalUrl || "").replace(/\/$/, "") || "…"}/verify?token=…</span>
            {!portalUrl && <span className="text-amber-600"> — leave blank while testing; the link is returned in the API response instead.</span>}
          </div>
        </div>

        <Field label="Subject line"><input value={tpl.subject || ""} onChange={(e) => setField("subject", e.target.value)} className="input w-full px-3 py-2 text-sm" data-testid="et-subject"/></Field>
        <Field label="Heading"><input value={tpl.heading || ""} onChange={(e) => setField("heading", e.target.value)} className="input w-full px-3 py-2 text-sm" data-testid="et-heading"/></Field>
        <Field label="Body text">
          <textarea value={tpl.body || ""} onChange={(e) => setField("body", e.target.value)} rows={4} className="input w-full px-3 py-2 text-sm" data-testid="et-body"/>
          <div className="text-[11px] text-slate-400 mt-1">Placeholders: <span className="font-mono">{"{name}"}</span>, <span className="font-mono">{"{email}"}</span></div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Button label"><input value={tpl.button_label || ""} onChange={(e) => setField("button_label", e.target.value)} className="input w-full px-3 py-2 text-sm" data-testid="et-button"/></Field>
          <Field label="Accent colour">
            <div className="flex items-center gap-2">
              <input type="color" value={accent} onChange={(e) => setField("accent_color", e.target.value)} className="h-9 w-12 rounded border hairline cursor-pointer" data-testid="et-accent"/>
              <input value={accent} onChange={(e) => setField("accent_color", e.target.value)} className="input flex-1 px-2 py-2 text-sm font-mono"/>
            </div>
          </Field>
        </div>
        <Field label="Logo URL (optional)"><input value={tpl.logo_url || ""} onChange={(e) => setField("logo_url", e.target.value)} placeholder="https://…/logo.png" className="input w-full px-3 py-2 text-sm font-mono" data-testid="et-logo"/></Field>
        <Field label="Footer text"><textarea value={tpl.footer || ""} onChange={(e) => setField("footer", e.target.value)} rows={2} className="input w-full px-3 py-2 text-sm" data-testid="et-footer"/></Field>

        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="text-[11px] text-amber-600 font-mono">unsaved changes</span>}
          <button onClick={save} disabled={busy || !dirty} className="btn btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed" data-testid="et-save-btn">
            {busy ? <Loader2 size={14} className="animate-spin"/> : <BadgeCheck size={14}/>} Save template
          </button>
        </div>
      </div>

      {/* Live preview */}
      <div className="card p-5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3">Live preview</div>
        <div className="text-xs text-slate-500 mb-2"><span className="font-mono">Subject:</span> {sub(tpl.subject) || <em>—</em>}</div>
        <div className="rounded-xl overflow-hidden border hairline" data-testid="et-preview">
          <div style={{ background: accent }} className="p-5 text-white">
            {tpl.logo_url
              ? <img src={tpl.logo_url} alt="" style={{ maxHeight: 36 }} className="mb-2"/>
              : <div className="text-[11px] tracking-widest uppercase opacity-85">PCAdmin</div>}
            <div className="text-lg font-bold mt-1">{sub(tpl.heading) || "Confirm your email address"}</div>
          </div>
          <div className="p-5 bg-white">
            <p className="text-sm text-slate-700 leading-relaxed">{sub(tpl.body) || <em className="text-slate-400">Body text…</em>}</p>
            <button style={{ background: accent }} className="mt-4 inline-block text-white font-bold text-sm px-5 py-2.5 rounded-lg" type="button" disabled>
              {tpl.button_label || "Activate my account"}
            </button>
            {tpl.footer && <div className="mt-5 pt-3 border-t hairline text-xs text-slate-500">{sub(tpl.footer)}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}


/* ------------------------- Storefront branding editor -------------------------
 * Store Management → Store Settings → "Store name" Configure. Edits the
 * PCStore-facing brand: store name, tagline, logo, favicon, browser tab title.
 * Saves to /api/store-branding; PCStore reads /api/store/config dynamically.
 * ---------------------------------------------------------------------------- */
const MAX_BRAND_IMG_BYTES = 3 * 1024 * 1024;

export function StoreBrandingEditor() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Read from the SAME endpoint PCStore reads (GET /api/store/config).
    const { data } = await axios.get(`${API}/store/config`);
    setData(data);
    setForm((f) => f ?? data);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data || !form) return <div className="card p-5 text-slate-500 text-sm" data-testid="store-branding-loading">Loading…</div>;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const pickImage = (key, label) => async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BRAND_IMG_BYTES) {
      toast.error(`${label} is too large`, { description: `Max 3 MB · this file is ${(file.size / 1024 / 1024).toFixed(1)} MB.` });
      return;
    }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    set({ [key]: dataUrl });
  };

  const save = async () => {
    if (!(form.store_name || "").trim()) { toast.error("Store name is required"); return; }
    setBusy(true);
    try {
      const payload = {
        store_name: (form.store_name || "").trim(),
        tagline: (form.tagline || "").trim(),
        tab_title: (form.tab_title || "").trim() || (form.store_name || "").trim(),
        logo: form.logo || "",
        favicon: form.favicon || "",
      };
      const { data } = await axios.put(`${API}/store/config`, payload);
      setData(data); setForm(data);
      toast.success("Store branding saved — live on PCStore");
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail || e.message });
    } finally { setBusy(false); }
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(data);

  return (
    <div className="card p-5" data-testid="store-branding-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl grid place-items-center shrink-0 text-white" style={{ background: "linear-gradient(135deg,#4F46E5,#EC4899)" }}>
            <Store size={18}/>
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-base">Store name &amp; branding</div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">
              <span className="font-medium text-slate-700">{data.store_name}</span>
              {data.tagline ? <span> · {data.tagline}</span> : null}
            </div>
          </div>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost text-sm" data-testid="store-branding-configure">
          {open ? "Close" : "Configure"}
        </button>
      </div>

      {open && (
        <div className="mt-5 pt-5 border-t hairline grid gap-4" data-testid="store-branding-form">
          <Field label="Store name (bold header on PCStore)">
            <input value={form.store_name || ""} onChange={(e) => set({ store_name: e.target.value })} placeholder="PrettyCheap" className="input w-full px-3 py-2 text-sm" data-testid="store-branding-name"/>
          </Field>
          <Field label="Tagline / subtitle">
            <input value={form.tagline || ""} onChange={(e) => set({ tagline: e.target.value })} placeholder="Pretty Prices · Cheap Deals · Every Day" className="input w-full px-3 py-2 text-sm" data-testid="store-branding-tagline"/>
          </Field>
          <Field label="Browser tab title">
            <input value={form.tab_title || ""} onChange={(e) => set({ tab_title: e.target.value })} placeholder="Defaults to store name" className="input w-full px-3 py-2 text-sm" data-testid="store-branding-tabtitle"/>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2">Logo</div>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg border hairline bg-slate-50 grid place-items-center overflow-hidden shrink-0">
                  {form.logo ? <img src={form.logo} alt="logo" className="w-full h-full object-contain p-1" data-testid="store-branding-logo-preview"/> : <Store size={20} className="text-slate-300"/>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="btn btn-primary text-xs cursor-pointer" data-testid="store-branding-logo-picker">
                    {form.logo ? "Replace" : "Upload"} logo
                    <input type="file" accept="image/*" className="hidden" onChange={pickImage("logo", "Logo")} data-testid="store-branding-logo-input"/>
                  </label>
                  {form.logo && <button onClick={() => set({ logo: "" })} className="btn btn-ghost text-xs" data-testid="store-branding-logo-clear"><Trash2 size={12}/> Remove</button>}
                </div>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2">Favicon</div>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg border hairline bg-slate-50 grid place-items-center overflow-hidden shrink-0">
                  {form.favicon ? <img src={form.favicon} alt="favicon" className="w-8 h-8 object-contain" data-testid="store-branding-favicon-preview"/> : <Store size={16} className="text-slate-300"/>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="btn btn-primary text-xs cursor-pointer" data-testid="store-branding-favicon-picker">
                    {form.favicon ? "Replace" : "Upload"} favicon
                    <input type="file" accept="image/*,.ico" className="hidden" onChange={pickImage("favicon", "Favicon")} data-testid="store-branding-favicon-input"/>
                  </label>
                  {form.favicon && <button onClick={() => set({ favicon: "" })} className="btn btn-ghost text-xs" data-testid="store-branding-favicon-clear"><Trash2 size={12}/> Remove</button>}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <div className="text-[11px] text-slate-400">Changes appear on PCStore immediately via <span className="font-mono">/api/store/config</span>.</div>
            <div className="flex items-center gap-2">
              {dirty && <span className="text-[11px] text-amber-600 font-mono">unsaved changes</span>}
              <button onClick={save} disabled={busy || !dirty} className="btn btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed" data-testid="store-branding-save">
                {busy ? <Loader2 size={14} className="animate-spin"/> : <BadgeCheck size={14}/>} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function StoreSettingsPanel() {
  const others = ["Legal business name", "ABN", "Contact email", "Support phone", "Business hours"];
  return (
    <div className="grid gap-3" data-testid="store-settings-panel">
      <StoreBrandingEditor/>
      {others.map((f) => (
        <div key={f} className="card p-4 md:p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-indigo-50 text-indigo-500"><Store size={16}/></div>
            <div className="min-w-0"><div className="font-medium text-sm truncate">{f}</div><div className="text-[11px] text-slate-400 font-mono">Not configured</div></div>
          </div>
          <button className="btn btn-ghost text-xs !py-1 !px-2" disabled>Configure</button>
        </div>
      ))}
    </div>
  );
}



const POSTCODE_ZONE_META = [
  { key: "same_state",     label: "Same state",     hint: "Delivery within the store's home state" },
  { key: "adjacent_state", label: "Adjacent state", hint: "A neighbouring state or territory" },
  { key: "interstate",     label: "Interstate",     hint: "Any other state / capital-city metro" },
  { key: "remote",         label: "Remote areas",   hint: "NT, far WA & outback QLD postcodes" },
];

const AU_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"];

function ShippingMethodsPanel() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/postcode-delivery-settings`);
    setSettings(data);
    setDraft({
      enabled: !!data.enabled,
      auto_detect_location: !!data.auto_detect_location,
      origin_state: data.origin_state || "QLD",
      zones: JSON.parse(JSON.stringify(data.zones || {})),
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const setZone = (key, field, value) =>
    setDraft(d => ({ ...d, zones: { ...d.zones, [key]: { ...d.zones[key], [field]: value } } }));

  const save = async () => {
    for (const z of POSTCODE_ZONE_META) {
      const r = draft.zones[z.key] || {};
      if ((Number(r.max_days) || 0) < (Number(r.min_days) || 0))
        return toast.error(`${z.label}: max days must be ≥ min days`);
    }
    setBusy(true);
    try {
      const { data } = await axios.patch(`${API}/postcode-delivery-settings`, {
        enabled: draft.enabled,
        auto_detect_location: draft.auto_detect_location,
        origin_state: draft.origin_state,
        zones: Object.fromEntries(POSTCODE_ZONE_META.map(z => [z.key, {
          min_days: Number(draft.zones[z.key]?.min_days) || 0,
          max_days: Number(draft.zones[z.key]?.max_days) || 0,
        }])),
      });
      setSettings(data);
      setDraft({
        enabled: !!data.enabled, auto_detect_location: !!data.auto_detect_location,
        origin_state: data.origin_state || "QLD", zones: JSON.parse(JSON.stringify(data.zones || {})),
      });
      toast.success("Postcode delivery settings saved");
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail?.slice(0, 200) || e.message });
    } finally { setBusy(false); }
  };

  const statusLabel = settings
    ? (settings.enabled ? `On · ${(settings.origin_state || "QLD")} origin` : "Disabled")
    : "…";

  return (
    <div className="grid gap-3" data-testid="shipping-methods-panel">
      {/* Postcode Delivery Estimate — the one working, configurable method */}
      <div className="card p-4 md:p-5" data-testid="postcode-delivery-card">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 text-white" style={{ background: "linear-gradient(135deg,#4F46E5,#0891B2)" }}><MapPin size={16}/></div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">Postcode Delivery Estimate</div>
              <div className="text-[11px] text-slate-400 font-mono">{statusLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`chip ${settings?.enabled ? "chip-success" : "chip-neutral"} font-mono text-[10px]`} data-testid="postcode-delivery-status-chip">{settings?.enabled ? "ENABLED" : "OFF"}</span>
            <button className="btn btn-ghost text-xs !py-1 !px-2" onClick={() => setOpen(o => !o)} data-testid="postcode-delivery-configure-btn">
              {open ? "Close" : "Configure"}
            </button>
          </div>
        </div>

        {open && draft && (
          <div className="mt-4 pt-4 border-t hairline grid gap-4" data-testid="postcode-delivery-form">
            <div className="text-xs text-slate-500">PCStore reads these zone windows to show a live "delivery to your postcode" estimate on each product page.</div>

            {/* Feature toggle */}
            <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer" data-testid="postcode-enabled-toggle">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft(d => ({ ...d, enabled: e.target.checked }))} className="accent-indigo-600 mt-1 w-4 h-4"/>
              <div className="flex-1">
                <div className="text-sm font-medium">Enable postcode delivery estimate</div>
                <div className="text-xs text-slate-500 mt-0.5">Show the per-postcode estimate on the storefront product modal.</div>
              </div>
              <span className={`chip ${draft.enabled ? "chip-success" : "chip-neutral"} font-mono text-[10px] shrink-0`}>{draft.enabled ? "ON" : "OFF"}</span>
            </label>

            {/* Auto-detect toggle */}
            <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer" data-testid="postcode-autodetect-toggle">
              <input type="checkbox" checked={draft.auto_detect_location} onChange={(e) => setDraft(d => ({ ...d, auto_detect_location: e.target.checked }))} className="accent-indigo-600 mt-1 w-4 h-4"/>
              <div className="flex-1">
                <div className="text-sm font-medium">Auto-detect customer location</div>
                <div className="text-xs text-slate-500 mt-0.5">Ask for browser geolocation to pre-fill the shopper's postcode.</div>
              </div>
              <span className={`chip ${draft.auto_detect_location ? "chip-success" : "chip-neutral"} font-mono text-[10px] shrink-0`}>{draft.auto_detect_location ? "ON" : "OFF"}</span>
            </label>

            {/* Store origin state */}
            <Field label="Store origin state (zones are calculated relative to this)">
              <select className="input w-full px-3 py-2 font-mono" value={draft.origin_state} onChange={(e) => setDraft(d => ({ ...d, origin_state: e.target.value }))} data-testid="postcode-origin-state-select">
                {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            {/* Zone day ranges */}
            <div className="grid gap-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Delivery windows (business days)</div>
              {POSTCODE_ZONE_META.map(z => (
                <div key={z.key} className="rounded-lg border hairline p-3 flex items-center justify-between gap-4" data-testid={`postcode-zone-${z.key}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{z.label}</div>
                    <div className="text-[11px] text-slate-400">{z.hint}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input type="number" min="0" max="60" step="1" className="input w-16 px-2 py-1.5 font-mono text-center" value={draft.zones[z.key]?.min_days ?? ""} onChange={(e) => setZone(z.key, "min_days", e.target.value)} data-testid={`postcode-zone-${z.key}-min`}/>
                    <span className="text-slate-400 text-xs">to</span>
                    <input type="number" min="0" max="60" step="1" className="input w-16 px-2 py-1.5 font-mono text-center" value={draft.zones[z.key]?.max_days ?? ""} onChange={(e) => setZone(z.key, "max_days", e.target.value)} data-testid={`postcode-zone-${z.key}-max`}/>
                    <span className="text-[11px] text-slate-400 font-mono w-8">days</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button className="btn btn-primary text-sm" onClick={save} disabled={busy} data-testid="postcode-delivery-save-btn">
                {busy ? <Loader2 size={14} className="animate-spin"/> : <BadgeCheck size={14}/>}
                {busy ? "Saving…" : "Save settings"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Carrier scaffolds removed — Postage Presets & Delivery Estimate folded in below */}
      <div className="pt-1">
        <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2"><Package size={13}/> Postage Presets</div>
        <PostagePresetsEditor/>
      </div>

      <div className="pt-1">
        <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2"><Calendar size={13}/> Delivery Estimate</div>
        <DeliverySettingsEditor/>
      </div>
    </div>
  );
}


const SITE_MENU_SCAFFOLDS = [
  "Main navigation", "Footer — Shop", "Footer — Support",
  "Footer — Legal", "Mobile drawer", "Utility bar",
];

function SiteMenusPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/site-menus`);
    setData(data);
    setDraft({ ...data.get_help });
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (draft.link_type === "url" && !String(draft.url || "").trim())
      return toast.error("Enter a URL for the Get Help link");
    setBusy(true);
    try {
      const { data: res } = await axios.patch(`${API}/site-menus`, {
        get_help: {
          enabled: draft.enabled,
          label: (draft.label || "Get Help").trim(),
          link_type: draft.link_type,
          url: draft.url || "",
          page: draft.page || "faq",
        },
      });
      setData(res);
      setDraft({ ...res.get_help });
      toast.success("Customer Support menu saved");
    } catch (e) {
      toast.error("Save failed", { description: e?.response?.data?.detail?.slice(0, 200) || e.message });
    } finally { setBusy(false); }
  };

  const gh = data?.get_help;
  const pages = data?.pages || [];
  const destLabel = gh
    ? (gh.link_type === "url"
        ? (gh.url || "no URL set")
        : (pages.find(p => p.slug === gh.page)?.label || gh.page))
    : "…";

  return (
    <div className="grid gap-3" data-testid="site-menus-panel">
      {/* Customer Support — the one working, configurable menu */}
      <div className="card p-4 md:p-5" data-testid="customer-support-card">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 text-white" style={{ background: "linear-gradient(135deg,#4F46E5,#EC4899)" }}><HelpCircle size={16}/></div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">Customer Support</div>
              <div className="text-[11px] text-slate-400 font-mono truncate">Get Help → {destLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`chip ${gh?.enabled ? "chip-success" : "chip-neutral"} font-mono text-[10px]`} data-testid="customer-support-status-chip">{gh?.enabled ? "ENABLED" : "OFF"}</span>
            <button className="btn btn-ghost text-xs !py-1 !px-2" onClick={() => setOpen(o => !o)} data-testid="customer-support-configure-btn">{open ? "Close" : "Configure"}</button>
          </div>
        </div>

        {open && draft && (
          <div className="mt-4 pt-4 border-t hairline grid gap-4" data-testid="customer-support-form">
            <div className="text-xs text-slate-500">PCStore reads this to wire up the "Get Help" link in the customer-account dropdown on the storefront.</div>

            <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer" data-testid="get-help-enabled-toggle">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft(d => ({ ...d, enabled: e.target.checked }))} className="accent-indigo-600 mt-1 w-4 h-4"/>
              <div className="flex-1">
                <div className="text-sm font-medium">Show the "Get Help" link</div>
                <div className="text-xs text-slate-500 mt-0.5">Display this link in the storefront customer-account dropdown.</div>
              </div>
              <span className={`chip ${draft.enabled ? "chip-success" : "chip-neutral"} font-mono text-[10px] shrink-0`}>{draft.enabled ? "ON" : "OFF"}</span>
            </label>

            <Field label="Link label">
              <input className="input w-full px-3 py-2" value={draft.label} onChange={(e) => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Get Help" data-testid="get-help-label-input"/>
            </Field>

            <div className="grid gap-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Destination</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDraft(d => ({ ...d, link_type: "url" }))} className={`btn text-xs ${draft.link_type === "url" ? "btn-primary" : "btn-ghost"}`} data-testid="get-help-type-url">External URL</button>
                <button type="button" onClick={() => setDraft(d => ({ ...d, link_type: "page" }))} className={`btn text-xs ${draft.link_type === "page" ? "btn-primary" : "btn-ghost"}`} data-testid="get-help-type-page">Store page</button>
              </div>

              {draft.link_type === "url" ? (
                <Field label="URL">
                  <input className="input w-full px-3 py-2 font-mono text-sm" value={draft.url} onChange={(e) => setDraft(d => ({ ...d, url: e.target.value }))} placeholder="https://help.yourstore.com" data-testid="get-help-url-input"/>
                </Field>
              ) : (
                <Field label="Page">
                  <select className="input w-full px-3 py-2" value={draft.page} onChange={(e) => setDraft(d => ({ ...d, page: e.target.value }))} data-testid="get-help-page-select">
                    {pages.map(p => <option key={p.slug} value={p.slug}>{p.label}</option>)}
                  </select>
                </Field>
              )}
            </div>

            <div className="flex justify-end">
              <button className="btn btn-primary text-sm" onClick={save} disabled={busy} data-testid="get-help-save-btn">
                {busy ? <Loader2 size={14} className="animate-spin"/> : <BadgeCheck size={14}/>}
                {busy ? "Saving…" : "Save settings"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Other menus — scaffolds, kept intact */}
      {SITE_MENU_SCAFFOLDS.map((f) => (
        <div key={f} className="card p-4 md:p-5 flex items-center justify-between gap-4 group hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-indigo-50 text-indigo-500"><Menu size={16}/></div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{f}</div>
              <div className="text-[11px] text-slate-400 font-mono">Not configured</div>
            </div>
          </div>
          <button className="btn btn-ghost text-xs !py-1 !px-2">Configure</button>
        </div>
      ))}
    </div>
  );
}


export function StoreManagement({ section, setSection }) {
  const meta = STORE_NAV.find((s) => s.id === section) || STORE_NAV[0];
  const Icon = meta.icon;

  const sections = {
    "store-settings":      { hint: "Your storefront brand — name, tagline, logo, favicon and tab title (shown live on PCStore) — plus contact and legal info.", fields: [], custom: <StoreSettingsPanel/> },
    "pricing-rules":       { hint: "Tiered profit rules the scraper uses when calculating sell prices for imported items.", fields: [], custom: <PricingRulesEditor/> },
    "scraper-schedule":    { hint: "Automate the eBay re-fetch: add one or more schedules, each with its own start time, frequency and optional stop date — or run one right now.", fields: [], custom: <ScraperScheduleEditor/> },
    "payment-gateway":     { hint: "Enable/disable payment providers and configure their credentials.", fields: ["Stripe","PayPal","Apple Pay","Google Pay","Afterpay","Zip Pay","Bank transfer","Cash on delivery"] },
    "shipping-methods":    { hint: "Everything delivery: the per-postcode estimate PCStore shows on each product, your reusable postage presets, and the store-wide delivery window.", fields: [], custom: <ShippingMethodsPanel/> },
    "tax-rates":           { hint: "GST and location-based tax rules.", fields: ["Australia — GST 10%","New Zealand — GST 15%","B2B / ABN entries"] },
    "checkout-settings":   { hint: "Fine-tune the buyer journey at checkout.", fields: ["Guest checkout","Require phone","Address auto-complete","Order note field","Marketing opt-in","Terms & conditions box"] },
    "email-notifications": { hint: "Admin alerts + transactional emails sent to customers. Configure the Resend API key and per-channel toggles here.", fields: [], custom: <PushNotificationSettings/> },
    "email-templates":     { hint: "Customise the account-verification email customers receive when they sign up, plus the PCStore link the activation button points to.", fields: [], custom: <EmailTemplatesEditor/> },
    "popup-messages":      { hint: "On-site banners, promos and pop-ups.", fields: ["Announcement bar","Welcome popup","Exit-intent offer","Free-shipping banner","Cookie consent","Age gate"] },
    "site-menus":          { hint: "Header, footer and mobile navigation menus. Configure the Customer Support 'Get Help' link PCStore shows in the account dropdown.", fields: [], custom: <SiteMenusPanel/> },
    "pages":               { hint: "Static content pages (About, Contact, Policies…).", fields: ["Home","About us","Contact","Shipping policy","Returns policy","Privacy policy","Terms of service","FAQ"] },
    "locations":           { hint: "Physical stores, warehouses and pickup points.", fields: ["Bellara HQ, QLD","Sydney warehouse, NSW","Melbourne showroom, VIC","Pickup: 3rd party locker"] },
    "seo-settings":        { hint: "Global SEO defaults, sitemaps and social cards.", fields: ["Meta title template","Meta description default","Open Graph image","Twitter card","Sitemap URL","robots.txt"] },
    "analytics-tracking":  { hint: "Attach analytics and tracking pixels.", fields: ["Google Analytics 4","Google Tag Manager","Meta pixel","TikTok pixel","Hotjar","Server-side conversions"] },
    "integrations":        { hint: "Third-party apps and API connections. Configure Resend to send customer verification & order emails.", fields: [], custom: <IntegrationsPanel/> },
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

