// src/components/CalendarPanel.jsx
import {
  useEffect,
  useImperativeHandle,
  useState,
  forwardRef,
} from "react";

const API = process.env.REACT_APP_API_URL || "";

// ---------- small helpers ----------
const p2 = (n) => String(n).padStart(2, "0");

function partsToISO(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseSafe(dt) {
  if (!dt) return null;
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Nice, short “Thu, Nov 13 · 10:00–11:00 AM”
function formatEventRange(start, end) {
  if (!start) return "—";

  const dateOpts = { weekday: "short", month: "short", day: "numeric" };
  const timeOpts = { hour: "numeric", minute: "2-digit" };

  const dateLabel = start.toLocaleDateString(undefined, dateOpts);
  const startTime = start.toLocaleTimeString(undefined, timeOpts);

  if (!end) {
    return `${dateLabel} · ${startTime}`;
  }

  const endTime = end.toLocaleTimeString(undefined, timeOpts);
  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay) {
    return `${dateLabel} · ${startTime}–${endTime}`;
  }

  const endLabel = end.toLocaleDateString(undefined, dateOpts);
  return `${dateLabel} ${startTime} → ${endLabel} ${endTime}`;
}

// shared input style (light + dark)
const inputBase =
  "mt-1 w-full rounded-md border px-2 py-1 text-sm " +
  "border-slate-300 bg-white/90 text-slate-900 " +
  "placeholder:text-slate-400 " +
  "dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-400/60";

const buttonGhost =
  "px-3 py-1.5 rounded-md border text-sm " +
  "border-slate-300 text-slate-700 bg-white/5 hover:bg-slate-50 " +
  "dark:border-slate-600 dark:text-slate-100 dark:bg-slate-900/40 dark:hover:bg-slate-800/80 transition";

const buttonPrimary =
  "px-3 py-1.5 rounded-md text-sm font-medium " +
  "bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60 transition";

// ---------- main component ----------
const CalendarPanel = forwardRef(function CalendarPanel({ userId }, ref) {
  // Quick Event Composer state
  const [title, setTitle] = useState("Follow-up meeting");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [description, setDescription] = useState("");

  // Calendar list
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [connected, setConnected] = useState(false);

  // Expose prefill() so Dashboard can fill the composer from Upcoming Events
  useImperativeHandle(ref, () => ({
    prefill(u) {
      if (!u) return;

      let dStr = date;
      let sStr = startTime;
      let eStr = endTime;

      if (u.start_iso) {
        const d = new Date(u.start_iso);
        if (!Number.isNaN(d.getTime())) {
          dStr = d.toISOString().slice(0, 10); // yyyy-mm-dd
          sStr = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
        }
      }

      if (u.end_iso) {
        const d = new Date(u.end_iso);
        if (!Number.isNaN(d.getTime())) {
          eStr = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
        }
      }

      setTitle(u.title || "Follow-up meeting");
      setDescription(u.description || "");
      setDate(dStr);
      setStartTime(sStr);
      setEndTime(eStr);
    },
  }));

  function authHeaders() {
    return userId ? { "X-User-Id": String(userId) } : {};
  }

  async function fetchEvents() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`${API}/api/calendar/events`, {
        credentials: "include",
        headers: authHeaders(),
      });

      if (!res.ok) {
        setConnected(false);

        if ([400, 401, 403, 409].includes(res.status)) {
          const t = await res.text().catch(() => "");
          setErr(
            t ||
              "Google Calendar not connected. Click Connect to link your account."
          );
          setEvents([]);
          return;
        }

        const t = await res.text().catch(() => "");
        setErr(`Calendar error (${res.status}): ${t || "unknown error"}`);
        setEvents([]);
        return;
      }

      setConnected(true);

      const data = await res.json().catch(() => []);
      const items = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
        ? data
        : [];

      const norm = items
        .map((e, i) => {
          const start = e.start?.dateTime || e.start?.date || e.start;
          const end = e.end?.dateTime || e.end?.date || e.end;
          const sd = parseSafe(start);
          const ed = parseSafe(end);
          return {
            id: e.id || i,
            title: e.summary || e.title || "Untitled",
            start: sd,
            end: ed,
            location: e.location || "",
          };
        })
        .filter((e) => !!e.start)
        .sort((a, b) => a.start - b.start);

      setEvents(norm);
    } catch (e) {
      setConnected(false);
      setErr(`Failed to fetch calendar: ${e?.message || e}`);
      setEvents([]);
    } finally {
      setBusy(false);
    }
  }

  async function connectGoogle() {
    setErr("");
    try {
      const r = await fetch(`${API}/api/google/auth-url`, {
        credentials: "include",
        headers: { "X-User-Id": String(userId) },
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        setErr(`Failed to get auth URL: ${t || r.status}`);
        return;
      }
      const { url } = await r.json();
      if (url) window.location.href = url;
      else setErr("Missing auth URL from server.");
    } catch (e) {
      setErr(`Failed to start OAuth: ${e?.message || e}`);
    }
  }

  async function createFromComposer() {
    const start_iso = partsToISO(date, startTime);
    let end_iso = partsToISO(date, endTime);

    if (!start_iso) {
      setErr("Please set a valid date and start time.");
      return;
    }
    if (!end_iso) {
      setErr("Please set a valid end time.");
      return;
    }

    // if end < start (user typo), push end to next day
    if (new Date(end_iso) <= new Date(start_iso)) {
      const s = new Date(start_iso);
      const e = new Date(start_iso);
      e.setDate(e.getDate() + 1);
      end_iso = e.toISOString();
    }

    setBusy(true);
    setErr("");
    try {
      const body = {
        title: (title || "Follow-up meeting").trim(),
        description: description || "",
        start_iso,
        end_iso,
      };

      const r = await fetch(`${API}/api/calendar/create`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        setErr(`Create event failed (${r.status}): ${t}`);
        return;
      }

      await fetchEvents();
    } catch (e) {
      setErr(`Create event error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <div className="p-4 rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_10px_35px_rgba(15,23,42,0.35)] dark:bg-slate-900/95 dark:border-slate-700/80">
      {/* Quick Event Composer */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900 dark:text-slate-50">
          Quick Event Composer
        </h3>
        <span
          className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
            connected
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/40"
              : "bg-slate-700/40 text-slate-200 border border-slate-500/60"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      <div className="space-y-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Title
          </label>
          <input
            className={inputBase}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Follow-up meeting"
          />
        </div>

        {/* date + time fields */}
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Date
            </label>
            <input
              type="date"
              className={inputBase}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Start time
              </label>
              <input
                type="time"
                className={inputBase}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                End time
              </label>
              <input
                type="time"
                className={inputBase}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Description
          </label>
          <textarea
            className={inputBase + " resize-none"}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Context or agenda…"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={connectGoogle}
            className={buttonGhost + " flex-1"}
          >
            Connect Google Calendar
          </button>
          <button
            type="button"
            onClick={createFromComposer}
            disabled={busy || !date || !startTime || !endTime}
            className={buttonPrimary + " flex-1"}
          >
            Add to Google Calendar
          </button>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Tip: End time is assumed to be on the same day. If it&rsquo;s earlier
          than the start time, we&rsquo;ll roll it to the next day
          automatically.
        </p>
      </div>

      <div className="border-t border-slate-200/70 dark:border-slate-700/80 pt-3 mt-2">
        {/* Calendar list */}
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold text-slate-900 dark:text-slate-50">
            Calendar
          </h4>
          <button
            type="button"
            onClick={fetchEvents}
            disabled={busy}
            className="px-2.5 py-1.5 rounded-md border border-slate-300 text-xs text-slate-700 bg-white/5 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-900/40 dark:hover:bg-slate-800/80 transition"
          >
            {busy ? "Refreshing…" : "Refresh Events"}
          </button>
        </div>

        {err && (
          <p className="mb-2 text-xs text-red-500 dark:text-red-400">{err}</p>
        )}

        {events.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {connected
              ? "No upcoming events."
              : "No events (connect your calendar above)."}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.slice(0, 6).map((e) => (
              <li
                key={e.id}
                className="border border-slate-200/70 dark:border-slate-700/80 rounded-xl px-3 py-2 bg-slate-50/80 dark:bg-slate-800/80"
              >
                <div className="font-medium text-slate-900 dark:text-slate-50 truncate">
                  {e.title}
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-300 mt-0.5">
                  {formatEventRange(e.start, e.end)}
                </div>
                {e.location && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {e.location}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

export default CalendarPanel;
