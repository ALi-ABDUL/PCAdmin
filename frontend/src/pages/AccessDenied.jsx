/**
 * AccessDenied — plain 403 page rendered when the backend rejects the
 * request with `code: "country_blocked"`. Deliberately spare so it doesn't
 * leak anything about the dashboard beyond "you don't have access".
 *
 * The parent shell (App.js) mounts this in place of the full app whenever
 * the axios interceptor flips `accessDenied` state.
 */
export function AccessDenied() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-50 px-6"
      data-testid="access-denied-page"
    >
      <div className="max-w-md w-full text-center">
        <div className="text-[11px] font-mono uppercase tracking-widest text-slate-400 mb-3">
          403
        </div>
        <h1 className="text-2xl font-display font-bold text-slate-800 mb-2">
          Access Denied
        </h1>
        <p className="text-sm text-slate-500">
          You do not have permission to view this page.
        </p>
      </div>
    </div>
  );
}
