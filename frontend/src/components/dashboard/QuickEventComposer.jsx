// src/components/dashboard/QuickEventComposer.jsx
export default function QuickEventComposer({
  draft,
  onChange,
  onCreate,
  calendarConnected,
  onConnect,
}) {
  const set = (k, v) => onChange((d) => ({ ...d, [k]: v }));

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/80 to-slate-50/60 shadow-[0_6px_30px_rgba(2,6,23,0.08)]">
      <div className="flex items-center justify-between p-4">
        <h3 className="text-lg font-semibold text-slate-900">Quick Event Composer</h3>
        {!calendarConnected ? (
          <button
            onClick={onConnect}
            className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700"
          >
            Connect Google Calendar
          </button>
        ) : (
          <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded">Connected</span>
        )}
      </div>

      <div className="p-4 space-y-3">
        <label className="block text-xs text-slate-600">
          Title
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Follow-up meeting"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-xs text-slate-600">
            Date
            <input
              type="date"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={draft.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Start time
            <input
              type="time"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={draft.start_time}
              onChange={(e) => set("start_time", e.target.value)}
            />
          </label>
          <label className="block text-xs text-slate-600">
            End time
            <input
              type="time"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={draft.end_time}
              onChange={(e) => set("end_time", e.target.value)}
            />
          </label>
        </div>

        <label className="block text-xs text-slate-600">
          Description
          <textarea
            rows={3}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Context or agenda…"
          />
        </label>

        <div className="flex justify-end">
          <button
            onClick={onCreate}
            disabled={!calendarConnected || !draft.date || !draft.start_time || !draft.end_time}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            Add to Google Calendar
          </button>
        </div>

        <p className="text-[11px] text-slate-500">
          Tip: End time is assumed to be on the same day. If it’s earlier than the start time,
          we’ll roll it to the next day automatically.
        </p>
      </div>
    </div>
  );
}
