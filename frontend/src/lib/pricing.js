import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "./api";

export const PRICING_FALLBACK = { marginPct: 20, minProfit: 20 };
export const calcPricingWithRules = (ebayPrice, rules) => {
  const ebay = Number(ebayPrice) || 0;
  if (ebay <= 0) return { ebay: 0, sell: 0, profit: 0, matched: null };
  const sorted = (rules || []).filter((r) => r.active).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  let matched = null;
  for (const r of sorted) {
    const min = Number(r.min_price) || 0;
    const max = r.max_price == null ? Infinity : Number(r.max_price);
    if (ebay >= min && ebay < max) { matched = r; break; }
  }
  let sell;
  if (matched) {
    sell = matched.kind === "percent" ? ebay * (1 + Number(matched.value) / 100) : ebay + Number(matched.value);
  } else {
    sell = ebay * (1 + PRICING_FALLBACK.marginPct / 100) + PRICING_FALLBACK.minProfit;
  }
  sell = Math.round(sell * 100) / 100;
  return { ebay, sell, profit: Math.round((sell - ebay) * 100) / 100, matched };
};
// Back-compat name used elsewhere in the file — now defers to rules-aware calc when
// callers pass a rules[] as the 2nd arg.
export const calcPricing = (ebay, rules) => {
  const r = calcPricingWithRules(ebay, rules);
  return { ebay: r.ebay, sell: r.sell, profit: r.profit };
};

// Tiny global cache so components sharing this file all share one fetch.
let _pricingRulesCache = null;
let _pricingRulesPromise = null;
export const _pricingRulesListeners = new Set();
export const _refreshPricingRules = async () => {
  _pricingRulesPromise = axios.get(`${API}/pricing-rules`).then((r) => {
    _pricingRulesCache = r.data.rules || [];
    _pricingRulesListeners.forEach((fn) => fn(_pricingRulesCache));
    return _pricingRulesCache;
  });
  return _pricingRulesPromise;
};
export const usePricingRules = () => {
  const [rules, setRules] = useState(_pricingRulesCache || []);
  useEffect(() => {
    _pricingRulesListeners.add(setRules);
    if (_pricingRulesCache == null && !_pricingRulesPromise) _refreshPricingRules();
    else if (_pricingRulesCache) setRules(_pricingRulesCache);
    return () => _pricingRulesListeners.delete(setRules);
  }, []);
  return [rules, _refreshPricingRules];
};

