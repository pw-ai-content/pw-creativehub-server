"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const google_auth_library_1 = require("google-auth-library");
const rolesFromSheet_1 = require("../services/rolesFromSheet");
const router = (0, express_1.Router)();
const gis = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
/** POST /api/auth/google
 * Body: { credential: string }  // Google ID token from GIS
 * Sets httpOnly session cookie, returns { user }
 */
router.post("/auth/google", async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential)
            return res.status(400).json({ error: "missing credential" });
        const ticket = await gis.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload?.email || !payload.email_verified) {
            return res.status(401).json({ error: "email not verified" });
        }
        // Enforce pw.live domain
        const email = payload.email.trim().toLowerCase();
        if (!email.endsWith("@pw.live")) {
            return res.status(403).json({ error: "domain not allowed" });
        }
        // Map to role via Google Sheet (defaults to "user" if not present)
        const sheetRole = await (0, rolesFromSheet_1.getRoleForEmail)(email);
        const role = sheetRole || "user";
        const user = {
            email,
            name: payload.name || email.split("@")[0],
            picture: payload.picture,
            role, // "admin" | "sme" | "user"
        };
        // Save to cookie-session
        req.session = { user };
        return res.json({ user });
    }
    catch (err) {
        console.error("auth/google error", err);
        return res.status(500).json({ error: "auth failed" });
    }
});
/** GET /api/auth/me  -> { user } or 401 */
router.get("/auth/me", (req, res) => {
    const user = req.session?.user;
    if (!user)
        return res.status(401).json({ user: null });
    return res.json({ user });
});
/** POST /api/auth/logout -> clears cookie */
router.post("/auth/logout", (req, res) => {
    req.session = null;
    res.json({ ok: true });
});
if (process.env.NODE_ENV !== "production") {
    router.post("/dev-login", (req, res) => {
        req.session = req.session || {};
        req.session.user = {
            email: "admin@pw.live",
            name: "Local Admin",
            role: "admin",
        };
        res.json({ ok: true, user: req.session.user });
    });
}
exports.default = router;
//# sourceMappingURL=auth.js.map