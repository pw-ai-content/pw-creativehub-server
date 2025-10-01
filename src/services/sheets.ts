// src/services/sheets.ts
import { google } from "googleapis";
import fs from "fs";

const SHEET_ID = process.env.GOOGLE_SHEETS_TAXONOMY_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_DRIVE_SA_EMAIL;

let SA_PRIVATE_KEY = (process.env.GOOGLE_DRIVE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
if (!SA_PRIVATE_KEY && fs.existsSync("/etc/secrets/GOOGLE_DRIVE_PRIVATE_KEY")) {
  SA_PRIVATE_KEY = fs.readFileSync("/etc/secrets/GOOGLE_DRIVE_PRIVATE_KEY", "utf8");
}

if (!SHEET_ID) throw new Error("Missing GOOGLE_SHEETS_TAXONOMY_SHEET_ID");
if (!SA_EMAIL) throw new Error("Missing GOOGLE_DRIVE_SA_EMAIL");
if (!SA_PRIVATE_KEY) throw new Error("Missing GOOGLE_DRIVE_PRIVATE_KEY (or /etc/secrets/...)");

// singleton client
let _sheets: ReturnType<typeof google.sheets> | null = null;
function sheetsClient() {
  if (_sheets) return _sheets;
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

// simple in-memory cache (per tab) with TTL
const CACHE_TTL_MS = Number(process.env.SHEETS_CACHE_TTL_MS || 60_000); // 1 min default
const cache = new Map<string, { expires: number; data: Record<string, string>[] }>();
export function clearSheetsCache() {
  cache.clear();
}

function uniquifyHeaders(h: string[]): string[] {
  const seen = new Map<string, number>();
  return h.map((kRaw) => {
    const k = String(kRaw || "").trim() || "COL";
    const count = seen.get(k) || 0;
    seen.set(k, count + 1);
    return count === 0 ? k : `${k}_${count + 1}`;
  });
}

async function valuesGetWithRetry(range: string, attempts = 4): Promise<string[][]> {
  const sheets = sheetsClient();
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID!,
        range,
        valueRenderOption: "UNFORMATTED_VALUE",
        majorDimension: "ROWS",
      });
      return (data.values || []).map((row) => row.map((c: any) => String(c ?? "")));
    } catch (e: any) {
      lastErr = e;
      // backoff with jitter (200ms, 400ms, 800ms, 1600ms ...)
      const delay = Math.min(200 * 2 ** i, 2000) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`Sheets read failed for range "${range}": ${lastErr?.message || lastErr}`);
}

export async function readSheet(tab: string): Promise<Record<string, string>[]> {
  const now = Date.now();
  const key = tab;

  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.data;

  const rows = await valuesGetWithRetry(`${tab}!A:Z`);
  if (rows.length === 0) {
    const empty: Record<string, string>[] = [];
    cache.set(key, { expires: now + CACHE_TTL_MS, data: empty });
    return empty;
  }

  const header = uniquifyHeaders(rows[0]);
  const data = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = String(r[i] ?? "").trim()));
    return rec;
  });

  cache.set(key, { expires: now + CACHE_TTL_MS, data });
  return data;
}
