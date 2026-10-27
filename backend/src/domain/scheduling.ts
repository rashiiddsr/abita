/**
 * Penjadwalan ala "Scheduler": pola jadwal, penerapan dengan tanggal efektif, tanggal terkunci, hari libur.
 * - Tanggal terkunci: sudah ada absensi atau izin/sakit disetujui -> tidak diubah (dilewati).
 * - Shift yang sudah mulai: hari ini, shift yang jam mulainya sudah lewat tidak boleh diganti, dihapus, atau
 *   dipasang mendadak (mis. pukul 09:00 tidak bisa memasang shift Pagi 07:00; shift Siang masih bisa) -> dilewati.
 * - Penerapan pola tanpa akhir: tanggal mulai harus setelah tanggal efektif terakhir; pola lama berakhir sehari sebelumnya.
 * - Rentang bertanggal akhir (fillRange): hanya tanggal itu yang diisi, pola yang berjalan tidak berubah
 *   (mis. mengisi hari yang terlewat).
 *   Tanpa tanggal akhir = berulang terus; shift dibuat bertahap (`extend`) saat jadwal dibuka.
 */
import { and, desc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { HttpError } from "../core/http";
import { addDays, diffDays, fmtDMY, lastDayOfMonth, maxDay, minDay, nextMonth, shiftWindow, today } from "../core/time";
import { db, schema, type DB } from "../db";
import type { User, UserPattern } from "../db/schema";

const { holidays: holidayT, attendances, leaveRequests, shiftAssignments, shiftTypes, userPatterns } = schema;

export const HORIZON_DAYS = 400;

export async function holidays(start: string, end: string, q: DB = db()): Promise<Map<string, string>> {
  const rows = await q.select().from(holidayT).where(and(gte(holidayT.date, start), lte(holidayT.date, end)));
  return new Map(rows.map((h) => [h.date, h.name]));
}

/** "uid|tanggal" yang sudah punya absensi atau izin/sakit disetujui. */
export async function protectedDates(userIds: number[], start: string, end: string, q: DB = db()): Promise<Set<string>> {
  const out = new Set<string>();
  if (!userIds.length) return out;
  const att = await q
    .select({ u: attendances.userId, d: attendances.workDate })
    .from(attendances)
    .where(and(inArray(attendances.userId, userIds), gte(attendances.workDate, start), lte(attendances.workDate, end)));
  for (const r of att) out.add(`${r.u}|${r.d}`);
  const lv = await q
    .select()
    .from(leaveRequests)
    .where(and(inArray(leaveRequests.userId, userIds), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)));
  for (const l of lv) for (let d = maxDay(l.startDate, start); d <= minDay(l.endDate, end); d = addDays(d, 1)) out.add(`${l.userId}|${d}`);
  return out;
}

/** Atur satu sel jadwal. true bila berubah. */
export async function setCell(userId: number, day: string, shiftTypeId: number | null, q: DB = db()): Promise<boolean> {
  const [cur] = await q.select().from(shiftAssignments).where(and(eq(shiftAssignments.userId, userId), eq(shiftAssignments.date, day)));
  if (shiftTypeId === null) {
    if (!cur) return false;
    await q.delete(shiftAssignments).where(eq(shiftAssignments.id, cur.id));
  } else if (!cur) {
    await q.insert(shiftAssignments).values({ userId, date: day, shiftTypeId });
  } else if (cur.shiftTypeId !== shiftTypeId) {
    await q.update(shiftAssignments).set({ shiftTypeId, updatedAt: new Date() }).where(eq(shiftAssignments.id, cur.id));
  } else return false;
  return true;
}

/**
 * Hari ini: true bila shift yang ada sekarang atau shift baru (newTypeId) jam mulainya sudah lewat -> sel tidak boleh diubah.
 * Tanggal lain: false (tanggal lewat ditolak di tempat lain).
 */
export async function runningLock(userId: number, day: string, newTypeId: number | null, now: Date = new Date(), q: DB = db()): Promise<boolean> {
  if (day !== today()) return false;
  const started = (t: { startTime: string; endTime: string }) => shiftWindow(day, t.startTime, t.endTime)[0] <= now;
  const [cur] = await q
    .select({ startTime: shiftTypes.startTime, endTime: shiftTypes.endTime, id: shiftTypes.id })
    .from(shiftAssignments)
    .innerJoin(shiftTypes, eq(shiftTypes.id, shiftAssignments.shiftTypeId))
    .where(and(eq(shiftAssignments.userId, userId), eq(shiftAssignments.date, day)));
  if (cur && cur.id === newTypeId) return false; // tidak berubah
  if (cur && started(cur)) return true;
  if (newTypeId === null) return false;
  const [t] = await q.select().from(shiftTypes).where(eq(shiftTypes.id, newTypeId));
  return !!t && started(t);
}

/** Buat shift dari pola sampai `until` (mulai setelah filled_until). [diubah, dilewati]. */
export async function materialize(up: UserPattern, until: string, locked?: Set<string>, q: DB = db()): Promise<[number, number]> {
  const seq = up.sequence?.length ? up.sequence : [null];
  const t = today();
  const start = maxDay(up.startDate, up.filledUntil ? addDays(up.filledUntil, 1) : up.startDate, t);
  const end = minDay(up.endDate ?? until, until, addDays(t, HORIZON_DAYS));
  if (end < start) return [0, 0];
  const hol = up.skipHolidays ? await holidays(start, end, q) : new Map<string, string>();
  const lock = locked ?? (await protectedDates([up.userId], start, end, q));
  let changed = 0,
    skipped = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (lock.has(`${up.userId}|${d}`)) {
      skipped++;
      continue;
    }
    const n = seq.length;
    const sid = hol.has(d) ? null : seq[((diffDays(d, up.startDate) % n) + n) % n];
    if (await runningLock(up.userId, d, sid ?? null, undefined, q)) {
      skipped++; // shift hari ini yang sudah mulai
      continue;
    }
    if (await setCell(up.userId, d, sid ?? null, q)) changed++;
  }
  await q.update(userPatterns).set({ filledUntil: end }).where(eq(userPatterns.id, up.id));
  up.filledUntil = end;
  return [changed, skipped];
}

/** Perpanjang pola yang masih berjalan sampai `until` (dipanggil saat jadwal dibuka). */
export async function extend(userIds: number[], until: string, q: DB = db()) {
  if (!userIds.length) return;
  const rows = await q
    .select()
    .from(userPatterns)
    .where(and(inArray(userPatterns.userId, userIds), or(isNull(userPatterns.endDate), isNull(userPatterns.filledUntil), gt(userPatterns.endDate, userPatterns.filledUntil))));
  for (const up of rows) {
    if (!up.filledUntil || up.filledUntil < minDay(up.endDate ?? until, until)) await materialize(up, until, undefined, q);
  }
}

/** Pola yang berlaku pada tanggal `on`, atau pola terdekat yang akan berlaku. */
export async function currentPattern(userId: number, on: string, q: DB = db()): Promise<UserPattern | null> {
  const rows = await q.select().from(userPatterns).where(eq(userPatterns.userId, userId)).orderBy(desc(userPatterns.startDate));
  for (const up of rows) if (up.startDate <= on && (!up.endDate || up.endDate >= on)) return up;
  const future = rows.filter((up) => up.startDate > on);
  return future.length ? future[future.length - 1] : null;
}

/**
 * Isi rentang `start`–`end` dengan urutan shift (diulang dari `start`) tanpa mengubah pola yang berjalan.
 * Pola yang belum dibuat sampai `end` diperpanjang dulu agar isian ini tidak tertimpa nanti. [diubah, dilewati].
 */
export async function fillRange(users: User[], sequence: (number | null)[], start: string, end: string, skipHolidays: boolean, q: DB): Promise<[number, number]> {
  if (start < today()) throw new HttpError(422, "Tanggal mulai tidak boleh sebelum hari ini.");
  if (end < start) throw new HttpError(422, "Tanggal akhir harus setelah tanggal mulai.");
  if (diffDays(end, start) > 366) throw new HttpError(422, "Rentang paling panjang 1 tahun. Untuk jadwal terus-menerus pilih Tanpa akhir.");
  if (!sequence.length) throw new HttpError(422, "Isi minimal satu hari pada pola.");
  const valid = new Set((await q.select({ id: shiftTypes.id }).from(shiftTypes).where(eq(shiftTypes.active, true))).map((r) => r.id));
  if (sequence.some((x) => x !== null && !valid.has(x))) throw new HttpError(422, "Pola memuat jenis shift yang tidak aktif.");
  const ids = users.map((u) => u.id);
  await extend(ids, end, q);
  const hol = skipHolidays ? await holidays(start, end, q) : new Map<string, string>();
  const locked = await protectedDates(ids, start, end, q);
  const n = sequence.length;
  let changed = 0,
    skipped = 0;
  for (const u of users)
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (locked.has(`${u.id}|${d}`)) {
        skipped++;
        continue;
      }
      const sid = hol.has(d) ? null : sequence[diffDays(d, start) % n];
      if (await runningLock(u.id, d, sid ?? null, undefined, q)) {
        skipped++; // shift hari ini yang sudah mulai
        continue;
      }
      if (await setCell(u.id, d, sid ?? null, q)) changed++;
    }
  return [changed, skipped];
}

/** Terapkan pola ke karyawan mulai `start`. Pola lama berakhir sehari sebelumnya; jadwal lama sejak `start` diganti. */
export async function assign(
  users: User[],
  name: string,
  patternId: number | null,
  sequence: (number | null)[],
  start: string,
  end: string | null,
  skipHolidays: boolean,
  actor: User,
  q: DB,
): Promise<[number, number]> {
  if (start < today()) throw new HttpError(422, "Tanggal mulai tidak boleh sebelum hari ini.");
  if (end !== null && end < start) throw new HttpError(422, "Tanggal akhir harus setelah tanggal mulai.");
  if (!sequence.length) throw new HttpError(422, "Isi minimal satu hari pada pola.");
  const valid = new Set((await q.select({ id: shiftTypes.id }).from(shiftTypes).where(eq(shiftTypes.active, true))).map((r) => r.id));
  if (sequence.some((x) => x !== null && !valid.has(x))) throw new HttpError(422, "Pola memuat jenis shift yang tidak aktif.");
  const late: string[] = [];
  for (const u of users) {
    const [last] = await q.select({ d: userPatterns.startDate }).from(userPatterns).where(eq(userPatterns.userId, u.id)).orderBy(desc(userPatterns.startDate)).limit(1);
    if (last && start <= last.d) late.push(`${u.name} (${fmtDMY(last.d)})`);
  }
  if (late.length)
    throw new HttpError(
      422,
      `Jadwal tanpa akhir harus mulai setelah tanggal efektif terakhir: ${late.join(", ")}. Untuk mengisi tanggal sebelumnya, pilih Berulang › Sampai tanggal.`,
    );
  // cakupan awal: sampai akhir bulan depan (atau tanggal akhir); sisanya diperpanjang saat dibuka
  let until = lastDayOfMonth(nextMonth(start));
  if (end !== null) until = minDay(until, end);
  const locked = await protectedDates(
    users.map((u) => u.id),
    start,
    until,
    q,
  );
  let changed = 0,
    skipped = 0;
  for (const u of users) {
    for (const prev of await q.select().from(userPatterns).where(eq(userPatterns.userId, u.id))) {
      if (!prev.endDate || prev.endDate >= start) {
        const oldUntil = prev.filledUntil;
        const set: Partial<UserPattern> = { endDate: addDays(start, -1) };
        if (oldUntil && oldUntil >= start) {
          // hapus sisa shift pola lama setelah cakupan pola baru
          for (let d = start; d <= oldUntil; d = addDays(d, 1)) if (!locked.has(`${u.id}|${d}`) && d > until) await setCell(u.id, d, null, q);
          set.filledUntil = addDays(start, -1);
        }
        await q.update(userPatterns).set(set).where(eq(userPatterns.id, prev.id));
      }
    }
    const [ins] = await q
      .insert(userPatterns)
      .values({ userId: u.id, patternId, name, sequence: [...sequence], startDate: start, endDate: end, skipHolidays, createdById: actor.id })
      .$returningId();
    const [up] = await q.select().from(userPatterns).where(eq(userPatterns.id, ins.id));
    const [c, s] = await materialize(up, until, locked, q);
    changed += c;
    skipped += s;
  }
  return [changed, skipped];
}
