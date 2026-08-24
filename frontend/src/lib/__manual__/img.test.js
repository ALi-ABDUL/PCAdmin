/**
 * Vitest/Jest-style tests are not wired for this repo; this file documents
 * the invariants of `imgAtSize / imgThumb / imgFull` for manual reference.
 * Run under Node: `node -r esbuild-register frontend/src/lib/__manual__/img.js`
 * (not part of CI — the backend pytest suite covers the equivalent server-
 * side signature helpers).
 */

// eslint-disable-next-line import/no-unresolved
const { imgAtSize, imgThumb, imgFull } = require("../api");

const cases = [
  ["ebay s-l1600 → s-l300",
    "https://i.ebayimg.com/images/g/ABC/s-l1600.webp",
    imgThumb("https://i.ebayimg.com/images/g/ABC/s-l1600.webp"),
    "https://i.ebayimg.com/images/g/ABC/s-l300.webp"],
  ["ebay s-l500 → s-l1600",
    "https://i.ebayimg.com/images/g/ABC/s-l500.jpg",
    imgFull("https://i.ebayimg.com/images/g/ABC/s-l500.jpg"),
    "https://i.ebayimg.com/images/g/ABC/s-l1600.jpg"],
  ["non-ebay URL untouched",
    "https://cdn.example.com/hero.png",
    imgThumb("https://cdn.example.com/hero.png"),
    "https://cdn.example.com/hero.png"],
  ["null-safe",
    "", imgAtSize("", 300), ""],
];

for (const [name, _in, actual, expected] of cases) {
  if (actual !== expected) {
    console.error("FAIL", name, "got", actual, "want", expected);
    process.exit(1);
  }
}
console.log("frontend img helpers OK", cases.length, "cases");
