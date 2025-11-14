// src/components/pages/DashboardPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CalendarPanel from "../CalendarPanel";

const API = process.env.REACT_APP_API_URL || "";
const AFTER_GOOGLE_KEY = "after_google_auth_destination";
const NOTES_KEY_PREFIX = "dashboard_notes_";

/* ------------ date extraction helpers ------------ */
const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const p2 = (n) => String(n).padStart(2, "0");
const toLocalISO = (d) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(
    d.getHours()
  )}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

function parseTimeBits(str) {
  if (!str) return null;
  const m = str.trim().match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = +m[1];
  const mm = m[2] ? +m[2] : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h <= 7) h += 12;
  return { h24: h, m: mm };
}

function extractUpcomingFromText(text) {
  if (!text || typeof text !== "string") return [];

  const now = new Date();

  // 1) Try to anchor year from transcript header like: "Date: November 9, 2025"
  let anchorYear = null;
  {
    const head = text.slice(0, 600);
    const y1 = head.match(
      /\bDate:\s*(?:[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*)?(\d{4}))\b/i
    );
    const y2 = head.match(/\b(20\d{2})\b/);
    if (y1 && y1[1]) anchorYear = parseInt(y1[1], 10);
    else if (y2 && y2[1]) anchorYear = parseInt(y2[1], 10);
  }

  const out = [];

  // 2) ISO-like: 2025-11-12 or 2025-11-12 10:00
  {
    const re = /\b(20\d{2})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?\b/g;
    for (const m of text.matchAll(re)) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      const hh = m[4] ? parseInt(m[4], 10) : 10;
      const mm = m[5] ? parseInt(m[5], 10) : 0;
      const dt = new Date(y, mo - 1, d, hh, mm, 0);
      if (dt >= now) {
        out.push({
          title: "Follow-up meeting",
          start_iso: toLocalISO(dt),
          end_iso: null,
          description: `Auto-detected: ${m[0]}`,
          source: m[0],
        });
      }
    }
  }

  // 3) mm/dd(/yyyy) [time]
  {
    const re =
      /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?\b/gi;
    for (const m of text.matchAll(re)) {
      const mo = parseInt(m[1], 10);
      const d = parseInt(m[2], 10);
      let y = null;
      if (m[3]) {
        y = parseInt(m[3], 10);
        if (y < 100) y += 2000;
      } else if (anchorYear) {
        y = anchorYear;
      } else {
        y = new Date().getFullYear();
      }
      const tb = parseTimeBits(m[4] || "");
      const hh = tb?.h24 ?? 10;
      const mm = tb?.m ?? 0;
      const dt = new Date(y, mo - 1, d, hh, mm, 0);
      if (dt >= now) {
        out.push({
          title: "Follow-up meeting",
          start_iso: toLocalISO(dt),
          end_iso: null,
          description: `Auto-detected: ${m[0]}`,
          source: m[0],
        });
      }
    }
  }

  // 4) Month-name forms
  {
    const monthMap = MONTHS;
    const re =
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?\b/gi;

    for (const m of text.matchAll(re)) {
      const mo = monthMap[m[1].toLowerCase().replace(/\./g, "")];
      const d = parseInt(m[2], 10);
      let y = null;
      if (m[3]) {
        y = parseInt(m[3], 10);
      } else if (anchorYear) {
        y = anchorYear;
      } else {
        y = new Date().getFullYear();
      }
      const tb = parseTimeBits(m[4] || "");
      const hh = tb?.h24 ?? 10;
      const mm = tb?.m ?? 0;

      const dt = new Date(y, mo - 1, d, hh, mm, 0);
      if (dt >= now) {
        out.push({
          title: "Follow-up meeting",
          start_iso: toLocalISO(dt),
          end_iso: null,
          description: `Auto-detected: ${m[0]}`,
          source: m[0],
        });
      }
    }
  }

  // Dedup + sort + cap
  const seen = new Set();
  const dedup = [];
  for (const it of out) {
    if (seen.has(it.start_iso)) continue;
    seen.add(it.start_iso);
    dedup.push(it);
  }
  dedup.sort((a, b) => new Date(a.start_iso) - new Date(b.start_iso));
  return dedup.slice(0, 12);
}

/* ----- title helper for upcoming cards ----- */
function inferUpcomingTitle(u = {}) {
  // If backend already sent a title, respect it.
  if (u.title && u.title.trim()) return u.title;

  const blob = `${u.description || ""} ${u.source || ""}`.toLowerCase();

  if (blob.includes("team lunch")) return "Team lunch";
  if (blob.includes("lunch")) return "Team lunch";

  if (blob.includes("retrospective") || blob.includes("retro")) {
    return "Sprint retrospective";
  }
  if (blob.includes("planning")) {
    return "Planning session";
  }
  if (blob.includes("demo")) {
    return "Demo";
  }
  if (blob.includes("review")) {
    return "Review meeting";
  }

  // Fallback
  return "Follow-up meeting";
}

/* ------------------------------- component ------------------------------- */
export default function DashboardPage({ user }) {
  const navigate = useNavigate();
  const userId = user?.id || user?.user_id || user?.uid || 1;

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [upcoming, setUpcoming] = useState([]);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const [notes, setNotes] = useState("");
  const calRef = useRef(null);

  async function fetchMeetings() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/meetings/user/${userId}`, {
        credentials: "include",
      });
      const list = r.ok ? await r.json() : [];
      setMeetings(Array.isArray(list) ? list : []);
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUpcomingFromLatest() {
    if (!meetings.length) {
      setUpcoming([]);
      return;
    }
    const latest = meetings[0];
    setLoadingUpcoming(true);
    try {
      const res = await fetch(
        `${API}/api/meetings/${latest.id}/summary?t=${Date.now()}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        setUpcoming([]);
        return;
      }
      const payload = await res.json();
      const s = payload?.normalized || {};
      let items = [];
      if (
        Array.isArray(s.schedule_suggestions) &&
        s.schedule_suggestions.length
      ) {
        items = s.schedule_suggestions.map((it) => ({
          title: it.title || "Follow-up meeting",
          start_iso: it.start_iso || "",
          end_iso: it.end_iso || null,
          description: it.description || it.raw_quote || "",
          source: it.raw_quote || "",
        }));
      } else {
        const bundle = [s.summary_text || "", ...(s.decisions || []), ...(s.action_items || [])]
          .filter(Boolean)
          .join("\n");
        items = extractUpcomingFromText(bundle);
      }
      setUpcoming(items);
    } catch {
      setUpcoming([]);
    } finally {
      setLoadingUpcoming(false);
    }
  }

  // Load meetings
  useEffect(() => {
    fetchMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Refresh upcoming when meetings change
  useEffect(() => {
    fetchUpcomingFromLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(meetings)]);

  // Handle redirect after Google auth
  useEffect(() => {
    const dest = localStorage.getItem(AFTER_GOOGLE_KEY);
    if (dest) {
      localStorage.removeItem(AFTER_GOOGLE_KEY);
      if (dest === "uploads") {
        navigate("/uploads");
      }
    }
  }, [navigate]);

  // Load notes from localStorage when userId changes
  useEffect(() => {
    const key = `${NOTES_KEY_PREFIX}${userId}`;
    const stored = localStorage.getItem(key);
    if (stored != null) {
      setNotes(stored);
    } else {
      setNotes("");
    }
  }, [userId]);

  // Persist notes to localStorage
  useEffect(() => {
    const key = `${NOTES_KEY_PREFIX}${userId}`;
    if (notes && notes.trim().length > 0) {
      localStorage.setItem(key, notes);
    } else {
      localStorage.removeItem(key);
    }
  }, [notes, userId]);

  const recent3 = useMemo(
    () => (meetings || []).slice(0, 3),
    [meetings]
  );

  return (
    // AppShell already gives background & padding; here we just stack content
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Recent meetings card */}
          <section className="rounded-xl border bg-white/95 shadow-sm dark:bg-slate-900 dark:border-slate-700">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-semibold text-gray-800 dark:text-slate-100">
                Recent Meetings
              </h3>
              <button
                onClick={() => navigate("/meetings")}
                className="px-3 py-1.5 rounded-md bg-purple-600 text-white text-sm hover:bg-purple-700"
              >
                + New Meeting
              </button>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && (
                <li className="px-4 py-4 text-sm text-gray-500 dark:text-slate-400">
                  Loading…
                </li>
              )}
              {!loading && recent3.length === 0 && (
                <li className="px-4 py-4 text-sm text-gray-500 dark:text-slate-400">
                  No meetings yet.
                </li>
              )}
              {recent3.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <button
                    onClick={() => navigate(`/meetings/${m.id}`)}
                    className="w-full text-left group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-slate-100 truncate">
                          {m.title || `Meeting #${m.id}`}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                          {m.platform || "—"} ·{" "}
                          <span className="text-green-600 dark:text-green-400">
                            Uploaded
                          </span>
                        </div>
                      </div>
                      <span className="text-gray-400 dark:text-slate-500 group-hover:text-gray-600 dark:group-hover:text-slate-300">
                        ›
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Upcoming events card */}
          <section className="rounded-xl border bg-white/95 shadow-sm dark:bg-slate-900 dark:border-slate-700">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-semibold text-gray-800 dark:text-slate-100">
                Upcoming Events
              </h3>
              <button
                onClick={fetchUpcomingFromLatest}
                disabled={loadingUpcoming}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-sm text-gray-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                {loadingUpcoming ? "Refreshing…" : "Refresh from Summary"}
              </button>
            </div>
            <div className="p-4 grid gap-3 md:grid-cols-2">
              {Array.isArray(upcoming) && upcoming.length > 0 ? (
                upcoming.map((u, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      // Prefill the calendar composer
                      calRef.current?.prefill(u);
                      // Remove this item from upcoming once it's used
                      setUpcoming((prev) =>
                        prev.filter((_, idx) => idx !== i)
                      );
                    }}
                    className="text-left border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-white/80 dark:bg-slate-800 hover:shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-500"
                    title="Click to prefill the Event Composer"
                  >
                    <div className="font-medium text-gray-900 dark:text-slate-100">
                      {inferUpcomingTitle(u)}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-slate-300 mt-1">
                      {u.start_iso
                        ? new Date(u.start_iso).toLocaleString()
                        : "—"}
                    </div>
                    {u.description && (
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                        {u.description.length > 80
                          ? u.description.slice(0, 80) + "…"
                          : u.description}
                      </div>
                    )}
                  </button>
                ))
              ) : (
                <p className="col-span-full text-sm text-gray-600 dark:text-slate-300">
                  No upcoming items detected yet. Click “Refresh from Summary”
                  to pull dates mentioned in your latest summaries and
                  decisions.
                </p>
              )}
            </div>
          </section>

          {/* Notes card */}
          <section className="rounded-xl border bg-white/95 shadow-sm dark:bg-slate-900 dark:border-slate-700">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-semibold text-gray-800 dark:text-slate-100">
                Notes
              </h3>
              <span className="text-[11px] text-gray-400 dark:text-slate-500">
                Auto-saved
              </span>
            </div>
            <div className="p-4">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Jot down quick ideas, next steps, or reminders…"
                className="w-full min-h-[120px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900 px-3 py-2 text-sm text-gray-800 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-500 resize-y"
              />
            </div>
          </section>
        </div>

        {/* Right column – Calendar + composer */}
        <div className="sticky top-4 self-start">
          <CalendarPanel ref={calRef} userId={userId} />
        </div>
      </div>
    </div>
  );
}