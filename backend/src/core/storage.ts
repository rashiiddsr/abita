/** Penyimpanan file lokal (STORAGE_DIR): foto absen, lampiran SKD, foto profil, hasil ekspor. */
import fs from "node:fs/promises";
import path from "node:path";
import { settings } from "./config";
import { HttpError } from "./http";

export const MIME_EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" };
const MAGIC: Record<string, Buffer[]> = {
  "image/jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
  "image/png": [Buffer.from("\x89PNG", "latin1")],
  "image/webp": [Buffer.from("RIFF")],
  "application/pdf": [Buffer.from("%PDF")],
};

/** Isi file harus cocok dengan jenisnya (cegah file berbahaya berganti nama). */
export const magicOk = (mime: string, data: Buffer) => (MAGIC[mime] ?? []).some((m) => data.subarray(0, m.length).equals(m));

const OOXML = [Buffer.from("PK\x03\x04", "latin1")];
/** Dokumen (menu Dokumen): ekstensi -> jenis & tanda awal isi file. Jenis dari browser tidak dipercaya. */
export const DOC_TYPES: Record<string, { mime: string; magic: Buffer[]; inline: boolean }> = {
  ".pdf": { mime: "application/pdf", magic: MAGIC["application/pdf"], inline: true },
  ".jpg": { mime: "image/jpeg", magic: MAGIC["image/jpeg"], inline: true },
  ".jpeg": { mime: "image/jpeg", magic: MAGIC["image/jpeg"], inline: true },
  ".png": { mime: "image/png", magic: MAGIC["image/png"], inline: true },
  ".webp": { mime: "image/webp", magic: MAGIC["image/webp"], inline: true },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: OOXML, inline: false },
  ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: OOXML, inline: false },
  ".pptx": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", magic: OOXML, inline: false },
};

/** Path absolut di dalam STORAGE_DIR (tolak path yang keluar folder). */
export function resolveStored(rel: string): string {
  const root = path.resolve(settings.STORAGE_DIR);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new HttpError(404, "File tidak ditemukan.");
  return full;
}

export async function saveFile(rel: string, data: Buffer | Uint8Array): Promise<string> {
  const full = resolveStored(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return rel.split(path.sep).join("/");
}

export async function readStored(rel: string | null | undefined): Promise<Buffer | null> {
  if (!rel) return null;
  try {
    return await fs.readFile(resolveStored(rel));
  } catch {
    return null;
  }
}

export async function removeStored(rel: string | null | undefined) {
  if (!rel) return;
  await fs.rm(resolveStored(rel), { force: true }).catch(() => undefined);
}

export function mimeOf(rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  return Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? (ext === ".xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/octet-stream");
}
