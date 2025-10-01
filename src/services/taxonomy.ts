import { readSheet } from "./sheets";

type Grade    = { id: string; name: string; code?: string; sort_order: number; is_active: boolean };
type Subject  = { id: string; grade_id: string; name: string; code?: string; sort_order: number; is_active: boolean };
type Chapter  = { id: string; subject_id: string; number?: string; name: string; sort_order: number; is_active: boolean };
type Topic    = { id: string; chapter_id: string; name: string; sort_order: number; is_active: boolean };
type Subtopic = { id: string; topic_id: string; name: string; sort_order: number; is_active: boolean };
type ArtStyle = { id: string; name: string; is_active: boolean; sort_order: number };

export type SelectionIds = {
  gradeId: string;
  subjectId: string;
  chapterId: string;
  topicId: string;
  subtopicId: string;
  artStyleId: string;
};

let cache:
  | {
      grades: Grade[];
      subjects: Subject[];
      chapters: Chapter[];
      topics: Topic[];
      subtopics: Subtopic[];
      artstyles: ArtStyle[];
      loadedAt: number;
    }
  | null = null;

const TTL_MS = Number(process.env.TAXONOMY_CACHE_TTL_MS || 60_000);

/* -------- helpers -------- */

function toBool(v: unknown) {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}
const sstr = (v: unknown) => String(v ?? "").trim();

/** Title Case that preserves acronyms and tokens already ALL CAPS. */
function smartTitleCase(s: string) {
  if (!s) return "";
  const ACRONYMS = new Set([
    "AI","ML","NLP","CV","RL","GAN","LLM","RAG","SQL","API","HTTP","GPU","CPU",
    "UPSC","SSC","CBSE","NCERT","IIT","JEE","NEET","DNA","RNA","3D","2D"
  ]);
  return s
    .split(/\s+/)
    .map((word, idx) => {
      const clean = word.replace(/[^A-Za-z0-9]/g, "");
      if (ACRONYMS.has(clean.toUpperCase())) return clean.toUpperCase() + word.slice(clean.length);
      if (/^[A-Z0-9]+$/.test(clean)) return word; // already all-caps or numeric
      const w = word.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/* -------- loader -------- */

export async function loadTaxonomy(force = false) {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) return cache;

  const [gradesR, subjectsR, chaptersR, topicsR, subtopicsR, artstylesR] = await Promise.all([
    readSheet("Grades"),
    readSheet("Subjects"),
    readSheet("Chapters"),
    readSheet("Topics"),
    readSheet("Subtopics"),
    readSheet("ArtStyles"),
  ]);

  // IMPORTANT: keep original casing from the sheet. Only trim.
  const grades: Grade[] = gradesR
    .filter((r: any) => toBool(r.is_active ?? "true"))
    .map((r: any) => ({
      id: sstr(r.id),
      name: sstr(r.name),
      code: r.code ? sstr(r.code) : undefined,
      sort_order: Number(r.sort_order || 0),
      is_active: true,
    }));

  const subjects: Subject[] = subjectsR
    .filter((r: any) => toBool(r.is_active ?? "true"))
    .map((r: any) => ({
      id: sstr(r.id),
      grade_id: sstr(r.grade_id),
      name: sstr(r.name),
      code: r.code ? sstr(r.code) : undefined,
      sort_order: Number(r.sort_order || 0),
      is_active: true,
    }));

  const chapters: Chapter[] = chaptersR
    .filter((r: any) => toBool(r.is_active ?? "true"))
    .map((r: any) => ({
      id: sstr(r.id),
      subject_id: sstr(r.subject_id),
      name: sstr(r.name),
      number: r.number != null && r.number !== "" ? sstr(r.number) : undefined,
      sort_order: Number(r.sort_order || 0),
      is_active: true,
    }));

  const topics: Topic[] = topicsR
    .filter((r: any) => toBool(r.is_active ?? "true"))
    .map((r: any) => ({
      id: sstr(r.id),
      chapter_id: sstr(r.chapter_id),
      name: sstr(r.name),
      sort_order: Number(r.sort_order || 0),
      is_active: true,
    }));

  const subtopics: Subtopic[] = subtopicsR
    .filter((r: any) => toBool(r.is_active ?? "true"))
    .map((r: any) => ({
      id: sstr(r.id),
      topic_id: sstr(r.topic_id),
      name: sstr(r.name),
      sort_order: Number(r.sort_order || 0),
      is_active: true,
    }));

  const artstyles: ArtStyle[] = artstylesR
    .filter((r: any) => toBool(r.is_active ?? "true"))
    .map((r: any) => ({
      id: sstr(r.id),
      name: sstr(r.name),
      sort_order: Number(r.sort_order || 0),
      is_active: true,
    }));

  const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;
  grades.sort(bySort); subjects.sort(bySort); chapters.sort(bySort);
  topics.sort(bySort); subtopics.sort(bySort); artstyles.sort(bySort);

  cache = { grades, subjects, chapters, topics, subtopics, artstyles, loadedAt: Date.now() };
  return cache;
}

/* -------- public API helpers -------- */

export async function getGrades() {
  return (await loadTaxonomy()).grades;
}
export async function getSubjects(gradeId: string) {
  return (await loadTaxonomy()).subjects.filter((s) => s.grade_id === String(gradeId));
}
export async function getChapters(subjectId: string) {
  return (await loadTaxonomy()).chapters.filter((c) => c.subject_id === String(subjectId));
}
export async function getTopics(chapterId: string) {
  return (await loadTaxonomy()).topics.filter((t) => t.chapter_id === String(chapterId));
}
export async function getSubtopics(topicId: string) {
  return (await loadTaxonomy()).subtopics.filter((s) => s.topic_id === String(topicId));
}
export async function getArtStyles() {
  return (await loadTaxonomy()).artstyles;
}

export async function resolveSelection(ids: SelectionIds) {
  const t = await loadTaxonomy();
  const grade = t.grades.find((g) => g.id === ids.gradeId);
  const subject = t.subjects.find((s) => s.id === ids.subjectId && s.grade_id === ids.gradeId);
  const chapter = t.chapters.find((c) => c.id === ids.chapterId && c.subject_id === ids.subjectId);
  const topic = t.topics.find((o) => o.id === ids.topicId && o.chapter_id === ids.chapterId);
  const subtopic = t.subtopics.find((p) => p.id === ids.subtopicId && p.topic_id === ids.topicId);
  const artstyle = t.artstyles.find((a) => a.id === ids.artStyleId);

  if (!grade || !subject || !chapter || !topic || !subtopic || !artstyle) {
    throw new Error("Invalid taxonomy selection");
  }
  return { grade, subject, chapter, topic, subtopic, artstyle };
}

/** Compose Title with Title Case (acronym-safe) */
export function generateTitle(parts: {
  subtopic: Subtopic;
  grade: Grade;
  subject: Subject;
  chapter: Chapter;
  artstyle: ArtStyle;
}) {
  const subjForTitle = parts.subject.code ? parts.subject.code : parts.subject.name;
  const chNo = parts.chapter.number || ""; // or format: `Chapter ${parts.chapter.number}`
  // SubtopicName_Grade_Subject_ChapterNo_ArtStyle_V1
  const raw = [parts.subtopic.name, parts.grade.name, subjForTitle, chNo, parts.artstyle.name, "V1"]
    .filter(Boolean)
    .join("_")
    .replace(/__+/g, "_");
  // Apply Title Case with acronym preservation only to the words (underscores kept)
  return raw
    .split("_")
    .map(smartTitleCase)
    .join("_");
}

/** Folder segments (keep original casing from taxonomy) */
export function folderSegmentsFrom(parts: {
  grade: Grade;
  subject: Subject;
  chapter: Chapter;
  topic: Topic;
  subtopic: Subtopic;
  artstyle: ArtStyle;
}) {
  return [
    parts.grade.name,
    parts.subject.name,
    parts.chapter.number || parts.chapter.name,
    parts.topic.name,
    parts.subtopic.name,
    parts.artstyle.name,
  ];
}

/** For places where you still want a strict Title Case */
export function titleCaseStrict(s: string) {
  return smartTitleCase(s);
}

export async function refreshTaxonomy() {
  cache = null;
  await loadTaxonomy(true);
}
