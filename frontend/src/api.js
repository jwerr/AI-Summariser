// frontend/src/api.js
import axios from "axios";

// For direct calls (if you ever bypass the proxy)
export const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

// Minimal helper to unwrap axios responses consistently
const ok = (p) => p.then((r) => r.data);

// Using relative paths; the dev proxy will send them to FastAPI.
// If you want to call FastAPI directly (no proxy), set baseURL to API.
export const api = axios.create({
  baseURL: "",            // keep empty to use same-origin + proxy in dev
  withCredentials: true,  // allow cookies/sessions
  headers: { "Content-Type": "application/json" },
});

/* ------------------------ Health ------------------------ */
export const ping = () => ok(api.get("/ping"));

/* ------------------------- Me --------------------------- */
// Keep your existing fetch-based me() if other places use it:
export async function me() {
  const r = await fetch(`${API}/api/me`, { credentials: "include" });
  if (!r.ok) throw new Error("me() failed");
  return r.json();
}

/* ------------------------ Auth -------------------------- */
export const getMe = () => ok(api.get("/auth/me"));
export const loginWithEmail = (payload) => ok(api.post("/auth/login", payload));
export const signup = (payload) => ok(api.post("/auth/signup", payload));
export const logout = () => ok(api.post("/auth/logout"));

/* ---------------------- Meetings ------------------------ */
// GET all meetings for a user
export const getUserMeetings = (userId) =>
  ok(api.get(`/api/meetings/user/${userId}`));

// POST create a meeting (title required; platform optional)
export const createMeeting = ({ user_id, title, platform = null, transcript_path = null }) =>
  ok(api.post(`/api/meetings`, { user_id, title, platform, transcript_path }));

// --- Meetings: transcript + summary ---
// add at top if not already
//import axios from "axios";

// ...

export const uploadTranscript = (meetingId, file) => {
  const fd = new FormData();
  fd.append("file", file);

  // Use a fresh axios call so we don't send "application/json"
  return axios.post(`/api/meetings/${meetingId}/upload`, fd, {
    withCredentials: true,
    // Let axios set the proper multipart boundary
    headers: { /* intentionally empty to avoid JSON override */ },
    // If you want to bypass proxy, use: url: `${API}/api/meetings/${meetingId}/upload`
  }).then(r => r.data);
};

export const startSummarize = (meetingId) =>
  api.post(`/api/meetings/${meetingId}/summarize`).then(r => r.data);

export const getMeetingSummary = (meetingId) =>
  api.get(`/api/meetings/${meetingId}/summary`).then(r => r.data);


// (Optional) DELETE a meeting later if you add the endpoint
// export const deleteMeeting = (id) => ok(api.delete(`/api/meetings/${id}`));

// (Optional) PATCH/PUT update meeting later if you add the endpoint
// export const updateMeeting = (id, patch) => ok(api.patch(`/api/meetings/${id}`, patch));
