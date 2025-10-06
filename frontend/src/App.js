import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useState } from "react";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Dashboard from "./components/Dashboard";
import Profile from "./components/Profile";

export default function App() {
  const [user, setUser] = useState(null);

  return (
    <Router>
      <Routes>
        {/* Root route -> if logged in go to Dashboard, else go to Login */}
        <Route
          path="/"
          element={
            user ? <Navigate to="/dashboard" /> : <Navigate to="/login" />
          }
        />

        {/* Login & Signup */}
        <Route path="/login" element={<Login onLoggedIn={setUser} />} />
        <Route path="/signup" element={<Signup onSignedUp={setUser} />} />

        {/* Dashboard */}
        <Route
          path="/dashboard"
          element={
            user ? (
              <Dashboard user={user} onLogout={() => setUser(null)} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        {/* Profile Page */}
        <Route
          path="/profile"
          element={
            user ? (
              <Profile user={user} onLogout={() => setUser(null)} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </Router>
  );
}