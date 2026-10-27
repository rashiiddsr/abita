// Format tanggal/waktu Indonesia (zona kerja Asia/Jakarta).

const TZ = "Asia/Jakarta";
export const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export const DAY3 = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** "2026-10-08" -> Date (tengah hari UTC agar aman dari geseran zona). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** Tanggal hari ini di WIB (YYYY-MM-DD). */
export function todayWib(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
}

export function nowWibTime(): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(".", ":");
}

export function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}

/** "Kamis, 8 Okt 2026" */
export function fmtDateLong(iso: string): string {
  const d = parseDate(iso);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "8 Okt 2026" */
export function fmtDate(iso: string): string {
  const d = parseDate(iso);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "8 Okt" */
export function fmtDateShort(iso: string): string {
  const d = parseDate(iso);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** "Kam, 8 Okt" */
export function fmtDayShort(iso: string): string {
  const d = parseDate(iso);
  return `${DAY3[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** Rentang: "14–15 Okt 2026" / "30 Sep – 2 Okt 2026" / "9 Okt 2026" */
export function fmtRange(a: string, b: string): string {
  if (a === b) return fmtDate(a);
  const x = parseDate(a);
  const y = parseDate(b);
  if (x.getUTCFullYear() === y.getUTCFullYear() && x.getUTCMonth() === y.getUTCMonth()) {
    return `${x.getUTCDate()}–${y.getUTCDate()} ${MON[y.getUTCMonth()]} ${y.getUTCFullYear()}`;
  }
  return `${x.getUTCDate()} ${MON[x.getUTCMonth()]} – ${y.getUTCDate()} ${MON[y.getUTCMonth()]} ${y.getUTCFullYear()}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000) + 1;
}

/** ISO datetime (UTC) -> bagian WIB */
export function wibParts(ts: string) {
  const d = new Date(ts);
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

/** "7 Okt 2026, 08:30" */
export function fmtDateTime(ts: string): string {
  const p = wibParts(ts);
  return `${fmtDate(p.date)}, ${p.time}`;
}

/** "2 jam lalu", "Kemarin", "3 hari lalu" */
export function fmtAgo(ts: string | null): string {
  if (!ts) return "Belum pernah";
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 180) return "Aktif sekarang";
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 172800) return "Kemarin";
  if (s < 2592000) return `${Math.floor(s / 86400)} hari lalu`;
  return fmtDate(wibParts(ts).date);
}

export function hoursSince(ts: string): number {
  return (Date.now() - new Date(ts).getTime()) / 3600000;
}

/** Durasi "8j 12m" dari jam masuk/pulang (HH:MM, lintas tengah malam aman). */
export function duration(a: string | null, b: string | null): string {
  if (!a) return "—";
  if (!b) return "Berjalan";
  const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  let d = m(b) - m(a);
  if (d < 0) d += 1440;
  return `${Math.floor(d / 60)}j ${String(d % 60).padStart(2, "0")}m`;
}

export function initials(name: string): string {
  return name
    .replace(/^(Ns\.|dr\.|apt\.)\s*/i, "")
    .replace(/,.*$/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function firstName(name: string): string {
  return name.replace(/^(Ns\.|dr\.|apt\.)\s*/i, "").split(/\s+/)[0] ?? name;
}

export function monthIso(iso: string): string {
  return iso.slice(0, 7);
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function pct(n: number | null | undefined, digits = 0): string {
  return n === null || n === undefined ? "–" : `${n.toFixed(digits).replace(".", ",")}%`;
}

export function phoneDisplay(p: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "").replace(/^62/, "0");
  return d.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}
