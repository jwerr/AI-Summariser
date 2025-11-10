// src/Dashboard.js
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CalendarPanel from "./CalendarPanel";

const API = process.env.REACT_APP_API_URL || ""; // proxy or set env var
const PLATFORMS = ["Zoom", "Google Meet", "Microsoft Teams", "Webex", "Other"];

/* -------------------------- helpers: date parsing -------------------------- */
const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const p2 = (n) => String(n).padStart(2, "0");
function toLocalISO(dateObj) {
  const y = dateObj.getFullYear();
  const m = p2(dateObj.getMonth() + 1);
  const d = p2(dateObj.getDate());
  const hh = p2(dateObj.getHours());
  const mm = p2(dateObj.getMinutes());
  const ss = p2(dateObj.getSeconds());
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}
function parseTimeBits(str) {
  if (!str) return null;
  const m = str.trim().match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h <= 7) h += 12;
  return { h24: h, m: mm };
}
function extractUpcomingFromText(text) {
  if (!text || typeof text !== "string") return [];
  const out = [];
  const now = new Date();

  const isoDate = /\b(20\d{2})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?\b/g;
  for (const m of text.matchAll(isoDate)) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    const hh = m[4] ? parseInt(m[4], 10) : 10;
    const mm = m[5] ? parseInt(m[5], 10) : 0;
    const dt = new Date(y, mo - 1, d, hh, mm, 0);
    if (dt > now) {
      out.push({
        title: "Follow-up meeting",
        start_iso: toLocalISO(dt),
        end_iso: null,
        description: `Auto-detected: ${m[0]}`,
        source: m[0],
      });
    }
  }

  const mdSlash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/gi;
  for (const m of text.matchAll(mdSlash)) {
    let y = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
    if (y < 100) y += 2000;
    const mo = parseInt(m[1], 10);
    const d = parseInt(m[2], 10);
    const tb = parseTimeBits(m[4] || "");
    const hh = tb?.h24 ?? 10;
    const mm = tb?.m ?? 0;
    const dt = new Date(y, mo - 1, d, hh, mm, 0);
    if (dt > now) {
      out.push({
        title: "Follow-up meeting",
        start_iso: toLocalISO(dt),
        end_iso: null,
        description: `Auto-detected: ${m[0]}`,
        source: m[0],
      });
    }
  }

  const monthName =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?\b/gi;
  for (const m of text.matchAll(monthName)) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)];
    let y = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
    const d = parseInt(m[2], 10);
    const tb = parseTimeBits(m[4] || "");
    const hh = tb?.h24 ?? 10;
    const mm = tb?.m ?? 0;
    const dt = new Date(y, mo - 1, d, hh, mm, 0);
    if (!m[3] && dt < now) dt.setFullYear(dt.getFullYear() + 1);
    if (dt > now) {
      out.push({
        title: "Follow-up meeting",
        start_iso: toLocalISO(dt),
        end_iso: null,
        description: `Auto-detected: ${m[0]}`,
        source: m[0],
      });
    }
  }

  const seen = new Set();
  const dedup = [];
  for (const it of out) {
    if (seen.has(it.start_iso)) continue;
    seen.add(it.start_iso);
    dedup.push(it);
  }
  return dedup.slice(0, 8);
}

/* -------------------------------- component -------------------------------- */

export default function Dashboard({ user, onLogout }) {
  const navigate = useNavigate();
  const userId = user?.id || user?.user_id || user?.uid || 1;

  const [meetings, setMeetings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [summary, setSummary] = useState({
    status: "empty", // empty | processing | ready | error
    summary_text: "",
    key_points: [],
    decisions: [],
    action_items: [],
    schedule_suggestions: [],
  });

  const [upcoming, setUpcoming] = useState([]);
  const [transcripts, setTranscripts] = useState([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const selected = useMemo(
    () => meetings.find((m) => m.id === selectedId) || null,
    [meetings, selectedId]
  );

  // ---------- API ----------
  const fetchMeetings = async () => {
    try {
      const res = await fetch(`${API}/api/meetings/user/${userId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        console.error("Meetings fetch failed:", res.status);
        setMeetings([]);
        return;
      }
      const list = await res.json();
      const arr = Array.isArray(list) ? list : [];
      setMeetings(arr);
      if (!selectedId && arr.length) setSelectedId(arr[0].id);
    } catch (e) {
      console.error(e);
      setMeetings([]);
    }
  };

  const createMeeting = async ({ title, platform }) => {
    const payload = { user_id: userId, title, platform, transcript_path: "" };
    const res = await fetch(`${API}/api/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Failed to create meeting: ${res.status}`);
    await fetchMeetings();
  };

  async function handleDelete(meetingId) {
    const ok = window.confirm("Delete this meeting and its data?");
    if (!ok) return;
    setDeletingId(meetingId);
    try {
      const res = await fetch(`${API}/api/meetings/${meetingId}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          // remove if you’re not using a dev shim
          "X-User-Id": user?.id ?? "",
        },
      });
      if (res.status === 204) {
        setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
        if (selectedId === meetingId) setSelectedId(null);
      } else {
        const msg = await res.text();
        alert(`Failed to delete (status ${res.status}): ${msg}`);
      }
    } catch (e) {
      alert(`Failed to delete: ${e}`);
    } finally {
      setDeletingId(null);
    }
  }

  const fetchTranscripts = async (mid) => {
    try {
      const res = await fetch(`${API}/api/meetings/${mid}/transcripts?t=${Date.now()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setTranscripts([]);
        return;
      }
      const idx = await res.json(); // { meeting_id, files: [...] } or array
      const files = Array.isArray(idx?.files) ? idx.files : Array.isArray(idx) ? idx : [];

      const mapped = files.map((f, i) => ({
        id: `${f.id ?? f.stored_as ?? f.path ?? i}`,
        filename: f.filename,
        size: f.size,
        storage_path: f.path || f.storage_path,
        upload_ts: f.uploaded_at || f.upload_ts,
        created_at: f.uploaded_at || f.created_at,
      }));

      mapped.sort((a, b) => {
        const at = new Date(a.upload_ts || a.created_at || 0).getTime();
        const bt = new Date(b.upload_ts || b.created_at || 0).getTime();
        return bt - at;
      });

      setTranscripts(mapped);
      setMeetings((prev) =>
        prev.map((m) => (m.id === mid ? { ...m, _hasTranscripts: mapped.length > 0 } : m))
      );
    } catch (e) {
      console.error(e);
      setTranscripts([]);
    }
  };

  const fetchSummary = async (mid) => {
    try {
      const res = await fetch(`${API}/api/meetings/${mid}/summary?t=${Date.now()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setSummary({
          status: "empty",
          summary_text: "",
          key_points: [],
          decisions: [],
          action_items: [],
          schedule_suggestions: [],
        });
        setUpcoming([]);
        return;
      }
      const payload = await res.json();
      const s = payload?.normalized || {};

      const nextSummary = {
        status: s.status || (s.summary_text ? "ready" : "empty"),
        summary_text: s.summary_text || "",
        key_points: Array.isArray(s.key_points) ? s.key_points : [],
        decisions: Array.isArray(s.decisions) ? s.decisions : [],
        action_items: Array.isArray(s.action_items) ? s.action_items : [],
        schedule_suggestions: Array.isArray(s.schedule_suggestions) ? s.schedule_suggestions : [],
      };
      setSummary(nextSummary);

      let upcomingItems = [];
      if (nextSummary.schedule_suggestions.length > 0) {
        upcomingItems = nextSummary.schedule_suggestions.map((it) => ({
          title: it.title || "Follow-up meeting",
          start_iso: it.start_iso || "",
          end_iso: it.end_iso || null,
          description: it.description || it.raw_quote || "",
          source: it.raw_quote || "",
        }));
      } else {
        const bundle = [
          nextSummary.summary_text,
          ...nextSummary.decisions,
          ...nextSummary.action_items,
        ]
          .filter(Boolean)
          .join("\n");
        upcomingItems = extractUpcomingFromText(bundle);
      }
      setUpcoming(upcomingItems);
    } catch (e) {
      console.error(e);
      setSummary({
        status: "empty",
        summary_text: "",
        key_points: [],
        decisions: [],
        action_items: [],
        schedule_suggestions: [],
      });
      setUpcoming([]);
    }
  };

  const startSummarize = async (mid) => {
    setSummary((s) => ({ ...s, status: "processing" }));
    const kick = await fetch(`${API}/api/meetings/${mid}/summarize`, {
      method: "POST",
      credentials: "include",
    });

    if (!kick.ok) {
      const body = await kick.text();
      setSummary({
        status: "error",
        summary_text: `Summarize failed: ${kick.status} ${body}`,
        key_points: [],
        decisions: [],
        action_items: [],
        schedule_suggestions: [],
      });
      setUpcoming([]);
      return;
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      const res = await fetch(`${API}/api/meetings/${mid}/summary?t=${Date.now()}`, {
        credentials: "include",
      });
      if (res.ok) {
        const payload = await res.json();
        const norm = payload?.normalized || {};
        if (norm.status === "ready") {
          const nextSummary = {
            status: "ready",
            summary_text: norm.summary_text || "",
            key_points: Array.isArray(norm.key_points) ? norm.key_points : [],
            decisions: Array.isArray(norm.decisions) ? norm.decisions : [],
            action_items: Array.isArray(norm.action_items) ? norm.action_items : [],
            schedule_suggestions: Array.isArray(norm.schedule_suggestions) ? norm.schedule_suggestions : [],
          };
          setSummary(nextSummary);

          let upcomingItems = [];
          if (nextSummary.schedule_suggestions.length > 0) {
            upcomingItems = nextSummary.schedule_suggestions.map((it) => ({
              title: it.title || "Follow-up meeting",
              start_iso: it.start_iso || "",
              end_iso: it.end_iso || null,
              description: it.description || it.raw_quote || "",
              source: it.raw_quote || "",
            }));
          } else {
            const bundle = [
              nextSummary.summary_text,
              ...nextSummary.decisions,
              ...nextSummary.action_items,
            ]
              .filter(Boolean)
              .join("\n");
            upcomingItems = extractUpcomingFromText(bundle);
          }
          setUpcoming(upcomingItems);
          return;
        }
        if (norm.status === "error") {
          setSummary({
            status: "error",
            summary_text: norm.error || "Summarization failed",
            key_points: [],
            decisions: [],
            action_items: [],
            schedule_suggestions: [],
          });
          setUpcoming([]);
          return;
        }
      }
      attempts += 1;
      await sleep(2000);
    }

    setSummary({
      status: "error",
      summary_text: "Timed out waiting for summary.",
      key_points: [],
      decisions: [],
      action_items: [],
      schedule_suggestions: [],
    });
    setUpcoming([]);
  };

  const uploadTranscript = async (mid, file) => {
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/api/meetings/${mid}/upload_transcript`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text();
        setSummary({
          status: "error",
          summary_text: `Upload failed: ${res.status} ${body}`,
          key_points: [],
          decisions: [],
          action_items: [],
          schedule_suggestions: [],
        });
        setUpcoming([]);
        return;
      }
      setSummary((s) => ({ ...s, status: "empty", summary_text: "" }));
      setUpcoming([]);
      await fetchTranscripts(mid);
      await fetchMeetings();
    } finally {
      setIsUploading(false);
    }
  };

  // ---------- lifecycle ----------
  useEffect(() => {
    fetchMeetings();
    // eslint-disable-next-line
  }, [userId]);

  useEffect(() => {
    if (!selectedId) return;
    fetchSummary(selectedId);
    fetchTranscripts(selectedId);
    // eslint-disable-next-line
  }, [selectedId]);

  // ---------- UI handlers ----------
  const onAddMeeting = async (form) => {
    await createMeeting(form);
    setIsAdding(false);
  };

  const onFilePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId) return;
    await uploadTranscript(selectedId, file);
    e.target.value = "";
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-purple-50">
      <header className="flex items-center justify-between px-6 py-4 bg-white shadow">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-purple-600" />
          <h1 className="text-xl font-bold text-purple-700">AI Meeting Summariser</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/profile")}
            className="text-sm text-gray-600 hover:text-purple-700 underline-offset-2 hover:underline"
            title="View profile"
          >
            {user?.name || user?.email || "User"}
          </button>
          <button
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700"
            onClick={onLogout}
          >
            Logout
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* LEFT */}
        <aside className="w-72 border-r bg-white">
          <div className="p-4 flex items-center justify-between border-b">
            <h2 className="font-semibold text-gray-800">Meetings</h2>
            <button
              onClick={() => setIsAdding(true)}
              className="px-2.5 py-1.5 rounded-md bg-purple-600 text-white text-sm hover:bg-purple-700"
            >
              + Add
            </button>
          </div>

          {meetings.length === 0 ? (
            <EmptySidebar />
          ) : (
            <ul className="overflow-y-auto max-h-[calc(100vh-7rem)]">
              {meetings.map((m) => (
                <li
                  key={m.id}
                  className={[
                    "px-4 py-3 cursor-pointer border-b hover:bg-purple-50",
                    selectedId === m.id ? "bg-purple-50/70" : "",
                  ].join(" ")}
                  onClick={() => setSelectedId(m.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800 truncate">
                        {m.title || `Meeting #${m.id}`}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {m.transcript_path
                          ? "Transcript uploaded"
                          : m._hasTranscripts
                          ? "Transcript uploaded"
                          : "No transcript yet"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-gray-500">{m.platform || "—"}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(m.id);
                        }}
                        disabled={deletingId === m.id}
                        title="Delete meeting"
                        className="px-2 py-0.5 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deletingId === m.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* CENTER */}
        <main className="flex-1 p-6">
          {meetings.length === 0 ? (
            <EmptyState onAdd={() => setIsAdding(true)} />
          ) : !selected ? (
            <div className="text-gray-600">Select a meeting on the left.</div>
          ) : (
            <MeetingPanel
              meeting={selected}
              summary={summary}
              transcripts={transcripts}
              isUploading={isUploading}
              onFilePick={onFilePick}
              onSummarize={() => startSummarize(selected.id)}
              upcoming={upcoming}
              onDelete={() => handleDelete(selected.id)}
              deleting={deletingId === selected.id}
            />
          )}
        </main>

        {/* RIGHT */}
        <aside className="w-96 border-l bg-white p-4 space-y-4">
        <CalendarPanel userId={userId} summary={summary} upcoming={upcoming} />
          <UserDetails user={user} meetings={meetings} selected={selected} />
          <div className="p-4 rounded-xl border">
            <h3 className="font-semibold text-gray-800 mb-2">How it works</h3>
            <ol className="list-decimal ml-5 text-sm text-gray-700 space-y-1">
              <li>Add a meeting (title + platform).</li>
              <li>Open the meeting, upload a transcript file.</li>
              <li>Click <b>Summarize</b> to generate the summary and lists.</li>
              <li>Use <b>Q&A</b> below the summary to ask questions.</li>
              <li>Use <b>Calendar</b> to add upcoming items as events.</li>
            </ol>
            <p className="text-xs text-gray-500 mt-3">
              Supports: TXT, VTT, SRT, DOCX, PDF (basic parsing).
            </p>
          </div>
        </aside>
      </div>

      {isAdding && (
        <AddMeetingModal onClose={() => setIsAdding(false)} onSubmit={onAddMeeting} />
      )}
    </div>
  );
}

/* ---------- Subcomponents ---------- */

function UserDetails({ user, meetings, selected }) {
  const total = Array.isArray(meetings) ? meetings.length : 0;
  const displayName = user?.name || "—";
  const email = user?.email || "—";
  const uid = user?.id || user?.user_id || user?.uid || "—";

  return (
    <div className="p-4 rounded-xl border">
      <h3 className="font-semibold text-gray-800 mb-2">Your Account</h3>
      <div className="text-sm text-gray-700 space-y-1">
        <div><span className="text-gray-500">Name:</span> {displayName}</div>
        <div><span className="text-gray-500">Email:</span> {email}</div>
        <div><span className="text-gray-500">User ID:</span> {uid}</div>
      </div>

      <div className="mt-3 pt-3 border-t">
        <h4 className="font-medium text-gray-800 mb-2">At a glance</h4>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>Total meetings: <b>{total}</b></li>
          {selected ? (
            <>
              <li>
                Selected:{" "}
                <b className="truncate inline-block max-w-[12rem] align-bottom">
                  {selected.title || `#${selected.id}`}
                </b>
              </li>
              <li>Platform: <span className="text-gray-600">{selected.platform || "—"}</span></li>
            </>
          ) : (
            <li>Selected: —</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function EmptySidebar() {
  return (
    <div className="p-6 text-sm text-gray-600">
      No meetings yet.
      <div className="mt-2 text-xs text-gray-500">
        Click <b>+ Add</b> to create your first meeting.
      </div>
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <div className="w-20 h-20 rounded-2xl bg-purple-100 mb-4" />
      <h2 className="text-xl font-semibold text-gray-800">Welcome!</h2>
      <p className="max-w-md text-gray-600 mt-2">
        Create a meeting, then upload a transcript to see the AI summary.
      </p>
      <button
        onClick={onAdd}
        className="mt-4 px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
      >
        Add a meeting
      </button>
    </div>
  );
}

function MeetingPanel({
  meeting,
  summary,
  transcripts,
  isUploading,
  onFilePick,
  onSummarize,
  upcoming,
  onDelete,
  deleting,
}) {
  const fileRef = useRef(null);
  const status = summary?.status || "empty";
  const hasTranscript = Array.isArray(transcripts) && transcripts.length > 0;

  const oneLiner = (summary?.summary_text || "").trim();
  const decisions = Array.isArray(summary?.decisions) ? summary.decisions.filter(Boolean) : [];
  const keyPoints = Array.isArray(summary?.key_points) ? summary.key_points.filter(Boolean) : [];
  const actionItems = Array.isArray(summary?.action_items) ? summary.action_items.filter(Boolean) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{meeting.title}</h2>
          <p className="text-sm text-gray-500">Platform: {meeting.platform || "—"}</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" className="hidden" onChange={onFilePick} />
          <button
            className="px-3 py-2 rounded-lg bg-white border hover:bg-gray-50"
            onClick={() => fileRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? "Uploading..." : "Upload transcript"}
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
            onClick={onSummarize}
            disabled={!hasTranscript}
            title={hasTranscript ? "Generate summary" : "Upload a transcript first"}
          >
            {status === "processing" ? "Summarizing..." : "Summarize"}
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            onClick={onDelete}
            disabled={deleting}
            title="Delete meeting"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {/* Transcript history */}
      <div className="p-4 bg-white rounded-xl border">
        <h3 className="font-semibold text-purple-700 mb-2">Transcript files</h3>
        {transcripts.length === 0 ? (
          <p className="text-sm text-gray-600">No transcripts uploaded yet.</p>
        ) : (
          <ul className="text-sm text-gray-700 space-y-1">
            {transcripts.map((t) => (
              <li key={t.id} className="flex items-center justify-between">
                <span className="truncate">
                  {t.filename}{" "}
                  <span className="text-xs text-gray-500">({formatBytes(t.size)})</span>
                </span>
                <span className="text-xs text-gray-500">
                  {t.upload_ts ? new Date(t.upload_ts).toLocaleString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Full Summary */}
      <div className="p-5 bg-white rounded-xl border">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold text-purple-700">Full Summary</h3>
          <StatusBadge status={status} />
        </div>
        <p className="text-sm text-gray-900 whitespace-pre-wrap">
          {oneLiner || (status === "empty" ? "No summary yet." : "Working on it…")}
        </p>
      </div>

      {/* Q&A */}
      <QaBox meetingId={meeting.id} summaryText={oneLiner} />

      {/* Upcoming */}
      <div className="p-5 bg-white rounded-xl border">
        <h3 className="font-semibold text-purple-700 mb-2">Upcoming Meetings</h3>
        {Array.isArray(upcoming) && upcoming.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {upcoming.map((u, i) => (
              <li key={i} className="border rounded-lg p-3">
                <div className="font-medium">{u.title || "Follow-up meeting"}</div>
                <div className="text-gray-700">
                  {u.start_iso ? new Date(u.start_iso).toLocaleString() : "—"}
                </div>
                {u.description && <div className="text-xs text-gray-500 mt-1">{u.description}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">No upcoming meetings detected yet.</p>
        )}
        <p className="text-xs text-gray-500 mt-3">
          Tip: Detected dates/times appear here and are pre-filled on the Calendar panel for one-click add.
        </p>
      </div>

      {/* Key Points & Action Items */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Key Points" items={keyPoints} />
        <Card title="Action Items" items={actionItems} />
      </div>

      {/* Decisions */}
      <div className="p-5 bg-white rounded-xl border">
        <h3 className="font-semibold text-purple-700 mb-2">Decisions</h3>
        {status === "processing" && decisions.length === 0 ? (
          <p className="text-sm text-gray-600">Identifying decisions…</p>
        ) : decisions.length ? (
          <ul className="list-disc pl-5 text-sm text-gray-900 space-y-1">
            {decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">No decisions.</p>
        )}
      </div>
    </div>
  );
}

function QaBox({ meetingId, summaryText }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [history, setHistory] = useState([]); // [{q, a, ctx: []}]
  const canUse = !!meetingId;

  const indexNow = async () => {
    if (!canUse) return;
    setBusy(true);
    setStatusMsg("Indexing meeting…");
    try {
      const res = await fetch(`${API}/api/qa/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ meeting_id: meetingId, include_transcript: true, include_summary: true }),
      });
      if (!res.ok) {
        const t = await res.text();
        setStatusMsg(`Index failed: ${res.status} ${t}`);
        return;
      }
      setStatusMsg("Index built. You can ask now.");
    } catch (e) {
      setStatusMsg(`Index error: ${e.message || e}`);
    } finally {
      setBusy(false);
      setTimeout(() => setStatusMsg(""), 2500);
    }
  };

  const ask = async () => {
    if (!canUse || !q.trim()) return;
    setBusy(true);
    setStatusMsg("Thinking…");
    try {
      const res = await fetch(`${API}/api/qa/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ meeting_id: meetingId, question: q, top_k: 6 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(`Ask failed: ${res.status} ${data?.detail || ""}`);
        return;
      }
      setHistory((h) => [...h, { q, a: data.answer, ctx: data.contexts || [] }]);
      setQ("");
      setStatusMsg("");
    } catch (e) {
      setStatusMsg(`Ask error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5 bg-white rounded-xl border">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <h3 className="font-semibold text-purple-700 mb-1">Ask about this summary</h3>
          <p className="text-xs text-gray-600 bg-purple-50/60 border border-purple-100 rounded-md p-2 whitespace-pre-wrap max-h-28 overflow-auto">
            {summaryText ? summaryText : "No summary text yet."}
          </p>
        </div>
        <button
          onClick={indexNow}
          disabled={busy || !canUse}
          className="px-2.5 py-1.5 text-xs rounded bg-gray-900 text-white h-8 self-start disabled:opacity-50"
          title={canUse ? "Build/refresh the vector index for this meeting" : "Select a meeting first"}
        >
          {busy ? "Indexing…" : "Reindex"}
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e)=>setQ(e.target.value)}
          placeholder={canUse ? "Ask a question about this meeting…" : "Select a meeting to ask"}
          className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-400 outline-none disabled:opacity-60"
          disabled={!canUse || busy}
          onKeyDown={(e)=>{ if(e.key==="Enter") ask(); }}
        />
        <button
          onClick={ask}
          disabled={busy || !canUse || !q.trim()}
          className="px-3 py-2 bg-purple-600 text-white rounded-lg disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>

      {statusMsg && <p className="text-xs text-gray-600 mt-2">{statusMsg}</p>}

      <div className="mt-3 space-y-3 text-sm">
        {history.map((h, i) => (
          <div key={i} className="border rounded-lg p-3">
            <p><b>You:</b> {h.q}</p>
            <p className="mt-2 whitespace-pre-wrap"><b>Bot:</b> {h.a}</p>
            {h.ctx?.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-gray-600">Context &amp; scores</summary>
                <ul className="mt-2 list-disc pl-6 space-y-1">
                  {h.ctx.map((c) => (
                    <li key={c.idx} className="text-gray-700">
                      [{c.idx}] <span className="uppercase">{c.source}</span> • score {Number(c.score).toFixed(2)} —{" "}
                      {String(c.text || "").slice(0, 400)}{(c.text || "").length > 400 ? "…" : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    ready: "bg-green-100 text-green-700",
    processing: "bg-yellow-100 text-yellow-700",
    error: "bg-red-100 text-red-700",
    empty: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${map[status] || map.empty}`}>
      {status}
    </span>
  );
}

function Card({ title, items }) {
  const arr = Array.isArray(items) ? items : [];
  return (
    <div className="p-4 bg-white rounded-xl border">
      <h4 className="font-semibold text-purple-700 mb-2">{title}</h4>
      {arr.length ? (
        <ul className="list-disc pl-5 text-sm text-gray-800 space-y-1">
          {arr.map((it, i) => (
            <li key={i}>{typeof it === "string" ? it : JSON.stringify(it)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">No {title.toLowerCase()}.</p>
      )}
    </div>
  );
}

function AddMeetingModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState(PLATFORMS[0]);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    await onSubmit({ title: title.trim(), platform });
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Add Meeting</h3>
          <button className="text-gray-500 hover:text-gray-700" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 outline-none focus:ring focus:ring-purple-200"
              placeholder="Sprint Planning – Week 4"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 outline-none focus:ring focus:ring-purple-200"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "—";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const num = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${num} ${["B", "KB", "MB", "GB", "TB"][i]}`;
}
