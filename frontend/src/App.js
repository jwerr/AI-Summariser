import { useEffect, useState, useCallback } from "react";
import Login from "./components/Login";

export default function App() {
  const [me, setMe] = useState(null);
  const [err, setErr] = useState("");

  // fetch current user from session cookie
  const fetchMe = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { credentials: "include" });
      setMe(r.ok ? await r.json() : null);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const logout = async () => {
    setErr("");
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    setMe(null);
  };

  return (
    <div className="min-h-screen bg-red-600 text-white">
      {/* Header */}
      <header className="w-full px-6 py-3 border-b bg-white">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold">AI Summariser</h1>

          {/* Right side: Login / User */}
          <div>
            {me ? (
              <div className="flex items-center gap-3">
                {me.picture && (
                  <img
                    src={me.picture}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                )}
                <span className="text-sm">{me.name || me.email}</span>
                <button className="px-3 py-1 border rounded" onClick={logout}>
                  Logout
                </button>
              </div>
            ) : (
              // pass fetchMe so name shows immediately after sign-in
              <Login onLoggedIn={fetchMe} />
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto p-6">
        {err && <p className="text-red-600 text-sm">{err}</p>}
        {me ? (
          <p className="text-gray-700">Welcome, <b>{me.name || me.email}</b> 👋</p>
        ) : (
          <p className="text-gray-600">Please sign in to continue.</p>
        )}
      </main>
    </div>
  );
}
