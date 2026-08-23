import { ExternalLink, ImageIcon } from "lucide-react";
import { statusBadge } from "./atoms";
import { CatIcon } from "./icons";
import { proxyImg } from "../lib/api";
import { moneyCents } from "../lib/format";

/**
 * Shared responsive product grid card.
 *
 * Layout:
 *  - Desktop  (≥ lg / 1024px): 4 columns
 *  - Tablet   (≥ md / 768px):  2 columns
 *  - Mobile   (<  md):          1 column
 *
 * Clicking anywhere on the card fires `onOpen(product)` which navigates to the
 * product edit page. The small eBay ExternalLink icon inside the card opens
 * `product.source_url` in a new tab and its click is stopped so it does not
 * bubble up to the card itself.
 *
 * Empty `list` renders a hint block instead of a bare grid.
 */
export function ProductGrid({
  list = [],
  onOpen = () => {},
  emptyLabel = "No products in this bucket yet.",
  cats = [],
  showBulkCheckbox = false,
  selected = new Set(),
  onToggleSelect = () => {},
  extraActions = null,   // (product) => JSX rendered at the bottom of the card, e.g. Archive / Restore
  tone = "default",      // "default" | "warning" | "danger" — controls stock accent
  testId = "product-grid",
}) {
  if (!list || list.length === 0) {
    return (
      <div className="card p-10 text-center text-slate-500" data-testid={`${testId}-empty`}>{emptyLabel}</div>
    );
  }
  const catBySlug = (slug) => cats.find((c) => c.slug === slug);

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      data-testid={testId}
    >
      {list.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          onOpen={onOpen}
          cat={catBySlug(p.category)}
          showBulkCheckbox={showBulkCheckbox}
          isSelected={selected.has(p.id)}
          onToggleSelect={onToggleSelect}
          extraActions={extraActions}
          tone={tone}
        />
      ))}
    </div>
  );
}

function ProductCard({
  product: p,
  onOpen,
  cat,
  showBulkCheckbox,
  isSelected,
  onToggleSelect,
  extraActions,
  tone,
}) {
  const badge = statusBadge(p);
  const dead = p.is_sold || !p.active || (p.stock_status && p.stock_status !== "live");
  const stockClass =
    (p.stock ?? 0) <= 0
      ? "text-red-600"
      : (p.stock ?? 0) <= 3
      ? "text-amber-600"
      : "text-emerald-600";
  const toneRing =
    tone === "danger"
      ? "ring-2 ring-red-100"
      : tone === "warning"
      ? "ring-2 ring-amber-100"
      : "";

  const stop = (e) => e.stopPropagation();
  const openEbay = (e) => {
    e.stopPropagation();
    if (p.source_url) window.open(p.source_url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(p)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(p);
        }
      }}
      data-testid={`product-card-${p.id}`}
      className={`group card p-0 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition cursor-pointer flex flex-col ${
        dead ? "opacity-70" : ""
      } ${isSelected ? "ring-2 ring-indigo-400" : toneRing}`}
    >
      {/* ---- Image ---- */}
      <div
        className={`relative aspect-square w-full bg-slate-100 overflow-hidden ${
          dead ? "grayscale" : ""
        }`}
      >
        {p.images?.[0] ? (
          <img
            src={proxyImg(p.images[0])}
            alt={p.title}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-slate-300">
            <ImageIcon size={40} />
          </div>
        )}
        {badge && (
          <span
            className={`chip ${badge.cls} !text-[10px] !py-0.5 absolute top-2 left-2 shadow-sm`}
            data-testid={`product-card-badge-${p.id}`}
          >
            {badge.label}
          </span>
        )}
        {showBulkCheckbox && (
          <label
            className="absolute top-2 right-2 bg-white/90 backdrop-blur rounded p-1 shadow-sm cursor-pointer"
            onClick={stop}
          >
            <input
              type="checkbox"
              className="accent-indigo-600 w-4 h-4 block"
              checked={isSelected}
              onChange={() => onToggleSelect(p.id)}
              data-testid={`product-card-check-${p.id}`}
            />
          </label>
        )}
        {p.source_url && (
          <button
            type="button"
            onClick={openEbay}
            data-testid={`product-card-ebay-${p.id}`}
            title="Open original eBay listing"
            className="absolute bottom-2 right-2 bg-white/95 hover:bg-white text-slate-700 hover:text-indigo-600 rounded-full p-1.5 shadow-sm border hairline transition"
          >
            <ExternalLink size={14} />
          </button>
        )}
      </div>

      {/* ---- Body ---- */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div
          className="text-sm font-medium leading-snug line-clamp-2 min-h-[2.5em]"
          data-testid={`product-card-title-${p.id}`}
        >
          {p.title}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="font-mono font-bold text-indigo-600 text-base" data-testid={`product-card-price-${p.id}`}>
            {moneyCents(p.price)}
          </div>
          <div
            className={`text-[11px] font-mono ${stockClass}`}
            data-testid={`product-card-stock-${p.id}`}
          >
            {(p.stock ?? 0) <= 0
              ? "Out of stock"
              : `${p.stock} in stock`}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {cat ? (
              <span
                className="chip inline-flex items-center gap-1 !text-[10px] truncate max-w-[110px]"
                style={{ background: `${cat.color}18`, color: cat.color }}
              >
                <CatIcon name={cat.icon} size={10} /> {cat.name}
              </span>
            ) : (
              p.category && (
                <span className="chip chip-neutral !text-[10px] capitalize truncate max-w-[110px]">
                  {p.category}
                </span>
              )
            )}
          </div>
          {p.product_code && (
            <span
              className="font-mono text-indigo-600 font-bold shrink-0"
              data-testid={`product-card-code-${p.id}`}
            >
              {p.product_code}
            </span>
          )}
        </div>

        {extraActions && (
          <div
            className="pt-2 mt-auto border-t hairline flex items-center gap-1 justify-end"
            onClick={stop}
          >
            {extraActions(p)}
          </div>
        )}
      </div>
    </div>
  );
}
