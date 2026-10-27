/** Baris file & folder untuk menu Dokumen (hanya baca: file diunggah Admin SDM). */
import { File, FileImage, FileSpreadsheet, FileText, Folder, Presentation } from "lucide-react";
import { fileUrl } from "../lib/api";
import { fmtDateMed } from "../lib/format";
import type { FileOut, FolderOut } from "../lib/types";
import { ListRow } from "./ui";

type Tone = "ok" | "warn" | "bad" | "brand" | "muted" | "purple";
const KIND: Record<string, [typeof File, Tone]> = {
  ".pdf": [FileText, "bad"],
  ".jpg": [FileImage, "purple"],
  ".jpeg": [FileImage, "purple"],
  ".png": [FileImage, "purple"],
  ".webp": [FileImage, "purple"],
  ".docx": [FileText, "brand"],
  ".xlsx": [FileSpreadsheet, "ok"],
  ".pptx": [Presentation, "warn"],
};

/** Tanggal WIB dari waktu ISO (UTC). */
const wibDay = (ts: string) => new Date(Date.parse(ts) + 7 * 3600_000).toISOString().slice(0, 10);

export function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** PDF & gambar dibuka di tab baru; format Office langsung diunduh. */
export const openFile = (f: FileOut) => window.open(fileUrl(`/files/${f.id}${f.inline ? "" : "?download=1"}`), "_blank", "noopener");

export function FileRow({ f }: { f: FileOut }) {
  const [Icon, tone] = KIND[f.ext] ?? [File, "muted"];
  return <ListRow icon={<Icon size={19} />} iconTone={tone} title={f.name + f.ext} subtitle={`${fmtSize(f.size)} · ${fmtDateMed(wibDay(f.created_at))}`} onClick={() => openFile(f)} />;
}

export function FolderRow({ f, onClick }: { f: FolderOut; onClick: () => void }) {
  return <ListRow icon={<Folder size={19} />} iconTone="brand" title={f.name} subtitle={`${f.file_count} file`} onClick={onClick} />;
}
