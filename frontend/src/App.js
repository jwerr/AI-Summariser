// src/App.js
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useEffect, useState } from "react";

import Login from "./components/Login";
import Signup from "./components/Signup";
import Profile from "./components/Profile";

import AppShell from "./components/layout/AppShell.jsx";
import DashboardPage from "./components/pages/DashboardPage.js";
import MeetingsPage from "./components/pages/MeetingsPage.js";
import MeetingPage from "./components/pages/MeetingPage.js";
import UploadsPage from "./components/pages/UploadsPage.js";

// --- helpers --------------------------------------------------------------

const API_ME_ENDPOINTS = ["/api/me", "/api/auth/me"];

async function fetchMe() {
  for (const url of API_ME_ENDPOINTS) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) return await res.json();
    } catch {
      // ignore and try next endpoint
    }
  }
  return null;
}

function Protected({ user, children }) {
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function OAuthQueryCleanup() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("google")) {
      params.delete("google");
      navigate(
        { pathname: location.pathname, search: params.toString() },
        { replace: true }
      );
    }
  }, [location, navigate]);
  return null;
}

// --- app ------------------------------------------------------------------

export default function App() {
  const [user, setUser] = useState(null);
  const [booted, setBooted] = useState(false);

  // theme: 'light' | 'dark'
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem("ai_summariser_theme") || "light";
  });

  // load current user
  useEffect(() => {
    (async () => {
      const me = await fetchMe();
      if (me) {
        setUser({
          id: me.id || me.user_id || me.uid || null,
          email: me.email,
          name: me.name || me.first_name || me.given_name,
          picture: me.picture,
        });
      } else {
        setUser(null);
      }
      setBooted(true);
    })();
  }, []);

  // apply theme to <html> and persist
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("ai_summariser_theme", theme);
  }, [theme]);

  const handleToggleTheme = () =>
    setTheme((t) => (t === "light" ? "dark" : "light"));

  if (!booted) {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          height: "100vh",
          fontSize: 12,
          color: "#666",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <Router>
      <OAuthQueryCleanup />
      <Routes>
        {/* Redirect root based on auth */}
        <Route
          path="/"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* Public auth routes */}
        <Route path="/login" element={<Login onLoggedIn={setUser} />} />
        <Route path="/signup" element={<Signup onSignedUp={setUser} />} />

        {/* Protected app shell with sidebar/topbar; nested pages render via <Outlet /> */}
        <Route
          element={
            <Protected user={user}>
              <AppShell
                user={user}
                onLogout={() => setUser(null)}
                theme={theme}
                onToggleTheme={handleToggleTheme}
              />
            </Protected>
          }
        >
          <Route path="/dashboard" element={<DashboardPage user={user} />} />
          <Route path="/meetings" element={<MeetingsPage user={user} />} />
          <Route path="/meetings/:id" element={<MeetingPage />} />
          <Route path="/uploads" element={<UploadsPage />} />
          <Route
            path="/profile"
            element={<Profile user={user} onLogout={() => setUser(null)} />}
          />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
