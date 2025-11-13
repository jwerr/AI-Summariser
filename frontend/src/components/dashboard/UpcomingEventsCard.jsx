// src/components/dashboard/UpcomingEventsCard.jsx
export default function UpcomingEventsCard({
  items,
  onRefresh,
  onPick,
  calendarConnected,
  onConnectCalendar,
}) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/80 to-slate-50/60 shadow-[0_6px_30px_rgba(2,6,23,0.08)]">
      <div className="flex items-center justify-between p-4">
        <h3 className="text-lg font-semibold text-slate-900">Upcoming Events</h3>
        <div className="flex items-center gap-2">
          {!calendarConnected && (
            <button
              onClick={onConnectCalendar}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700"
            >
              Connect Google Calendar
            </button>
          )}
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-md border text-xs hover:bg-white"
          >
            Refresh from Summary
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-4 text-sm text-slate-600">
          No upcoming items detected yet.
        </div>
      ) : (
        <ul className="p-2 space-y-2">
          {items.map((u, i) => (
            <li key={i}>
              <button
                onClick={() => onPick(u)}
                className="w-full text-left p-3 rounded-xl border hover:shadow-md hover:-translate-y-[1px] transition bg-white"
                title="Load into the Quick Event Composer"
              >
                <div className="font-medium text-slate-900">{u.title || "Follow-up meeting"}</div>
                <div className="text-sm text-slate-700">
                  {u.start_iso ? new Date(u.start_iso).toLocaleString() : "—"}
                </div>
                {u.description && (
                  <div className="text-xs text-slate-500 mt-1 line-clamp-2">{u.description}</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="p-4 pt-2">
        <p className="text-[11px] text-slate-500">
          From your latest summary and decisions. Click an item to prefill the composer.
        </p>
      </div>
    </div>
  );
}
