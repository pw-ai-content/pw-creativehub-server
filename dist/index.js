"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const mongoose_1 = __importDefault(require("mongoose"));
const cookie_session_1 = __importDefault(require("cookie-session"));
const auth_1 = __importDefault(require("./routes/auth"));
const auth_2 = require("./middleware/auth");
const rolesFromSheet_1 = require("./services/rolesFromSheet");
const path_1 = __importDefault(require("path"));
const assets_1 = __importDefault(require("./routes/assets"));
const drive_1 = require("./services/drive");
const app = (0, express_1.default)();
const isProd = process.env.NODE_ENV === "production";
const crossSite = true; // Netlify <-> Render are different domains
app.set("trust proxy", true);
// CORS (supports comma-separated origins in ALLOWED_ORIGIN)
const origins = (process.env.ALLOWED_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
// One global CORS middleware
app.use((0, cors_1.default)({
    origin: function (origin, cb) {
        // allow non-browser tools (curl/Postman) which send no Origin
        if (!origin)
            return cb(null, true);
        return cb(null, origins.includes(origin));
    },
    credentials: true,
}));
app.use(express_1.default.json());
app.use("/uploads", express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
// Cookie session
app.use((0, cookie_session_1.default)({
    name: "sid",
    keys: [process.env.SESSION_SECRET || "dev-secret"],
    httpOnly: true,
    sameSite: crossSite && isProd ? "none" : "lax",
    secure: crossSite && isProd,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
}));
// Attach req.user if session present
app.use(auth_2.attachUser);
// Routes
app.use("/api", auth_1.default);
app.use("/api/assets", assets_1.default);
app.get("/api/debug/drive", async (_req, res) => {
    try {
        const id = await (0, drive_1.ensureFolderPath)(["_healthcheck"]);
        res.json({ ok: true, id });
    }
    catch (e) {
        console.error("Drive debug error:", e?.response?.data || e);
        res.status(500).json({ ok: false, error: String(e) });
    }
});
// ---- DEV: test Google Sheet role lookup ----
app.get("/api/dev/role", async (req, res) => {
    try {
        const email = String(req.query.email || "").trim().toLowerCase();
        if (!email)
            return res.status(400).json({ message: "Pass ?email=user@pw.live" });
        const role = await (0, rolesFromSheet_1.getRoleForEmail)(email);
        res.json({ email, role });
    }
    catch (e) {
        console.error("Sheet error:", e);
        res.status(500).json({ error: "sheet error", details: String(e) });
    }
});
// Simple root/health
app.get("/", (_req, res) => res.send("CreativeHub API. Try /api/health"));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
// Start
(async () => {
    await mongoose_1.default.connect(process.env.MONGODB_URI);
    const port = Number(process.env.PORT) || 4000;
    app.listen(port, () => console.log(`API on http://localhost:${port}`));
})();
//# sourceMappingURL=index.js.map