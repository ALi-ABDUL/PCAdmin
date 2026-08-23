import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * Floating "back to top" pill that appears after the user scrolls past
 * `threshold` px on the given `scrollTarget` (defaults to window).
 *
 * The scaffold layout scrolls the <main> element (not <html>), so callers
 * that mount this INSIDE a scrollable panel should pass a ref to that panel.
 * When no `scrollTarget` is supplied we track both `window.scrollY` and the
 * nearest scrollable ancestor via a subtle `scroll` capture — this makes the
 * button robust regardless of which container actually scrolls in the layout.
 */
export function BackToTopButton({ threshold = 240, testId = "back-to-top" }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Find the nearest scrollable ancestor once the component mounts.
    // The Emergent scaffold typically scrolls <main> which is the direct
    // parent of the tab content.
    const check = () => {
      // Window scroll
      if (window.scrollY > threshold) return setVisible(true);
      // Common scrollable containers in the app
      const candidates = [
        document.scrollingElement,
        document.querySelector("main"),
        document.querySelector('[data-scroll-root="1"]'),
      ].filter(Boolean);
      for (const el of candidates) {
        if (el && el.scrollTop > threshold) return setVisible(true);
      }
      setVisible(false);
    };
    check();
    // Listen in capture mode so we catch scrolls inside nested containers too.
    window.addEventListener("scroll", check, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", check, { capture: true });
  }, [threshold]);

  const scrollTop = () => {
    // Scroll the window first
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
    // Also scroll any inner scrollable container
    for (const el of [
      document.scrollingElement,
      document.querySelector("main"),
      document.querySelector('[data-scroll-root="1"]'),
    ]) {
      if (el && el.scrollTop > 0) {
        try {
          el.scrollTo({ top: 0, behavior: "smooth" });
        } catch {
          el.scrollTop = 0;
        }
      }
    }
  };

  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={scrollTop}
      data-testid={testId}
      aria-label="Back to top"
      title="Back to top"
      className="fixed bottom-6 right-6 z-40 rounded-full bg-slate-900 text-white shadow-lg border hairline w-11 h-11 grid place-items-center hover:bg-indigo-600 hover:scale-105 active:scale-95 transition"
    >
      <ArrowUp size={18} />
    </button>
  );
}
