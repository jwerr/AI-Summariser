import { useRef, useState } from "react";

const API = process.env.REACT_APP_API_URL || "";

export default function UploadAndSummarize({ meetingId, mode }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function upload(file) {
    if (!meetingId || !file) return;
    setBusy(true);
    setMsg("Uploading…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/api/meetings/${meetingId}/upload_transcript`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        setMsg(`Upload failed: ${res.status} ${await res.text()}`);
        return;
      }
      setMsg("Uploaded. You can click Summarize.");
    } catch (e) {
      setMsg(`Upload error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function summarize() {
    if (!meetingId) return;
    setBusy(true);
    setMsg("Starting summarization…");
    try {
      const res = await fetch(`${API}/api/meetings/${meetingId}/summarize`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setMsg(`Summarize failed: ${res.status} ${await res.text()}`);
        return;
      }
      setMsg("Summarization started. Check the meeting’s summary panel.");
    } catch (e) {
      setMsg(`Summarize error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">
        Meeting: <b>{meetingId}</b> {mode ? <span>• Mode: <b>{mode}</b></span> : null}
      </div>

      <div className="flex gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => upload(e.target.files?.[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="px-3 py-2 rounded bg-white border hover:bg-gray-50 disabled:opacity-60"
        >
          {busy ? "Working…" : "Choose transcript"}
        </button>
        <button
          onClick={summarize}
          disabled={busy}
          className="px-3 py-2 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
        >
          Summarize
        </button>
      </div>

      {msg && <p className="text-xs text-gray-700">{msg}</p>}

      <p className="text-xs text-gray-500">
        Supported: TXT, VTT, SRT, DOCX, PDF (basic parsing).
      </p>
    </div>
  );
}
