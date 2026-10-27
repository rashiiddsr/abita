/**
 * Boleh check in / check out sekarang? Mengikuti jendela dari server (Pengaturan › Jam shift: default check in 2 jam
 * sebelum s.d. 1 jam sesudah jam mulai, check out 1 jam sebelum s.d. 2 jam sesudah jam selesai). Server tetap memeriksa
 * ulang; ini untuk tombol & pesan di aplikasi.
 */
import { fmtTime, todayWib } from "./format";
import type { TodayStatus } from "./types";

export type Gate = { purpose: "in" | "out" | null; can: boolean; hint: string | null };

const wibDate = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);
/** "pukul 06:00" / "besok pukul 06:00" */
const at = (iso: string) => `${wibDate(iso) === todayWib() ? "" : wibDate(iso) > todayWib() ? "besok " : "kemarin "}pukul ${fmtTime(iso)}`;

export function attendanceGate(t: TodayStatus | undefined | null, now: number = Date.now()): Gate {
  if (!t) return { purpose: null, can: false, hint: null };
  const w = t.window;
  if (t.check_in && t.check_out) return { purpose: null, can: false, hint: "Sudah check out." };
  if (t.check_in) {
    if (!w) return { purpose: "out", can: true, hint: null };
    if (now < Date.parse(w.out_open)) return { purpose: "out", can: false, hint: `Check out dibuka ${at(w.out_open)}.` };
    if (now > Date.parse(w.out_close)) return { purpose: "out", can: false, hint: `Batas check out ${at(w.out_close)} sudah lewat. Minta Kepala Unit mengoreksi jam pulang.` };
    return { purpose: "out", can: true, hint: `Check out sampai ${at(w.out_close)}.` };
  }
  if (t.leave) return { purpose: null, can: false, hint: t.leave === "sakit" ? "Hari ini Anda sakit (disetujui)." : "Hari ini Anda izin (disetujui)." };
  if (!t.shift) return { purpose: null, can: false, hint: "Tidak ada jadwal shift hari ini." };
  if (!w) return { purpose: "in", can: true, hint: null };
  if (now < Date.parse(w.in_open)) return { purpose: "in", can: false, hint: `Check in dibuka ${at(w.in_open)}.` };
  if (now > Date.parse(w.in_close)) return { purpose: "in", can: false, hint: `Batas check in ${at(w.in_close)} sudah lewat. Hubungi Kepala Unit untuk koreksi absensi.` };
  return { purpose: "in", can: true, hint: `Check in sampai ${at(w.in_close)}.` };
}
