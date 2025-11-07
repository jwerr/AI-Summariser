import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Dashboard from "./components/Dashboard";
import Profile from "./components/Profile";
import MeetingDetail from "./components/MeetingDetail";
import MeetingThread from "./components/MeetingThread";

function Protected({ user, children }) {
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booted, setBooted] = useState(false);

  // 🔑 Hydrate from the HTTP-only cookie set by /api/auth/google/callback
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me", { credentials: "include" });
        if (res.ok) {
          const u = await res.json();
          setUser({ email: u.email, firstName: u.name, picture: u.picture });
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setBooted(true);
      }
    })();
  }, []);

  if (!booted) return null; // or a small loader

  return (
    <Router>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />} />

        {/* Auth */}
        <Route path="/login" element={<Login onLoggedIn={setUser} />} />
        <Route path="/signup" element={<Signup onSignedUp={setUser} />} />

        {/* App */}
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
