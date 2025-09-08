// src/routes/assets.ts
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import Asset from "../models/Asset";
import { requireUser, requireRole } from "../middleware/auth";

const router = Router();

// Ensure uploads dir exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Keep original extension, sanitize base name
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_\-]/g, "");
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || "";

const absolutize = (p?: string) =>
  !p
    ? p
    : /^https?:\/\//i.test(p)
    ? p
    : `${PUBLIC_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
// Only allow images, limit to 10MB
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error("Only image files are allowed"));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// helper to normalize _id → id for FE
const mapDoc = (d: any) => {
  const { _id, approval, thumb, url,   ...rest } = d;
  return { id: String(_id), ...rest, 
    thumb: absolutize(thumb),
    url: absolutize(url || thumb),
    approval: approval
      ? {
          status: approval.status ?? "yellow",
          approvedByEmail: approval.approvedByEmail ?? undefined,
          approvedAt: approval.approvedAt
            ? new Date(approval.approvedAt).toISOString()
            : undefined,
        }
      : { status: "yellow" },
  }; };


/**
 * GET /api/assets
 * - SME sees only admin uploads (so they can review them)
 * - Others see everything (apply search like before)
 */
router.get("/", requireUser, async (req: any, res) => {
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

  const roleFilter =
    req.user?.role === "sme" ? { uploaderRole: "admin" } : {};

  const find: any = { ...search, ...roleFilter };

  const docs = await Asset.find(find).sort({ createdAt: -1 }).lean();
  res.json({ items: docs.map(mapDoc) });
});




/**
 * POST /api/assets
 * Admin only. Expects multipart/form-data with:
 * - file
 * - meta (JSON) — title, tags[], taxonomy, etc.
 * On admin upload, default review.status='allotted' so SMEs see the "Allotted" tag.
 */
router.post(
  "/",
  requireRole("admin"),
  upload.single("file"),
  async (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: "file required" });

    let meta: any = {};
    try {
      meta = req.body.meta ? JSON.parse(req.body.meta) : req.body;
    } catch {
      meta = req.body;
    }

    const thumb = `${PUBLIC_BASE}/uploads/${req.file.filename}`;

    const doc = await Asset.create({
      ...meta,
      thumb,
      url: thumb,
      type: meta.type || "photo",
      uploadedBy: req.user?.email,
      uploaderRole: req.user?.role, // <— important
      downloads: 0,
      views: 0,
      // default Allotted for admin uploads so it shows in SME as "Allotted"
      approval: { status: "yellow" },
      review:
        req.user?.role === "admin"
          ? { status: "allotted" }
          : undefined,
    });

    res.status(201).json({ item: mapDoc(doc.toObject()) });
  }

);



/**
 * POST /api/assets/:id/assign
 * Admin assigns to a specific SME (status -> allotted)
 * body: { assignedTo, assignedToName }
 */
router.post("/:id/assign", requireRole("admin"), async (req, res) => {
  const { assignedTo, assignedToName } = req.body || {};
  const doc = await Asset.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        "review.status": "allotted",
        "review.assignedTo": assignedTo,
        "review.assignedToName": assignedToName,
      },
    },
    { new: true }
  ).lean();
  if (!doc) return res.status(404).json({ error: "not found" });
  res.json({ item: mapDoc(doc) });
});

/**
 * POST /api/assets/:id/comment
 * SME adds / updates comment (status -> commented)
 * body: { comment }
 */
router.post("/:id/comment", requireRole("sme"), async (req: any, res) => {
  const { comment } = req.body || {};
  const doc = await Asset.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        "review.status": "commented",
        "review.comment": comment,
        "review.reviewedBy": req.user?.email,
        "review.reviewedByName": req.user?.name,
        "review.reviewedAt": new Date(),
      },
    },
    { new: true }
  ).lean();
  if (!doc) return res.status(404).json({ error: "not found" });
  res.json({ item: mapDoc(doc) });
});

/**
 * POST /api/assets/:id/pass
 * SME marks as passed (status -> passed)
 */
router.post("/:id/pass", requireRole("sme"), async (req: any, res) => {
  const doc = await Asset.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        "review.status": "passed",
        "review.reviewedBy": req.user?.email,
        "review.reviewedByName": req.user?.name,
        "review.reviewedAt": new Date(),
      },
    },
    { new: true }
  ).lean();
  if (!doc) return res.status(404).json({ error: "not found" });
  res.json({ item: mapDoc(doc) });
});


/**
 * PATCH /api/assets/:id/approval
 * SME-only. Body: { status: "yellow" | "green" }
 * - If "green": set approver + timestamp
 * - If "yellow": clear approver fields
 */
router.patch("/:id/approval", requireRole("sme"), async (req: any, res) => {
  const { status } = req.body || {};
  if (status !== "yellow" && status !== "green") {
    return res.status(400).json({ error: "invalid status" });
  }

  const setFields =
    status === "green"
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

  const doc = await Asset.findByIdAndUpdate(
    req.params.id,
    { $set: setFields },
    { new: true }
  ).lean();

  if (!doc) return res.status(404).json({ error: "not found" });
  res.json({ item: mapDoc(doc) });
});


/**
 * DELETE /api/assets/:id
 */
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const r = await Asset.deleteOne({ _id: req.params.id });
  res.json({ ok: true, deleted: r.deletedCount });
});

/**
 * POST /api/assets/:id/download
 */
router.post("/:id/download", requireUser, async (req, res) => {
  await Asset.updateOne({ _id: req.params.id }, { $inc: { downloads: 1 } });
  res.json({ ok: true });
});

export default router;
