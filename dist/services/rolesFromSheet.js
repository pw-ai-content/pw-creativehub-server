"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoleForEmail = getRoleForEmail;
const googleapis_1 = require("googleapis");
const SHEET_ID = process.env.ROLES_SHEET_ID;
const RANGE = process.env.ROLES_SHEET_RANGE || "Roles!A2:B";
const clientEmail = process.env.GOOGLE_SHEET_SA_EMAIL;
const privateKey = (process.env.GOOGLE_SHEET_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
let cache = null;
async function fetchRoles() {
    const auth = new googleapis_1.google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = googleapis_1.google.sheets({ version: "v4", auth });
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: RANGE,
    });
    const rows = resp.data.values || [];
    const map = new Map();
    for (const [email, role] of rows) {
        const e = String(email || "").trim().toLowerCase();
        const r = String(role || "").trim().toLowerCase();
        if (!e)
            continue;
        if (r === "admin" || r === "sme" || r === "user")
            map.set(e, r);
    }
    return map;
}
async function getRoleForEmail(email) {
    const now = Date.now();
    if (!cache || now > cache.expiresAt) {
        const map = await fetchRoles();
        cache = { map, expiresAt: now + 5 * 60 * 1000 }; // 5 min
    }
    return cache.map.get(email.toLowerCase()) || "user";
}
//# sourceMappingURL=rolesFromSheet.js.map