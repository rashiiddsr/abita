/** Aturan bisnis murni: shift, keterlambatan, tanggal kerja, sesi verifikasi wajah, prasyarat masuk/pulang. */
import { randomInt } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, schema, type DB } from "../db";
import type { Attendance, ShiftType, User } from "../db/schema";
import { getSetting } from "../core/settings";
import { addDays, fmtD, localHm, shiftWindow, workDateOf } from "../core/time";

// Liveness: hadap, toleh kiri & kanan (urutan acak), hadap. Kedip tidak dipakai (sering gagal di kamera HP).
export const ACTIVE_CHALLENGES = ["turn_left", "turn_right"];
export const ENROLL_CHALLENGES = ["center", "turn_left", "turn_right", "center"];

export const MESSAGES: Record<string, string> = {
  OK: "Berhasil.",
  SESSION_NOT_FOUND: "Sesi verifikasi tidak ditemukan. Silakan coba lagi.",
  SESSION_USED: "Sesi verifikasi sudah dipakai. Silakan mulai ulang.",
  SESSION_EXPIRED: "Waktu verifikasi habis. Silakan coba lagi.",
  FRAME_COUNT_MISMATCH: "Data foto tidak lengkap. Silakan coba lagi.",
  BAD_IMAGE: "Gambar dari kamera tidak dapat dibaca. Silakan coba lagi.",
  NO_FACE: "Wajah tidak terdeteksi. Pastikan wajah terlihat jelas dan cukup cahaya.",
  FACE_TOO_SMALL: "Wajah terlalu jauh. Dekatkan wajah ke kamera, lalu coba lagi.",
  POOR_LIGHTING: "Cahaya terlalu gelap atau terlalu terang. Cari tempat dengan cahaya merata, lalu coba lagi.",
  BLURRY_FACE: "Foto wajah buram. Tahan ponsel dengan stabil, lalu coba lagi.",
  MULTIPLE_FACES: "Ada wajah lain yang sama dekat ke kamera. Pastikan hanya Anda yang paling dekat.",
  CHALLENGE_MISMATCH: "Gerakan wajah tidak sesuai instruksi. Silakan coba lagi.",
  INCONSISTENT_FACE: "Wajah berubah selama verifikasi. Silakan coba lagi.",
  FACE_MISMATCH: "Wajah tidak cocok dengan data wajah akun ini.",
  NOT_ENROLLED: "Wajah belum didaftarkan. Silakan daftar wajah terlebih dahulu.",
  ALREADY_ENROLLED: "Wajah sudah terdaftar. Minta admin untuk reset jika ingin daftar ulang.",
  ALREADY_CHECKED_IN: "Anda sudah absen masuk hari ini.",
  ALREADY_CHECKED_OUT: "Anda sudah absen pulang hari ini.",
  NOT_CHECKED_IN: "Anda belum absen masuk hari ini.",
  CHECKIN_NOT_OPEN: "Check in belum dibuka.",
  CHECKIN_CLOSED: "Batas waktu check in sudah lewat. Hubungi Kepala Unit untuk koreksi absensi.",
  CHECKOUT_NOT_OPEN: "Check out belum dibuka.",
  CHECKOUT_CLOSED: "Batas waktu check out sudah lewat. Hubungi Kepala Unit untuk koreksi absensi.",
  NO_SHIFT: "Tidak ada jadwal shift hari ini.",
  ON_LEAVE: "Anda tercatat izin/sakit (disetujui) pada tanggal ini; absen tidak diperlukan.",
  NO_OFFICE: "Akun Anda belum terhubung ke kantor. Hubungi admin.",
  LOCATION_REQUIRED: "Lokasi wajib diaktifkan untuk absen.",
  LOW_GPS_ACCURACY: "Akurasi GPS terlalu rendah. Coba di area terbuka lalu ulangi.",
  OUT_OF_RANGE: "Anda berada di luar area kantor.",
  INVALID_PURPOSE: "Jenis verifikasi tidak valid.",
  MOCK_LOCATION: "Lokasi palsu terdeteksi. Matikan aplikasi pengubah lokasi (fake GPS) lalu coba lagi.",
  ACCOUNT_INACTIVE: "Akun Anda tidak aktif. Hubungi admin.",
};
export const msg = (code: string) => MESSAGES[code] ?? code;

export function pickChallenges(purpose: string, rnd: (n: number) => number = randomInt): string[] {
  if (purpose === "enroll" || purpose === "reenroll") return [...ENROLL_CHALLENGES];
  const a = [...ACTIVE_CHALLENGES];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return ["center", a[0], a[1], "center"];
}

export async function todayRecords(userId: number, day: string, q: DB = db()): Promise<Record<string, Attendance>> {
  const rows = await q
    .select()
    .from(schema.attendances)
    .where(and(eq(schema.attendances.userId, userId), eq(schema.attendances.workDate, day)));
  return Object.fromEntries(rows.map((r) => [r.type, r]));
}

// ------------------------------------------------------------------ shift

export type Assignment = typeof schema.shiftAssignments.$inferSelect & { shiftType: ShiftType };

export async function shiftFor(userId: number, day: string, q: DB = db()): Promise<Assignment | null> {
  const [r] = await q
    .select({ a: schema.shiftAssignments, t: schema.shiftTypes })
    .from(schema.shiftAssignments)
    .innerJoin(schema.shiftTypes, eq(schema.shiftTypes.id, schema.shiftAssignments.shiftTypeId))
    .where(and(eq(schema.shiftAssignments.userId, userId), eq(schema.shiftAssignments.date, day)));
  return r ? { ...r.a, shiftType: r.t } : null;
}

/** Menit terlambat terhadap jam mulai shift (0 = tepat waktu / lebih awal). null jika tidak ada jadwal shift. */
export async function lateMinutes(checkedAt: Date, a: Assignment | null): Promise<number | null> {
  if (!a) return null;
  const [start] = shiftWindow(a.date, a.shiftType.startTime, a.shiftType.endTime);
  return Math.max(0, Math.floor((checkedAt.getTime() - start.getTime()) / 60000));
}

// ------------------------------------------------------------------ jendela absen
// Check in: [mulai − checkin_open_before_min, mulai + checkin_close_after_min];
// check out: [selesai − checkout_open_before_min, selesai + checkout_close_after_min] (Pengaturan › Jam shift).
// Shift lintas tengah malam milik tanggal mulainya; check out dini hari tetap dicatat ke tanggal itu.

export type WindowMin = { inBefore: number; inAfter: number; outBefore: number; outAfter: number };
export type Windows = { start: Date; end: Date; inOpen: Date; inClose: Date; outOpen: Date; outClose: Date };

export async function windowMinutes(): Promise<WindowMin> {
  return {
    inBefore: Number(await getSetting("checkin_open_before_min")),
    inAfter: Number(await getSetting("checkin_close_after_min")),
    outBefore: Number(await getSetting("checkout_open_before_min")),
    outAfter: Number(await getSetting("checkout_close_after_min")),
  };
}

export function windowsOf(date: string, startTime: string, endTime: string, m: WindowMin): Windows {
  const [start, end] = shiftWindow(date, startTime, endTime);
  const at = (base: Date, min: number) => new Date(base.getTime() + min * 60_000);
  return { start, end, inOpen: at(start, -m.inBefore), inClose: at(start, m.inAfter), outOpen: at(end, -m.outBefore), outClose: at(end, m.outAfter) };
}

export const windowsFor = async (a: Assignment, m?: WindowMin) => windowsOf(a.date, a.shiftType.startTime, a.shiftType.endTime, m ?? (await windowMinutes()));

/**
 * Tanggal kerja untuk absen:
 * - out: shift yang sudah check in & belum check out (hari ini, lalu kemarin untuk shift malam), utamakan yang jendelanya masih buka;
 * - in: shift yang jendela check in-nya sedang buka (hari ini, besok untuk shift dini hari, kemarin);
 * - selain itu tanggal hari ini.
 */
export type DayInfo = { a: Assignment | null; recs: Record<string, Attendance> };
export type Days = Map<string, DayInfo>;

/** Jadwal + catatan absen satu karyawan untuk kemarin, hari ini, dan besok — dua query (dipakai /me & prasyarat absen). */
export async function daysAround(userId: number, at: Date = new Date(), q: DB = db()): Promise<Days> {
  const t = workDateOf(at);
  const days = [addDays(t, -1), t, addDays(t, 1)];
  const map: Days = new Map(days.map((d) => [d, { a: null, recs: {} }]));
  const sh = await q
    .select({ a: schema.shiftAssignments, t: schema.shiftTypes })
    .from(schema.shiftAssignments)
    .innerJoin(schema.shiftTypes, eq(schema.shiftTypes.id, schema.shiftAssignments.shiftTypeId))
    .where(and(eq(schema.shiftAssignments.userId, userId), inArray(schema.shiftAssignments.date, days)));
  for (const r of sh) map.get(r.a.date)!.a = { ...r.a, shiftType: r.t };
  const att = await q
    .select()
    .from(schema.attendances)
    .where(and(eq(schema.attendances.userId, userId), inArray(schema.attendances.workDate, days)));
  for (const r of att) map.get(r.workDate)!.recs[r.type] = r;
  return map;
}
const dayOf = (days: Days, d: string): DayInfo => days.get(d) ?? { a: null, recs: {} };
const winOf = (a: Assignment, m: WindowMin) => windowsOf(a.date, a.shiftType.startTime, a.shiftType.endTime, m);

export async function resolveWorkDate(user: Pick<User, "id">, purpose: string, at: Date = new Date(), q: DB = db(), pre?: Days): Promise<string> {
  const t = workDateOf(at);
  const days = pre ?? (await daysAround(user.id, at, q));
  const m = await windowMinutes();
  if (purpose === "out") {
    const open: string[] = [];
    for (const d of [t, addDays(t, -1)]) {
      const { a, recs } = dayOf(days, d);
      if (!("in" in recs) || "out" in recs) continue;
      if (!a || at <= winOf(a, m).outClose) return d;
      open.push(d);
    }
    return open[0] ?? t; // jendela sudah tutup: tetap tanggal itu (pesan "batas check out lewat")
  }
  if (purpose === "in") {
    for (const d of [t, addDays(t, 1), addDays(t, -1)]) {
      const { a, recs } = dayOf(days, d);
      if (!a || "in" in recs) continue;
      const w = winOf(a, m);
      if (at >= w.inOpen && at <= w.inClose) return d;
    }
  }
  return t;
}

/** Tanggal yang ditampilkan sebagai "hari ini" di aplikasi: shift yang sedang berjalan / bisa check in, selain itu hari ini. */
export async function activeWorkDate(user: Pick<User, "id">, at: Date = new Date(), q: DB = db(), pre?: Days): Promise<string> {
  const days = pre ?? (await daysAround(user.id, at, q));
  const out = await resolveWorkDate(user, "out", at, q, days);
  const { a, recs } = dayOf(days, out);
  if ("in" in recs && !("out" in recs) && (!a || at <= winOf(a, await windowMinutes()).outClose)) return out;
  return resolveWorkDate(user, "in", at, q, days);
}

const when = (d: Date, at: Date) => (workDateOf(d) === workDateOf(at) ? `pukul ${localHm(d)}` : `${fmtD(workDateOf(d))} pukul ${localHm(d)}`);

/** Prasyarat absen: null bila boleh, selain itu kode + pesan (dengan jam buka/tutup jendela bila relevan). */
export async function prerequisite(user: User, purpose: string, at: Date = new Date(), q: DB = db()): Promise<{ code: string; message: string } | null> {
  const fail = (code: string, message = msg(code)) => ({ code, message });
  if (!["enroll", "reenroll", "in", "out"].includes(purpose)) return fail("INVALID_PURPOSE");
  if (user.isActive === false) return fail("ACCOUNT_INACTIVE");
  if (purpose === "enroll") return user.faceEmbedding ? fail("ALREADY_ENROLLED") : null;
  if (!user.faceEmbedding) return fail("NOT_ENROLLED");
  if (purpose === "reenroll") return null;
  if (user.officeId == null) return fail("NO_OFFICE");
  const days = await daysAround(user.id, at, q);
  const day = await resolveWorkDate(user, purpose, at, q, days);
  const { a, recs } = dayOf(days, day);
  if (purpose === "in") {
    if ("in" in recs) return fail("ALREADY_CHECKED_IN");
    if (!a) return fail("NO_SHIFT"); // check in hanya pada hari berjadwal
    // izin/sakit yang sudah disetujui: tanggal itu tidak boleh sekaligus tercatat hadir
    const [lv] = await q
      .select({ kind: schema.leaveRequests.kind })
      .from(schema.leaveRequests)
      .where(and(eq(schema.leaveRequests.userId, user.id), eq(schema.leaveRequests.status, "approved"), lte(schema.leaveRequests.startDate, day), gte(schema.leaveRequests.endDate, day)))
      .limit(1);
    if (lv) return fail("ON_LEAVE", `Anda tercatat ${lv.kind} (disetujui) pada ${fmtD(day)}; absen tidak diperlukan.`);
    const w = await windowsFor(a);
    const name = `shift ${a.shiftType.name} (${localHm(w.start)}–${localHm(w.end)})`;
    if (at < w.inOpen) return fail("CHECKIN_NOT_OPEN", `Check in ${name} dibuka ${when(w.inOpen, at)}.`);
    if (at > w.inClose) return fail("CHECKIN_CLOSED", `Batas check in ${name} ${when(w.inClose, at)} sudah lewat. Hubungi Kepala Unit untuk koreksi absensi.`);
    return null;
  }
  if (!("in" in recs)) return fail("NOT_CHECKED_IN");
  if ("out" in recs) return fail("ALREADY_CHECKED_OUT");
  if (a) {
    const w = await windowsFor(a);
    if (at < w.outOpen) return fail("CHECKOUT_NOT_OPEN", `Check out dibuka ${when(w.outOpen, at)} (shift ${a.shiftType.name} selesai ${localHm(w.end)}).`);
    if (at > w.outClose) return fail("CHECKOUT_CLOSED", `Batas check out ${when(w.outClose, at)} sudah lewat. Hubungi Kepala Unit untuk koreksi absensi.`);
  }
  return null;
}

/** reason_code jika purpose tidak boleh dijalankan sekarang, null jika boleh. */
export async function checkPrerequisite(user: User, purpose: string, at: Date = new Date(), q: DB = db()): Promise<string | null> {
  return (await prerequisite(user, purpose, at, q))?.code ?? null;
}

/** Validasi sesi & langsung tandai terpakai (sekali pakai, UPDATE atomik). reason_code jika gagal. */
export async function claimSession(sessionId: string, user: Pick<User, "id">, at: Date = new Date(), q: DB = db()): Promise<string | null> {
  const [s] = await q.select().from(schema.faceSessions).where(eq(schema.faceSessions.id, sessionId));
  if (!s || s.userId !== user.id) return "SESSION_NOT_FOUND";
  const [res] = await q
    .update(schema.faceSessions)
    .set({ usedAt: at })
    .where(and(eq(schema.faceSessions.id, sessionId), isNull(schema.faceSessions.usedAt)));
  if (!res.affectedRows) return "SESSION_USED";
  if (s.expiresAt.getTime() < at.getTime()) return "SESSION_EXPIRED";
  return null;
}

// ------------------------------------------------------------------ lokasi

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const r = (x: number) => (x * Math.PI) / 180;
  const dp = r(lat2 - lat1);
  const dl = r(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Lolos jika jarak - min(akurasi, kelonggaran maks.) <= radius. */
export function checkGeofence(
  lat: number | null,
  lng: number | null,
  accuracy: number | null,
  officeLat: number,
  officeLng: number,
  radiusM: number,
  maxAccuracyM = 0,
  allowanceMaxM = Infinity,
): { ok: boolean; reason: string | null; distance: number | null } {
  if (lat == null || lng == null) return { ok: false, reason: "LOCATION_REQUIRED", distance: null };
  const acc = Math.max(0, accuracy ?? 0);
  const distance = haversineM(lat, lng, officeLat, officeLng);
  if (maxAccuracyM > 0 && acc > maxAccuracyM) return { ok: false, reason: "LOW_GPS_ACCURACY", distance };
  if (distance - Math.min(acc, allowanceMaxM) > radiusM) return { ok: false, reason: "OUT_OF_RANGE", distance };
  return { ok: true, reason: null, distance };
}
