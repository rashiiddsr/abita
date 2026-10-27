/** Logika domain bersama: notifikasi, status hari ini, rekap bulanan, aturan persetujuan, audit. */
import { and, count, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import { settings } from "../core/config";
import { bus } from "../core/events";
import { inScope, scopeUnits, setLedUnits } from "../core/auth";
import { HttpError, reqStore } from "../core/http";
import { getSetting } from "../core/settings";
import { addDays, maxDay, monthBounds, shiftWindow, today as todayFn } from "../core/time";
import { db, schema, type DB } from "../db";
import type { User } from "../db/schema";
import { pushNotifications } from "./push";
import { activeWorkDate, daysAround, windowsFor, type Assignment } from "./rules";

const { users, notifications, leaveRequests, swapRequests, attendances, shiftAssignments, units, unitHeads, auditLogs } = schema;

export const activeUser = () => or(isNull(users.isActive), eq(users.isActive, true))!;

// ------------------------------------------------------------------ notifikasi

/**
 * Notifikasi + event real-time + Web Push (akun karyawan) ke penerima: setelah permintaan selesai dengan sukses,
 * atau langsung bila dipanggil di luar permintaan (mis. cron).
 */
export async function notify(userId: number, kind: string, title: string, body = "", link: string | null = null, q: DB = db()) {
  const [{ id }] = await q.insert(notifications).values({ userId, kind, title: title.slice(0, 160), body, link }).$returningId();
  const store = reqStore.getStore();
  if (store) {
    store.notifyUids.add(userId);
    store.pushes.push(id);
  } else {
    bus.publish("notifications", null, userId);
    void pushNotifications([id]).catch(() => undefined);
  }
}

export async function unreadCount(userId: number): Promise<number> {
  const [r] = await db().select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function pendingCount(userId: number): Promise<number> {
  const [a] = await db().select({ n: count() }).from(leaveRequests).where(and(eq(leaveRequests.userId, userId), eq(leaveRequests.status, "pending")));
  const [b] = await db().select({ n: count() }).from(swapRequests).where(and(eq(swapRequests.userId, userId), eq(swapRequests.status, "pending")));
  // permintaan tukar dari rekan yang menunggu jawaban karyawan ini
  const [c] = await db()
    .select({ n: count() })
    .from(swapRequests)
    .where(and(eq(swapRequests.targetUserId, userId), eq(swapRequests.status, "pending"), eq(swapRequests.peerStatus, "pending")));
  return (a?.n ?? 0) + (b?.n ?? 0) + (c?.n ?? 0);
}

/** Syarat SQL "unit karyawan dalam jangkauan akun" (undefined = semua unit, Admin SDM). */
export function scopeCond(me: Pick<User, "role" | "unit">, col: typeof users.unit = users.unit) {
  const list = scopeUnits(me);
  if (list === null) return undefined;
  return list.length ? inArray(col, list) : eq(col, "__none__");
}

/** Admin SDM + semua Kepala Unit yang memimpin unit staff ini (unit_heads). */
export async function managersFor(staff: Pick<User, "unit">, q: DB = db()): Promise<User[]> {
  const rows = await q.select().from(users).where(and(activeUser(), inArray(users.role, ["admin", "unit_head"])));
  const heads = staff.unit ? new Set((await headsOfUnits([staff.unit], q)).map((h) => h.userId)) : new Set<number>();
  return rows.filter((m) => m.role === "admin" || (m.role === "unit_head" && heads.has(m.id)));
}

// Preferensi notifikasi dasbor Kepala Unit (Pengaturan › Notifikasi).
export const KU_NOTIF = { leave: true, swap: true, attendance: true, schedule: true };
export type KuPrefs = typeof KU_NOTIF;

export function kuPrefs(u: Pick<User, "notifPrefs">): KuPrefs {
  const saved = Object.fromEntries(Object.entries(u.notifPrefs ?? {}).filter(([k]) => k in KU_NOTIF).map(([k, v]) => [k, !!v]));
  return { ...KU_NOTIF, ...saved };
}

export const wants = (u: Pick<User, "role" | "notifPrefs">, kind: string) => u.role !== "unit_head" || (kuPrefs(u) as Record<string, boolean>)[kind] !== false;

/** Admin SDM (memantau semua unit) + Kepala Unit unit tersebut, sesuai preferensi Kepala Unit. */
export async function notifyManagers(staff: Pick<User, "unit">, kind: string, title: string, body = "", link: string | null = null, q: DB = db()) {
  for (const m of await managersFor(staff, q)) if (wants(m, kind)) await notify(m.id, kind, title, body, link, q);
}

export async function notifyRole(role: string, kind: string, title: string, body = "", link: string | null = null, q: DB = db()) {
  const rows = await q.select({ id: users.id }).from(users).where(and(eq(users.role, role), activeUser()));
  for (const r of rows) await notify(r.id, kind, title, body, link, q);
}

export async function audit(actor: Pick<User, "id"> | null, action: string, targetType: string, targetId: number | null, detail: Record<string, unknown> = {}, q: DB = db()) {
  await q.insert(auditLogs).values({ actorId: actor?.id ?? null, action, targetType, targetId, detail });
}

// ------------------------------------------------------------------ persetujuan

/** Pengajuan yang menunggu lebih lama dari batas eskalasi (Aturan persetujuan). */
export async function isEscalated(status: string, createdAt: Date | null): Promise<boolean> {
  if (status !== "pending" || !createdAt) return false;
  const hours = Number(await getSetting("escalation_hours")) || 0;
  return hours > 0 && Date.now() - createdAt.getTime() > hours * 3600_000;
}

/** Pengajuan diputuskan Kepala Unit dari unit staff (satu tahap). Admin SDM hanya memantau. */
export const canReview = (me: Pick<User, "role" | "unit">, staff: Pick<User, "unit">, status: string) => status === "pending" && me.role === "unit_head" && inScope(me, staff.unit);

export async function unitHasHead(unit: string | null): Promise<boolean> {
  if (!unit) return false;
  const [r] = await db()
    .select({ n: count() })
    .from(unitHeads)
    .innerJoin(units, eq(units.id, unitHeads.unitId))
    .innerJoin(users, eq(users.id, unitHeads.userId))
    .where(and(eq(units.name, unit), eq(users.role, "unit_head"), activeUser()));
  return (r?.n ?? 0) > 0;
}

// ------------------------------------------------------------------ Kepala Unit <-> unit (unit_heads)

const byPrimary = (names: string[], primary: string | null) => names.sort((a, b) => (a === primary ? -1 : b === primary ? 1 : a.localeCompare(b)));

/** Kepala Unit dari unit-unit ini (nama unit -> akun), urut nama. */
export async function headsOfUnits(names: string[] | null, q: DB = db()) {
  const rows = await q
    .select({ unit: units.name, unitId: units.id, userId: users.id, name: users.name, isActive: users.isActive })
    .from(unitHeads)
    .innerJoin(units, eq(units.id, unitHeads.unitId))
    .innerJoin(users, eq(users.id, unitHeads.userId))
    .where(names ? (names.length ? inArray(units.name, names) : eq(units.name, "__none__")) : undefined)
    .orderBy(users.name);
  return rows;
}

/** Unit yang dipimpin satu Kepala Unit, unit utama (User.unit) lebih dulu. */
export async function ledUnitsOf(u: Pick<User, "id" | "unit">, q: DB = db()): Promise<string[]> {
  const rows = await q.select({ name: units.name }).from(unitHeads).innerJoin(units, eq(units.id, unitHeads.unitId)).where(eq(unitHeads.userId, u.id));
  return byPrimary(
    rows.map((r) => r.name),
    u.unit,
  );
}

/** Muat unit yang dipimpin untuk setiap Kepala Unit di daftar (agar userOut().head_units lengkap). */
export async function withLedUnits<T extends User>(list: T[], q: DB = db()): Promise<T[]> {
  const heads = list.filter((u) => u.role === "unit_head");
  if (!heads.length) return list;
  const rows = await q
    .select({ name: units.name, head: unitHeads.userId })
    .from(unitHeads)
    .innerJoin(units, eq(units.id, unitHeads.unitId))
    .where(inArray(unitHeads.userId, heads.map((u) => u.id)));
  for (const u of heads) setLedUnits(u, byPrimary(rows.filter((r) => r.head === u.id).map((r) => r.name), u.unit));
  return list;
}

/**
 * Jaga unit_heads sinkron dengan akun Kepala Unit (boleh memimpin beberapa unit); unit utama = User.unit.
 * Satu unit boleh punya beberapa Kepala Unit (menambah kepala tidak melepas kepala lain).
 * `wanted`: daftar unit baru. Tanpa `wanted`: unit yang dipimpin tetap, kecuali User.unit berganti ke unit yang belum
 * dipimpinnya (dipindah). Akun yang bukan / tidak lagi Kepala Unit aktif dilepas dari semua unit.
 */
export async function syncUnitHead(user: User, wanted?: string[] | null, q: DB = db()) {
  const led = await ledUnitsOf(user, q);
  if (user.role !== "unit_head" || user.isActive === false) {
    if (led.length) await q.delete(unitHeads).where(eq(unitHeads.userId, user.id));
    return;
  }
  let target: string[];
  if (wanted) target = [...new Set(wanted.map((w) => w.trim()).filter(Boolean))]; // daftar eksplisit (kosong = lepas semua unit)
  else if (!user.unit) target = led;
  else target = led.includes(user.unit) ? [user.unit, ...led.filter((n) => n !== user.unit)] : [user.unit];

  const drop = led.filter((n) => !target.includes(n));
  if (drop.length) {
    const ids = (await q.select({ id: units.id }).from(units).where(inArray(units.name, drop))).map((r) => r.id);
    if (ids.length) await q.delete(unitHeads).where(and(eq(unitHeads.userId, user.id), inArray(unitHeads.unitId, ids)));
  }
  for (const name of target) {
    if (led.includes(name)) continue;
    let [un] = await q.select().from(units).where(eq(units.name, name));
    if (!un) {
      const [ins] = await q.insert(units).values({ name }).$returningId();
      [un] = await q.select().from(units).where(eq(units.id, ins.id));
    }
    await q.insert(unitHeads).values({ unitId: un.id, userId: user.id });
  }
  const primary = target[0] ?? null;
  if (user.unit !== primary) {
    await q.update(users).set({ unit: primary }).where(eq(users.id, user.id));
    user.unit = primary;
  }
  setLedUnits(user, target);
}

/** Unit utama (User.unit) Kepala Unit tetap salah satu unit yang masih dipimpinnya, atau kosong. */
export async function refreshPrimaryUnit(userId: number, q: DB = db()) {
  const [u] = await q.select().from(users).where(eq(users.id, userId));
  if (!u || u.role !== "unit_head") return;
  const left = await ledUnitsOf(u, q);
  if (!u.unit || !left.includes(u.unit)) await q.update(users).set({ unit: left[0] ?? null }).where(eq(users.id, userId));
}

export function appUrl(origin: string | null | undefined): string {
  if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, "");
  return settings.PUBLIC_APP_URL.replace(/\/+$/, "");
}

// ------------------------------------------------------------------ status hari ini & rekap

export async function approvedLeaveOn(userId: number, day: string, q: DB = db()) {
  const [r] = await q
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.userId, userId), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, day), gte(leaveRequests.endDate, day)));
  return r ?? null;
}

export function shiftToday(a: Assignment | null) {
  if (!a) return null;
  const [s, e] = shiftWindow(a.date, a.shiftType.startTime, a.shiftType.endTime);
  const t = a.shiftType;
  return { shift: { id: t.id, name: t.name, start_time: t.startTime, end_time: t.endTime, color: t.color, active: t.active }, start: s, end: e };
}

export async function todayStatus(user: User, at: Date = new Date()) {
  // shift yang sedang berjalan / bisa check in (shift malam: tanggal mulainya), selain itu hari ini
  const days = await daysAround(user.id, at);
  const wd = await activeWorkDate(user, at, undefined, days);
  const { a, recs } = days.get(wd) ?? { a: null, recs: {} };
  const leave = await approvedLeaveOn(user.id, wd);
  const w = a ? await windowsFor(a) : null;
  return {
    work_date: wd,
    check_in: recs.in?.checkedAt ?? null,
    check_out: recs.out?.checkedAt ?? null,
    late_minutes: recs.in?.lateMinutes ?? null,
    shift: shiftToday(a),
    leave: leave?.kind ?? null,
    window: w ? { in_open: w.inOpen, in_close: w.inClose, out_open: w.outOpen, out_close: w.outClose } : null,
  };
}

export async function monthSummary(userId: number, month: string | null, todayDay: string = todayFn()) {
  const [start, end] = monthBounds(month);
  const upto = end < addDays(todayDay, 1) ? end : addDays(todayDay, 1); // hari ini ikut dihitung
  const att = await db()
    .select()
    .from(attendances)
    .where(and(eq(attendances.userId, userId), gte(attendances.workDate, start), lt(attendances.workDate, end)));
  const ins = new Map(att.filter((a) => a.type === "in").map((a) => [a.workDate, a]));
  const scheduled = new Set(
    (
      await db()
        .select({ d: shiftAssignments.date })
        .from(shiftAssignments)
        .where(and(eq(shiftAssignments.userId, userId), gte(shiftAssignments.date, start), lt(shiftAssignments.date, upto)))
    ).map((r) => r.d),
  );
  const leaves = await db()
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.userId, userId), eq(leaveRequests.status, "approved"), lt(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)));
  const leaveDay = new Map<string, string>();
  for (const lv of leaves) for (let d = maxDay(lv.startDate, start); d <= lv.endDate && d < end; d = addDays(d, 1)) leaveDay.set(d, lv.kind);
  const insV = [...ins.values()];
  const onTime = insV.filter((a) => a.lateMinutes === 0).length;
  const late = insV.filter((a) => (a.lateMinutes ?? 0) > 0).length;
  const izin = [...leaveDay].filter(([d, k]) => k === "izin" && d < upto && !ins.has(d)).length;
  const sakit = [...leaveDay].filter(([d, k]) => k === "sakit" && d < upto && !ins.has(d)).length;
  // alpa: hari berjadwal yang sudah lewat (bukan hari ini), tanpa absen & tanpa izin/sakit
  const absent = [...scheduled].filter((d) => d < todayDay && !ins.has(d) && !leaveDay.has(d)).length;
  const rated = onTime + late;
  return {
    month: start.slice(0, 7),
    scheduled_days: scheduled.size,
    present: ins.size,
    on_time: onTime,
    late,
    izin,
    sakit,
    absent,
    punctuality_pct: rated ? Math.round((1000 * onTime) / rated) / 10 : null,
  };
}
