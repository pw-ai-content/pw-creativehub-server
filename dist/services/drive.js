"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureFolderPath = ensureFolderPath;
exports.uploadFileToDrive = uploadFileToDrive;
exports.streamDriveFile = streamDriveFile;
// src/services/drive.ts
const googleapis_1 = require("googleapis");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mime_types_1 = __importDefault(require("mime-types"));
const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID;
const SA_EMAIL = process.env.GOOGLE_DRIVE_SA_EMAIL;
// If you stored the private key as a single env var string (recommended), keep this:
let SA_PRIVATE_KEY = (process.env.GOOGLE_DRIVE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
// (Optional fallback) If you used a Render Secret File named GOOGLE_DRIVE_PRIVATE_KEY instead:
if (!SA_PRIVATE_KEY && fs_1.default.existsSync("/etc/secrets/GOOGLE_DRIVE_PRIVATE_KEY")) {
    SA_PRIVATE_KEY = fs_1.default.readFileSync("/etc/secrets/GOOGLE_DRIVE_PRIVATE_KEY", "utf8");
}
if (!DRIVE_ROOT_FOLDER_ID || !SA_EMAIL || !SA_PRIVATE_KEY) {
    console.warn("[Drive] Missing env vars: DRIVE_ROOT_FOLDER_ID / GOOGLE_DRIVE_SA_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY");
}
function driveClient() {
    const auth = new googleapis_1.google.auth.JWT({
        email: SA_EMAIL,
        key: SA_PRIVATE_KEY,
        scopes: ["https://www.googleapis.com/auth/drive"],
    });
    return googleapis_1.google.drive({ version: "v3", auth });
}
/** Ensure nested folder path exists; returns the deepest folder ID. */
async function ensureFolderPath(segments) {
    const drive = driveClient();
    let parentId = DRIVE_ROOT_FOLDER_ID;
    for (const raw of segments) {
        const name = String(raw || "").trim();
        if (!name)
            continue;
        const q = [
            `'${parentId}' in parents`,
            `mimeType = 'application/vnd.google-apps.folder'`,
            `name = '${name.replace(/'/g, "\\'")}'`,
            "trashed = false",
        ].join(" and ");
        const { data } = await drive.files.list({ q, fields: "files(id, name)", pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true, });
        let folderId = data.files?.[0]?.id;
        if (!folderId) {
            const created = await drive.files.create({
                requestBody: {
                    name,
                    mimeType: "application/vnd.google-apps.folder",
                    parents: [parentId],
                },
                fields: "id, name",
                supportsAllDrives: true,
            });
            folderId = created.data.id;
        }
        parentId = folderId;
    }
    return parentId;
}
/**
 * Upload local file to Drive under folderId.
 * Accepts optional fileName and optional mimeTypeOverride to match your route.
 */
async function uploadFileToDrive(folderId, localPath, fileName, mimeTypeOverride) {
    const drive = driveClient();
    const name = fileName || path_1.default.basename(localPath);
    const mt = mimeTypeOverride || (mime_types_1.default.lookup(localPath) || "application/octet-stream");
    const res = await drive.files.create({
        requestBody: { name, parents: [folderId], mimeType: String(mt) },
        media: { mimeType: String(mt), body: fs_1.default.createReadStream(localPath) },
        fields: "id, name, size, webViewLink, webContentLink, mimeType",
        supportsAllDrives: true,
    });
    const fileId = res.data.id;
    // Make the file publicly readable so thumbnails work without auth
    await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone", allowFileDiscovery: false, },
        supportsAllDrives: true,
    });
    // fetch metadata including thumbnailLink (needed for portal thumbs)
    const meta = await drive.files.get({
        fileId,
        supportsAllDrives: true,
        fields: "id,name,size,mimeType,webViewLink,webContentLink,thumbnailLink,iconLink",
    });
    // ADD: a stable, cacheable CDN thumbnail URL (size is adjustable, e.g. w600)
    const publicThumbUrl = `https://lh3.googleusercontent.com/d/${fileId}=w800`;
    return {
        fileId,
        name: meta.data.name,
        size: meta.data.size ? Number(meta.data.size) : undefined,
        mimeType: meta.data.mimeType,
        webViewLink: meta.data.webViewLink || null,
        webContentLink: meta.data.webContentLink || null,
        thumbnailLink: meta.data.thumbnailLink || null,
        // good universal viewer URL for <img>
        publicViewUrl: `https://drive.google.com/uc?id=${fileId}&export=view`,
        publicThumbUrl, // <—— NEW
    };
}
/** Stream a Drive file (download) directly to the HTTP response. */
async function streamDriveFile(fileId, res) {
    const drive = driveClient();
    // look up mime so browser renders the image inline
    const head = await drive.files.get({
        fileId,
        fields: "mimeType,name",
        supportsAllDrives: true,
    });
    if (head.data.mimeType)
        res.setHeader("Content-Type", head.data.mimeType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    const dl = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
    dl.data.on("error", (err) => {
        console.error("Drive stream error:", err);
        if (!res.headersSent)
            res.status(500).end("stream error");
    });
    dl.data.pipe(res);
}
//# sourceMappingURL=drive.js.map