import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { getRoleForEmail } from "../services/rolesFromSheet";

const router = Router();
const gis = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/** POST /api/auth/google
 * Body: { credential: string }  // Google ID token from GIS
 * Sets httpOnly session cookie, returns { user }
 */
router.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body as { credential?: string };
    if (!credential) return res.status(400).json({ error: "missing credential" });

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
    const sheetRole = await getRoleForEmail(email);
    const role = sheetRole || "user";

    const user = {
      email,
      name: payload.name || email.split("@")[0],
      picture: payload.picture,
      role, // "admin" | "sme" | "user"
    };

    // Save to cookie-session
    (req as any).session = { user };
    return res.json({ user });
  } catch (err: any) {
    console.error("auth/google error", err);
    return res.status(500).json({ error: "auth failed" });
  }
});

/** GET /api/auth/me  -> { user } or 401 */
router.get("/auth/me", (req, res) => {
  const user = (req as any).session?.user;
  if (!user) return res.status(401).json({ user: null });
  return res.json({ user });
});

/** POST /api/auth/logout -> clears cookie */
router.post("/auth/logout", (req, res) => {
  (req as any).session = null;
  res.json({ ok: true });
});

export default router;
