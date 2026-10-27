/**
 * Lupa check out:
 * - 30 menit setelah shift selesai (jendela check out masih buka): karyawan diingatkan sekali.
 * - Jendela check out tutup tanpa check out: hari itu berstatus "tanpa_pulang"; karyawan diberi tahu untuk minta
 *   koreksi dan Kepala Unit unitnya (sesuai preferensi notifikasi) diberi tahu sekali. Admin SDM melihatnya di dasbor. Tidak ada check out otomatis:
 *   jam pulang hanya diisi lewat Koreksi absensi oleh Kepala Unit (tercatat & beralasan).
 * Dijalankan cron tiap 5 menit (modules/checkout-reminder.job.ts); hanya melihat shift kemarin & hari ini.
 */
import { and, eq, inArray } from "drizzle-orm";
import { addDays, fmtD, localHm, workDateOf } from "../core/time";
import { db, schema } from "../db";
import { activeUser, managersFor, notify, wants } from "./services";
import { shiftFor, windowMinutes, windowsOf } from "./rules";

const { attendances, notifications, users } = schema;
const REMIND_AFTER_END_MIN = 30;

async function sentBefore(userId: number, title: string) {
  const [r] = await db()
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.title, title)))
    .limit(1);
  return !!r;
}

/** Jumlah [pengingat, pemberitahuan tanpa check out] yang dikirim. */
export async function remindCheckouts(now: Date = new Date()): Promise<[number, number]> {
  const t = workDateOf(now);
  const days = [addDays(t, -1), t];
  const rows = await db()
    .select({ a: attendances, u: users })
    .from(attendances)
    .innerJoin(users, eq(users.id, attendances.userId))
    .where(and(inArray(attendances.workDate, days), eq(users.role, "staff"), activeUser()));
  const done = new Set(rows.filter((r) => r.a.type === "out").map((r) => `${r.a.userId}|${r.a.workDate}`));
  const m = await windowMinutes();
  let reminded = 0,
    missed = 0;
  for (const { a, u } of rows) {
    if (a.type !== "in" || done.has(`${a.userId}|${a.workDate}`)) continue;
    const s = await shiftFor(a.userId, a.workDate);
    if (!s) continue;
    const w = windowsOf(a.workDate, s.shiftType.startTime, s.shiftType.endTime, m);
    const day = fmtD(a.workDate);
    if (now > w.outClose) {
      const title = `Absen pulang ${day} tidak tercatat`;
      if (await sentBefore(u.id, title)) continue;
      await notify(u.id, "attendance", title, `Batas check out pukul ${localHm(w.outClose)} sudah lewat. Minta Kepala Unit mengoreksi jam pulang Anda.`, "/notifications");
      // hanya Kepala Unit dari unit karyawan (yang bisa mengoreksi), sesuai preferensi notifikasinya
      for (const head of await managersFor(u))
        if (head.role === "unit_head" && wants(head, "attendance"))
          await notify(head.id, "attendance", `${u.name} tidak absen pulang`, `${day} · shift ${s.shiftType.name} ${localHm(w.start)}–${localHm(w.end)} · periksa & koreksi bila perlu`, `/attendance?detail=${u.id}&date=${a.workDate}`);
      missed++;
    } else if (now.getTime() >= w.end.getTime() + REMIND_AFTER_END_MIN * 60_000) {
      const title = `Belum absen pulang · ${day}`;
      if (await sentBefore(u.id, title)) continue;
      await notify(u.id, "attendance", title, `Shift ${s.shiftType.name} selesai ${localHm(w.end)}. Batas check out pukul ${localHm(w.outClose)}.`, "/attendance");
      reminded++;
    }
  }
  return [reminded, missed];
}
