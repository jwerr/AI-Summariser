// frontend/src/App.js
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
import Dashboard from "./components/Dashboard";
import Profile from "./components/Profile";
// Delete these two if you don't have them:
import MeetingDetail from "./components/MeetingDetail";
import MeetingThread from "./components/MeetingThread";

const API_ME_ENDPOINTS = ["/api/me", "/api/auth/me"];

async function fetchMe() {
  for (const url of API_ME_ENDPOINTS) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) return await res.json();
    } catch {}
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
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }, [location, navigate]);
  return null;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await fetchMe();
      if (me) {
        setUser({
          id: me.id || me.user_id || me.uid || null,
          email: me.email,
          firstName: me.name || me.first_name || me.given_name,
          picture: me.picture,
        });
      } else {
        setUser(null);
      }
      setBooted(true);
    })();
  }, []);

  if (!booted) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh", fontSize: 12, color: "#666" }}>
        Loading…
      </div>
    );
  }

  return (
    <Router>
      <OAuthQueryCleanup />
      <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />} />
        <Route path="/login" element={<Login onLoggedIn={setUser} />} />
        <Route path="/signup" element={<Signup onSignedUp={setUser} />} />
        <Route
          path="/dashboard"
          element={
            <Protected user={user}>
              <Dashboard user={user} onLogout={() => setUser(null)} />
            </Protected>
          }
        />
        <Route
          path="/profile"
          element={
            <Protected user={user}>
              <Profile user={user} onLogout={() => setUser(null)} />
            </Protected>
          }
        />
        {/* Remove these if the files don't exist */}
        <Route
          path="/meetings/:id"
          element={
            <Protected user={user}>
              <MeetingDetail />
            </Protected>
          }
        />
        <Route
          path="/meeting/:id"
          element={
            <Protected user={user}>
              <MeetingThread user={user} />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
