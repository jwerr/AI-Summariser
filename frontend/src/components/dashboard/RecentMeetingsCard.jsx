// src/components/dashboard/RecentMeetingsCard.jsx
export default function RecentMeetingsCard({ meetings, onOpen, onNew }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white/80 to-slate-50/60 shadow-[0_6px_30px_rgba(2,6,23,0.08)]">
      <div className="flex items-center justify-between p-4">
        <h3 className="text-lg font-semibold text-slate-900">Recent Meetings</h3>
        <button
          onClick={onNew}
          className="px-3 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-700 transition"
        >
          + New Meeting
        </button>
      </div>

      <div className="divide-y">
        {meetings.length === 0 ? (
          <div className="p-4 text-sm text-slate-600">No meetings yet.</div>
        ) : (
          meetings.slice(0, 6).map((m) => (
            <button
              key={m.id}
              onClick={() => onOpen(m.id)}
              className="w-full text-left group p-4 hover:bg-white/70 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-900 group-hover:text-purple-700 transition">
                    {m.title || `Meeting #${m.id}`}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {m.platform || "—"}
                    {" • "}
                    {m.transcript_path || m._hasTranscripts ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">
                        Uploaded
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-2 py-0.5">
                        No transcript
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-slate-400 group-hover:text-purple-600 transition">›</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
