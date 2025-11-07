// src/components/MeetingThread.js
import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  getUserMeetings,
  createMeeting,
  uploadTranscript,
  startSummarize,
  getMeetingSummary,
} from "../api";

export default function MeetingThread({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [sidebarMeetings, setSidebarMeetings] = useState([]);
  const [meeting, setMeeting] = useState(null);
  const [activeTab, setActiveTab] = useState("summary"); // summary | transcript | qa
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // demo summary payload; swap to real after summarize
  const [summary, setSummary] = useState({
    summary: {
      one_liner: "Team aligned on scope, risks, and next steps.",
      key_points: ["Scope agreed", "Timeline approved", "Owners assigned"],
      decisions: ["Use FastAPI + Postgres", "Sprint length = 2 weeks"],
      action_items: ["@shiva set up DB", "@arul build UI shell"],
    },
  });

  const uid = user?.id ?? user?.user_id ?? user?._id;

  // Load sidebar meeting list (on mount and when user changes)
  useEffect(() => {
    if (!uid) return;
    getUserMeetings(uid)
      .then(rows => setSidebarMeetings(Array.isArray(rows) ? rows : []))
      .catch(() => setSidebarMeetings([]));
  }, [uid]);

  // Keep `meeting` in sync with `id` and `sidebarMeetings`
  useEffect(() => {
    const found = (Array.isArray(sidebarMeetings) ? sidebarMeetings : []).find(
      m => String(m.id) === String(id)
    );
    setMeeting(found || { id, title: `Meeting ${id}` });
  }, [id, sidebarMeetings]);

  // Optionally load summary for this meeting (if exists)
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getMeetingSummary(id)
      .then(res => {
        if (res?.data) setSummary(res.data);
      })
      .catch(() => {
        /* it's fine if none yet */
      })
      .finally(() => setLoading(false));
  }, [id]);

  /* ---------- Create New Meeting (fixed) ---------- */
  const NewMeeting = async () => {
    if (!uid || creating) return;
    setErrorMsg("");
    setCreating(true);
    try {
      // create on backend so we get a real id
      const m = await createMeeting({
        user_id: uid,
        title: "Untitled Meeting",
        platform: null,
      });

      // update sidebar immediately
      setSidebarMeetings(prev => (m ? [m, ...prev] : prev));

      // navigate to the new thread
      if (m?.id) navigate(`/meeting/${m.id}`);
      else throw new Error("Invalid meeting id from server");
    } catch (e) {
      setErrorMsg(e?.message || "Failed to create meeting");
    } finally {
      setCreating(false);
    }
  };

  /* ---------- Upload & Summarize ---------- */
  const handleUpload = async () => {
    if (!file || !id) return;
    setLoading(true);
    try {
      await uploadTranscript(id, file);
      const res = await getMeetingSummary(id);
      setSummary(res?.data || null);
    } catch (e) {
      setErrorMsg("Upload failed");
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSummarize = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await startSummarize(id);
      setSummary(res?.data || null);
    } catch (e) {
      setErrorMsg("Summarization failed");
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-r from-purple-100 via-white to-indigo-100">
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 bg-white shadow">
        <Link to="/dashboard" className="text-2xl font-bold text-purple-700 hover:opacity-80">
          AI Summariser
        </Link>

        <div
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition"
          onClick={() => navigate("/profile")}
        >
          <img
            src={user?.picture || "https://via.placeholder.com/40"}
            alt="profile"
            className="h-10 w-10 rounded-full object-cover border-2 border-purple-400"
          />
          <span className="font-medium text-gray-700">
            {user?.firstName || user?.email || "User"}
          </span>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Left Sidebar (threads list) */}
        <aside className="w-64 bg-white shadow-md p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold text-purple-700">Meetings</h2>
            <button
              onClick={NewMeeting}
              disabled={creating}
              className="px-2 py-1 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
              title="Create new meeting"
            >
              {creating ? "Creating..." : "+ New"}
            </button>
          </div>

          {errorMsg && (
            <div className="mb-2 text-xs text-red-600 bg-red-50 p-2 rounded">{errorMsg}</div>
          )}

          <ul className="space-y-2">
            {sidebarMeetings.map((m) => (
              <li key={m.id}>
                <Link
                  to={`/meeting/${m.id}`}
                  className={`block p-3 rounded-lg hover:bg-purple-100 transition ${
                    String(m.id) === String(id)
                      ? "bg-purple-50 border border-purple-200"
                      : "bg-white"
                  }`}
                >
                  <p className="font-medium">{m.title}</p>
                  <p className="text-sm text-gray-500">{m.platform || "Unspecified"}</p>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main thread area */}
        <main className="flex-1 p-6 space-y-4">
          {/* Title row */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-800">
                {meeting?.title || `Meeting ${id}`}
              </h1>
              <p className="text-sm text-gray-500">ID: {id}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            {["summary", "transcript", "qa"].map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-4 py-2 rounded-lg border ${
                  activeTab === t
                    ? "bg-purple-600 text-white border-purple-700"
                    : "bg-white text-gray-700 hover:bg-purple-50 border-gray-200"
                }`}
              >
                {t === "summary" ? "Summary" : t === "transcript" ? "Transcript" : "Q&A"}
              </button>
            ))}
          </div>

          {/* Panels */}
          {activeTab === "summary" && (
            <div className="grid md:grid-cols-3 gap-4">
              <Card title="Key Points" items={summary?.summary?.key_points} />
              <Card title="Decisions" items={summary?.summary?.decisions} />
              <Card title="Action Items" items={summary?.summary?.action_items} />
              {summary?.summary?.one_liner && (
                <div className="md:col-span-3 p-5 bg-white rounded-xl shadow">
                  <h3 className="font-semibold text-purple-700 mb-2">One-liner</h3>
                  <p className="text-gray-700">{summary.summary.one_liner}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "transcript" && (
            <div className="p-5 bg-white rounded-xl shadow">
              <p className="text-gray-700 whitespace-pre-wrap">(Transcript content…)</p>

              {/* Upload & Summarize controls */}
              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  type="file"
                  accept=".txt,.md,.docx,.pdf,.vtt,.srt"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <button
                  onClick={handleUpload}
                  disabled={!file || loading}
                  className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:bg-black disabled:opacity-50"
                >
                  {loading ? "Uploading..." : "Upload"}
                </button>
                <button
                  onClick={handleSummarize}
                  disabled={loading}
                  className="px-3 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {loading ? "Summarizing..." : "Summarize"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "qa" && (
            <div className="p-5 bg-white rounded-xl shadow">
              <h3 className="font-semibold text-purple-700 mb-3">Ask this meeting</h3>
              <QABox />
              <div className="mt-4 space-y-2 text-sm">
                <p><b>You:</b> What are my tasks?</p>
                <p><b>Bot:</b> {(summary?.summary?.action_items || []).join("; ")}</p>
              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar */}
        <aside className="w-64 bg-white shadow-md p-4">
          <h2 className="text-xl font-bold text-purple-700 mb-3">Quick Actions</h2>
          <button className="w-full mb-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            Create Calendar Event
          </button>
          <button className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
            Export Summary
          </button>
        </aside>
      </div>
    </div>
  );
}

function Card({ title, items }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div className="p-5 bg-white rounded-xl shadow">
      <h3 className="font-semibold text-purple-700 mb-2">{title}</h3>
      <ul className="list-disc pl-5 text-gray-700 space-y-1">
        {list.length ? list.map((x, i) => <li key={i}>{x}</li>) : <li className="list-none text-gray-400">No items</li>}
      </ul>
    </div>
  );
}

function QABox() {
  const [q, setQ] = useState("");
  const ask = async () => {
    // TODO: wire your /api/meetings/:id/qa
    setQ("");
  };
  return (
    <div className="flex gap-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask something about this meeting…"
        className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
      />
      <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700" onClick={ask}>
        Send
      </button>
    </div>
  );
}
