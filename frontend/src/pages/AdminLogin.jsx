import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { API } from "../lib/api";
import { saveAdminSession } from "../lib/adminSession";

/**
 * Full-screen admin login. Shown by App.js whenever the localStorage
 * session is empty (fresh browser, after logout, or after wiping
 * "Admin session" from Settings › Cache). Successful login drops the
 * account into localStorage and reloads the shell.
 */
export function AdminLoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (!email || !password) { setErr("Enter your email and password"); return; }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/admin-accounts/login`, {
        email: email.trim().toLowerCase(), password,
      });
      saveAdminSession(data);
      toast.success(`Welcome back, ${data.name || data.email}`);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Login failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10" data-testid="admin-login-screen">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto grid place-items-center rounded-2xl text-white shadow-lg shadow-indigo-500/25" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}>
            <ShieldCheck size={20}/>
          </div>
          <div className="font-display font-bold text-2xl mt-3">Admin Sign in</div>
          <div className="text-sm text-slate-500 mt-1">Enter your Admin or Manager credentials.</div>
        </div>

        <form onSubmit={submit} className="card p-6 grid gap-3" data-testid="admin-login-form">
          <label className="block">
            <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-1">Email</div>
            <input
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input px-3 py-2 w-full font-mono"
              data-testid="admin-login-email"
            />
          </label>
          <label className="block">
            <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-1">Password</div>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input px-3 py-2 w-full font-mono"
              data-testid="admin-login-password"
            />
          </label>

          {err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="admin-login-error">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary w-full py-2.5 mt-1"
            data-testid="admin-login-submit"
          >
            {busy ? <><Loader2 size={14} className="animate-spin"/> Signing in…</> : <><LogIn size={14}/> Sign in</>}
          </button>
        </form>

        <div className="mt-4 text-center text-[11px] text-slate-400 font-mono">
          eBay AU Scraper Admin · v1.1
        </div>
      </div>
    </div>
  );
}
