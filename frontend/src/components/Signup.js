import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function Signup({ onSignedUp }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const navigate = useNavigate();

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (email !== confirmEmail) {
      setError("Emails do not match!");
      return;
    }

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        // 👇 match backend’s field names exactly
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          password,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        onSignedUp(data);

        setSuccess(
          `Hey ${firstName}, you have entered into AI Summarizing World 🚀`
        );

        setTimeout(() => navigate("/login"), 2000);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || "Signup failed. Try again.");
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-r from-purple-200 to-indigo-200">
      <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md">
        <h2 className="text-3xl font-bold text-center text-purple-700 mb-6">
          Create Account
        </h2>

        {success && (
          <div className="bg-green-100 text-green-700 p-3 rounded mb-4 text-center font-medium">
            {success}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          {error && (
            <p className="text-red-600 text-sm font-medium">{error}</p>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="First Name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-1/2 px-4 py-2 border rounded-lg focus:ring focus:ring-purple-300"
              required
            />
            <input
              type="text"
              placeholder="Last Name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-1/2 px-4 py-2 border rounded-lg focus:ring focus:ring-purple-300"
            />
          </div>

          <input
            type="email"
            placeholder="Email Address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:ring focus:ring-purple-300"
            required
          />

          <input
            type="email"
            placeholder="Confirm Email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
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
            className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white py-2 rounded-lg font-semibold hover:opacity-90 transition"
          >
            Sign Up →
          </button>
        </form>

        <p className="mt-4 text-center text-sm">
          Already have an account?{" "}
          <Link to="/login" className="text-purple-600 font-medium">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}
