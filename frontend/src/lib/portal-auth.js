import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API } from "./api";

export const PORTAL_TOKEN_KEY = "portalToken";

export function usePortalAuth() {
  const [token, setToken] = useState(() => localStorage.getItem(PORTAL_TOKEN_KEY) || "");
  const [customer, setCustomer] = useState(null);
  const [checking, setChecking] = useState(!!token);
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const load = useCallback(async () => {
    if (!token) { setChecking(false); return; }
    try {
      const { data } = await axios.get(`${API}/portal/me`, { headers: { Authorization: `Bearer ${token}` } });
      setCustomer(data.customer);
    } catch (e) {
      localStorage.removeItem(PORTAL_TOKEN_KEY); setToken(""); setCustomer(null);
    } finally { setChecking(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const signIn = (t, cust) => { localStorage.setItem(PORTAL_TOKEN_KEY, t); setToken(t); setCustomer(cust); };
  const signOut = () => { localStorage.removeItem(PORTAL_TOKEN_KEY); setToken(""); setCustomer(null); };

  return { token, customer, checking, authHeaders, signIn, signOut };
}

