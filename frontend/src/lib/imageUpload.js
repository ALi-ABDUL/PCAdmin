/**
 * Read a File and return a resized JPEG data-URL, so admin-uploaded product
 * photos stay in the ~200–400 KB range instead of shipping raw 5–20 MB blobs
 * through PATCH /products/:id. Preserves aspect ratio.
 */
export async function fileToResizedDataURL(file, { maxDim = 1600, quality = 0.85 } = {}) {
  if (!file) throw new Error("No file selected");
  if (!file.type.startsWith("image/")) throw new Error("Only image files are supported");

  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("Failed to read file"));
    fr.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Not a valid image"));
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  // JPEG keeps file size small; PNG source is auto-converted (transparency lost by design for product shots).
  return canvas.toDataURL("image/jpeg", quality);
}
