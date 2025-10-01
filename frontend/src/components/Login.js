import { GoogleLogin } from "@react-oauth/google";

export default function Login({ onLoggedIn }) {
  return (
    <GoogleLogin
      useOneTap
      onSuccess={async (cred) => {
        const r = await fetch("/api/auth/google", {  // RELATIVE path (uses proxy)
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ credential: cred.credential }),
        });
        if (!r.ok) {
          alert(`HTTP ${r.status}`);
          return;
        }
        onLoggedIn && onLoggedIn(); // fetch /api/me so your name shows up
      }}
      onError={() => alert("Google sign-in failed")}
    />
  );
}
