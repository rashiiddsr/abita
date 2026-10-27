/**
 * Tukar shift antar-rekan satu unit dan status terbit jadwal bulanan.
 * Tanggal sama : A dan B bertukar jenis shift (harus berbeda).
 * Beda tanggal : B menggantikan A pada `date`, A menggantikan B pada `target_date` (masing-masing harus libur di tanggal tujuan).
 * Alur: B menerima/menolak -> Kepala Unit memutuskan -> jadwal berubah otomatis.
 */
import { and, asc, eq, gte, inArray, ne, or } from "drizzle-orm";
import { scopeUnits } from "../core/auth";
import { HttpError } from "../core/http";
import { getSetting } from "../core/settings";
import { addDays, fmtD, fmtDMY, lastDayOfMonth, monthKey, monthLabel, nextMonth, startOfDay, today } from "../core/time";
import { db, schema, type DB } from "../db";
import type { ShiftAssignment, SwapRequest, User } from "../db/schema";
import { attendedDays, leaveOn, swapConflict } from "./conflicts";
import { shiftFor, type Assignment } from "./rules";
import { runningLock } from "./scheduling";
import { activeUser, notify, wants } from "./services";

const { schedulePeriods, swapRequests, shiftAssignments, notifications, units, users } = schema;

// ============================================================ jadwal bulanan

/** published | draft. Bulan berjalan & sebelumnya tanpa catatan dianggap terbit (data lama). */
export async function periodStatus(unit: string | null, month: string, q: DB = db()): Promise<string> {
  if (!unit) return "published";
  const [row] = await q
    .select()
    .from(schedulePeriods)
    .where(and(eq(schedulePeriods.unit, unit), eq(schedulePeriods.month, month)));
  if (row) return row.status;
  return month <= monthKey(today()) ? "published" : "draft";
}

export const isPublished = async (unit: string | null, day: string, q: DB = db()) => (await periodStatus(unit, monthKey(day), q)) === "published";

/** Batas terbit jadwal `month`: tanggal N bulan sebelumnya (Pengaturan › Aturan, default 25). */
export async function deadline(month: string): Promise<string> {
  const prevLast = addDays(`${month}-01`, -1);
  const day = Number(await getSetting("schedule_deadline_day")) || 25;
  const maxD = Number(prevLast.slice(8));
  return `${prevLast.slice(0, 8)}${String(Math.min(Math.max(day, 1), maxD)).padStart(2, "0")}`;
}

/** Pengingat jadwal bulan depan, maksimal sekali sehari (dipanggil saat dasbor memuat akun). */
export async function scheduleReminder(user: User) {
  const t = today();
  const month = nextMonth(t);
  const due = await deadline(month);
  if (t < addDays(due, -5)) return;
  const label = monthLabel(month);
  let title: string, body: string;
  if (user.role === "unit_head" && user.unit && wants(user, "schedule")) {
    const pending: string[] = [];
    for (const u of scopeUnits(user) ?? []) if ((await periodStatus(u, month)) !== "published") pending.push(u);
    if (!pending.length) return;
    title = pending.length > 1 ? `Jadwal ${label} belum diterbitkan (${pending.join(", ")})` : `Jadwal ${label} belum diterbitkan`;
    body = t <= due ? `Batas terbit ${fmtDMY(due)}` : `Melewati batas terbit ${fmtDMY(due)}`;
  } else if (user.role === "admin" && t > due) {
    const late: string[] = [];
    for (const u of await db().select({ name: units.name }).from(units).orderBy(asc(units.name))) if ((await periodStatus(u.name, month)) !== "published") late.push(u.name);
    if (!late.length) return;
    title = `${late.length} unit belum menerbitkan jadwal ${label}`;
    body = late.slice(0, 5).join(", ") + (late.length > 5 ? " …" : "");
  } else return;
  const [sent] = await db()
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.kind, "schedule"), gte(notifications.createdAt, startOfDay(t))));
  if (!sent) await notify(user.id, "schedule", title, body, "/schedule");
}

// ============================================================ tukar shift

/** peer = menunggu rekan, review = menunggu Kepala Unit, done = selesai. */
export function stage(s: Pick<SwapRequest, "status" | "targetUserId" | "peerStatus">): "peer" | "review" | "done" {
  if (s.status !== "pending") return "done";
  // tukar shift langsung diputuskan Kepala Unit; tahap "peer" hanya untuk pengajuan lama yang masih menunggu rekan
  if (s.targetUserId != null && s.peerStatus === "pending") return "peer";
  return "review";
}

/** Ada pengajuan tukar berjalan yang melibatkan user pada tanggal d. */
export async function involved(userId: number, day: string, exclude: number | null = null, q: DB = db()): Promise<boolean> {
  const conds = [eq(swapRequests.status, "pending"), or(eq(swapRequests.userId, userId), eq(swapRequests.targetUserId, userId)), or(eq(swapRequests.date, day), eq(swapRequests.targetDate, day))];
  if (exclude != null) conds.push(ne(swapRequests.id, exclude));
  const [r] = await q
    .select({ id: swapRequests.id })
    .from(swapRequests)
    .where(and(...conds))
    .limit(1);
  return !!r;
}

async function colleagues(me: User): Promise<User[]> {
  if (!me.unit) throw new HttpError(422, "Akun Anda belum terdaftar di unit.");
  return db()
    .select()
    .from(users)
    .where(and(eq(users.unit, me.unit), eq(users.role, "staff"), activeUser(), ne(users.id, me.id)))
    .orderBy(asc(users.name));
}

async function checkDates(me: User, d1: string, d2: string): Promise<Assignment> {
  const t = today();
  if (d1 < t || d2 < t) throw new HttpError(422, "Tanggal yang sudah lewat tidak bisa ditukar.");
  if (!(await isPublished(me.unit, d1)) || !(await isPublished(me.unit, d2))) throw new HttpError(422, "Jadwal bulan tersebut belum diterbitkan Kepala Unit.");
  const mine = await shiftFor(me.id, d1);
  if (!mine) throw new HttpError(422, `Anda tidak punya jadwal pada ${fmtD(d1)}.`);
  if (d1 !== d2 && (await shiftFor(me.id, d2))) throw new HttpError(422, `Anda sudah punya jadwal pada ${fmtD(d2)}; pilih tanggal saat Anda libur.`);
  if ((await involved(me.id, d1)) || (d1 !== d2 && (await involved(me.id, d2)))) throw new HttpError(409, "Masih ada tukar shift yang berjalan pada tanggal tersebut.");
  if ((await attendedDays(me.id, d1, d1)).length) throw new HttpError(409, `Anda sudah absen pada ${fmtD(d1)}; shift itu tidak bisa ditukar.`);
  for (const d of new Set([d1, d2])) {
    const lv = await leaveOn(me.id, d);
    if (lv) throw new HttpError(409, `Anda punya pengajuan ${lv.kind} pada ${fmtD(d)}; batalkan dulu bila ingin menukar shift.`);
  }
  if (await runningLock(me.id, d1, null)) throw new HttpError(409, `Shift Anda pada ${fmtD(d1)} sudah dimulai; tidak bisa ditukar.`);
  return mine;
}

/** Rekan satu unit yang bisa diajak tukar: punya shift pada d2 (berbeda bila tanggal sama), libur pada d1 (bila beda tanggal). */
export async function candidates(me: User, d1: string, d2: string): Promise<[User, Assignment][]> {
  const mine = await checkDates(me, d1, d2);
  const out: [User, Assignment][] = [];
  for (const u of await colleagues(me)) {
    const theirs = await shiftFor(u.id, d2);
    if (!theirs) continue;
    if (d1 === d2 && theirs.shiftTypeId === mine.shiftTypeId) continue;
    if (d1 !== d2 && (await shiftFor(u.id, d1))) continue;
    if ((await involved(u.id, d2)) || (d1 !== d2 && (await involved(u.id, d1)))) continue;
    if (await swapConflict(me, u, d1, d2, mine.shiftTypeId, theirs.shiftTypeId)) continue; // rekan sudah absen, izin/sakit, atau shiftnya sudah mulai
    out.push([u, theirs]);
  }
  return out;
}

export async function validate(me: User, targetId: number, d1: string, d2: string): Promise<[Assignment, Assignment, User]> {
  const ok = new Map((await candidates(me, d1, d2)).map(([u, a]) => [u.id, [u, a] as const]));
  const hit = ok.get(targetId);
  if (!hit) throw new HttpError(422, "Rekan ini tidak bisa diajak tukar pada tanggal tersebut.");
  return [(await shiftFor(me.id, d1))!, hit[1], hit[0]];
}

/** Terapkan tukar shift yang disetujui ke jadwal (dicek ulang terhadap jadwal saat ini). */
export async function applySwap(s: SwapRequest, q: DB) {
  const now = new Date();
  const cell = async (uid: number, d: string): Promise<ShiftAssignment | null> =>
    (
      await q
        .select()
        .from(shiftAssignments)
        .where(and(eq(shiftAssignments.userId, uid), eq(shiftAssignments.date, d)))
    )[0] ?? null;
  if (s.targetUserId == null) {
    // pengajuan lama: ubah shift sendiri
    const cur = await cell(s.userId, s.date);
    if (!cur) await q.insert(shiftAssignments).values({ userId: s.userId, date: s.date, shiftTypeId: s.toShiftTypeId });
    else await q.update(shiftAssignments).set({ shiftTypeId: s.toShiftTypeId, updatedAt: now }).where(eq(shiftAssignments.id, cur.id));
    return;
  }
  const d2 = s.targetDate ?? s.date;
  const a = await cell(s.userId, s.date);
  const b = await cell(s.targetUserId, d2);
  if (!a || !b || a.shiftTypeId !== s.fromShiftTypeId || b.shiftTypeId !== s.toShiftTypeId)
    throw new HttpError(409, "Jadwal salah satu karyawan sudah berubah sejak pengajuan dibuat. Tolak pengajuan ini.");
  // keadaan bisa berubah sejak pengajuan dibuat: tanggal lewat, sudah absen, izin/sakit, shift sudah mulai
  if (s.date < today() || d2 < today()) throw new HttpError(409, "Tanggal tukar shift sudah lewat. Tolak pengajuan ini.");
  const people = await q
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [s.userId, s.targetUserId]));
  const who = (id: number) => people.find((p) => p.id === id) ?? { id, name: "Karyawan" };
  const why = await swapConflict(who(s.userId), who(s.targetUserId), s.date, d2, a.shiftTypeId, b.shiftTypeId, now, q);
  if (why) throw new HttpError(409, `${why} Tolak pengajuan ini.`);
  if (s.date === d2) {
    await q.update(shiftAssignments).set({ shiftTypeId: b.shiftTypeId, updatedAt: now }).where(eq(shiftAssignments.id, a.id));
    await q.update(shiftAssignments).set({ shiftTypeId: a.shiftTypeId, updatedAt: now }).where(eq(shiftAssignments.id, b.id));
  } else {
    if ((await cell(s.userId, d2)) || (await cell(s.targetUserId, s.date))) throw new HttpError(409, "Salah satu karyawan sudah punya jadwal di tanggal tujuan. Tolak pengajuan ini.");
    await q.update(shiftAssignments).set({ userId: s.targetUserId, updatedAt: now }).where(eq(shiftAssignments.id, a.id));
    await q.update(shiftAssignments).set({ userId: s.userId, updatedAt: now }).where(eq(shiftAssignments.id, b.id));
  }
}

/** Ringkas: '12 Okt Pagi ↔ 14 Okt Malam' atau '12 Okt Pagi ↔ Malam'. */
export function summary(s: Pick<SwapRequest, "date" | "targetDate" | "targetUserId">, fromName: string | null, toName: string): string {
  if (s.targetUserId == null) return `${fmtD(s.date)} ${fromName ?? "Libur"} → ${toName}`;
  const d2 = s.targetDate ?? s.date;
  return `${fmtD(s.date)} ${fromName ?? "—"} ↔ ${d2 !== s.date ? fmtD(d2) + " " : ""}${toName}`;
}

export async function summaryOf(s: SwapRequest, q: DB = db()): Promise<string> {
  const types = await q.select().from(schema.shiftTypes);
  const name = (id: number | null) => types.find((t) => t.id === id)?.name ?? null;
  return summary(s, name(s.fromShiftTypeId), name(s.toShiftTypeId) ?? "—");
}

export { lastDayOfMonth };
