import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Eye, EyeOff, Globe2, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { API } from "../lib/api";
import { Field } from "./atoms";

const BUILTIN_IDS = new Set(["scrapingbee", "scraperapi", "scrapedo", "brightdata", "decodo", "webscrapingapi", "scrapebadger"]);
const SECRET_FIELDS = ["api_key", "username", "password"];

const emptyCustom = () => ({
  id: `custom-${Date.now()}`,
  type: "custom",
  label: "Custom provider",
  enabled: true,
  endpoint: "",
  request_method: "get",
  auth_mode: "query",
  api_key_param: "api_key",
  url_param: "url",
  api_key: "",
  username: "",
  password: "",
});

const emptyStructuredJson = () => ({
  id: `structured-json-${Date.now()}`,
  type: "structured_json",
  label: "Structured JSON API",
  enabled: true,
  endpoint: "https://api.example.com/items/{item_id}",
  api_key_label: "API key / token",
  structured_auth_mode: "header",
  structured_auth_name: "X-API-Key",
  field_mappings: { title: "", price: "", images: "", description: "", shipping_cost: "", stock_quantity: "" },
  api_key: "",
  username: "",
  password: "",
});

const STRUCTURED_MAPPING_FIELDS = [
  ["title", "Title", "product.title"], ["price", "Price", "pricing.amount"],
  ["images", "Images", "media.images[*].url"], ["description", "Description", "product.description"],
  ["shipping_cost", "Shipping cost", "shipping.cost"], ["stock_quantity", "Stock quantity", "inventory.quantity"],
];

const credentialFields = (provider) => {
  if (provider.type === "decodo") return ["username", "password"];
  if (provider.type === "custom" && provider.auth_mode === "basic") return ["username", "password"];
  if (provider.type === "custom" && provider.auth_mode === "none") return [];
  return ["api_key"];
};

export function ScraperApiSettingsCard() {
  const [providers, setProviders] = useState(null);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState({});
  const [open, setOpen] = useState(false);
  const [newProviderType, setNewProviderType] = useState("custom");
  const [providerPendingDelete, setProviderPendingDelete] = useState(null);
  const [deletingProvider, setDeletingProvider] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/scraper/apis`);
      const loaded = (data.providers || []).map((provider) => ({ ...provider, api_key: "", username: "", password: "" }));
      // React development mode can issue a second initial request. Never let a
      // late response replace an admin's just-added, unsaved provider.
      setProviders((current) => current ?? loaded);
    } catch (error) {
      toast.error("Couldn’t load scraper API settings", { description: error?.response?.data?.detail || error.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = (id, patch) => setProviders((current) => current.map((provider) => provider.id === id ? { ...provider, ...patch } : provider));

  const deleteProvider = async () => {
    if (!providerPendingDelete) return;
    setDeletingProvider(true);
    try {
      await axios.delete(`${API}/scraper/apis/${encodeURIComponent(providerPendingDelete.id)}`);
      setProviders((current) => current.filter((provider) => provider.id !== providerPendingDelete.id));
      setRevealed((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${providerPendingDelete.id}-`))));
      toast.success(`${providerPendingDelete.label} deleted`);
      setProviderPendingDelete(null);
    } catch (error) {
      toast.error("Delete failed", { description: error?.response?.data?.detail || error.message });
    } finally {
      setDeletingProvider(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = providers.map((provider) => {
        const next = { ...provider };
        SECRET_FIELDS.forEach((field) => { if (!next[field]) delete next[field]; });
        Object.keys(next).forEach((key) => { if (key.endsWith("_masked") || key.endsWith("_set")) delete next[key]; });
        return next;
      });
      const { data } = await axios.patch(`${API}/scraper/apis`, { providers: payload });
      setProviders((data.providers || []).map((provider) => ({ ...provider, api_key: "", username: "", password: "" })));
      toast.success("Scraper API settings saved");
    } catch (error) {
      toast.error("Save failed", { description: error?.response?.data?.detail || error.message });
    } finally {
      setSaving(false);
    }
  };

  if (providers === null) return <div className="card p-6 text-sm text-slate-500" data-testid="scraper-apis-loading">Loading scraper API settings…</div>;

  const configuredCount = providers.filter((provider) => provider.api_key_set || provider.username_set || provider.password_set).length;

  return (
    <div className="card p-5" data-testid="scraper-apis-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl grid place-items-center shrink-0 bg-indigo-50 text-indigo-600"><Globe2 size={19}/></div>
          <div className="min-w-0">
            <div className="font-display font-bold text-base flex items-center gap-2">Scraper APIs <span className={`chip ${configuredCount ? "chip-success" : "chip-neutral"} text-[10px]`} data-testid="scraper-apis-status">{configuredCount ? `${configuredCount} configured` : "Not configured"}</span></div>
            <div className="text-xs text-slate-500 mt-0.5">Provider credentials and fallback order for product sourcing.</div>
          </div>
        </div>
        <button onClick={() => setOpen((value) => !value)} className="btn btn-ghost text-sm min-h-10" data-testid="scraper-apis-configure-button">{open ? "Close" : "Configure"}</button>
      </div>

      {open && <div className="mt-5 pt-5 border-t hairline grid gap-4" data-testid="scraper-apis-configure-panel">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="text-xs text-slate-500 max-w-2xl">Credentials are stored on the server and never returned to this browser. Auto tries Manual, then the enabled providers below in order, then enabled custom providers.</div>
          <div className="chip chip-primary text-[10px] font-mono" data-testid="scraper-apis-fallback-order">Auto fallback enabled</div>
        </div>

      {providers.map((provider) => {
        const isCustom = provider.type === "custom";
        const isStructured = provider.type === "structured_json";
        const isEditable = isCustom || isStructured;
        const fields = credentialFields(provider);
        return (
          <div className="rounded-lg border hairline p-5" key={provider.id} data-testid={`scraper-provider-${provider.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                {isEditable ? (
                  <input value={provider.label} onChange={(event) => update(provider.id, { label: event.target.value })} className="input px-3 py-1.5 font-display font-bold text-sm" data-testid={`scraper-provider-label-${provider.id}`}/>
                ) : <div className="font-display font-bold text-base" data-testid={`scraper-provider-name-${provider.id}`}>{provider.label}</div>}
                <div className="text-xs text-slate-500 mt-1">{isCustom ? "HTML scraper · raw response is parsed as an eBay page." : isStructured ? "Structured JSON API · response fields are mapped directly to product data." : provider.type === "scrapebadger" ? "Structured eBay AU JSON fallback · item-detail credits apply" : `Built-in fallback provider · ${provider.type}`}</div>
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600" data-testid={`scraper-provider-toggle-${provider.id}`}>
                  <input type="checkbox" checked={!!provider.enabled} onChange={(event) => update(provider.id, { enabled: event.target.checked })} className="accent-indigo-600" data-testid={`scraper-provider-enabled-${provider.id}`}/>
                  Enabled
                </label>
                <button type="button" onClick={() => setProviderPendingDelete(provider)} className="btn btn-danger !p-2" title={`Delete ${provider.label}`} data-testid={`scraper-provider-delete-${provider.id}`}><Trash2 size={13}/></button>
              </div>
            </div>

            {isCustom && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="HTTPS endpoint"><input value={provider.endpoint || ""} onChange={(event) => update(provider.id, { endpoint: event.target.value })} placeholder="https://provider.example/scrape" className="input w-full px-3 py-2 font-mono text-sm" data-testid={`scraper-provider-endpoint-${provider.id}`}/></Field>
                <Field label="Request method"><select value={provider.request_method || "get"} onChange={(event) => update(provider.id, { request_method: event.target.value })} className="input w-full px-3 py-2" data-testid={`scraper-provider-method-${provider.id}`}><option value="get">GET</option><option value="post">POST</option></select></Field>
                <Field label="Authentication"><select value={provider.auth_mode || "query"} onChange={(event) => update(provider.id, { auth_mode: event.target.value })} className="input w-full px-3 py-2" data-testid={`scraper-provider-auth-${provider.id}`}><option value="query">API key in query</option><option value="bearer">Bearer token</option><option value="basic">Basic username/password</option><option value="none">No authentication</option></select></Field>
                <div className="grid grid-cols-2 gap-3"><Field label="URL parameter"><input value={provider.url_param || "url"} onChange={(event) => update(provider.id, { url_param: event.target.value })} className="input w-full px-3 py-2 font-mono text-sm" data-testid={`scraper-provider-url-param-${provider.id}`}/></Field><Field label="API key parameter"><input value={provider.api_key_param || "api_key"} onChange={(event) => update(provider.id, { api_key_param: event.target.value })} className="input w-full px-3 py-2 font-mono text-sm" data-testid={`scraper-provider-key-param-${provider.id}`}/></Field></div>
              </div>
            )}

            {isStructured && (
              <div className="mt-4 grid gap-4" data-testid={`scraper-provider-structured-settings-${provider.id}`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Endpoint URL template"><input value={provider.endpoint || ""} onChange={(event) => update(provider.id, { endpoint: event.target.value })} placeholder="https://api.example.com/items/{item_id}" className="input w-full px-3 py-2 font-mono text-sm" data-testid={`scraper-provider-endpoint-${provider.id}`}/></Field>
                  <Field label="API key field label"><input value={provider.api_key_label || ""} onChange={(event) => update(provider.id, { api_key_label: event.target.value })} placeholder="Production API key" className="input w-full px-3 py-2 text-sm" data-testid={`scraper-provider-key-label-${provider.id}`}/></Field>
                  <Field label="Authentication method"><select value={provider.structured_auth_mode || "header"} onChange={(event) => update(provider.id, { structured_auth_mode: event.target.value })} className="input w-full px-3 py-2" data-testid={`scraper-provider-auth-mode-${provider.id}`}><option value="header">Request header</option><option value="query">Query parameter</option></select></Field>
                  <Field label={provider.structured_auth_mode === "query" ? "Query parameter name" : "Header name"}><input value={provider.structured_auth_name || ""} onChange={(event) => update(provider.id, { structured_auth_name: event.target.value })} placeholder={provider.structured_auth_mode === "query" ? "api_key" : "X-API-Key"} className="input w-full px-3 py-2 font-mono text-sm" data-testid={`scraper-provider-auth-name-${provider.id}`}/></Field>
                </div>
                <div className="border-t hairline pt-4"><div className="text-xs font-medium text-slate-700">JSON field mappings</div><div className="text-[11px] text-slate-500 mt-0.5">Use dot paths and array wildcards, e.g. <span className="font-mono">media.images[*].url</span>.</div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                  {STRUCTURED_MAPPING_FIELDS.map(([key, label, placeholder]) => <Field key={key} label={label}><input value={provider.field_mappings?.[key] || ""} onChange={(event) => update(provider.id, { field_mappings: { ...(provider.field_mappings || {}), [key]: event.target.value } })} placeholder={placeholder} className="input w-full px-3 py-2 font-mono text-sm" data-testid={`scraper-provider-mapping-${key}-${provider.id}`}/></Field>)}
                </div></div>
              </div>
            )}

            {fields.length > 0 && <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {fields.map((field) => {
                const configured = provider[`${field}_set`];
                const show = revealed[`${provider.id}-${field}`];
                return <Field key={field} label={field === "api_key" ? "API key / token" : field === "username" ? "Username / zone" : "Password"}>
                  <div className="relative"><input type={show ? "text" : "password"} value={provider[field] || ""} onChange={(event) => update(provider.id, { [field]: event.target.value })} placeholder={configured ? `Saved: ${provider[`${field}_masked`]}` : "Not configured"} className="input w-full px-3 py-2 pr-10 font-mono text-sm" data-testid={`scraper-provider-${field}-${provider.id}`}/><button type="button" onClick={() => setRevealed((current) => ({ ...current, [`${provider.id}-${field}`]: !show }))} className="btn btn-ghost !p-2 absolute right-1 top-1/2 -translate-y-1/2" title={show ? "Hide value" : "Reveal value"} data-testid={`scraper-provider-${field}-toggle-${provider.id}`}>{show ? <EyeOff size={13}/> : <Eye size={13}/>}</button></div>
                  {configured && <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-700 font-mono" data-testid={`scraper-provider-${field}-saved-${provider.id}`}><CheckCircle2 size={10}/> Saved securely</span>}
                </Field>;
              })}
            </div>}
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap"><select value={newProviderType} onChange={(event) => setNewProviderType(event.target.value)} className="input px-3 py-2 text-sm" data-testid="scraper-provider-type-choice"><option value="custom">HTML scraper</option><option value="structured_json">Structured JSON API</option></select><button type="button" onClick={() => setProviders((current) => [...current, newProviderType === "structured_json" ? emptyStructuredJson() : emptyCustom()])} className="btn btn-ghost text-sm" data-testid="scraper-provider-add-custom"><Plus size={14}/> Add provider</button></div>
        <button onClick={save} disabled={saving} className="btn btn-primary text-sm" data-testid="scraper-apis-save-button">{saving ? <Loader2 size={14} className="animate-spin"/> : <KeyRound size={14}/>} Save scraper APIs</button>
      </div>
      {providerPendingDelete && <div className="fixed inset-0 z-50 bg-slate-950/30 grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-provider-title" data-testid="scraper-provider-delete-dialog">
        <div className="w-full max-w-md rounded-lg bg-white shadow-xl border hairline p-6">
          <div id="delete-provider-title" className="font-display font-bold text-lg">Delete {providerPendingDelete.label}?</div>
          <p className="mt-2 text-sm text-slate-600">This permanently removes the provider, its saved credentials, and its usage history. This cannot be undone.</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setProviderPendingDelete(null)} disabled={deletingProvider} data-testid="scraper-provider-delete-cancel">Cancel</button>
            <button type="button" className="btn btn-danger" onClick={deleteProvider} disabled={deletingProvider} data-testid="scraper-provider-delete-confirm">{deletingProvider ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>} Delete permanently</button>
          </div>
        </div>
      </div>}
      </div>}
    </div>
  );
}