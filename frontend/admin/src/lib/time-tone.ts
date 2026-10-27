/**
 * Warna jam absen terhadap jadwal shift (selisih menit; negatif = lebih awal):
 * - Masuk: lebih awal = hijau · tepat di jam mulai = biasa · terlambat = kuning → merah (merah penuh 60 menit).
 * - Pulang: kebalikannya — pulang lebih awal = kuning → merah (merah penuh 60 menit lebih awal) · tepat = biasa ·
 *   pulang ≥ 30 menit lebih lambat = hijau.
 * Sama persis di admin/ dan staff/ (src/lib/time-tone.ts).
 */
const FULL_RED_MIN = 60;
const LATER_GREEN_MIN = 30;
const YELLOW = "#C99400";

/** kuning (sedikit) → merah (FULL_RED_MIN menit atau lebih) */
const scale = (min: number) => `color-mix(in srgb, var(--color-bad) ${Math.round(Math.min(1, Math.max(0, min) / FULL_RED_MIN) * 100)}%, ${YELLOW})`;

/** Warna jam masuk; undefined = warna teks biasa. */
export function inTimeColor(diff: number | null | undefined): string | undefined {
  if (diff == null) return undefined;
  if (diff < 0) return "var(--color-ok)";
  if (diff === 0) return undefined;
  return scale(diff);
}

/** Warna jam pulang; undefined = warna teks biasa. */
export function outTimeColor(diff: number | null | undefined): string | undefined {
  if (diff == null) return undefined;
  if (diff < 0) return scale(-diff);
  if (diff >= LATER_GREEN_MIN) return "var(--color-ok)";
  return undefined;
}

/** "+12 mnt" / "−5 mnt" untuk keterangan kecil di samping jam (null bila tepat 0 / tidak ada). */
export function diffLabel(diff: number | null | undefined): string | null {
  if (diff == null || diff === 0) return null;
  const a = Math.abs(diff);
  const v = a >= 60 ? `${Math.floor(a / 60)} j ${a % 60 ? `${a % 60} m` : ""}`.trim() : `${a} mnt`;
  return `${diff > 0 ? "+" : "−"}${v}`;
}

/** Selisih menit dari waktu ISO terhadap jadwal (tanggal kerja + jam; shift lewat tengah malam: jam selesai = hari berikutnya). */
export function diffFromShift(atIso: string | null | undefined, date: string, startTime: string, endTime: string, edge: "start" | "end"): number | null {
  if (!atIso) return null;
  const hm = (t: string) => t.slice(0, 5);
  const next = (d: string) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  };
  const day = edge === "end" && hm(endTime) <= hm(startTime) ? next(date) : date;
  const base = Date.parse(`${day}T${hm(edge === "start" ? startTime : endTime)}:00+07:00`);
  return Math.floor((Date.parse(atIso) - base) / 60_000);
}
