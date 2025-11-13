// src/pages/MeetingPage.js
import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Download, Trash2 } from "lucide-react";

const API = process.env.REACT_APP_API_URL || "";

const emptySummary = {
  status: "empty",
  key_points: [],
  action_items: [],
  decisions: [],
  summary_text: "",
};

// simple formatter for timestamps
function formatDateTime(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MeetingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fileRef = useRef(null);

  // If we came from Meetings list we already know name/platform
  const meetingFromList = location.state?.meeting || null;

  const [meeting, setMeeting] = useState(meetingFromList);
  const [summary, setSummary] = useState(emptySummary);
  const [isUploading, setIsUploading] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [loadError, setLoadError] = useState("");

  // local transcript info so UI updates immediately after upload
  const [localTranscript, setLocalTranscript] = useState(null); // {name, uploadedAt}

  // --------- derive transcript info ----------
  const transcriptPath =
    meeting?.transcript_download_url ||
    meeting?.transcript_url ||
    meeting?.transcript_path ||
    meeting?.transcript_file ||
    null;

  const hasTranscript = !!(transcriptPath || localTranscript);

  const transcriptMeta = (() => {
    const nameFromServer =
      meeting?.transcript_filename || meeting?.transcript_name;
    const uploadedFromServer = meeting?.transcript_uploaded_at;

    const name = nameFromServer || localTranscript?.name || "Transcript";
    const uploadedAt =
      uploadedFromServer || localTranscript?.uploadedAt || null;

    return { name, uploadedAt };
  })();

  // final title resolution – keep list title if API doesn’t send one
  const title =
    meeting?.title || meetingFromList?.title || `Meeting #${id}`;

  // --------- API calls ----------
  async function fetchMeeting() {
    try {
      const r = await fetch(`${API}/api/meetings/${id}`, {
        credentials: "include",
      });

      if (r.ok) {
        const data = await r.json();
        setMeeting((prev) => ({
          ...(prev || {}),
          ...(data || {}),
        }));
        setLoadError("");
      } else {
        // only show hard error if we *don’t* have info from the list
        if (!meetingFromList) {
          setLoadError(`Could not load meeting #${id}`);
        }
        setMeeting((prev) => {
          if (prev && prev.title) return prev;
          return {
            id,
            title: meetingFromList?.title || `Meeting #${id}`,
          };
        });
      }
    } catch {
      if (!meetingFromList) {
        setLoadError(`Could not load meeting #${id}`);
      }
      setMeeting((prev) => {
        if (prev && prev.title) return prev;
        return {
          id,
          title: meetingFromList?.title || `Meeting #${id}`,
        };
      });
    }
  }

  async function fetchSummary() {
    try {
      const r = await fetch(
        `${API}/api/meetings/${id}/summary?t=${Date.now()}`,
        { credentials: "include" }
      );
      if (!r.ok) {
        setSummary(emptySummary);
        return;
      }
      const payload = await r.json();
      const s = payload?.normalized || {};
      setSummary({
        status: s.status || (s.summary_text ? "ready" : "empty"),
        key_points: Array.isArray(s.key_points) ? s.key_points : [],
        action_items: Array.isArray(s.action_items) ? s.action_items : [],
        decisions: Array.isArray(s.decisions) ? s.decisions : [],
        summary_text: s.summary_text || "",
      });
    } catch {
      setSummary(emptySummary);
    }
  }

  async function handleSummarize() {
    setIsSummarizing(true);
    try {
      const kick = await fetch(`${API}/api/meetings/${id}/summarize`, {
        method: "POST",
        credentials: "include",
      });
      if (!kick.ok) {
        const txt = await kick.text();
        alert(`Summarize failed: ${kick.status} ${txt}`);
        return;
      }

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 30; i++) {
        await sleep(1500);
        const r = await fetch(
          `${API}/api/meetings/${id}/summary?t=${Date.now()}`,
          { credentials: "include" }
        );
        if (r.ok) {
          const payload = await r.json();
          const s = payload?.normalized || {};
          if (s.status === "ready") {
            await fetchSummary();
            break;
          }
          if (s.status === "error") {
            alert(s.error || "Summarization failed");
            break;
          }
        }
      }
    } finally {
      setIsSummarizing(false);
    }
  }

  async function handleFilePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API}/api/meetings/${id}/upload_transcript`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!r.ok) {
        const t = await r.text();
        alert(`Upload failed: ${r.status} ${t}`);
        return;
      }

      // immediately reflect in UI
      setLocalTranscript({
        name: file.name,
        uploadedAt: new Date().toISOString(),
      });

      // also refresh server-side data if it exists
      await fetchMeeting();
      await fetchSummary();
    } finally {
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleDownloadTranscript() {
    if (transcriptPath && /^https?:\/\//i.test(transcriptPath)) {
      window.open(transcriptPath, "_blank");
      return;
    }
    if (transcriptPath) {
      const url = `${API}/api/files/${encodeURIComponent(transcriptPath)}`;
      window.open(url, "_blank");
      return;
    }
    // fallback generic endpoint
    const url = `${API}/api/meetings/${id}/transcript`;
    window.open(url, "_blank");
  }

  async function handleDeleteTranscript() {
    const ok = window.confirm(
      "Delete the uploaded transcript for this meeting? This cannot be undone."
    );
    if (!ok) return;

    try {
      const r = await fetch(`${API}/api/meetings/${id}/transcript`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        console.warn("Transcript delete failed", r.status);
        alert("Transcript delete API not wired yet (front-end only).");
      }
    } catch (err) {
      console.warn("Transcript delete error", err);
      alert("Transcript delete API not wired yet (front-end only).");
    } finally {
      setLocalTranscript(null);
      setMeeting((m) =>
        m
          ? {
              ...m,
              transcript_path: null,
              transcript_file: null,
              transcript_url: null,
              transcript_download_url: null,
              transcript_filename: null,
              transcript_uploaded_at: null,
            }
          : m
      );
      setSummary(emptySummary);
    }
  }

  useEffect(() => {
    fetchMeeting();
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // --------- render ----------
  return (
    <div className="max-w-5xl mx-auto">
      <div className="p-8 space-y-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 shadow-sm">
        {/* Header + actions */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              {title}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Key insights and outcomes
            </p>

            {!hasTranscript && (
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                No transcript uploaded yet. Use{" "}
                <span className="font-medium">Upload transcript</span> above to
                add one.
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(-1)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800"
                type="button"
              >
                ← Back
              </button>

              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={handleFilePicked}
                accept=".txt,.vtt,.srt,.docx,.pdf"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                disabled={isUploading}
                type="button"
              >
                {isUploading ? "Uploading…" : "Upload transcript"}
              </button>

              <button
                onClick={handleSummarize}
                className="px-3 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-700 disabled:opacity-60"
                disabled={isSummarizing}
                type="button"
              >
                {isSummarizing ? "Summarizing…" : "Summarize"}
              </button>
            </div>

            {/* transcript status row */}
            {hasTranscript && (
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-500 dark:text-slate-400 mr-1">
                  Manual upload ·{" "}
                  {formatDateTime(transcriptMeta.uploadedAt) ||
                    "just now"}
                </div>

                <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5 text-[11px]">
                  Uploaded
                </span>

                <button
                  type="button"
                  onClick={handleDownloadTranscript}
                  className="p-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 hover:bg-slate-50 dark:text-slate-300 dark:hover:text-slate-50 dark:hover:bg-slate-700"
                  title={`Download ${transcriptMeta.name}`}
                >
                  <Download size={14} />
                </button>

                <button
                  type="button"
                  onClick={handleDeleteTranscript}
                  className="p-1.5 rounded-full border border-rose-200/80 text-rose-500 hover:bg-rose-50 dark:border-rose-700/60 dark:text-rose-300 dark:hover:bg-rose-900/30"
                  title="Delete transcript"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Only show hard error if we truly couldn't load anything */}
        {loadError && !meetingFromList && (
          <div className="px-4 py-2 rounded-xl bg-rose-50 text-rose-700 text-sm border border-rose-100 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-800">
            {loadError}
          </div>
        )}

        {/* Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Key Points" items={summary.key_points} />
          <Card title="Action Items" items={summary.action_items} />
          <div className="lg:col-span-2">
            <Card title="Decisions" items={summary.decisions} />
          </div>
        </div>

        {summary.summary_text ? (
          <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-purple-700 dark:text-purple-300 mb-2">
              Summary
            </h3>
            <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
              {summary.summary_text}
            </p>
          </div>
        ) : (
          <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-purple-700 dark:text-purple-300 mb-2">
              Summary
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No summary generated yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, items }) {
  const arr = Array.isArray(items) ? items : [];
  const emptyLabel = title.toLowerCase();

  return (
    <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
      <h3 className="font-semibold text-purple-700 dark:text-purple-300 mb-2">
        {title}
      </h3>
      {arr.length ? (
        <ul className="list-disc pl-5 text-sm text-slate-800 dark:text-slate-100 space-y-1">
          {arr.map((t, i) => (
            <li key={i}>{typeof t === "string" ? t : JSON.stringify(t)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No {emptyLabel}.
        </p>
      )}
    </div>
  );
}