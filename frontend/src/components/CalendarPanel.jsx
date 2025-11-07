// src/components/CalendarPanel.jsx
import { useEffect, useState } from "react";

const API = process.env.REACT_APP_API_URL || "";

export default function CalendarPanel({ summary }) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [authUrl, setAuthUrl] = useState("");

  // Editable decisions (local mirror of summary.decisions)
  const [decisions, setDecisions] = useState([]);

  // Keep local decisions in sync when summary changes
  useEffect(() => {
    const incoming = Array.isArray(summary?.decisions) ? summary.decisions : [];
    // Normalize to strings for editing
    const normalized = incoming.map((d) =>
      typeof d === "string" ? d : d?.title || d?.text || ""
    );
    setDecisions(normalized);
  }, [summary]);

  // 1) Get Google auth URL
  useEffect(() => {
    fetch(`${API}/api/google/auth-url`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAuthUrl(d.url))
      .catch(() => {});
  }, []);

  // 2) Detect callback hit
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("google=connected")) setConnected(true);
  }, []);

  const fetchEvents = async () => {
    const res = await fetch(`${API}/api/calendar/events`, {
      credentials: "include",
    });
    if (res.ok) {
      const items = await res.json();
      setEvents(items);
      setConnected(true);
    } else {
      setConnected(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const createFromDecision = async (text) => {
    const startISO = new Date().toISOString();
    const endISO = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const payload = {
      summary: text || "Follow-up",
      description: text || "Created from AI Summariser decision",
      start: { dateTime: startISO },
      end: { dateTime: endISO },
    };

    const res = await fetch(`${API}/api/calendar/events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      fetchEvents();
    } else {
      const t = await res.text();
      alert("Failed: " + t);
    }
  };

  const updateDecisionAt = (idx, val) => {
    setDecisions((prev) => {
      const copy = [...prev];
      copy[idx] = val;
      return copy;
    });
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-purple-600">Calendar</h3>
        {!connected && authUrl && (
          <a
            href={authUrl}
            className="px-3 py-2 rounded bg-purple-600 text-white"
          >
            Connect Google Calendar
          </a>
        )}
      </div>

      <button
        onClick={fetchEvents}
        className="px-3 py-2 rounded bg-gray-100 border hover:bg-gray-200"
      >
        Refresh Events
      </button>

      <div className="space-y-2">
        {events.length === 0 ? (
          <p className="text-sm text-gray-600">
            No upcoming events (or not connected).
          </p>
        ) : (
          events.map((e) => {
            const start = e.start?.dateTime || e.start?.date;
            const end = e.end?.dateTime || e.end?.date;
            return (
              <div key={e.id} className="p-3 rounded border">
                <div className="font-medium">{e.summary || "(no title)"}</div>
                <div className="text-sm text-gray-600">
                  {start} → {end}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Editable Decisions → quick-add */}
      {decisions.length > 0 && (
        <div className="pt-4 border-t">
          <div className="font-medium mb-2">Create events from decisions</div>

          <div className="space-y-2">
            {decisions.map((d, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-2 rounded border"
              >
                <input
                  type="text"
                  value={d}
                  onChange={(e) => updateDecisionAt(i, e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-md focus:ring-2 focus:ring-purple-300 outline-none"
                  placeholder="Edit decision before adding to Calendar…"
                />
                <button
                  onClick={() => createFromDecision(d)}
                  className="px-3 py-2 rounded bg-purple-600 text-white text-sm"
                >
                  Add to Calendar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
