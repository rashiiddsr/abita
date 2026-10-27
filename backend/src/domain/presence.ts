/** Data presensi sekumpulan staff pada rentang tanggal (dimuat sekali, dihitung di memori) + status harian. */
import { and, asc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { unitFilter } from "../core/auth";
import { addDays, localHm, maxDay, minDay, startOfDay } from "../core/time";
import { db, schema } from "../db";
import type { Attendance, ShiftType, User } from "../db/schema";
import { msg, windowMinutes, windowsOf, type WindowMin } from "./rules";
import { activeUser } from "./services";

const { users, shiftAssignments, shiftTypes, attendances, leaveRequests, attempts } = schema;

export const NO_UNIT = "Tanpa unit";
const LOCATION_CODES = new Set(["OUT_OF_RANGE", "MOCK_LOCATION", "LOCATION_REQUIRED", "LOW_GPS_ACCURACY", "NO_OFFICE"]);
const FACE_CODES = new Set(["FACE_MISMATCH", "NO_FACE", "MULTIPLE_FACES", "CHALLENGE_MISMATCH", "INCONSISTENT_FACE", "BAD_IMAGE", "FACE_TOO_SMALL", "POOR_LIGHTING", "BLURRY_FACE"]);

export type Attempt = typeof attempts.$inferSelect;
export type Shift = { userId: number; date: string; type: ShiftType };
export type RangeData = { shifts: Map<string, Shift>; att: Map<string, Record<string, Attendance>>; leave: Map<string, string>; win: WindowMin };
/** Status yang dihitung "hadir" (termasuk lupa check out). */
export const PRESENT = new Set(["hadir", "telat", "selesai", "tanpa_pulang"]);

export const key = (uid: number, d: string) => `${uid}|${d}`;
export const hhmm = (d: Date | null | undefined) => (d ? localHm(d) : null);
export const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

/** Unit data yang ditampilkan (null = semua): Kepala Unit = unit pilihannya atau semua unitnya; Admin SDM = pilihan (kosong/'all' = semua). */
export const effectiveUnit = (me: User, unit: string | null | undefined): string[] | null => unitFilter(me, unit);

/** Staff aktif (atau semua) di unit tertentu: satu nama unit, daftar unit, atau null = semua unit. */
export async function staffIn(unit: string | string[] | null, activeOnly = true): Promise<User[]> {
  const conds = [eq(users.role, "staff")];
  if (typeof unit === "string") conds.push(eq(users.unit, unit));
  else if (unit) conds.push(inArray(users.unit, unit.length ? unit : ["__none__"]));
  if (activeOnly) conds.push(activeUser());
  return db()
    .select()
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.name));
}

/** [start, end] inklusif. */
export async function loadRange(us: Pick<User, "id">[], start: string, end: string): Promise<RangeData> {
  const data: RangeData = { shifts: new Map(), att: new Map(), leave: new Map(), win: await windowMinutes() };
  const ids = us.map((u) => u.id);
  if (!ids.length || end < start) return data;
  const sh = await db()
    .select({ a: shiftAssignments, t: shiftTypes })
    .from(shiftAssignments)
    .innerJoin(shiftTypes, eq(shiftTypes.id, shiftAssignments.shiftTypeId))
    .where(and(inArray(shiftAssignments.userId, ids), gte(shiftAssignments.date, start), lte(shiftAssignments.date, end)));
  for (const { a, t } of sh) data.shifts.set(key(a.userId, a.date), { userId: a.userId, date: a.date, type: t });
  const att = await db()
    .select()
    .from(attendances)
    .where(and(inArray(attendances.userId, ids), gte(attendances.workDate, start), lte(attendances.workDate, end)));
  for (const a of att) {
    const k = key(a.userId, a.workDate);
    data.att.set(k, { ...(data.att.get(k) ?? {}), [a.type]: a });
  }
  const lv = await db()
    .select()
    .from(leaveRequests)
    .where(and(inArray(leaveRequests.userId, ids), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)));
  for (const l of lv) for (let d = maxDay(l.startDate, start); d <= minDay(l.endDate, end); d = addDays(d, 1)) data.leave.set(key(l.userId, d), l.kind);
  return data;
}

/** Selisih check in terhadap jam mulai & check out terhadap jam selesai shift (menit, negatif = lebih awal). */
export function diffsOf(data: RangeData, uid: number, d: string) {
  const sh = data.shifts.get(key(uid, d));
  const rec = data.att.get(key(uid, d)) ?? {};
  if (!sh) return { in_diff_min: null, out_diff_min: null };
  const w = windowsOf(d, sh.type.startTime, sh.type.endTime, data.win);
  const diff = (a: Attendance | undefined, base: Date) => (a ? Math.floor((a.checkedAt.getTime() - base.getTime()) / 60_000) : null);
  return { in_diff_min: diff(rec.in, w.start), out_diff_min: diff(rec.out, w.end) };
}

/** hadir | telat | selesai | tanpa_pulang | izin | sakit | gagal | belum | alpa | libur */
export function statusOf(data: RangeData, uid: number, d: string, nowDay: string, failed?: Attempt | null): string {
  const rec = data.att.get(key(uid, d)) ?? {};
  if (rec.in) {
    if (rec.out) return "selesai";
    // jendela check out sudah tutup tanpa check out
    const sh = data.shifts.get(key(uid, d));
    const closed = sh ? Date.now() > windowsOf(d, sh.type.startTime, sh.type.endTime, data.win).outClose.getTime() : d < nowDay;
    if (closed) return "tanpa_pulang";
    return (rec.in.lateMinutes ?? 0) > 0 ? "telat" : "hadir";
  }
  const kind = data.leave.get(key(uid, d));
  if (kind) return kind;
  if (failed) return "gagal";
  if (data.shifts.has(key(uid, d))) return d >= nowDay ? "belum" : "alpa";
  return "libur";
}

export const isLate = (data: RangeData, uid: number, d: string) => (data.att.get(key(uid, d))?.in?.lateMinutes ?? 0) > 0;

/** Percobaan absen terakhir per staff pada tanggal d, hanya jika gagal. */
export async function failedAttempts(ids: number[], d: string): Promise<Map<number, Attempt>> {
  const last = new Map<number, Attempt>();
  if (!ids.length) return last;
  const rows = await db()
    .select()
    .from(attempts)
    .where(and(inArray(attempts.userId, ids), gte(attempts.createdAt, startOfDay(d)), lt(attempts.createdAt, startOfDay(addDays(d, 1))), inArray(attempts.purpose, ["in", "out"])))
    .orderBy(asc(attempts.createdAt));
  for (const a of rows) last.set(a.userId, a);
  for (const [uid, a] of last) if (a.success) last.delete(uid);
  return last;
}

const scoreOf = (a: Attempt): number | null => {
  const s = (a.scores ?? {}).match_score;
  return typeof s === "number" ? s : null;
};

/** [catatan lokasi, catatan wajah] untuk percobaan gagal. */
export function attemptNote(a: Attempt): [string | null, string | null] {
  const code = a.reasonCode;
  if (code === "OUT_OF_RANGE") return [a.distanceM !== null ? `Di luar area · ${Math.round(a.distanceM)} m` : "Di luar area", null];
  if (code === "MOCK_LOCATION") return ["Lokasi palsu terdeteksi", null];
  if (LOCATION_CODES.has(code)) return [msg(code), null];
  if (code === "FACE_MISMATCH") {
    const s = scoreOf(a);
    return [null, s !== null ? `Wajah tidak cocok · skor ${Math.round(s * 100)}%` : "Wajah tidak cocok"];
  }
  if (FACE_CODES.has(code)) return [null, msg(code)];
  return [null, null];
}
export const attemptScore = scoreOf;

export const shiftDict = (s: Shift | undefined | null) =>
  s ? { id: s.type.id, name: s.type.name, start: s.type.startTime.slice(0, 5), end: s.type.endTime.slice(0, 5), color: s.type.color } : null;

export type DailyRow = ReturnType<typeof baseRow>;
function baseRow(u: User) {
  return {
    user_id: u.id,
    name: u.name,
    employee_code: u.employeeCode,
    employment_type: u.employmentType,
    unit: u.unit,
    has_avatar: !!u.avatarPath,
    shift: null as ReturnType<typeof shiftDict>,
    status: "libur",
    check_in: null as string | null,
    check_out: null as string | null,
    in_id: null as number | null,
    out_id: null as number | null,
    late_minutes: null as number | null,
    in_diff_min: null as number | null,
    out_diff_min: null as number | null,
    has_photo: false,
    location_ok: null as boolean | null,
    location_note: null as string | null,
    face_ok: null as boolean | null,
    face_note: null as string | null,
    distance_m: null as number | null,
    accuracy: null as number | null,
    match_score: null as number | null,
    manual: false,
    lat: null as number | null,
    lng: null as number | null,
  };
}
export const emptyRow = baseRow;

export async function buildRows(us: User[], d: string, nowDay: string): Promise<DailyRow[]> {
  const data = await loadRange(us, d, d);
  const failed = await failedAttempts(
    us.map((u) => u.id),
    d,
  );
  const out: DailyRow[] = [];
  for (const u of us) {
    const st = statusOf(data, u.id, d, nowDay, data.att.has(key(u.id, d)) ? null : failed.get(u.id));
    if (st === "libur") continue; // tidak berjadwal & tidak ada catatan
    const rec = data.att.get(key(u.id, d)) ?? {};
    const aIn = rec.in,
      aOut = rec.out;
    const row = baseRow(u);
    Object.assign(row, {
      shift: shiftDict(data.shifts.get(key(u.id, d))),
      status: st,
      check_in: hhmm(aIn?.checkedAt),
      check_out: hhmm(aOut?.checkedAt),
      in_id: aIn?.id ?? null,
      out_id: aOut?.id ?? null,
      late_minutes: aIn?.lateMinutes ?? null,
      ...diffsOf(data, u.id, d),
      manual: [aIn, aOut].some((a) => a?.source === "manual"),
    });
    const ref = aOut ?? aIn;
    if (ref) {
      Object.assign(row, {
        has_photo: !!ref.photoPath,
        location_ok: true,
        face_ok: ref.source !== "manual",
        distance_m: ref.distanceM,
        accuracy: ref.accuracy,
        match_score: ref.matchScore,
        lat: ref.lat,
        lng: ref.lng,
        face_note: ref.source === "manual" ? "Koreksi manual" : null,
      });
    } else if (st === "gagal") {
      const fa = failed.get(u.id)!;
      const [loc, face] = attemptNote(fa);
      Object.assign(row, {
        location_ok: loc === null,
        location_note: loc,
        face_ok: loc ? null : face === null,
        face_note: face,
        distance_m: fa.distanceM,
        accuracy: fa.accuracy,
        lat: fa.lat,
        lng: fa.lng,
        match_score: scoreOf(fa),
      });
    }
    out.push(row);
  }
  return out;
}

export async function aggregateDays(us: User[], start: string, end: string, nowDay: string) {
  const data = await loadRange(us, start, end);
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const c: Record<string, number> = { scheduled: 0, hadir: 0, telat: 0, alpa: 0, izin: 0, sakit: 0 };
    for (const u of us) {
      const st = statusOf(data, u.id, d, nowDay);
      if (st === "libur") continue;
      c.scheduled++;
      if (PRESENT.has(st)) {
        c.hadir++;
        if (isLate(data, u.id, d)) c.telat++;
      } else if (st === "alpa" || st === "belum") c.alpa++;
      else c[st] = (c[st] ?? 0) + 1;
    }
    out.push({ date: d, scheduled: c.scheduled, hadir: c.hadir, telat: c.telat, alpa: c.alpa, izin: c.izin, sakit: c.sakit, rate: pct(c.hadir, c.scheduled - c.izin - c.sakit) });
  }
  return out;
}

export function staffDays(data: RangeData, uid: number, start: string, end: string, nowDay: string) {
  const days = [];
  for (let d = end; d >= start; d = addDays(d, -1)) {
    const st = statusOf(data, uid, d, nowDay);
    if (st === "libur") continue;
    const rec = data.att.get(key(uid, d)) ?? {};
    days.push({
      date: d,
      shift: shiftDict(data.shifts.get(key(uid, d))),
      status: st,
      check_in: hhmm(rec.in?.checkedAt),
      check_out: hhmm(rec.out?.checkedAt),
      late_minutes: rec.in?.lateMinutes ?? null,
      ...diffsOf(data, uid, d),
      manual: Object.values(rec).some((a) => a.source === "manual"),
    });
  }
  return days;
}
