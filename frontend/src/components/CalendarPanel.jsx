// src/components/CalendarPanel.jsx
import { useEffect, useState } from "react";

const API = process.env.REACT_APP_API_URL || "";

function parseSafe(dt) {
  if (!dt) return null;
  const d = new Date(dt);
  return isNaN(d.getTime()) ? null : d;
}

export default function CalendarPanel({ userId, summary, upcoming }) {
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
        // 400/401/403/409 → not connected / needs consent / not authed
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
      if (url) {
        window.location.href = url; // redirect to Google OAuth
      } else {
        setErr("Missing auth URL from server.");
      }
    } catch (e) {
      setErr(`Failed to start OAuth: ${e?.message || e}`);
    }
  }

  async function quickCreate(u) {
    if (!u?.start_iso) return;
    setBusy(true);
    setErr("");
    try {
      const body = {
        title: u.title || "Follow-up meeting",
        description: u.description || "",
        start_iso: u.start_iso,
        end_iso: u.end_iso || null,
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

      {Array.isArray(upcoming) && upcoming.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium text-gray-800 mb-2">Create events from decisions</h4>
          <ul className="space-y-2">
            {upcoming.slice(0, 3).map((u, i) => (
              <li key={i} className="flex items-center justify-between border rounded-lg p-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{u.title || "Follow-up meeting"}</div>
                  <div className="text-xs text-gray-600">
                    {u.start_iso ? new Date(u.start_iso).toLocaleString() : "—"}
                  </div>
                </div>
                <button
                  onClick={() => quickCreate(u)}
                  disabled={busy || !u.start_iso}
                  className="ml-3 px-2 py-1 rounded bg-indigo-600 text-white text-xs disabled:opacity-60"
                  type="button"
                >
                  Add to Calendar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
