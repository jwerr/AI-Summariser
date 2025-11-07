// src/components/Profile.js
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";
const LS_KEY = "ai_summariser_user";
const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024; // ~1.5MB base64 payload guard

const readLocalUser = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "null");
  } catch {
    return null;
  }
};
const writeLocalUser = (u) => localStorage.setItem(LS_KEY, JSON.stringify(u || null));
const shallowEqual = (a, b) => {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) if ((a ?? {})[k] !== (b ?? {})[k]) return false;
  return true;
};

export default function Profile({ user, onLogout }) {
  const navigate = useNavigate();

  // Seed from prop -> localStorage -> sensible defaults
  const seed = useMemo(
    () =>
      user ||
      readLocalUser() || {
        email: "",
        name: "",
        title: "",
        bio: "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        picture: "",
        created_at: null,
        last_login: null,
      },
    [user]
  );

  const [me, setMe] = useState(seed); // what we show in view mode
  const [form, setForm] = useState(seed); // edit buffer
  const [editing, setEditing] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(seed.picture || "");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // ---- initial load from backend ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`${API}/api/me`, { credentials: "include" });
        if (res.status === 401) {
          // not logged in → redirect
          onLogout?.();
          navigate("/login");
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setMe(data);
            setForm(data);
            writeLocalUser(data);
            setAvatarPreview(data.picture || "");
          }
        } else {
          // keep local seed if backend not ready
          if (!cancelled) setErr("Could not fetch profile from server.");
        }
      } catch {
        if (!cancelled) {
          // offline or server down → use local
          setErr("Offline or server unreachable. Showing last saved profile.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only once on mount

  // keep local copy fresh if parent prop changes (e.g., after login)
  useEffect(() => {
    if (user) {
      setMe(user);
      setForm(user);
      writeLocalUser(user);
      if (user.picture) setAvatarPreview(user.picture);
    }
  }, [user]);

  // -------- actions --------
  const toDashboard = () => navigate("/dashboard");

  const startEdit = () => {
    setForm(me);
    setMsg("");
    setErr("");
    setEditing(true);
  };

  const cancelEdit = () => {
    setForm(me);
    setAvatarPreview(me.picture || "");
    setMsg("");
    setErr("");
    setEditing(false);
  };

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const onPickAvatar = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // data URL
      try {
        const b64 = String(result).split(",")[1] || "";
        // crude estimate of decoded size
        const estimatedBytes = Math.ceil((b64.length * 3) / 4);
        if (estimatedBytes > MAX_AVATAR_BYTES) {
          setErr("Image is too large. Please choose a smaller photo (~<1.5MB).");
          return;
        }
      } catch {
        // ignore parse errors
      }
      setErr("");
      setAvatarPreview(result);
      setForm((f) => ({ ...f, picture: result }));
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      // optimistic local save
      writeLocalUser(form);

      // backend PUT (best effort)
      const res = await fetch(`${API}/api/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name ?? "",
          title: form.title ?? "",
          bio: form.bio ?? "",
          timezone: form.timezone ?? "",
          picture: form.picture ?? "",
        }),
      });

      if (res.status === 401) {
        onLogout?.();
        navigate("/login");
        return;
      }

      if (res.ok) {
        const updated = await res.json();
        setMe(updated);
        setForm(updated);
        writeLocalUser(updated);
        if (updated.picture) setAvatarPreview(updated.picture);
        setMsg("Profile updated ✔");
      } else {
        // fallback to local but show warning
        setMe(form);
        setMsg("Saved locally. Server did not accept the update yet.");
      }
      setEditing(false);
    } catch {
      // offline → keep local
      setMe(form);
      setMsg("Saved locally (offline). Changes will persist on this device.");
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    try {
      await fetch(`${API}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch {}
    onLogout?.();
    navigate("/login");
  };

  const dirty = !shallowEqual(
    { name: me.name, title: me.title, bio: me.bio, timezone: me.timezone, picture: me.picture },
    { name: form.name, title: form.title, bio: form.bio, timezone: form.timezone, picture: form.picture }
  );

  // -------- UI --------
  return (
    <div className="min-h-screen bg-gradient-to-r from-purple-100 via-white to-indigo-100">
      {/* Top bar */}
      <header className="flex justify-between items-center px-6 py-4 bg-white shadow">
        <h1 className="text-2xl font-bold text-purple-700">Profile</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={toDashboard}
            className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300"
          >
            Dashboard
          </button>
          <button
            onClick={editing ? cancelEdit : startEdit}
            className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
          >
            {editing ? "Cancel" : "Edit profile"}
          </button>
          <button
            onClick={logout}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Avatar */}
          <div className="md:col-span-1">
            <div className="flex flex-col items-center">
              <img
                src={avatarPreview || "https://via.placeholder.com/128"}
                alt="avatar"
                className="h-32 w-32 rounded-full object-cover border-4 border-purple-300 shadow"
              />
              {editing && (
                <label className="mt-4 inline-block">
                  <span className="px-3 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 cursor-pointer">
                    Change photo
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
                </label>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="md:col-span-2 space-y-4">
            {loading && (
              <p className="text-sm text-gray-500">Loading profile…</p>
            )}
            {err && <p className="text-sm text-red-600">{err}</p>}

            {/* VIEW MODE */}
            {!editing && !loading && (
              <div className="space-y-4">
                <Field label="Email" value={me.email || "—"} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Name" value={me.name || "—"} />
                  <Field label="Title" value={me.title || "—"} />
                </div>
                <Field label="Timezone" value={me.timezone || "—"} />
                <Field label="Bio" value={me.bio || "—"} multiline />
                {msg && <p className="text-sm text-gray-600">{msg}</p>}
              </div>
            )}

            {/* EDIT MODE */}
            {editing && !loading && (
              <div className="space-y-4">
                <LabeledInput label="Email (read-only)" name="email" value={form.email || ""} disabled />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <LabeledInput label="Name" name="name" value={form.name || ""} onChange={onChange} placeholder="Your full name" />
                  <LabeledInput label="Title" name="title" value={form.title || ""} onChange={onChange} placeholder="e.g., Backend Lead" />
                </div>
                <LabeledInput label="Timezone" name="timezone" value={form.timezone || ""} onChange={onChange} placeholder="America/New_York" />
                <LabeledTextarea label="Bio" name="bio" value={form.bio || ""} onChange={onChange} rows={4} placeholder="Tell us a little about you…" />

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={save}
                    disabled={saving || !dirty}
                    className="px-5 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  <button onClick={cancelEdit} className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300">
                    Cancel
                  </button>
                  {msg && <span className="text-sm text-gray-600">{msg}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---------- small presentational helpers ---------- */
function Field({ label, value, multiline = false }) {
  return (
    <div>
      <div className="text-sm font-medium text-gray-700">{label}</div>
      {multiline ? (
        <p className="mt-1 whitespace-pre-wrap text-gray-900">{value}</p>
      ) : (
        <p className="mt-1 text-gray-900">{value}</p>
      )}
    </div>
  );
}

function LabeledInput({ label, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        {...props}
        className={`mt-1 w-full px-3 py-2 border rounded-lg ${
          props.disabled ? "bg-gray-100" : "focus:ring-2 focus:ring-purple-400 outline-none"
        }`}
      />
    </div>
  );
}

function LabeledTextarea({ label, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <textarea
        {...props}
        className="mt-1 w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
      />
    </div>
  );
}
