// frontend/src/api.js
import axios from "axios";

// Using relative paths; dev proxy will send them to FastAPI.
export const api = axios.create({
  baseURL: "",            // important: keep empty to use same-origin + proxy
  withCredentials: true,  // if you use cookies/sessions
});

// Health
export const ping = () => api.get("/ping").then(r => r.data);

// Auth
export const getMe = () => api.get("/auth/me").then(r => r.data);
export const loginWithEmail = (payload) => api.post("/auth/login", payload).then(r => r.data);
export const signup = (payload) => api.post("/auth/signup", payload).then(r => r.data);
export const logout = () => api.post("/auth/logout").then(r => r.data);
