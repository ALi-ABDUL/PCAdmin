/**
 * Admin-side session helpers.
 *
 * There is intentionally no admin login flow yet — the app was built as
 * an internal dashboard and every /api route is open. However, once the
 * user starts creating additional Admin / Manager accounts inside
 * `Settings › Accounts` we need *some* concept of "who is currently
 * viewing the dashboard" so we can gate the sidebar (Managers must not
 * see Store Management / Payments / Settings).
 *
 * We keep it dead-simple: an id + role snapshot lives in localStorage
 * and can be swapped from the Accounts card by clicking "Sign in as
 * this account". The main admin id is set on first boot after the
 * accounts list loads. This is enough for the RBAC UI hiding the user
 * asked for; a proper JWT-backed admin login can layer on later.
 */

const ID_KEY = "admin_current_id";
const ROLE_KEY = "admin_current_role";

export const ADMIN_ROLES = ["admin", "manager"];

export function loadAdminSession() {
  try {
    return {
      id: localStorage.getItem(ID_KEY) || null,
      role: localStorage.getItem(ROLE_KEY) || "admin",
    };
  } catch { return { id: null, role: "admin" }; }
}

export function saveAdminSession(account) {
  try {
    if (account?.id) localStorage.setItem(ID_KEY, account.id);
    if (account?.role) localStorage.setItem(ROLE_KEY, account.role);
    window.dispatchEvent(new CustomEvent("adminsessionchange", { detail: loadAdminSession() }));
  } catch { /* private-mode: ignore */ }
}

/** Managers can only reach these top-level tabs. */
export const MANAGER_ALLOWED = new Set(["orders", "customers", "products"]);

export function canAccess(role, tabId) {
  if (role === "manager") return MANAGER_ALLOWED.has(tabId);
  return true;
}
