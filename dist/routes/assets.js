"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/assets.ts
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const Asset_1 = __importDefault(require("../models/Asset"));
const auth_1 = require("../middleware/auth");
const mime_types_1 = __importDefault(require("mime-types"));
const drive_1 = require("../services/drive");
const router = (0, express_1.Router)();
// Ensure uploads dir exists
const uploadDir = path_1.default.join(process.cwd(), "uploads");
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
// Keep original extension, sanitize base name
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        const base = path_1.default
            .basename(file.originalname, ext)
            .replace(/\s+/g, "_")
            .replace(/[^a-zA-Z0-9_\-]/g, "");
        cb(null, `${Date.now()}_${base}${ext}`);
    },
});
// const PUBLIC_BASE = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || "";
// const absolutize = (p?: string) =>
//   !p
//     ? p
//     : /^https?:\/\//i.test(p)
//     ? p
//     : `${PUBLIC_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
// Optional global override for Render/production. Leave undefined locally.
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
/** Build an absolutizer with a base (PUBLIC_BASE, or request host/proto). */
function absolutizeWith(base) {
    return (p) => {
        if (!p)
            return p;
        if (/^https?:\/\//i.test(p))
            return p; // already absolute
        const prefix = base || "";
        return `${prefix}${p.startsWith("/") ? "" : "/"}${p}`;
    };
}
// Only allow images, limit to 10MB
const upload = (0, multer_1.default)({
    storage,
    fileFilter: (_req, file, cb) => {
        if (/^image\//.test(file.mimetype))
            return cb(null, true);
        cb(new Error("Only image files are allowed"));
    },
    limits: { fileSize: 10 * 1024 * 1024 },
});
// helper to normalize _id → id for FE
// replace your mapDoc
// const mapDoc = (d: any) => {
//   const {
//     _id, approval, thumb, url,
//     driveFileId, driveFolderId, driveWebViewLink, driveWebContentLink,
//     mimeType,
//     ...rest
//   } = d;
//   const driveCdnThumb = driveFileId
//     ? `https://lh3.googleusercontent.com/d/${driveFileId}=w800`
//     : undefined;
//   return {
//     id: String(_id),
//     ...rest,
//     thumb: thumb ? absolutize(thumb) : (driveCdnThumb || absolutize(url)),
//     url: absolutize(url || thumb),
//     approval: approval
//       ? {
//           status: approval.status ?? "yellow",
//           approvedByEmail: approval.approvedByEmail ?? undefined,
//           approvedAt: approval.approvedAt
//             ? new Date(approval.approvedAt).toISOString()
//             : undefined,
//         }
//       : { status: "yellow" },
//   };
// };
// Factory: builds a mapper bound to a request-aware base URL
const mapDoc = (base) => (d) => {
    const { _id, approval, thumb, url, driveFileId, driveFolderId, driveWebViewLink, driveWebContentLink, mimeType, ...rest } = d;
    // Prefer the Google Drive CDN thumbnail whenever a Drive file exists
    const driveCdnThumb = driveFileId
        ? `https://lh3.googleusercontent.com/d/${driveFileId}=w800`
        : undefined;
    const abs = absolutizeWith(base);
    // Choose thumb → prefer Drive CDN, then saved thumb, then url
    const thumbCandidate = driveCdnThumb || thumb || url;
    return {
        id: String(_id),
        ...rest,
        thumb: abs(thumbCandidate),
        url: abs(url || thumbCandidate),
        approval: approval
            ? {
                status: approval.status ?? "yellow",
                approvedByEmail: approval.approvedByEmail ?? undefined,
                approvedAt: approval.approvedAt
                    ? new Date(approval.approvedAt).toISOString()
                    : undefined,
            }
            : { status: "yellow" },
    };
};
/**
 * GET /api/assets
 * - SME sees only admin uploads (so they can review them)
 * - Others see everything (apply search like before)
 */
router.get("/", async (req, res) => {
    // Build a base URL for absolutizing relative paths
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const base = PUBLIC_BASE || `${proto}://${host}`;
    const q = String(req.query.q || "").trim();
    const search = q
        ? {
            $or: [
                { title: new RegExp(q, "i") },
                { tags: { $regex: q, $options: "i" } },
                { uploadedBy: new RegExp(q, "i") },
            ],
        }
        : {};
    const roleFilter = req.user?.role === "sme" ? { uploaderRole: "admin" } : {};
    const find = { ...search, ...roleFilter };
    const docs = await Asset_1.default.find(find).sort({ createdAt: -1 }).lean();
    // res.json({ items: docs.map(mapDoc) });
    res.json({ items: docs.map(mapDoc(base)) });
});
// GET /api/assets/:id/file  (requires login)
router.get("/:id/file", auth_1.requireUser, async (req, res) => {
    const doc = await Asset_1.default.findById(req.params.id).lean();
    if (!doc)
        return res.status(404).json({ error: "not found" });
    const item = doc;
    // add ?download=1 (or ?dl=1) to force a download
    const forceDownload = String(req.query.download || req.query.dl || "") === "1";
    // ---- No Drive file? redirect/serve local fallback ----
    if (!item.driveFileId) {
        const url = item.url || item.thumb;
        // If it's a remote URL and we are NOT forcing download, just redirect
        if (!forceDownload && typeof url === "string" && /^https?:\/\//i.test(url)) {
            return res.redirect(url);
        }
        // If it's a local uploads path, either sendFile() or download()
        const maybeRel = (item.url || item.thumb || "");
        if (maybeRel && maybeRel.startsWith("/uploads/")) {
            const filePath = path_1.default.join(process.cwd(), maybeRel.replace(/^\//, ""));
            if (fs_1.default.existsSync(filePath)) {
                if (forceDownload) {
                    const ext = path_1.default.extname(filePath);
                    const base = (item.title || `asset-${item._id}`).replace(/[^\w.-]+/g, "_") ||
                        "asset";
                    return res.download(filePath, `${base}${ext}`);
                }
                return res.sendFile(filePath);
            }
        }
        return res.status(404).json({ error: "file not available" });
    }
    // ---- Drive-backed file ----
    const mimeType = item.mimeType || undefined;
    if (mimeType)
        res.setHeader("Content-Type", mimeType);
    if (forceDownload) {
        const ext = (mimeType && mime_types_1.default.extension(mimeType)) || "";
        const base = (item.title || `asset-${item._id}`).replace(/[^\w.-]+/g, "_") || "asset";
        const filename = ext ? `${base}.${ext}` : base;
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    }
    else {
        res.setHeader("Content-Disposition", "inline");
    }
    // bump downloads asynchronously (don’t block the stream)
    Asset_1.default.updateOne({ _id: req.params.id }, { $inc: { downloads: 1 } }).catch(() => { });
    try {
        await (0, drive_1.streamDriveFile)(item.driveFileId, res); // stream ONCE
    }
    catch (e) {
        console.error("streamDriveFile error:", e);
        if (!res.headersSent)
            res.status(500).json({ error: "stream error" });
    }
});
/**
 * POST /api/assets
 * Admin only. Expects multipart/form-data with:
 * - file
 * - meta (JSON) — title, tags[], taxonomy, etc.
 * On admin upload, default review.status='allotted' so SMEs see the "Allotted" tag.
 */
router.post("/", (0, auth_1.requireRole)("admin"), upload.single("file"), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: "file required" });
    let meta = {};
    try {
        meta = req.body.meta ? JSON.parse(req.body.meta) : req.body;
    }
    catch {
        meta = req.body;
    }
    // 1) Validate taxonomy (all required)
    const required = ["grade", "subject", "chapter", "topic", "subtopic", "artStyle"];
    const missing = required.filter((k) => !meta[k]);
    if (missing.length) {
        return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
    }
    // 2) Build folder path in Drive (you can tweak chapter formatting)
    const folderSegments = [
        String(meta.grade),
        String(meta.subject),
        String(meta.chapter),
        String(meta.topic),
        String(meta.subtopic),
        String(meta.artStyle),
    ];
    if (process.env.LOG_LEVEL === "debug") {
        console.log("[Drive] Building path:", folderSegments.join(" / "));
    }
    // Build folder path in Drive
    let driveFolderId;
    try {
        driveFolderId = await (0, drive_1.ensureFolderPath)(folderSegments);
    }
    catch (e) {
        console.error("ensureFolderPath error:", e);
        return res.status(500).json({ error: "drive folder error" });
    }
    // Upload file to Drive
    let driveUpload;
    try {
        driveUpload = await (0, drive_1.uploadFileToDrive)(driveFolderId, req.file.path, req.file.originalname, // or your computed `${code}${ext}`
        req.file.mimetype);
    }
    catch (e) {
        console.error("uploadFileToDrive error:", e);
        return res.status(500).json({ error: "drive upload error" });
    }
    // after uploadFileToDrive(...)
    if (process.env.LOG_LEVEL === "debug") {
        console.log("[Drive] Uploaded", {
            fileId: driveUpload.fileId,
            folderId: driveFolderId,
            mimeType: driveUpload.mimeType,
            publicViewUrl: driveUpload.publicViewUrl,
        });
    }
    // const thumb = `${PUBLIC_BASE}/uploads/${req.file.filename}`;
    //const thumb = `/uploads/${req.file.filename}`;   // no PUBLIC_BASE here
    // AFTER — use Google Drive URL coming from uploadFileToDrive
    // driveUpload should contain publicViewUrl, webViewLink, webContentLink, mimeType, fileId, etc.
    // const thumbUrl = driveUpload.publicViewUrl ?? driveUpload.webViewLink ?? `/api/assets/${req.file.filename}`;
    //   const thumbUrl =
    // driveUpload.publicViewUrl || driveUpload.webViewLink || `/uploads/${req.file.filename}`;
    const thumbUrl = driveUpload.publicThumbUrl || // <—— prefer CDN thumb
        driveUpload.publicViewUrl ||
        driveUpload.webViewLink ||
        `/uploads/${req.file.filename}`;
    // (optional) cleanup local file—Render disks are ephemeral anyway
    try {
        fs_1.default.unlinkSync(req.file.path);
    }
    catch { /* ignore */ }
    // 4) Construct a title if not provided
    const baseTitle = meta.title?.trim() || meta.subtopic || "Untitled";
    // const thumb = drive.thumbnailLink || drive.publicViewUrl; 
    const doc = await Asset_1.default.create({
        ...meta,
        title: baseTitle,
        type: "photo",
        thumb: thumbUrl, // << use Drive public URL for thumbnails
        url: thumbUrl,
        uploadedBy: req.user?.email,
        uploaderRole: req.user?.role,
        downloads: 0,
        views: 0,
        // defaults
        approval: { status: "yellow" },
        review: req.user?.role === "admin" ? { status: "allotted" } : undefined,
        // Drive fields
        driveFileId: driveUpload.fileId,
        driveFolderId,
        driveWebViewLink: driveUpload.webViewLink,
        driveWebContentLink: driveUpload.webContentLink,
        mimeType: driveUpload.mimeType,
    });
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const base = PUBLIC_BASE || `${proto}://${host}`;
    res.status(201).json({ item: mapDoc(base)(doc.toObject()) });
});
/**
 * POST /api/assets/:id/assign
 * Admin assigns to a specific SME (status -> allotted)
 * body: { assignedTo, assignedToName }
 */
router.post("/:id/assign", (0, auth_1.requireRole)("admin"), async (req, res) => {
    const { assignedTo, assignedToName } = req.body || {};
    const doc = await Asset_1.default.findByIdAndUpdate(req.params.id, {
        $set: {
            "review.status": "allotted",
            "review.assignedTo": assignedTo,
            "review.assignedToName": assignedToName,
        },
    }, { new: true }).lean();
    if (!doc)
        return res.status(404).json({ error: "not found" });
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const base = PUBLIC_BASE || `${proto}://${host}`;
    res.json({ item: mapDoc(base)(doc) });
});
/**
 * POST /api/assets/:id/comment
 * SME adds / updates comment (status -> commented)
 * body: { comment }
 */
router.post("/:id/comment", (0, auth_1.requireRole)("sme"), async (req, res) => {
    const { comment } = req.body || {};
    const doc = await Asset_1.default.findByIdAndUpdate(req.params.id, {
        $set: {
            "review.status": "commented",
            "review.comment": comment,
            "review.reviewedBy": req.user?.email,
            "review.reviewedByName": req.user?.name,
            "review.reviewedAt": new Date(),
        },
    }, { new: true }).lean();
    if (!doc)
        return res.status(404).json({ error: "not found" });
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const base = PUBLIC_BASE || `${proto}://${host}`;
    res.json({ item: mapDoc(base)(doc) });
});
/**
 * POST /api/assets/:id/pass
 * SME marks as passed (status -> passed)
 */
router.post("/:id/pass", (0, auth_1.requireRole)("sme"), async (req, res) => {
    const doc = await Asset_1.default.findByIdAndUpdate(req.params.id, {
        $set: {
            "review.status": "passed",
            "review.reviewedBy": req.user?.email,
            "review.reviewedByName": req.user?.name,
            "review.reviewedAt": new Date(),
        },
    }, { new: true }).lean();
    if (!doc)
        return res.status(404).json({ error: "not found" });
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const base = PUBLIC_BASE || `${proto}://${host}`;
    res.json({ item: mapDoc(base)(doc) });
});
/**
 * PATCH /api/assets/:id/approval
 * SME-only. Body: { status: "yellow" | "green" }
 * - If "green": set approver + timestamp
 * - If "yellow": clear approver fields
 */
router.patch("/:id/approval", (0, auth_1.requireRole)("sme"), async (req, res) => {
    const { status } = req.body || {};
    if (status !== "yellow" && status !== "green") {
        return res.status(400).json({ error: "invalid status" });
    }
    const setFields = status === "green"
        ? {
            "approval.status": "green",
            "approval.approvedByEmail": req.user?.email || null,
            "approval.approvedAt": new Date(),
        }
        : {
            "approval.status": "yellow",
            "approval.approvedByEmail": null,
            "approval.approvedAt": null,
        };
    const doc = await Asset_1.default.findByIdAndUpdate(req.params.id, { $set: setFields }, { new: true }).lean();
    if (!doc)
        return res.status(404).json({ error: "not found" });
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const base = PUBLIC_BASE || `${proto}://${host}`;
    res.json({ item: mapDoc(base)(doc) });
});
/**
 * DELETE /api/assets/:id
 */
router.delete("/:id", (0, auth_1.requireRole)("admin"), async (req, res) => {
    const r = await Asset_1.default.deleteOne({ _id: req.params.id });
    res.json({ ok: true, deleted: r.deletedCount });
});
/**
 * POST /api/assets/:id/download
 */
router.post("/:id/download", auth_1.requireUser, async (req, res) => {
    await Asset_1.default.updateOne({ _id: req.params.id }, { $inc: { downloads: 1 } });
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=assets.js.map