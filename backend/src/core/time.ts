/**
 * Waktu & tanggal kerja. Tanggal = string "YYYY-MM-DD" (zona kerja, default Asia/Jakarta);
 * instant = Date (UTC). Padanan rules.tz/work_date_of/shift_window di backend lama.
 */
import { settings } from "./config";

export const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(at: Date, tz = settings.TZ_NAME) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(at)) o[p.type] = p.value;
  return o;
}

export const nowUtc = () => new Date();

/** Selisih zona kerja terhadap UTC (menit) pada instant tertentu. */
export function tzOffsetMin(at: Date): number {
  const p = parts(at);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Tanggal kerja (zona kerja) dari instant. */
export function workDateOf(at: Date): string {
  const p = parts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

export const today = () => workDateOf(nowUtc());

/** Jam:menit lokal "HH:MM" dari instant. */
export function localHm(at: Date): string {
  const p = parts(at);
  return `${p.hour}:${p.minute}`;
}

/** Instant dari tanggal + jam lokal zona kerja. */
export function combine(day: string, hms: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm, ss] = hms.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss || 0));
  return new Date(guess.getTime() - tzOffsetMin(guess) * 60000);
}

export function startOfDay(day: string): Date {
  return combine(day, "00:00:00");
}

// ------------------------------------------------------------------ aritmetika tanggal (string)

function toUtc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const addDays = (day: string, n: number) => fromUtc(new Date(toUtc(day).getTime() + n * 86400000));
export const diffDays = (a: string, b: string) => Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / 86400000); // a - b
export const minDay = (...xs: string[]) => xs.reduce((a, b) => (b < a ? b : a));
export const maxDay = (...xs: string[]) => xs.reduce((a, b) => (b > a ? b : a));
export const weekday = (day: string) => toUtc(day).getUTCDay(); // 0 = Minggu
export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s).getTime()) && fromUtc(toUtc(s)) === s;

export function* eachDay(start: string, end: string) {
  for (let d = start; d <= end; d = addDays(d, 1)) yield d;
}

export const monthKey = (day: string) => day.slice(0, 7);
export function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${BULAN[+m - 1]} ${y}`;
}
export function nextMonth(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
/** [awal, akhir) bulan "YYYY-MM"; default bulan berjalan. */
export function monthBounds(month?: string | null): [string, string] {
  const start = month && /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : today().slice(0, 8) + "01";
  return [start, `${nextMonth(start)}-01`];
}
export const lastDayOfMonth = (month: string) => addDays(`${nextMonth(`${month}-01`)}-01`, -1);

export function fmtD(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${BULAN[m - 1].slice(0, 3)}`;
}
export function fmtDMY(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/** Rentang shift (instant). Jika end <= start, shift berakhir keesokan harinya. */
export function shiftWindow(day: string, start: string, end: string): [Date, Date] {
  const s = combine(day, start);
  let e = combine(day, end);
  if (e <= s) e = combine(addDays(day, 1), end);
  return [s, e];
}

export const crossesMidnight = (start: string, end: string) => end <= start;
export const hms = (t: string) => (t.length === 5 ? `${t}:00` : t.slice(0, 8));
