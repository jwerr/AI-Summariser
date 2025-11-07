import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { Link, useNavigate } from "react-router-dom";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

export default function Login({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function fetchMe() {
    const r = await fetch(`${API}/api/me`, { credentials: "include" });
    if (!r.ok) throw new Error(`me() failed: ${r.status}`);
    return r.json();
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setError("Invalid credentials");
        return;
      }

      // use cookie-based session to load full profile
      const profile = await fetchMe();
      onLoggedIn(profile);
      navigate("/dashboard");
    } catch (err) {
      console.error(err);
      setError("Something went wrong");
    }
  };

  async function onGoogleCredential(credential) {
    setError("");
    try {
      // 1) Exchange Google credential with backend (sets session cookie)
      const r = await fetch(`${API}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // IMPORTANT: allow cookie
        body: JSON.stringify({ credential }),
      });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(`Google auth failed: ${r.status} ${msg}`);
      }

      // 2) Fetch profile using the cookie
      const profile = await fetchMe(); // { id, email, name, picture, ... }
      onLoggedIn(profile);
      navigate("/dashboard");
    } catch (e) {
      console.error(e);
      setError("Google sign-in failed");
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-r from-purple-200 to-indigo-200">
      <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md">
        <h2 className="text-3xl font-bold text-center text-purple-700 mb-6">
          Welcome Back
        </h2>

        <GoogleLogin
          onSuccess={(resp) => onGoogleCredential(resp.credential)}
          onError={() => setError("Google sign-in failed")}
        />

        <div className="my-4 text-gray-500 flex items-center">
          <hr className="flex-grow border-gray-300" />
          <span className="px-2">or</span>
          <hr className="flex-grow border-gray-300" />
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:ring focus:ring-purple-300"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:ring focus:ring-purple-300"
            required
          />
          <button
            type="submit"
            className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white py-2 rounded-lg hover:opacity-90"
          >
            Sign In →
          </button>
        </form>

        <p className="mt-4 text-center text-sm">
          Don’t have an account?{" "}
          <Link to="/signup" className="text-purple-600 font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
