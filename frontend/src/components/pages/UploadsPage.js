// src/components/pages/UploadsPage.jsx
import { useEffect, useState } from "react";
import { Download, Trash2, Star } from "lucide-react";

const API = process.env.REACT_APP_API_URL || "";
const LS_KEY = "ai_summariser_user";
const AFTER_GOOGLE_KEY = "after_google_auth_destination";
// ---- helpers ----
function readLocalUser() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "null");
  } catch {
    return null;
  }
}

// small helper to send X-User-Id like other components
function authHeaders(userId) {
  return userId ? { "X-User-Id": String(userId) } : {};
}

// Format "Nov 12, 2025, 4:04 PM"
function formatDateTime(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Build uploads list from meetings array
function normalizeUploadsFromMeetings(meetings) {
  const arr = Array.isArray(meetings) ? meetings : [];
  const manual = [];
  const drive = [];

  for (const m of arr) {
    const hasTranscript =
      !!m.transcript_path || !!m.transcript || !!m.transcript_file;

    if (!hasTranscript) continue;

    const kind =
      m.transcript_source === "gdrive" || m.source === "gdrive"
        ? "gdrive"
        : "manual";

    const item = {
      id: `m-${m.id}-${kind}`,
      meetingId: m.id,
      kind,
      title: m.title || `Meeting #${m.id}`,
      createdAt: m.created_at || m.updated_at || null,
      path: m.transcript_path || m.transcript_file || "",
      raw: m,
    };

    if (kind === "gdrive") drive.push(item);
    else manual.push(item);
  }

  return { manual, drive };
}
function mapDriveFilesToItems(files) {
  return (files || []).map((f) => ({
    id: `drive-${f.id}`,
    meetingId: null,
    kind: "gdrive",
    title: f.name || "Drive file",
    createdAt: f.modifiedTime || null,
    path: f.webViewLink || "",
    raw: f,
  }));
}


// ---- component ----
export default function UploadsPage() {
  const user = readLocalUser() || {};
  const userId = user.id || user.user_id || user.uid || 1;

  const [activeTab, setActiveTab] = useState("manual"); // 'manual' | 'drive'
  const [manualFiles, setManualFiles] = useState([]);
  const [driveFiles, setDriveFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [starred, setStarred] = useState(() => new Set());

  async function fetchUploads() {
    setLoading(true);
    setErr("");

    try {
      // use same endpoint as Meetings page
      const r = await fetch(`${API}/api/meetings/user/${userId}`, {
        credentials: "include",
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(
          t && t.startsWith("{")
            ? "Could not load uploads."
            : t || `Error ${r.status}`
        );
      }

      const list = await r.json();
      const { manual, drive } = normalizeUploadsFromMeetings(list);
      setManualFiles(manual);
      setDriveFiles(drive);
    } catch (e) {
      console.error("Uploads fetch error:", e);
      setErr(e?.message || "Failed to load uploads.");
      setManualFiles([]);
      setDriveFiles([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUploads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const currentList = activeTab === "manual" ? manualFiles : driveFiles;

  const toggleStar = (id) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownload = (item) => {
    if (item.path && /^https?:\/\//i.test(item.path)) {
      window.open(item.path, "_blank");
    } else {
      alert("Download endpoint not wired yet – front-end only for now.");
    }
  };

  const handleDelete = async (item) => {
    const sure = window.confirm(
      `Delete transcript for “${item.title}”? This cannot be undone.`
    );
    if (!sure) return;

    if (item.kind === "gdrive") {
      setDriveFiles((list) => list.filter((f) => f.id !== item.id));
    } else {
      setManualFiles((list) => list.filter((f) => f.id !== item.id));
    }
  };

  // --- handlers for the two buttons ---
  const handleConnectDrive = async () => {
    setErr("");
    try {
      const res = await fetch(`${API}/api/google/auth-url`, {
        credentials: "include",
        headers: authHeaders(userId),
        redirect: "follow",
      });
  
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(
          t || `Failed to start Google Drive connection (HTTP ${res.status})`
        );
      }
  
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
  
      const url =
        data.auth_url ||
        data.authUrl ||
        data.url ||
        data.redirect_url ||
        data.redirect ||
        data.login_url;
  
      if (url && typeof url === "string") {
        // 👇 remember we came from Uploads
        localStorage.setItem(AFTER_GOOGLE_KEY, "uploads");
        window.location.href = url; // go to Google consent screen
        return;
      }
  
      // Fallback: still remember destination before hitting backend URL
      localStorage.setItem(AFTER_GOOGLE_KEY, "uploads");
      window.location.href = `${API}/api/google/auth-url`;
    } catch (e) {
      console.error("Connect Drive error:", e);
      setErr(e?.message || "Failed to connect Google Drive.");
    }
  };
  

  const handleBackfill = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`${API}/api/google/drive/backfill`, {
        method: "POST",
        credentials: "include",
        headers: authHeaders(userId),
      });
  
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || "Backfill failed.");
      }
  
      const data = await res.json();
      const files = data.files || [];
  
      // 🔑 DIRECTLY push Drive files into the Drive tab list
      const items = mapDriveFilesToItems(files);
      setDriveFiles(items);
  
      // If you still want to refresh manual uploads from meetings:
      // await fetchUploads();
    } catch (e) {
      console.error("Backfill transcripts error:", e);
      setErr(e?.message || "Failed to backfill transcripts from Google Drive.");
    } finally {
      setLoading(false);
    }
  };
  

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
          Uploads
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          All transcripts you&apos;ve uploaded across meetings.
        </p>
      </header>

      {/* Tabs + refresh */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-6 text-sm border-b border-slate-200 dark:border-slate-700">
          <button
            type="button"
            className={`pb-2 -mb-px ${
              activeTab === "manual"
                ? "border-b-2 border-rose-400 text-slate-900 dark:text-slate-50"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
            onClick={() => setActiveTab("manual")}
          >
            Manual
          </button>
          <button
            type="button"
            className={`pb-2 -mb-px ${
              activeTab === "drive"
                ? "border-b-2 border-rose-400 text-slate-900 dark:text-slate-50"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
            onClick={() => setActiveTab("drive")}
          >
            G Drive uploads
          </button>
        </div>

        <button
          type="button"
          onClick={fetchUploads}
          disabled={loading}
          className="px-3 py-1.5 rounded-full text-xs border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-100 bg-white/80 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Card container */}
      <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm">
        {/* section header */}
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
          {activeTab === "manual" ? "MANUAL UPLOADED" : "G DRIVE UPLOADS"}
        </div>

        {/* extra toolbar ONLY for G Drive tab */}
        {activeTab === "drive" && (
          <div className="px-4 pt-3 pb-3 flex flex-wrap gap-2 border-b border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={handleConnectDrive}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-500 text-white hover:bg-sky-600"
            >
              Connect to G&nbsp;Drive
            </button>
            <button
              type="button"
              onClick={handleBackfill}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-800"
            >
              Backfill transcripts
            </button>
          </div>
        )}

        {err && (
          <div className="px-4 py-3 text-xs text-red-600 border-b border-slate-100 dark:border-slate-800">
            {err}
          </div>
        )}

        {/* List */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {loading && currentList.length === 0 && (
            <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-300">
              Loading uploads…
            </div>
          )}

          {!loading && currentList.length === 0 && (
            <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-300">
              No files found.
            </div>
          )}

          {currentList.map((item) => {
            const label =
              item.kind === "gdrive" ? "G-Drive upload" : "Manual upload";
            const dt = formatDateTime(item.createdAt);

            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/70 transition"
              >
                {/* Left icon */}
                <div className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[11px] font-semibold text-slate-500">
                  TXT
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">
                    {item.title}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {label}
                    {dt && ` · ${dt}`}
                  </div>
                </div>

                {/* Status pill */}
                <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5 text-[11px] mr-1">
                  Uploaded
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleStar(item.id)}
                    className={`p-1.5 rounded-full border text-slate-500 hover:text-amber-400 hover:border-amber-300 dark:text-slate-300 dark:hover:text-amber-300 ${
                      starred.has(item.id)
                        ? "border-amber-300 bg-amber-50/60 dark:bg-amber-900/40 text-amber-400"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                    title={starred.has(item.id) ? "Unstar" : "Star"}
                  >
                    <Star
                      size={14}
                      className={starred.has(item.id) ? "fill-current" : ""}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownload(item)}
                    className="p-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 hover:bg-slate-50 dark:text-slate-300 dark:hover:text-slate-50 dark:hover:bg-slate-700"
                    title="Download"
                  >
                    <Download size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    className="p-1.5 rounded-full border border-rose-200/80 text-rose-500 hover:bg-rose-50 dark:border-rose-700/60 dark:text-rose-300 dark:hover:bg-rose-900/30"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
