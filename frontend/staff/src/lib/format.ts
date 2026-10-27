/** Format tanggal & waktu (WIB, Asia/Jakarta) dan teks Indonesia. */

const TZ = "Asia/Jakarta";
export const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const parts = (d: Date) => {
  const o: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) o[p.type] = p.value;
  return o;
};

/** Tanggal hari ini (WIB) "YYYY-MM-DD". */
export function todayWib(): string {
  const p = parts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}
export const isoMonth = (day: string) => day.slice(0, 7);
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const diffDays = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
export const weekday = (day: string) => new Date(day + "T00:00:00Z").getUTCDay();
export function monthStart(month: string) {
  return `${month}-01`;
}
export function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** "08:05" dari waktu ISO (WIB). */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  const p = parts(new Date(iso));
  return `${p.hour}:${p.minute}`;
}
export function nowClock(): string {
  const p = parts(new Date());
  return `${p.hour}:${p.minute}`;
}
/** Kamis, 15 Oktober 2026 */
export function fmtDateLong(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${HARI[weekday(day)]}, ${d} ${BULAN[m - 1]} ${y}`;
}
/** 15 Okt 2026 */
export function fmtDateMed(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${BULAN[m - 1].slice(0, 3)} ${y}`;
}
/** Kam, 15 Okt */
export function fmtDayShort(day: string) {
  const [, m, d] = day.split("-").map(Number);
  return `${HARI[weekday(day)].slice(0, 3)}, ${d} ${BULAN[m - 1].slice(0, 3)}`;
}
export const fmtWeekday3 = (day: string) => HARI[weekday(day)].slice(0, 3);
export function fmtMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${BULAN[m - 1]} ${y}`;
}
export function fmtDateTime(iso: string) {
  const p = parts(new Date(iso));
  return `${Number(p.day)} ${BULAN[Number(p.month) - 1].slice(0, 3)} ${p.year} · ${p.hour}:${p.minute}`;
}
/** "5 mnt lalu", "kemarin", ... */
export function fmtAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 172800) return "kemarin";
  if (s < 604800) return `${Math.floor(s / 86400)} hari lalu`;
  return fmtDateMed(new Date(iso).toISOString().slice(0, 10));
}
export function fmtDistance(m: number | null | undefined) {
  if (m == null) return "-";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
export function greeting(): string {
  const h = Number(parts(new Date()).hour);
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}
export const hm = (t: string) => t.slice(0, 5);
export const shiftRange = (t: { start_time: string; end_time: string }) => `${hm(t.start_time)}–${hm(t.end_time)}`;
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}
export function firstNames(name: string) {
  return name.split(/\s+/).slice(0, 2).join(" ");
}
export const EMPLOYMENT: Record<string, string> = { magang: "Magang/PKL", outsourcing: "Outsourcing", tetap: "Karyawan tetap" };
export function phoneDisplay(p: string | null | undefined) {
  if (!p) return "-";
  const d = p.replace(/\D/g, "").replace(/^62/, "");
  return `+62 ${d.replace(/(\d{3})(\d{4})(\d+)/, "$1 $2 $3")}`;
}

// ------------------------------------------------------------------ keterlambatan

/** Menit terlambat sebenarnya (sebelum toleransi): waktu masuk (ISO) dibanding mulai shift (ISO). Masuk lebih awal = 0. */
export function lateMinutes(checkIn: string | null | undefined, shiftStart: string | null | undefined): number {
  if (!checkIn || !shiftStart) return 0;
  return Math.max(0, Math.floor((Date.parse(checkIn) - Date.parse(shiftStart)) / 60000));
}

/** Mulai shift (ISO, WIB) dari tanggal "YYYY-MM-DD" dan jam "HH:MM[:SS]". */
export const shiftStartIso = (date: string, startTime: string) => `${date}T${hm(startTime)}:00+07:00`;

/** Tepat waktu = biasa · terlambat dalam toleransi Admin SDM = kuning · melewati toleransi = merah. */
export function lateTone(mins: number, tolerance: number): "ok" | "warn" | "bad" {
  if (mins <= 0) return "ok";
  return mins <= tolerance ? "warn" : "bad";
}
