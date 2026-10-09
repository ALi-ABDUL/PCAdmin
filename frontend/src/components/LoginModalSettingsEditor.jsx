import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { ArrowDown, ArrowUp, BadgeCheck, Loader2, Plus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { API } from "../lib/api";
import { Field } from "./atoms";

const blankField = (count) => ({ key: `custom_field_${count + 1}`, label: "New field", placeholder: "", type: "text", required: false });

export function LoginModalSettingsEditor() {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/login-modal-settings`);
    setSaved(data); setForm((current) => current ?? data);
  }, []);
  useEffect(() => { load().catch(() => toast.error("Could not load login modal settings")); }, [load]);
  if (!form || !saved) return <div className="card p-5 text-sm text-slate-500" data-testid="login-modal-settings-loading">Loading login modal settings…</div>;

  const fields = form.signup_fields || [];
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const updateField = (index, patch) => set({ signup_fields: fields.map((field, i) => i === index ? { ...field, ...patch } : field) });
  const moveField = (index, direction) => {
    const next = [...fields]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set({ signup_fields: next });
  };
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await axios.patch(`${API}/login-modal-settings`, form);
      setSaved(data); setForm(data);
      toast.success("Login modal settings saved — live on PCStore");
    } catch (error) { toast.error("Save failed", { description: error?.response?.data?.detail || error.message }); }
    finally { setBusy(false); }
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  return <section className="card p-5" data-testid="login-modal-settings-card">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-lg grid place-items-center shrink-0 bg-emerald-50 text-emerald-700"><UserRound size={19}/></div>
        <div><div className="font-display font-bold text-base" data-testid="login-modal-settings-heading">Login modal settings</div><div className="text-xs text-slate-500 mt-0.5">Control PCStore’s login message and signup profile fields.</div></div>
      </div>
      <button onClick={() => setOpen((value) => !value)} className="btn btn-ghost text-sm" data-testid="login-modal-settings-configure">{open ? "Close" : "Configure"}</button>
    </div>

    {open && <div className="mt-5 pt-5 border-t hairline grid gap-5" data-testid="login-modal-settings-form">
      <div className="grid gap-3">
        <Field label="Modal headline"><input value={form.header_title || ""} onChange={(event) => set({ header_title: event.target.value })} className="input w-full px-3 py-2 text-sm" data-testid="login-modal-header-title" /></Field>
        <Field label="Offer message"><textarea value={form.offer_message || ""} onChange={(event) => set({ offer_message: event.target.value })} rows={2} className="input w-full px-3 py-2 text-sm resize-y" data-testid="login-modal-offer-message" /></Field>
        <Field label="Helper line / demo notice"><input value={form.demo_notice || ""} onChange={(event) => set({ demo_notice: event.target.value })} className="input w-full px-3 py-2 text-sm" data-testid="login-modal-demo-notice" /></Field>
      </div>

      <div className="border-t hairline pt-5">
        <div className="flex items-start justify-between gap-3 flex-wrap"><div><div className="font-medium text-sm">Signup profile fields</div><div className="text-xs text-slate-500 mt-0.5">Email and password remain required for secure account creation.</div></div><button onClick={() => set({ signup_fields: [...fields, blankField(fields.length)] })} className="btn btn-ghost text-xs" data-testid="login-modal-add-field"><Plus size={14}/> Add field</button></div>
        <div className="grid gap-2 mt-3" data-testid="login-modal-signup-fields">
          {fields.map((field, index) => <div key={`${field.key}-${index}`} className="border hairline rounded-lg p-3 grid gap-3" data-testid={`login-modal-field-${index}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <label className="grid gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">Label<input value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} className="input px-2.5 py-1.5 text-sm normal-case tracking-normal" data-testid={`login-modal-field-label-${index}`} /></label>
              <label className="grid gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">Field key<input value={field.key} onChange={(event) => updateField(index, { key: event.target.value })} className="input px-2.5 py-1.5 text-sm font-mono normal-case tracking-normal" data-testid={`login-modal-field-key-${index}`} /></label>
              <label className="grid gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">Placeholder<input value={field.placeholder || ""} onChange={(event) => updateField(index, { placeholder: event.target.value })} className="input px-2.5 py-1.5 text-sm normal-case tracking-normal" data-testid={`login-modal-field-placeholder-${index}`} /></label>
              <label className="grid gap-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">Input type<select value={field.type} onChange={(event) => updateField(index, { type: event.target.value })} className="input px-2.5 py-1.5 text-sm normal-case tracking-normal" data-testid={`login-modal-field-type-${index}`}><option value="text">Text</option><option value="tel">Phone</option></select></label>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap"><label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={!!field.required} onChange={(event) => updateField(index, { required: event.target.checked })} data-testid={`login-modal-field-required-${index}`} /> Required</label><div className="flex gap-1"><button onClick={() => moveField(index, -1)} disabled={index === 0} title="Move field up" className="btn btn-ghost !p-1.5" data-testid={`login-modal-field-up-${index}`}><ArrowUp size={14}/></button><button onClick={() => moveField(index, 1)} disabled={index === fields.length - 1} title="Move field down" className="btn btn-ghost !p-1.5" data-testid={`login-modal-field-down-${index}`}><ArrowDown size={14}/></button><button onClick={() => set({ signup_fields: fields.filter((_, i) => i !== index) })} title="Remove field" className="btn btn-ghost !p-1.5 text-red-600" data-testid={`login-modal-field-remove-${index}`}><Trash2 size={14}/></button></div></div>
          </div>)}
          {!fields.length && <div className="text-sm text-slate-500 py-3" data-testid="login-modal-no-fields">No optional profile fields. Email and password will remain on signup.</div>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap"><div className="text-[11px] text-slate-400">PCStore reads these settings dynamically from <span className="font-mono">/api/store/login-modal</span>.</div><div className="flex items-center gap-2">{dirty && <span className="text-[11px] text-amber-600 font-mono" data-testid="login-modal-unsaved">Unsaved changes</span>}<button onClick={save} disabled={busy || !dirty} className="btn btn-primary text-sm disabled:opacity-50" data-testid="login-modal-save">{busy ? <Loader2 size={14} className="animate-spin"/> : <BadgeCheck size={14}/>} Save</button></div></div>
    </div>}
  </section>;
}