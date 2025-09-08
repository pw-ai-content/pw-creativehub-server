// src/api.ts
import axios from "axios";

export const api = axios.create({
  baseURL: "/api",          // relies on Vite proxy below
  withCredentials: true,    // <-- VERY important (sends the session cookie)
});
