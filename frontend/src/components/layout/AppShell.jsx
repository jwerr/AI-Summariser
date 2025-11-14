// src/components/layout/AppShell.jsx
import { useMemo, useState } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import FloatingBackButton from "../FloatingBackButton";

const LS_KEY = "ai_summariser_user";

function readLocalUser() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "null");
  } catch {
    return null;
  }
}

export default function AppShell({
  user: userProp,
  onLogout,
  theme = "light",
  onToggleTheme,
}) {
  const navigate = useNavigate();
  const user = useMemo(() => userProp || readLocalUser() || {}, [userProp]);

  // sidebar collapsed by default
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const initials =
    (user?.name?.trim()?.[0] ||
      user?.email?.trim()?.[0] ||
      "U").toUpperCase();

  const goProfile = () => navigate("/profile");

  // global logout used by Sidebar + Profile
  const logout = async () => {
    try {
      await fetch(
        (process.env.REACT_APP_API_URL || "") + "/api/auth/logout",
        { method: "POST", credentials: "include" }
      );
    } catch {
      // ignore network errors, still clear UI session
    }
    onLogout?.();
    navigate("/login");
  };

  const isDark = theme === "dark";
  const toggleLabel = isDark ? "Switch to light mode" : "Switch to dark mode";
  const toggleIcon = isDark ? "☀️" : "🌙";

  const toggleSidebar = () => setSidebarOpen((v) => !v);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 bg-[radial-gradient(circle_at_top,_#e0f2fe,_transparent_60%)] dark:bg-[radial-gradient(circle_at_top,_#020617,_transparent_55%)]">
      {/* === SIDEBAR (overlay, does NOT push content) === */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:bg-black/40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 bottom-0 z-40 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-xl transform transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 py-4 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={toggleSidebar}
            className="h-9 w-9 rounded-2xl bg-gradient-to-br from-purple-500 to-fuchsia-500 shadow-md flex items-center justify-center text-white font-semibold"
          >
            AM
          </button>
          <div className="font-semibold text-sm text-slate-900 dark:text-slate-50">
            AI Meeting Summariser
          </div>
        </div>
        <div className="p-3 h-full">
          <Sidebar
            onNavigate={() => setSidebarOpen(false)}
            onLogout={logout}           
          />
        </div>
      </aside>

      {/* === TOP BAR === */}
      <header className="h-16 px-4 lg:px-8 flex items-center justify-between border-b border-slate-200/70 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/90 backdrop-blur-sm sticky top-0 z-10">
        {/* Left: logo button – opens sidebar */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleSidebar}
            className="h-9 w-9 rounded-2xl bg-gradient-to-br from-purple-500 to-fuchsia-500 shadow-md flex items-center justify-center text-white font-semibold"
            title="Open navigation"
          >
            AM
          </button>
          <span className="hidden sm:inline text-sm font-semibold text-slate-800 dark:text-slate-100">
            AI Meeting Summariser
          </span>
        </div>

        {/* Right: theme toggle + profile */}
        <div className="flex items-center gap-3">
          {/* Theme toggle */}
          <button
            type="button"
            onClick={onToggleTheme}
            title={toggleLabel}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <span>{toggleIcon}</span>
            <span className="hidden sm:inline">
              {isDark ? "Light mode" : "Dark mode"}
            </span>
          </button>

          {/* Profile */}
          <button
            onClick={goProfile}
            title="Profile"
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            type="button"
          >
            <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-purple-600 text-white text-sm font-medium">
              {initials}
            </span>
            <span className="hidden sm:block text-sm font-medium text-slate-800 dark:text-slate-100 truncate max-w-[14rem]">
              {user?.name || user?.email || "Profile"}
            </span>
          </button>
        </div>
      </header>

      {/* === MAIN CONTENT === */}
      <main className="px-4 lg:px-8 py-6">
        <div className="max-w-6xl mx-auto">
          {/* Profile (and others) can call logout from Outlet context */}
          <Outlet context={{ logout }} />
        </div>
      </main>
      <FloatingBackButton />
    </div>
  );
}
