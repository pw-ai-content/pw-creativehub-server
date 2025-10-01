// src/routes/taxonomy.ts
import { Router } from "express";
import { requireUser, requireRole } from "../middleware/auth";
import {
  getGrades, getSubjects, getChapters, getTopics, getSubtopics, getArtStyles,
  generateTitle, resolveSelection, refreshTaxonomy
} from "../services/taxonomy";

const router = Router();

// Return bare arrays (matches frontend tApi)
router.get("/grades",    async (_req, res) => {
  try { res.json(await getGrades()); }
  catch (e: any) { res.status(500).json({ error: String(e.message || e) }); }
});

router.get("/subjects",  async (req, res) => {
  try { res.json(await getSubjects(String(req.query.gradeId || ""))); }
  catch (e: any) { res.status(500).json({ error: String(e.message || e) }); }
});

router.get("/chapters",  async (req, res) => {
  try { res.json(await getChapters(String(req.query.subjectId || ""))); }
  catch (e: any) { res.status(500).json({ error: String(e.message || e) }); }
});

router.get("/topics",    async (req, res) => {
  try { res.json(await getTopics(String(req.query.chapterId || ""))); }
  catch (e: any) { res.status(500).json({ error: String(e.message || e) }); }
});

router.get("/subtopics", async (req, res) => {
  try { res.json(await getSubtopics(String(req.query.topicId || ""))); }
  catch (e: any) { res.status(500).json({ error: String(e.message || e) }); }
});

router.get("/artstyles", async (_req, res) => {
  try { res.json(await getArtStyles()); }
  catch (e: any) { res.status(500).json({ error: String(e.message || e) }); }
});

// preview default title
router.post("/generate-title", requireUser, async (req, res) => {
  try {
    const { gradeId, subjectId, chapterId, topicId, subtopicId, artStyleId } = req.body || {};
    const sel = await resolveSelection({ gradeId, subjectId, chapterId, topicId, subtopicId, artStyleId });
    const title = generateTitle(sel);
    res.json({ title });
  } catch (e: any) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// manual refresh after sheet edits
router.post("/refresh", requireRole("admin"), async (_req, res) => {
  await refreshTaxonomy();
  res.json({ ok: true });
});

export default router;
