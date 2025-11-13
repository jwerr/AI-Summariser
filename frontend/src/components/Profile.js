// src/components/Profile.js
import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";
const LS_KEY = "ai_summariser_user";
const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024;

const readLocalUser = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "null");
  } catch {
    return null;
  }
};
const writeLocalUser = (u) =>
  localStorage.setItem(LS_KEY, JSON.stringify(u || null));

const shallowEqual = (a, b) => {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) if ((a ?? {})[k] !== (b ?? {})[k]) return false;
  return true;
};

export default function Profile({ user }) {
  // get logout from AppShell
  const { logout } = useOutletContext() || {};

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

  const [me, setMe] = useState(seed);
  const [form, setForm] = useState(seed);
  const [editing, setEditing] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(seed.picture || "");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`${API}/api/me`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setMe(data);
            setForm(data);
            writeLocalUser(data);
            setAvatarPreview(data.picture || "");
          }
        } else if (!cancelled) {
          setErr("Could not fetch profile from server.");
        }
      } catch {
        if (!cancelled)
          setErr("Offline or server unreachable. Showing last saved profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (user) {
      setMe(user);
      setForm(user);
      writeLocalUser(user);
      if (user.picture) setAvatarPreview(user.picture);
    }
  }, [user]);

  const onChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onPickAvatar = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      try {
        const b64 = String(result).split(",")[1] || "";
        const estimatedBytes = Math.ceil((b64.length * 3) / 4);
        if (estimatedBytes > MAX_AVATAR_BYTES) {
          setErr("Image too large (~>1.5MB).");
          return;
        }
      } catch {}
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
      writeLocalUser(form);
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
      if (res.ok) {
        const updated = await res.json();
        setMe(updated);
        setForm(updated);
        writeLocalUser(updated);
        if (updated.picture) setAvatarPreview(updated.picture);
        setMsg("Profile updated ✔");
      } else {
        setMe(form);
        setMsg("Saved locally. Server didn’t accept the update yet.");
      }
      setEditing(false);
    } catch {
      setMe(form);
      setMsg("Saved locally (offline).");
    } finally {
      setSaving(false);
    }
  };

  const dirty = !shallowEqual(
    {
      name: me.name,
      title: me.title,
      bio: me.bio,
      timezone: me.timezone,
      picture: me.picture,
    },
    {
      name: form.name,
      title: form.title,
      bio: form.bio,
      timezone: form.timezone,
      picture: form.picture,
    }
  );

  return (
    <div className="space-y-6">
      {/* Header row with Edit + Logout */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Profile</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing((e) => !e)}
            className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-700"
          >
            {editing ? "Cancel" : "Edit profile"}
          </button>

          <button
            type="button"
            onClick={logout}
            className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm hover:bg-red-600"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-xl border shadow-sm p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
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
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickAvatar}
                />
              </label>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="md:col-span-2 space-y-4">
          {loading && <p className="text-sm text-gray-500">Loading profile…</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}

          {!editing && !loading && (
            <div className="space-y-4">
              <Field label="Name" value={me.name || "—"} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Email" value={me.email || "—"} />
                <Field label="Title" value={me.title || "—"} />
              </div>
              <Field label="Timezone" value={me.timezone || "—"} />
              <Field label="Bio" value={me.bio || "—"} multiline />
              {msg && <p className="text-sm text-gray-600">{msg}</p>}
            </div>
          )}

          {editing && !loading && (
            <div className="space-y-4">
              <LabeledInput
                label="Name"
                name="name"
                value={form.name || ""}
                onChange={onChange}
                placeholder="Your full name"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <LabeledInput
                  label="Email (read-only)"
                  name="email"
                  value={form.email || ""}
                  disabled
                />
                <LabeledInput
                  label="Title"
                  name="title"
                  value={form.title || ""}
                  onChange={onChange}
                  placeholder="e.g., Backend Lead"
                />
              </div>
              <LabeledInput
                label="Timezone"
                name="timezone"
                value={form.timezone || ""}
                onChange={onChange}
                placeholder="America/New_York"
              />
              <LabeledTextarea
                label="Bio"
                name="bio"
                value={form.bio || ""}
                onChange={onChange}
                rows={4}
                placeholder="Tell us a little about you…"
              />

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={save}
                  disabled={saving || !dirty}
                  className="px-5 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
                {msg && <span className="text-sm text-gray-600">{msg}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Presentational helpers */
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
      <label className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        {...props}
        className={`mt-1 w-full px-3 py-2 border rounded-lg ${
          props.disabled
            ? "bg-gray-100"
            : "focus:ring-2 focus:ring-purple-400 outline-none"
        }`}
      />
    </div>
  );
}

function LabeledTextarea({ label, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <textarea
        {...props}
        className="mt-1 w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
      />
    </div>
  );
}
