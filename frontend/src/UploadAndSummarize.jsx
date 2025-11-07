import { useState } from "react";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

// ---------- Helpers ----------
const fmtCount = (arr) => (Array.isArray(arr) ? arr.length : 0);

const highlightTokens = (t) => {
  // highlight @owners and "due/ deadline ..." phrases
  return t
    .split(/(\s@[\w.-]+|\s(?:due|deadline)\s[^,;]+|\sby\s[0-9]{4}-[0-9]{2}-[0-9]{2})/gi)
    .map((chunk, i) => {
      if (/^\s@[\w.-]+/i.test(chunk)) {
        return (
          <span key={i} className="px-1 rounded bg-purple-100 text-purple-700 font-medium">
            {chunk.trim()}
          </span>
        );
      }
      if (/^\s(?:due|deadline)\s/i.test(chunk) || /^\sby\s[0-9]{4}-[0-9]{2}-[0-9]{2}/i.test(chunk)) {
        return (
          <span key={i} className="px-1 rounded bg-amber-100 text-amber-700">
            {chunk.trim()}
          </span>
        );
      }
      return <span key={i}>{chunk}</span>;
    });
};

const toMarkdown = (s) => {
  if (!s) return "";
  const mk = [
    `# Summary #${s.id}`,
    s.model_used ? `*Model:* ${s.model_used}` : "",
    s.created_at ? `*Created:* ${new Date(s.created_at).toLocaleString()}` : "",
    "",
    "## Key Points",
    ...(s.key_points || []).map((x) => `- ${typeof x === "string" ? x : JSON.stringify(x)}`),
    "",
    "## Decisions",
    ...(s.decisions || []).map((x) => `- ${typeof x === "string" ? x : JSON.stringify(x)}`),
    "",
    "## Action Items",
    ...(s.action_items || []).map((x) => `- ${typeof x === "string" ? x : JSON.stringify(x)}`),
    "",
  ]
    .filter(Boolean)
    .join("\n");
  return mk;
};

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
};

const downloadFile = (name, text) => {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

// ---------- Component ----------
/**
 * Props (all optional but recommended):
 * - meetingId (string): scope uploads to this meeting
 * - mode ("upload" | "summarize" | null): optional UI hint
 * - onUploaded(meta: object): called after a successful upload/summarize with EXACT server meta
 */
export default function UploadAndSummarize({ meetingId, mode, onUploaded }) {
  const [file, setFile] = useState(null);
  const [uploadRes, setUploadRes] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const onUpload = async () => {
    try {
      setErr("");
      setSummary(null);
      if (!file) return setErr("Pick a file first");
      if (!meetingId) return setErr("No meeting selected.");

      const fd = new FormData();
      // IMPORTANT: keep original filename/metadata — do NOT change it client-side
      fd.append("f", file);
      // Pass meeting context to backend (your API can read from form field)
      fd.append("meeting_id", meetingId);

      setLoading(true);
      const res = await fetch(`${API}/api/transcripts/upload`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());

      // EXACT meta object from server; do not rewrite
      const meta = await res.json(); // { id, filename, created_at, size_bytes, summary? }
      setUploadRes(meta);
      onUploaded?.(meta); // notify Dashboard to append AS-IS
    } catch (e) {
      setErr(e.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const onSummarize = async () => {
    try {
      if (!uploadRes?.id) return setErr("Upload something first");
      setErr("");
      setLoading(true);
      const res = await fetch(`${API}/api/summarize/${uploadRes.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ max_tokens: 512, temperature: 0.2 }),
      });
      if (!res.ok) throw new Error(await res.text());

      // Many APIs return the updated transcript (now with summary)
      const meta = await res.json(); // shape depends on your API
      setSummary(meta);
      // If your API returns the same transcript object, you can bubble it up:
      onUploaded?.(meta);
    } catch (e) {
      setErr(e.message || "Summarize failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-semibold">Upload & Summarize</h2>

      <input
        type="file"
        accept=".txt,.vtt,.srt,.doc,.docx,.pdf"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="block"
      />

      <div className="flex gap-3">
        <button
          onClick={onUpload}
          disabled={loading}
          className="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
          title={meetingId ? `Upload to meeting ${meetingId}` : "Select a meeting first"}
        >
          {loading ? "Uploading..." : "Upload"}
        </button>
        <button
          onClick={onSummarize}
          disabled={loading || !uploadRes}
          className="px-4 py-2 rounded bg-purple-600 text-white disabled:opacity-50"
        >
          {loading ? "Summarizing..." : "Summarize"}
        </button>
      </div>

      {/* Show where this will be stored */}
      {meetingId && (
        <div className="text-xs text-gray-500">
          Target meeting: <b>{meetingId}</b>
          {mode ? <> • Mode: <b>{mode}</b></> : null}
        </div>
      )}

      {uploadRes && (
        <div className="rounded border p-3 bg-white">
          <div className="font-medium">Uploaded</div>
          <div className="text-sm text-gray-600">
            id: {uploadRes.id}, file: {uploadRes.filename}
          </div>
        </div>
      )}

      {summary && (
        <div className="rounded-xl border bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-gray-900">Summary #{summary.id}</div>
              <div className="text-xs text-gray-500">
                {summary.model_used ? `Model: ${summary.model_used} · ` : ""}
                {summary.created_at ? new Date(summary.created_at).toLocaleString() : ""}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-1 text-sm rounded border hover:bg-gray-50"
                onClick={() => copyText(toMarkdown(summary))}
                title="Copy as Markdown"
              >
                Copy MD
              </button>
              <button
                className="px-3 py-1 text-sm rounded border hover:bg-gray-50"
                onClick={() => downloadFile(`summary-${summary.id}.md`, toMarkdown(summary))}
                title="Download Markdown"
              >
                Download
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {/* Key Points */}
            <section className="p-3 rounded-lg border">
              <header className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-purple-700">Key Points</h4>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  {fmtCount(summary.key_points)}
                </span>
              </header>
              {fmtCount(summary.key_points) === 0 ? (
                <p className="text-sm text-gray-500">No key points detected.</p>
              ) : (
                <ul className="list-disc pl-5 space-y-1">
                  {summary.key_points.map((k, i) => (
                    <li key={i} className="text-sm text-gray-800 leading-snug">
                      {typeof k === "string" ? highlightTokens(k) : JSON.stringify(k)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Decisions */}
            <section className="p-3 rounded-lg border">
              <header className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-indigo-700">Decisions</h4>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  {fmtCount(summary.decisions)}
                </span>
              </header>
              {fmtCount(summary.decisions) === 0 ? (
                <p className="text-sm text-gray-500">No decisions identified.</p>
              ) : (
                <ul className="list-disc pl-5 space-y-1">
                  {summary.decisions.map((k, i) => (
                    <li key={i} className="text-sm text-gray-800 leading-snug">
                      {typeof k === "string" ? highlightTokens(k) : JSON.stringify(k)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Action Items */}
            <section className="p-3 rounded-lg border">
              <header className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-emerald-700">Action Items</h4>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {fmtCount(summary.action_items)}
                </span>
              </header>
              {fmtCount(summary.action_items) === 0 ? (
                <p className="text-sm text-gray-500">No action items found.</p>
              ) : (
                <ul className="list-disc pl-5 space-y-1">
                  {summary.action_items.map((k, i) => (
                    <li key={i} className="text-sm text-gray-800 leading-snug">
                      {typeof k === "string" ? highlightTokens(k) : JSON.stringify(k)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {!!err && <div className="text-red-600">{err}</div>}
    </div>
  );
}
