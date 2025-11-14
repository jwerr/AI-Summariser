// src/pages/MeetingPage.js
import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Download, Trash2, FileText, X, MessageCircle } from "lucide-react";

const API = process.env.REACT_APP_API_URL || "";

const emptySummary = {
  status: "empty",
  key_points: [],
  action_items: [],
  decisions: [],
  summary_text: "",
};

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

  const meetingFromList = location.state?.meeting || null;

  const [meeting, setMeeting] = useState(meetingFromList);
  const [summary, setSummary] = useState(emptySummary);
  const [isUploading, setIsUploading] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [loadError, setLoadError] = useState("");

  // transcript local info
  const [localTranscript, setLocalTranscript] = useState(null); // {name, uploadedAt}

  // transcript modal
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [transcriptText, setTranscriptText] = useState("");
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState("");

  // Q&A bot state (chat style)
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaMessages, setQaMessages] = useState([]); // [{role:"user"|"assistant", text}]
  const [isQaLoading, setIsQaLoading] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);

  // optional: auto-scroll chat to bottom
  const chatBodyRef = useRef(null);

  // --------- transcript info ----------
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

      setLocalTranscript({
        name: file.name,
        uploadedAt: new Date().toISOString(),
      });

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
    const url = `${API}/api/meetings/${id}/transcript?raw=true`;
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
      setTranscriptText("");
      setQaMessages([]);
      setQaQuestion("");
    }
  }

  async function openTranscriptModal() {
    if (!hasTranscript) return;
    setShowTranscriptModal(true);
    setTranscriptError("");

    if (transcriptText) return;

    setIsLoadingTranscript(true);
    try {
      let url;
      if (transcriptPath && /^https?:\/\//i.test(transcriptPath)) {
        url = transcriptPath;
      } else {
        url = `${API}/api/meetings/${id}/transcript`;
      }

      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Failed to load transcript: ${r.status} ${t}`);
      }
      const text = await r.text();
      setTranscriptText(text || "");
    } catch (err) {
      console.error(err);
      setTranscriptError(
        "Unable to load transcript text. You may still download it instead."
      );
    } finally {
      setIsLoadingTranscript(false);
    }
  }

  async function handleAskQuestion() {
    const question = qaQuestion.trim();
    if (!question) return;

    if (!hasTranscript) {
      setQaMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Please upload a transcript first, then I can answer questions.",
          error: true,
        },
      ]);
      return;
    }

    // push user message immediately
    setQaMessages((prev) => [
      ...prev,
      { role: "user", text: question },
    ]);
    setQaQuestion("");
    setIsQaLoading(true);

    try {
      const res = await fetch(`${API}/api/qa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          meeting_id: Number(id),
          question,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to get answer from Q/A bot");
      }

      const answer =
        data.answer || "I couldn't find that in this meeting.";
      setQaMessages((prev) => [
        ...prev,
        { role: "assistant", text: answer },
      ]);
    } catch (err) {
      console.error(err);
      setQaMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            err.message ||
            "Something went wrong while asking the bot.",
          error: true,
        },
      ]);
    } finally {
      setIsQaLoading(false);
    }
  }

  useEffect(() => {
    fetchMeeting();
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // auto-scroll chat body when messages change
  useEffect(() => {
    if (!chatBodyRef.current) return;
    chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }, [qaMessages]);

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
                  {formatDateTime(transcriptMeta.uploadedAt) || "just now"}
                </div>

                <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5 text-[11px]">
                  Uploaded
                </span>

                <button
                  type="button"
                  onClick={openTranscriptModal}
                  className="px-2 py-1 text-[11px] inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  title="View transcript"
                >
                  <FileText size={12} />
                  View transcript
                </button>

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

        {/* Summary card */}
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

      {/* Floating Q&A chat bubble */}
      <div className="fixed bottom-5 right-4 sm:bottom-6 sm:right-6 z-40">
        {/* Chat window */}
        {qaOpen && (
          <div className="mb-3 w-80 sm:w-96 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-xs font-semibold">
                  AI
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-50">
                    Meeting Q&A
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Ask anything about this transcript
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQaOpen(false)}
                className="p-1 rounded-full hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>

            <div
              ref={chatBodyRef}
              className="px-3 py-2 h-44 overflow-auto text-xs bg-slate-50/60 dark:bg-slate-950/40"
            >
              {qaMessages.length === 0 ? (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Ask a question about the meeting, for example:
                  <br />
                  <span className="italic">
                    “What did we decide about next week&apos;s deployment?”
                  </span>
                </p>
              ) : (
                qaMessages.map((m, idx) => {
                  const isUser = m.role === "user";
                  const bubbleClasses = isUser
                    ? "bg-purple-600 text-white rounded-2xl rounded-br-sm"
                    : m.error
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-50 rounded-2xl rounded-bl-sm"
                    : "bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-50 rounded-2xl rounded-bl-sm";

                  return (
                    <div
                      key={idx}
                      className={`mb-2 flex ${
                        isUser ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div className={`max-w-[80%] px-3 py-2 text-[11px] ${bubbleClasses} shadow-sm`}>
                        {m.text}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-3 py-2 border-top border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500/70"
                  placeholder={
                    hasTranscript
                      ? "Type your question…"
                      : "Upload a transcript first"
                  }
                  value={qaQuestion}
                  onChange={(e) => setQaQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isQaLoading) {
                      handleAskQuestion();
                    }
                  }}
                  disabled={!hasTranscript || isQaLoading}
                />
                <button
                  type="button"
                  onClick={handleAskQuestion}
                  disabled={!hasTranscript || isQaLoading}
                  className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isQaLoading ? "…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bubble button */}
        <button
          type="button"
          onClick={() => hasTranscript && setQaOpen((v) => !v)}
          disabled={!hasTranscript}
          title={
            hasTranscript
              ? "Chat with the meeting bot"
              : "Upload a transcript to enable Q&A"
          }
          className={`h-12 w-12 rounded-full shadow-xl flex items-center justify-center text-white text-xl font-semibold bg-gradient-to-br from-pink-400 via-fuchsia-500 to-blue-500 border border-white/40
            ${!hasTranscript ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          `}
        >
          <MessageCircle size={22} />
        </button>
      </div>

      {/* Transcript Modal */}
      {showTranscriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Transcript • {transcriptMeta.name}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {formatDateTime(transcriptMeta.uploadedAt) || "Uploaded"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTranscriptModal(false)}
                className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300"
                aria-label="Close transcript"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-auto text-xs sm:text-sm font-mono whitespace-pre-wrap text-slate-800 dark:text-slate-100 bg-slate-50/80 dark:bg-slate-950/60">
              {isLoadingTranscript ? (
                <p>Loading transcript…</p>
              ) : transcriptError ? (
                <p className="text-rose-600 dark:text-rose-300">
                  {transcriptError}
                </p>
              ) : transcriptText ? (
                transcriptText
              ) : (
                <p>No transcript text available.</p>
              )}
            </div>

            <div className="flex justify-end px-4 py-3 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setShowTranscriptModal(false)}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-900 text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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