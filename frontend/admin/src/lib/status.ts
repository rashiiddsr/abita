import type { CSSProperties } from "react";
import type { DayStatus, EmploymentType, ReqStatus } from "./types";

/** Gaya badge berwarna lewat variabel CSS (tema gelap menyesuaikan otomatis di globals.css). */
export function toneStyle(bg: string, fg: string): CSSProperties {
  // Warna teks yang sangat gelap (netral/tinta) tidak bisa "dicerahkan" di tema gelap → pakai abu terang.
  return { "--tone-bg": bg, "--tone-fg": fg, "--tone-dk": luminance(fg) < 0.06 ? "#b7c0cb" : fg } as CSSProperties;
}

function luminance(hex: string) {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export type Tone = { label: string; bg: string; fg: string };

// [label, latar, teks] persis seperti desain
export const DAY: Record<DayStatus, Tone> = {
  hadir: { label: "Hadir", bg: "#E3F5EA", fg: "#14995A" },
  telat: { label: "Terlambat", bg: "#FFF3D9", fg: "#8A5600" },
  belum: { label: "Belum hadir", bg: "#F4F6F8", fg: "#5B6678" },
  selesai: { label: "Selesai", bg: "#E7EBEF", fg: "#0D1726" },
  tanpa_pulang: { label: "Tanpa absen pulang", bg: "#FDEEE3", fg: "#B4531A" },
  izin: { label: "Izin", bg: "#ECEEFC", fg: "#4F5BD5" },
  sakit: { label: "Sakit", bg: "#FDECEC", fg: "#C82829" },
  gagal: { label: "Verifikasi gagal", bg: "#FDECEC", fg: "#C82829" },
  alpa: { label: "Alpa", bg: "#FDECEC", fg: "#C82829" },
  libur: { label: "Libur", bg: "#F4F6F8", fg: "#97A1B0" },
};

export const REQ: Record<ReqStatus, Tone> = {
  pending: { label: "Menunggu", bg: "#FFF3D9", fg: "#8A5600" },
  approved: { label: "Disetujui", bg: "#E3F5EA", fg: "#14995A" },
  rejected: { label: "Ditolak", bg: "#FDECEC", fg: "#C82829" },
  cancelled: { label: "Dibatalkan", bg: "#F4F6F8", fg: "#5B6678" },
};

export const EMP_STATUS: Record<string, Tone> = {
  aktif: { label: "Aktif", bg: "#E3F5EA", fg: "#14995A" },
  nonaktif: { label: "Nonaktif", bg: "#F4F6F8", fg: "#5B6678" },
};

export function tipe(t: EmploymentType | string | null | undefined): Tone {
  if (t === "magang") return { label: "Magang/PKL", bg: "#ECEEFC", fg: "#4F5BD5" };
  if (t === "outsourcing") return { label: "Outsourcing", bg: "#FFF3D9", fg: "#8A5600" };
  if (t === "tetap") return { label: "Tetap", bg: "#E5F3F4", fg: "#005A64" };
  return { label: "—", bg: "#F4F6F8", fg: "#5B6678" };
}

export const KIND: Record<string, Tone> = {
  izin: { label: "Izin", bg: "#ECEEFC", fg: "#4F5BD5" },
  sakit: { label: "Sakit", bg: "#FDECEC", fg: "#C82829" },
};

/** Warna shift dari warna jenis shift (bebas tambah/ubah); tanpa warna -> netral. */
export function shiftTone(name: string | undefined | null, color?: string | null): Tone & { code: string } {
  const label = name ?? "";
  const code = label.trim()[0]?.toUpperCase() ?? "?";
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return { label, code, bg: color + "1F", fg: color };
  return { label, code, bg: "#F4F6F8", fg: "#5B6678" };
}

export const SHIFT_COLORS = ["#0F766E", "#B45309", "#4338CA", "#BE185D", "#0369A1", "#4D7C0F", "#7C3AED", "#475569"];

export const ROLE_LABEL: Record<string, string> = { admin: "Admin SDM", unit_head: "Kepala Unit", staff: "Staff" };

export const ROLE_TONE: Record<string, Tone> = {
  admin: { label: "Admin SDM", bg: "#ECEEFC", fg: "#4F5BD5" },
  unit_head: { label: "Kepala Unit", bg: "#E5F3F4", fg: "#005A64" },
};

/** Status tukar shift dengan tahap: menunggu rekan / menunggu Kepala Unit. */
export function swapTone(w: { status: ReqStatus; stage: "peer" | "review" | "done" }): Tone {
  if (w.stage === "peer") return { label: "Menunggu rekan", bg: "#F4F6F8", fg: "#5B6678" };
  return REQ[w.status];
}
