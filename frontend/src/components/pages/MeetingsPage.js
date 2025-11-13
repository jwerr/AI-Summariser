// src/pages/MeetingsPage.js
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star, Search } from "lucide-react";

const API = process.env.REACT_APP_API_URL || "";
const PLATFORMS = ["Zoom", "Google Meet", "Microsoft Teams", "Webex", "Other"];
const STAR_KEY = "ai_ms_starred_meetings";

export default function MeetingsPage({ user }) {
  const navigate = useNavigate();
  const userId = user?.id || user?.user_id || user?.uid || 1;

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all"); // 'all' | 'starred'

  const [starred, setStarred] = useState({});

  // ---- helpers for starred persistence ----
  function readStarred() {
    try {
      return JSON.parse(localStorage.getItem(STAR_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function persistStarred(map) {
    try {
      localStorage.setItem(STAR_KEY, JSON.stringify(map || {}));
    } catch {
      // ignore
    }
  }

  function toggleStar(id) {
    setStarred((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      persistStarred(next);
      return next;
    });
  }

  async function loadMeetings() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/meetings/user/${userId}`, {
        credentials: "include",
      });
      if (r.ok) {
        const list = await r.json();
        setMeetings(Array.isArray(list) ? list : []);
      } else {
        setMeetings([]);
      }
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }

  async function createMeeting({ title, platform }) {
    const payload = { user_id: userId, title, platform, transcript_path: "" };
    const r = await fetch(`${API}/api/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`Create failed: ${r.status}`);
    await loadMeetings();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this meeting permanently?")) return;

    try {
      const r = await fetch(`${API}/api/meetings/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!r.ok) {
        alert("Failed to delete this meeting. Please try again.");
        return;
      }

      setMeetings((prev) => prev.filter((m) => m.id !== id));

      setStarred((prev) => {
        const next = { ...prev };
        delete next[id];
        persistStarred(next);
        return next;
      });
    } catch {
      alert("Error deleting meeting. Please try again.");
    }
  }

  useEffect(() => {
    setStarred(readStarred());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ---- filtering ----
  const normSearch = search.trim().toLowerCase();

  const filtered = meetings.filter((m) => {
    if (activeTab === "starred" && !starred[m.id]) return false;

    if (!normSearch) return true;

    const txt = [
      m.title || "",
      m.platform || "",
      m.created_at ? new Date(m.created_at).toLocaleString() : "",
    ]
      .join(" ")
      .toLowerCase();

    return txt.includes(normSearch);
  });

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      {/* Header row */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
            Meetings
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Browse, search and manage your recorded meetings.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search */}
          <div className="relative w-full sm:w-64">
            <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-slate-400">
              <Search size={16} />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search meetings…"
              className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center justify-center rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-purple-700 hover:shadow-lg transition"
          >
            + New Meeting
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1 text-xs font-medium dark:border-slate-700 dark:bg-slate-900/70">
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={`px-3 py-1 rounded-full transition-colors ${
            activeTab === "all"
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-100 dark:text-slate-900"
              : "text-slate-500 dark:text-slate-300"
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("starred")}
          className={`px-3 py-1 rounded-full transition-colors flex items-center gap-1 ${
            activeTab === "starred"
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-100 dark:text-slate-900"
              : "text-slate-500 dark:text-slate-300"
          }`}
        >
          <Star size={12} className="mt-px" />
          Starred
        </button>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur-lg dark:border-slate-700 dark:bg-slate-900/80">
        {/* Header row */}
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_auto] items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <div>Name</div>
          <div>Platform</div>
          <div>Transcript</div>
          <div className="text-right pr-1">Actions</div>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
            {activeTab === "starred"
              ? "No starred meetings yet."
              : "No meetings found."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.map((m) => {
              const hasTranscript =
                !!m.transcript_path || !!m._hasTranscripts;
              const isStarred = !!starred[m.id];

              return (
                <li
                    key={m.id}
  onClick={() =>
    navigate(`/meetings/${m.id}`, {
      state: { meeting: m }, 
    })
  }
                  className="grid cursor-pointer grid-cols-[minmax(0,3fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_auto] items-center gap-4 px-4 py-4 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-900"
                  // onClick={() => navigate(`/meetings/${m.id}`)}
                >
                  {/* Name + date */}
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900 dark:text-slate-50">
                      {m.title || `Meeting #${m.id}`}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {m.created_at
                        ? new Date(m.created_at).toLocaleString()
                        : ""}
                    </div>
                  </div>

                  {/* Platform */}
                  <div className="text-slate-700 dark:text-slate-200">
                    {m.platform || "—"}
                  </div>

                  {/* Transcript status */}
                  <div>
                    {hasTranscript ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Uploaded
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        None
                      </span>
                    )}
                  </div>

                  {/* Star + Delete buttons */}
                  <div className="flex justify-end gap-2">
                    {/* Star button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStar(m.id);
                      }}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-slate-500 transition-colors dark:text-slate-300 ${
                        isStarred
                          ? "border-amber-400 bg-amber-50 text-amber-500 dark:border-amber-400/80 dark:bg-amber-900/40 dark:text-amber-300"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
                      }`}
                      title={isStarred ? "Unstar meeting" : "Star meeting"}
                    >
                      <Star size={16} className={isStarred ? "fill-current" : ""} />
                    </button>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(m.id);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-300 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
                      title="Delete meeting"
                    >
                      🗑️
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {addOpen && (
        <AddMeetingModal
          onClose={() => setAddOpen(false)}
          onSubmit={async (data) => {
            await createMeeting(data);
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Modal ---------- */
function AddMeetingModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const canSave = title.trim().length > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSave) return;
    await onSubmit({ title: title.trim(), platform });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">
            Create New Meeting
          </h3>
          <button
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 py-4">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700 dark:text-slate-200">
              Title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Sprint Planning – Week 4"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700 dark:text-slate-200">
              Platform
            </span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              disabled={!canSave}
              type="submit"
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-purple-700 disabled:opacity-60"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
