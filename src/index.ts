import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import cookieSession from "cookie-session";
import authRoutes from "./routes/auth";
import { attachUser } from "./middleware/auth";
import { getRoleForEmail } from "./services/rolesFromSheet";
import path from "path";
import assetsRoutes from "./routes/assets";
import { ensureFolderPath } from "./services/drive";


const app = express();
const isProd = process.env.NODE_ENV === "production";
const crossSite = true; // Netlify <-> Render are different domains

// CORS (supports comma-separated origins in ALLOWED_ORIGIN)
const origins = (process.env.ALLOWED_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: origins,
    credentials: true,
  })
);

// Allow all preflights for the allowed origins (esp. for file uploads and auth)
app.options("*", cors({
  origin: origins,
  credentials: true,
}));


app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
// src/index.ts (near the top, before cookieSession)
app.set("trust proxy", 1);


// Cookie session
app.use(
  cookieSession({
    name: "sid",
    keys: [process.env.SESSION_SECRET || "dev-secret"],
    httpOnly: true,
    sameSite: crossSite && isProd ? "none" : "lax",
    secure: crossSite && isProd, 
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  })
);

// Attach req.user if session present
app.use(attachUser);

// Routes
app.use("/api", authRoutes);
app.use("/api/assets", assetsRoutes);

app.get("/api/debug/drive", async (_req, res) => {
  try {
    const id = await ensureFolderPath(["_healthcheck"]);
    res.json({ ok: true, id });
  } catch (e: any) {
    console.error("Drive debug error:", e?.response?.data || e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});


// ---- DEV: test Google Sheet role lookup ----
app.get("/api/dev/role", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Pass ?email=user@pw.live" });

    const role = await getRoleForEmail(email);
    res.json({ email, role });
  } catch (e) {
    console.error("Sheet error:", e);
    res.status(500).json({ error: "sheet error", details: String(e) });
  }
});

// Simple root/health
app.get("/", (_req, res) => res.send("CreativeHub API. Try /api/health"));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Start
(async () => {
  await mongoose.connect(process.env.MONGODB_URI!);
  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => console.log(`API on http://localhost:${port}`));
})();
