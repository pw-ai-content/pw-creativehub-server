// src/services/drive.ts
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import mime from "mime-types";
import type { Response } from "express";


const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID!;
const SA_EMAIL = process.env.GOOGLE_DRIVE_SA_EMAIL!;

// If you stored the private key as a single env var string (recommended), keep this:
let SA_PRIVATE_KEY = (process.env.GOOGLE_DRIVE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

// (Optional fallback) If you used a Render Secret File named GOOGLE_DRIVE_PRIVATE_KEY instead:
if (!SA_PRIVATE_KEY && fs.existsSync("/etc/secrets/GOOGLE_DRIVE_PRIVATE_KEY")) {
  SA_PRIVATE_KEY = fs.readFileSync("/etc/secrets/GOOGLE_DRIVE_PRIVATE_KEY", "utf8");
}

if (!DRIVE_ROOT_FOLDER_ID || !SA_EMAIL || !SA_PRIVATE_KEY) {
  console.warn("[Drive] Missing env vars: DRIVE_ROOT_FOLDER_ID / GOOGLE_DRIVE_SA_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY");
}

function driveClient() {
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

/** Ensure nested folder path exists; returns the deepest folder ID. */
export async function ensureFolderPath(segments: string[]) {
  const drive = driveClient();
  let parentId = DRIVE_ROOT_FOLDER_ID;

  for (const raw of segments) {
    const name = String(raw || "").trim();
    if (!name) continue;

    const q = [
      `'${parentId}' in parents`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `name = '${name.replace(/'/g, "\\'")}'`,
      "trashed = false",
    ].join(" and ");

    const { data } = await drive.files.list({ q, fields: "files(id, name)", pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true,});
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
      folderId = created.data.id!;
    }
    parentId = folderId!;
  }
  return parentId;
}

/**
 * Upload local file to Drive under folderId.
 * Accepts optional fileName and optional mimeTypeOverride to match your route.
 */
export async function uploadFileToDrive(
  folderId: string,
  localPath: string,
  fileName?: string,
  mimeTypeOverride?: string
) {
  const drive = driveClient();
  const name = fileName || path.basename(localPath);
  const mt = mimeTypeOverride || (mime.lookup(localPath) || "application/octet-stream");

  const res = await drive.files.create({
    requestBody: { name, parents: [folderId], mimeType: String(mt) },
    media: { mimeType: String(mt), body: fs.createReadStream(localPath) },
    fields: "id, name, size, webViewLink, webContentLink, mimeType",
    supportsAllDrives: true,
  });

  const fileId = res.data.id!;
  // Make the file publicly readable so thumbnails work without auth
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone", allowFileDiscovery: false,},
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
  name: meta.data.name!,
  size: meta.data.size ? Number(meta.data.size) : undefined,
  mimeType: meta.data.mimeType!,
  webViewLink: meta.data.webViewLink || null,
  webContentLink: meta.data.webContentLink || null,
  thumbnailLink: meta.data.thumbnailLink || null,
  // good universal viewer URL for <img>
  publicViewUrl: `https://drive.google.com/uc?id=${fileId}&export=view`,
    publicThumbUrl, // <—— NEW
};

}


/** Stream a Drive file (download) directly to the HTTP response. */
export async function streamDriveFile(fileId: string, res: Response) {
  const drive = driveClient();
  // look up mime so browser renders the image inline
  const head = await drive.files.get({
    fileId,
    fields: "mimeType,name",
    supportsAllDrives: true,
  });
  if (head.data.mimeType) res.setHeader("Content-Type", head.data.mimeType);
  res.setHeader("Cache-Control", "public, max-age=3600");

  const dl = await drive.files.get(
    { fileId, alt: "media" as any },
    { responseType: "stream" }
  );

  dl.data.on("error", (err) => {
    console.error("Drive stream error:", err);
    if (!res.headersSent) res.status(500).end("stream error");
  });

  dl.data.pipe(res);
}

// hard-delete a file from Google Drive
export async function deleteDriveFile(fileId: string) {
  const drive = driveClient();

  try {
    await drive.files.delete({
      fileId,
      supportsAllDrives: true, // important for shared drives
    });
    return { ok: true, fileId };
  } catch (err: any) {
    // If the file is already gone, treat as success to keep the API idempotent
    if (err?.code === 404) {
      return { ok: true, fileId, alreadyDeleted: true };
    }
    // Re-throw all other errors so the caller can decide
    throw err;
  }
}

