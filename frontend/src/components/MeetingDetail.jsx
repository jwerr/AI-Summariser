// components/MeetingDetail.jsx
import { useParams, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import UploadAndSummarize from "../UploadAndSummarize";


// Demo list (remove when wiring real data)
export const MEETINGS = [
  { id: "kickoff-2024-04-20", title: "Project Kickoff", date: "Apr 20" },
  { id: "team-sync-2024-04-18", title: "Team Sync", date: "Apr 18" },
  { id: "team-sync-2024-04-15", title: "Team Sync", date: "Apr 15" },
  { id: "client-call-2024-04-12", title: "Client Call", date: "Apr 12" },
];

export default function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState(null); // "upload" | "summarize" | null
  const [deleting, setDeleting] = useState(false);

  const meeting = useMemo(() => MEETINGS.find((m) => String(m.id) === String(id)), [id]);

  async function handleDelete() {
    const ok = window.confirm("Delete this meeting and its related data?");
    if (!ok) return;

    // If your real backend uses numeric IDs, try to delete when id is numeric.
    const isNumeric = /^\d+$/.test(String(id));

    if (!isNumeric) {
      // Demo mode (string ids from MEETINGS): just navigate back.
      navigate("/dashboard", { replace: true });
      return;
    }

    try {
      setDeleting(true);
      const res = await fetch(`/api/meetings/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 204) {
        navigate("/dashboard", { replace: true });
      } else {
        const txt = await res.text();
        alert(`Failed to delete (status ${res.status}): ${txt}`);
      }
    } catch (e) {
      alert(`Failed to delete: ${e}`);
    } finally {
      setDeleting(false);
    }
  }

  if (!meeting) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate("/dashboard")}
          className="mb-4 px-3 py-2 rounded bg-gray-200"
        >
          ← Back
        </button>
        <p className="text-red-600">Meeting not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-r from-purple-100 via-white to-indigo-100">
      <header className="flex justify-between items-center px-6 py-4 bg-white shadow">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200 transition"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-purple-700">{meeting.title}</h1>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-gray-600">{meeting.date}</span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Delete meeting"
            className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-6">
        {/* Buttons: separate Upload vs Summarize */}
        <div className="flex gap-3">
          <button
            onClick={() => setMode("upload")}
            className={`px-4 py-2 rounded-lg text-white transition ${
              mode === "upload" ? "bg-purple-700" : "bg-purple-500 hover:bg-purple-600"
            }`}
          >
            Upload Transcript
          </button>
          <button
            onClick={() => setMode("summarize")}
            className={`px-4 py-2 rounded-lg text-white transition ${
              mode === "summarize" ? "bg-indigo-700" : "bg-indigo-500 hover:bg-indigo-600"
            }`}
          >
            Summarize
          </button>
        </div>

        {/* Panel */}
        <div className="p-6 bg-white rounded-xl shadow">
          {!mode && (
            <p className="text-gray-600">
              Choose <b>Upload Transcript</b> or <b>Summarize</b> to begin.
            </p>
          )}

          {mode && (
            <UploadAndSummarize
              key={`${id}-${mode}`}   // force remount when switching modes
              meetingId={id}          // backend meeting identifier
              mode={mode}             // optional prop if your component supports it
            />
          )}
        </div>
      </main>
    </div>
  );
}
