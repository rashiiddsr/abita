/**
 * Benturan antar-catatan seorang karyawan pada tanggal yang sama: absensi, izin/sakit, tukar shift, dan shift yang
 * sudah dimulai. Satu tanggal hanya boleh punya satu keadaan (hadir, izin/sakit, atau ditukar), sehingga setiap
 * pengajuan diperiksa saat dibuat, saat diputuskan, dan saat absensi dikoreksi.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { fmtD } from "../core/time";
import { db, schema, type DB } from "../db";
import type { LeaveRequest } from "../db/schema";
import { runningLock } from "./scheduling";

const { attendances, leaveRequests } = schema;
const ACTIVE = ["pending", "approved"];

/** Tanggal (urut) dalam rentang [start, end] yang sudah punya check in. */
export async function attendedDays(userId: number, start: string, end: string, q: DB = db()): Promise<string[]> {
  const rows = await q
    .select({ d: attendances.workDate })
    .from(attendances)
    .where(and(eq(attendances.userId, userId), eq(attendances.type, "in"), gte(attendances.workDate, start), lte(attendances.workDate, end)));
  return [...new Set(rows.map((r) => r.d))].sort();
}

/** Pengajuan izin/sakit berstatus `statuses` yang mencakup tanggal `day`. */
export async function leaveOn(userId: number, day: string, statuses: string[] = ACTIVE, q: DB = db()): Promise<LeaveRequest | null> {
  const [r] = await q
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.userId, userId), inArray(leaveRequests.status, statuses), lte(leaveRequests.startDate, day), gte(leaveRequests.endDate, day)))
    .limit(1);
  return r ?? null;
}

const KIND = (k: string) => (k === "sakit" ? "sakit" : "izin");

/**
 * Alasan tukar shift tidak boleh dijalankan, atau null bila aman. Diperiksa per orang per tanggal yang berubah:
 * sudah absen, punya izin/sakit (menunggu/disetujui), atau shift hari ini sudah dimulai.
 */
export async function swapConflict(
  a: { id: number; name: string },
  b: { id: number; name: string },
  d1: string,
  d2: string,
  aType: number,
  bType: number,
  now: Date = new Date(),
  q: DB = db(),
): Promise<string | null> {
  // [orang, tanggal, jenis shift baru orang itu pada tanggal tersebut (null = shiftnya pindah ke rekan)]
  const cells: [typeof a, string, number | null][] =
    d1 === d2
      ? [
          [a, d1, bType],
          [b, d1, aType],
        ]
      : [
          [a, d1, null],
          [a, d2, bType],
          [b, d2, null],
          [b, d1, aType],
        ];
  for (const [u, day, newType] of cells) {
    if ((await attendedDays(u.id, day, day, q)).length) return `${u.name} sudah absen pada ${fmtD(day)}.`;
    const lv = await leaveOn(u.id, day, ACTIVE, q);
    if (lv) return `${u.name} punya pengajuan ${KIND(lv.kind)} pada ${fmtD(day)}.`;
    if (await runningLock(u.id, day, newType, now, q)) return `Shift ${u.name} pada ${fmtD(day)} sudah dimulai.`;
  }
  return null;
}
