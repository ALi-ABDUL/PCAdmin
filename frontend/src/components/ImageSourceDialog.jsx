import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2, Upload, X } from "lucide-react";
import { fileToResizedDataURL } from "../lib/imageUpload";

/**
 * Modal that lets admins add or replace a product image using either the
 * local file picker (uploaded from PC, resized to ≤1600 px JPEG) or a URL.
 *
 * onSubmit(imageString) fires once — the parent handles PATCHing the product.
 */
export function ImageSourceDialog({ open, mode = "add", initialUrl = "", onClose, onSubmit }) {
  const [tab, setTab] = useState("upload");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialUrl ? "url" : "upload");
    setUrl(initialUrl || "");
    setFile(null);
    setPreview("");
    setBusy(false);
  }, [open, initialUrl]);

  // Release blob URL created by URL.createObjectURL when the preview changes or
  // the dialog closes — prevents small memory leaks after many uploads.
  useEffect(() => {
    return () => { if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview); };
  }, [preview]);

  if (!open) return null;

  const title = mode === "replace" ? "Replace image" : "Add image";
  const submitLabel = mode === "replace" ? "Replace" : "Add image";

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Please pick an image file"); return; }
    if (f.size > 15 * 1024 * 1024) { toast.error("Image too large (max 15 MB)"); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    setBusy(true);
    try {
      let value = "";
      if (tab === "upload") {
        if (!file) { toast.error("Please pick a file first"); setBusy(false); return; }
        value = await fileToResizedDataURL(file);
      } else {
        const trimmed = (url || "").trim();
        if (!trimmed) { toast.error("Please paste an image URL"); setBusy(false); return; }
        if (!/^https?:\/\//i.test(trimmed)) { toast.error("URL must start with http:// or https://"); setBusy(false); return; }
        value = trimmed;
      }
      await onSubmit(value);
      onClose();
    } catch (e) {
      toast.error("Something went wrong", { description: e?.message });
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
      data-testid="image-source-dialog"
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b hairline">
          <div className="font-display font-bold">{title}</div>
          <button onClick={onClose} className="btn btn-ghost !p-1.5" data-testid="image-dialog-close" aria-label="Close">
            <X size={14}/>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1.5 bg-slate-50 border-b hairline">
          <button
            onClick={() => setTab("upload")}
            className={`flex items-center justify-center gap-2 text-xs font-medium py-2 rounded-lg transition-colors ${tab === "upload" ? "bg-white shadow-sm text-indigo-600" : "text-slate-500 hover:text-slate-800"}`}
            data-testid="image-dialog-tab-upload"
          >
            <Upload size={13}/> Upload from PC
          </button>
          <button
            onClick={() => setTab("url")}
            className={`flex items-center justify-center gap-2 text-xs font-medium py-2 rounded-lg transition-colors ${tab === "url" ? "bg-white shadow-sm text-indigo-600" : "text-slate-500 hover:text-slate-800"}`}
            data-testid="image-dialog-tab-url"
          >
            <Link2 size={13}/> Paste URL
          </button>
        </div>

        <div className="p-4">
          {tab === "upload" ? (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onPickFile}
                className="hidden"
                data-testid="image-dialog-file-input"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors"
                data-testid="image-dialog-file-picker"
              >
                {preview ? (
                  <img src={preview} alt="preview" className="w-32 h-32 object-cover mx-auto rounded-lg"/>
                ) : (
                  <>
                    <Upload size={22} className="mx-auto mb-2 text-slate-400"/>
                    <div className="text-sm font-medium text-slate-700">Click to choose an image</div>
                    <div className="text-xs text-slate-500 mt-1">JPG, PNG, WEBP · up to 15 MB</div>
                  </>
                )}
              </button>
              {file && (
                <div className="mt-2 text-xs text-slate-500 font-mono truncate" data-testid="image-dialog-filename">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Image URL</label>
              <input
                type="url"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="input w-full px-3 py-2 text-sm font-mono"
                data-testid="image-dialog-url-input"
              />
              {url && /^https?:\/\//i.test(url) && (
                <div className="mt-3 rounded-lg overflow-hidden border hairline bg-slate-50 h-32 flex items-center justify-center">
                  <img src={url} alt="preview" className="max-h-32 max-w-full object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }}/>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t hairline bg-slate-50">
          <button onClick={onClose} className="btn btn-ghost text-sm" data-testid="image-dialog-cancel">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || (tab === "upload" ? !file : !url)}
            className="btn btn-primary text-sm"
            data-testid="image-dialog-submit"
          >
            {busy ? <Loader2 className="animate-spin" size={13}/> : <Upload size={13}/>} {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
