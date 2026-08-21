import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BadgeCheck, Ban, Clock as ClockIcon, Loader2, ShieldCheck, Star as StarIcon, User as UserIcon, UserPlus } from "lucide-react";
import { StatusChip } from "../components/atoms";
import { API } from "../lib/api";
import { fmtDate, moneyCents } from "../lib/format";
import { usePortalAuth } from "../lib/portal-auth";
import { Orders } from "./Orders";

export function CustomerPortal() {
  const auth = usePortalAuth();
  if (auth.checking) return <div className="text-slate-500 py-24 text-center">loading portal…</div>;
  if (!auth.customer) return <PortalAuthCard onSignedIn={auth.signIn}/>;
  return <PortalDashboard auth={auth}/>;
}

export function PortalAuthCard({ onSignedIn }) {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const parseErr = (e) => {
    const d = e?.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map(x => x?.msg || "").filter(Boolean).join(" ") || e.message;
    return d?.msg || e.message;
  };

  const submit = async (evt) => {
    evt.preventDefault();
    setBusy(true); setErr("");
    try {
      const url = `${API}/portal/${mode}`;
      const body = mode === "register" ? { email, password, name } : { email, password };
      const { data } = await axios.post(url, body);
      onSignedIn(data.token, data.customer);
      toast.success(mode === "register" ? "Welcome — account created" : "Signed in");
    } catch (e) { setErr(parseErr(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="card p-6 md:p-8 max-w-xl mx-auto w-full" data-testid="portal-auth-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl grid place-items-center text-white" style={{ background: "linear-gradient(135deg, #4F46E5, #EC4899)" }}>
          <ShieldCheck size={18}/>
        </div>
        <div>
          <div className="font-display font-bold text-xl">Customer portal</div>
          <div className="text-xs text-slate-500">Sign in with the email you used at checkout to view orders and leave verified reviews.</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <button onClick={()=>setMode("login")}    className={`btn text-sm ${mode==="login"?"btn-primary":"btn-ghost"}`}    data-testid="portal-tab-login">Sign in</button>
        <button onClick={()=>setMode("register")} className={`btn text-sm ${mode==="register"?"btn-primary":"btn-ghost"}`} data-testid="portal-tab-register">Create account</button>
      </div>

      <form onSubmit={submit} className="grid gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Email</span>
          <input required type="email" value={email} onChange={(e)=>setEmail(e.target.value)} className="input px-3 py-2 text-sm" placeholder="you@example.com" data-testid="portal-email"/>
        </label>
        {mode === "register" && (
          <label className="grid gap-1">
            <span className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Display name (optional)</span>
            <input value={name} onChange={(e)=>setName(e.target.value)} className="input px-3 py-2 text-sm" placeholder="Jane Doe" data-testid="portal-name"/>
          </label>
        )}
        <label className="grid gap-1">
          <span className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Password</span>
          <input required minLength={6} type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className="input px-3 py-2 text-sm" placeholder={mode==="register"?"minimum 6 characters":"your password"} data-testid="portal-password"/>
        </label>
        {err && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3" data-testid="portal-error">{err}</div>}
        <button type="submit" disabled={busy} className="btn btn-primary text-sm" data-testid="portal-submit">
          {busy ? <Loader2 className="animate-spin" size={14}/> : mode==="register" ? <UserPlus size={14}/> : <UserIcon size={14}/>}
          {mode === "register" ? "Create account" : "Sign in"}
        </button>
        {mode === "register" && (
          <div className="text-[11px] text-slate-500">You need an existing order under this email — this stops fake reviews from non-buyers.</div>
        )}
      </form>
    </div>
  );
}

export function StarPicker({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1" data-testid="star-picker">
      {[1,2,3,4,5].map(i => (
        <button type="button" key={i} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(0)} onClick={()=>onChange(i)}
          className="text-amber-500 hover:scale-110 transition-transform" data-testid={`star-${i}`}>
          <StarIcon size={26} fill={i <= (hover || value) ? "currentColor" : "none"}/>
        </button>
      ))}
    </div>
  );
}

export function PortalReviewForm({ order, auth, onDone, onCancel }) {
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API}/portal/reviews`, { product_id: order.product_id, rating, title, body }, { headers: auth.authHeaders });
      toast.success("Review posted — thanks!");
      onDone();
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Could not post review");
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="card p-5 grid gap-3 mt-3" data-testid={`portal-review-form-${order.product_id}`}>
      <div>
        <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mb-1">Your rating</div>
        <StarPicker value={rating} onChange={setRating}/>
      </div>
      <label className="grid gap-1">
        <span className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Headline (optional)</span>
        <input value={title} onChange={(e)=>setTitle(e.target.value)} maxLength={120} className="input px-3 py-2 text-sm" placeholder="Sum it up in a sentence" data-testid="review-title"/>
      </label>
      <label className="grid gap-1">
        <span className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Your review</span>
        <textarea value={body} onChange={(e)=>setBody(e.target.value)} maxLength={4000} rows={4} className="input px-3 py-2 text-sm resize-y" placeholder="What did you love, what could be better?" data-testid="review-body"/>
      </label>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="btn btn-ghost text-sm" data-testid="review-cancel">Cancel</button>
        <button type="submit" disabled={busy} className="btn btn-primary text-sm" data-testid="review-submit">
          {busy ? <Loader2 className="animate-spin" size={14}/> : <StarIcon size={14}/>} Post review
        </button>
      </div>
    </form>
  );
}

export function PortalReviewsList({ productId, auth, refresh }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    const { data } = await axios.get(`${API}/products/${productId}/reviews`);
    setData(data);
  }, [productId]);
  useEffect(() => { load(); }, [load, refresh]);
  const vote = async (rid, choice) => {
    if (!auth.token) return;
    try {
      await axios.post(`${API}/reviews/${rid}/vote`, { vote: choice }, { headers: auth.authHeaders });
      load();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Could not vote");
    }
  };
  if (!data) return null;
  if (data.total === 0) return <div className="text-xs text-slate-500 mt-2">No reviews yet for this product.</div>;
  return (
    <div className="mt-3 grid gap-2" data-testid={`portal-reviews-list-${productId}`}>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="text-amber-500 flex items-center gap-0.5">{[1,2,3,4,5].map(i=><StarIcon key={i} size={11} fill={i<=Math.round(data.average_rating)?"currentColor":"none"}/>)}</span>
        <span className="font-mono">{data.average_rating.toFixed(1)}</span>
        <span>·</span>
        <span>{data.total} review{data.total===1?"":"s"}</span>
      </div>
      {data.reviews.slice(0, 3).map(r => (
        <div key={r.id} className="p-3 rounded-lg bg-slate-50 border" data-testid={`portal-review-${r.id}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-amber-500 flex items-center gap-0.5">{[1,2,3,4,5].map(i=><StarIcon key={i} size={11} fill={i<=r.rating?"currentColor":"none"}/>)}</span>
              <span className="text-xs font-medium">{r.customer_name}</span>
              {r.verified_purchase && <span className="chip chip-success !text-[10px] !py-0.5"><BadgeCheck size={9}/> Verified</span>}
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{fmtDate(r.created_at)}</span>
          </div>
          {r.title && <div className="text-sm font-medium mt-1">{r.title}</div>}
          {r.body && <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{r.body}</div>}
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span className="text-slate-500">Was this helpful?</span>
            <button onClick={()=>vote(r.id, "helpful")} className="btn btn-ghost !py-1 !px-2 text-[11px]" data-testid={`vote-helpful-${r.id}`}>
              👍 <span className="font-mono">{r.helpful_count}</span>
            </button>
            <button onClick={()=>vote(r.id, "not_helpful")} className="btn btn-ghost !py-1 !px-2 text-[11px]" data-testid={`vote-not-helpful-${r.id}`}>
              👎 <span className="font-mono">{r.not_helpful_count}</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PortalDashboard({ auth }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openReviewFor, setOpenReviewFor] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/portal/orders`, { headers: auth.authHeaders });
      setOrders(data.orders || []);
    } finally { setLoading(false); }
  }, [auth.authHeaders]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const totalSpend = orders.reduce((s, o) => s + (o.total || 0), 0);
  const reviewable = orders.filter(o => o.can_review && !o.already_reviewed).length;

  return (
    <div className="grid gap-4" data-testid="portal-dashboard">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Signed in as</div>
            <div className="font-display font-bold text-xl">{auth.customer.name}</div>
            <div className="text-xs text-slate-500">{auth.customer.email}</div>
          </div>
          <div className="flex gap-6 items-center">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Orders</div>
              <div className="font-mono font-bold text-lg">{orders.length}</div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Total spend</div>
              <div className="font-mono font-bold text-lg text-indigo-600">{moneyCents(totalSpend)}</div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Awaiting review</div>
              <div className="font-mono font-bold text-lg text-amber-600">{reviewable}</div>
            </div>
            <button onClick={auth.signOut} className="btn btn-ghost text-xs" data-testid="portal-signout"><Ban size={12}/> Sign out</button>
          </div>
        </div>
      </div>

      {loading && <div className="text-slate-500 py-16 text-center">Loading your orders…</div>}
      {!loading && orders.length === 0 && (
        <div className="card p-10 text-center text-slate-500">No orders yet under this email.</div>
      )}

      {orders.map(o => (
        <div key={o.id} className="card p-5" data-testid={`portal-order-${o.id}`}>
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Order {o.id.slice(0,8)}</div>
              <div className="font-medium text-sm mt-1 line-clamp-2" title={o.product_title}>{o.product_title}</div>
              <div className="text-xs text-slate-500 mt-1">
                {o.quantity} × {moneyCents(o.unit_price)} · placed {fmtDate(o.created_at)}
              </div>
            </div>
            <div className="text-right">
              <StatusChip status={o.status}/>
              <div className="font-mono font-bold text-indigo-600 mt-1">{moneyCents(o.total)}</div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            {o.already_reviewed
              ? <span className="chip chip-success"><BadgeCheck size={11}/> You've reviewed this</span>
              : o.can_review
                ? <button onClick={()=>setOpenReviewFor(openReviewFor===o.id?null:o.id)} className="btn btn-primary text-xs" data-testid={`portal-write-review-${o.id}`}>
                    <StarIcon size={12}/> {openReviewFor===o.id ? "Close" : "Write a review"}
                  </button>
                : <span className="chip chip-neutral"><ClockIcon size={11}/> Review available once processed</span>}
          </div>

          {openReviewFor === o.id && (
            <PortalReviewForm order={o} auth={auth}
              onDone={() => { setOpenReviewFor(null); setRefreshKey(k=>k+1); load(); }}
              onCancel={() => setOpenReviewFor(null)}/>
          )}

          {o.product_id && <PortalReviewsList productId={o.product_id} auth={auth} refresh={refreshKey}/>}
        </div>
      ))}
    </div>
  );
}



