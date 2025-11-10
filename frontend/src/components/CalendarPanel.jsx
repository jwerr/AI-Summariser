// src/components/CalendarPanel.jsx
import { useEffect, useState } from "react";

const API = process.env.REACT_APP_API_URL || "";

// helpers
const p2 = (n) => String(n).padStart(2, "0");
function isoToParts(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    time: `${p2(d.getHours())}:${p2(d.getMinutes())}`,
  };
}
function partsToISO(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}`);
  if (isNaN(d.getTime())) return null;
  return d.toISOString(); // backend sets timeZone; UTC here is fine
}
function parseSafe(dt) {
  if (!dt) return null;
  const d = new Date(dt);
  return isNaN(d.getTime()) ? null : d;
}

export default function CalendarPanel({ userId, summary, upcoming }) {
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // drafts: editable suggestions (Date + Start + End + Description)
  const [drafts, setDrafts] = useState([]);
  useEffect(() => {
    const next = Array.isArray(upcoming)
      ? upcoming.slice(0, 10).map((u) => {
          const start = isoToParts(u.start_iso);
          // default end = start + 60 mins
          let end = { ...start };
          if (u.end_iso) end = isoToParts(u.end_iso);
          else {
            const sDate = new Date(partsToISO(start.date, start.time) || Date.now());
            const e = new Date(sDate.getTime() + 60 * 60000);
            end = { date: start.date, time: `${p2(e.getHours())}:${p2(e.getMinutes())}` };
          }
          return {
            title: u.title || "Follow-up meeting",
            date: start.date,
            start_time: start.time,
            end_time: end.time, // same day
            description: u.description || "",
          };
        })
      : [];
    setDrafts(next);
  }, [JSON.stringify(upcoming || [])]);

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
        if ([400, 401, 403, 409].includes(res.status)) {
          const t = await res.text().catch(() => "");
          setErr(t || "Google Calendar not connected. Click Connect to link your account.");
          setEvents([]);
          return;
        }
        const t = await res.text().catch(() => "");
        setErr(`Calendar error (${res.status}): ${t || "unknown error"}`);
        setEvents([]);
        return;
      }
      const data = await res.json().catch(() => []);
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
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

  async function createFromDraft(idx) {
    const d = drafts[idx];
    if (!d) return;

    const start_iso = partsToISO(d.date, d.start_time);
    let end_iso = partsToISO(d.date, d.end_time);

    if (!start_iso) {
      setErr("Please set a valid date and start time.");
      return;
    }
    if (!end_iso) {
      setErr("Please set a valid end time.");
      return;
    }
    // if end < start (user typo), push end to next day but warn
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
        title: (d.title || "Follow-up meeting").trim(),
        description: d.description || "",
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
    <div className="p-4 rounded-xl border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-800">Calendar</h3>
        <button
          onClick={connectGoogle}
          className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700"
          type="button"
        >
          Connect Google Calendar
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={fetchEvents}
          disabled={busy}
          className="px-2.5 py-1.5 rounded border text-sm disabled:opacity-60"
          type="button"
        >
          {busy ? "Refreshing…" : "Refresh Events"}
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-gray-600">
          {err ? "No events (connect your calendar above)." : "No upcoming events (or not connected)."}
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {events.slice(0, 6).map((e) => (
            <li key={e.id} className="border rounded-lg p-2">
              <div className="font-medium truncate">{e.title}</div>
              <div className="text-gray-700">
                {e.start ? e.start.toLocaleString() : "—"}
                {e.end ? ` – ${e.end.toLocaleString()}` : ""}
              </div>
              {e.location && <div className="text-xs text-gray-500">{e.location}</div>}
            </li>
          ))}
        </ul>
      )}

      {drafts.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium text-gray-800 mb-2">Create events from decisions</h4>
          <ul className="space-y-3">
            {drafts.map((d, i) => (
              <li key={i} className="border rounded-lg p-3">
                <div className="grid grid-cols-1 gap-2">
                  <label className="text-xs text-gray-600">
                    Title
                    <input
                      className="mt-1 w-full border rounded-md px-2 py-1 text-sm"
                      value={d.title}
                      onChange={(e) =>
                        setDrafts((ds) => ds.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x)))
                      }
                      placeholder="Follow-up meeting"
                    />
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="text-xs text-gray-600">
                      Date
                      <input
                        type="date"
                        className="mt-1 w-full border rounded-md px-2 py-1 text-sm"
                        value={d.date}
                        onChange={(e) =>
                          setDrafts((ds) => ds.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x)))
                        }
                      />
                    </label>

                    <label className="text-xs text-gray-600">
                      Start time
                      <input
                        type="time"
                        className="mt-1 w-full border rounded-md px-2 py-1 text-sm"
                        value={d.start_time}
                        onChange={(e) =>
                          setDrafts((ds) =>
                            ds.map((x, idx) => (idx === i ? { ...x, start_time: e.target.value } : x))
                          )
                        }
                      />
                    </label>

                    <label className="text-xs text-gray-600">
                      End time (same day)
                      <input
                        type="time"
                        className="mt-1 w-full border rounded-md px-2 py-1 text-sm"
                        value={d.end_time}
                        onChange={(e) =>
                          setDrafts((ds) =>
                            ds.map((x, idx) => (idx === i ? { ...x, end_time: e.target.value } : x))
                          )
                        }
                      />
                    </label>
                  </div>

                  <label className="text-xs text-gray-600">
                    Description (optional)
                    <textarea
                      className="mt-1 w-full border rounded-md px-2 py-1 text-sm"
                      rows={2}
                      value={d.description}
                      onChange={(e) =>
                        setDrafts((ds) => ds.map((x, idx) => (idx === i ? { ...x, description: e.target.value } : x)))
                      }
                    />
                  </label>

                  <div className="flex justify-end">
                    <button
                      onClick={() => createFromDraft(i)}
                      disabled={busy || !d.date || !d.start_time || !d.end_time}
                      className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs disabled:opacity-60"
                      type="button"
                    >
                      Add to Calendar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs text-gray-500">
            Tip: End time is assumed to be on the same day. If it’s earlier than the start time, we’ll roll it to the next day.
          </p>
        </div>
      )}
    </div>
  );
}
