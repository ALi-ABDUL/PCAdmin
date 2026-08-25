/**
 * Admin-side session helpers.
 *
 * The active session lives in localStorage under a small handful of keys.
 * It's swapped in three places:
 *   1. `AdminLoginScreen` on successful email+password verification.
 *   2. Settings › Accounts row action "Sign in as".
 *   3. Header shortcut "Switch to main admin".
 *
 * On boot, if there's no session id we render `AdminLoginScreen` in App.js
 * so nobody sees the dashboard before entering credentials.
 */

const ID_KEY    = "admin_current_id";
const ROLE_KEY  = "admin_current_role";
const NAME_KEY  = "admin_current_name";
const EMAIL_KEY = "admin_current_email";

export const ADMIN_ROLES = ["admin", "manager"];

export function loadAdminSession() {
  try {
    return {
      id:    localStorage.getItem(ID_KEY)    || null,
      role:  localStorage.getItem(ROLE_KEY)  || null,
      name:  localStorage.getItem(NAME_KEY)  || null,
      email: localStorage.getItem(EMAIL_KEY) || null,
    };
  } catch { return { id: null, role: null, name: null, email: null }; }
}

export function saveAdminSession(account) {
  try {
    if (!account?.id) return;
    localStorage.setItem(ID_KEY,    account.id);
    localStorage.setItem(ROLE_KEY,  account.role || "manager");
    localStorage.setItem(NAME_KEY,  account.name || "");
    localStorage.setItem(EMAIL_KEY, account.email || "");
    window.dispatchEvent(new CustomEvent("adminsessionchange", { detail: loadAdminSession() }));
  } catch { /* private-mode: ignore */ }
}

export function clearAdminSession() {
  try {
    [ID_KEY, ROLE_KEY, NAME_KEY, EMAIL_KEY].forEach(k => localStorage.removeItem(k));
    window.dispatchEvent(new CustomEvent("adminsessionchange", { detail: loadAdminSession() }));
  } catch { /* ignore */ }
}

/** Whether the session is signed in (all four keys populated). */
export function hasAdminSession() {
  const s = loadAdminSession();
  return !!(s.id && s.role);
}

/** Managers can only reach these top-level tabs. */
export const MANAGER_ALLOWED = new Set(["orders", "customers", "products"]);

export function canAccess(role, tabId) {
  if (role === "manager") return MANAGER_ALLOWED.has(tabId);
  return true;
}
