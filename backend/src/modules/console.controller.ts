/** Dasbor admin: ringkasan, absensi harian & rentang, karyawan, unit, pengaturan, SMTP. */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, min, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AppSettings,
  AttendanceCorrectIn,
  DailyDetail,
  DailyRow,
  Dashboard,
  DayAgg,
  Message,
  RangeSummary,
  SettingsIn,
  SmtpConfig,
  SmtpIn,
  SmtpTestIn,
  StaffDay,
  StaffDetail,
  StaffRow,
  UnitIn,
  UnitOut,
  zDay,
} from "../shared";
import { ensureScope, scopeUnits } from "../core/auth";
import { HttpError } from "../core/http";
import { allSettings, putSettings } from "../core/settings";
import { addDays, combine, diffDays, fmtD, hms, maxDay, minDay, monthBounds, startOfDay, today } from "../core/time";
import { leaveOn } from "../domain/conflicts";
import { db, schema } from "../db";
import type { User } from "../db/schema";
import { mail, MailError, smtpConfig } from "../domain/mailer";
import { leavesOut, officeOut, swapsOut, userOut } from "../domain/out";
import {
  aggregateDays,
  attemptNote,
  attemptScore,
  buildRows,
  effectiveUnit,
  emptyRow,
  failedAttempts,
  hhmm,
  isLate,
  loadRange,
  NO_UNIT,
  staffDays,
  staffIn,
  statusOf,
  key,
  PRESENT,
} from "../domain/presence";
import { lateMinutes, msg, shiftFor, todayRecords } from "../domain/rules";
import { activeUser, audit, headsOfUnits, isEscalated, monthSummary, notify, refreshPrimaryUnit } from "../domain/services";
import { IdPipe, Me, Roles } from "../common/nest";
import { Returns } from "../common/swagger";
import { EMAIL_RE } from "./auth.controller";
import { defaultOffice, getUser } from "./admin.controller";

const { users, units, unitHeads, attendances, attempts, auditLogs, leaveRequests, swapRequests, shiftAssignments, offices, appSettings } = schema;
const MAX_RANGE_DAYS = 366;

const publicSettings = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith("smtp_"))); // rahasia SMTP tidak pernah ke browser

function monthOrThrow(month: string | undefined) {
  if (month && !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(422, "Format bulan harus YYYY-MM.");
  return monthBounds(month);
}

async function smtpOut() {
  const c = await smtpConfig();
  return { host: c.host || "", port: c.port || 587, encryption: c.encryption || "tls", username: c.username || "", has_password: !!c.password, sender: c.sender || "" };
}

/** Unit yang hanya tercatat di profil staff dibuatkan barisnya. */
async function syncUnits() {
  const have = new Set((await db().select({ n: units.name }).from(units)).map((r) => r.n));
  const names = await db()
    .selectDistinct({ u: users.unit })
    .from(users)
    .where(and(isNotNull(users.unit), inArray(users.role, ["staff", "unit_head"])));
  for (const { u } of names) {
    if (u && !have.has(u)) {
      await db().insert(units).values({ name: u });
      have.add(u);
    }
  }
}

async function unitOut(un: typeof units.$inferSelect) {
  const [{ n }] = await db()
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.unit, un.name), eq(users.role, "staff"), activeUser()));
  const heads = (await headsOfUnits([un.name])).map((h) => ({ id: h.userId, name: h.name }));
  return { id: un.id, name: un.name, heads, head_name: heads.map((h) => h.name).join(", ") || null, staff_count: n };
}

/**
 * Tetapkan daftar Kepala Unit sebuah unit (boleh lebih dari satu). Kepala lain tidak terpengaruh.
 */
async function setUnitHeads(un: typeof units.$inferSelect, headIds: number[]) {
  const want = [...new Set(headIds)];
  const cur = (await db().select({ userId: unitHeads.userId }).from(unitHeads).where(eq(unitHeads.unitId, un.id))).map((r) => r.userId);
  await checkNewHeads(want.filter((x) => !cur.includes(x)));
  const drop = cur.filter((x) => !want.includes(x));
  if (drop.length)
    await db()
      .delete(unitHeads)
      .where(and(eq(unitHeads.unitId, un.id), inArray(unitHeads.userId, drop)));
  const add = want.filter((x) => !cur.includes(x));
  if (add.length)
    await db()
      .insert(unitHeads)
      .values(add.map((userId) => ({ unitId: un.id, userId })));
  for (const id of [...drop, ...add]) await refreshPrimaryUnit(id); // unit utama kepala ikut menyesuaikan
}

/** Calon Kepala Unit baru sebuah unit: harus akun Kepala Unit yang aktif. */
async function checkNewHeads(ids: number[]) {
  for (const id of ids) {
    const h = await getUser(id);
    if (!h || h.role !== "unit_head") throw new HttpError(422, "Kepala Unit harus akun dengan peran Kepala Unit.");
    if (h.isActive === false) throw new HttpError(422, `${h.name} tidak aktif.`);
  }
}

@ApiTags("Admin · Dasbor, unit & pengaturan")
@Controller("admin")
@Roles("manager")
export class ConsoleController {
  // ============================================================ absensi harian

  @Get("daily")
  @Returns(DailyRow, { list: true })
  @Roles("monitor")
  async daily(@Query("date") date: string | undefined, @Query("unit") unit: string | undefined, @Me() me: User) {
    if (date && !zDay.safeParse(date).success) throw new HttpError(422, "Format tanggal harus YYYY-MM-DD.");
    return buildRows(await staffIn(effectiveUnit(me, unit)), date ?? today(), today());
  }

  @Get("daily/history")
  @Returns(DayAgg, { list: true })
  @Roles("monitor")
  async history(@Query("days") daysQ: string | undefined, @Query("unit") unit: string | undefined, @Me() me: User) {
    const days = Number(daysQ ?? 14);
    if (!Number.isInteger(days) || days < 1 || days > 62) throw new HttpError(422, "days harus 1–62.");
    const end = today();
    return (await aggregateDays(await staffIn(effectiveUnit(me, unit)), addDays(end, -(days - 1)), end, end)).reverse();
  }

  /**
   * Koreksi absensi (Kepala Unit dari unit karyawan): ubah / isi jam check in & check out satu tanggal, dengan alasan.
   * Tercatat sebagai "manual", masuk riwayat (audit) dan karyawan diberi tahu. Paling lama 62 hari ke belakang.
   */
  @Post("attendance/correct")
  @Returns(DailyDetail)
  @Roles("head")
  @HttpCode(200)
  async correctAttendance(@Body({ schema: AttendanceCorrectIn }) body: z.output<typeof AttendanceCorrectIn>, @Me() me: User) {
    const u = ensureScope(me, await getUser(body.user_id));
    if (u.role !== "staff") throw new HttpError(422, "Koreksi hanya untuk absensi karyawan.");
    const d = body.date;
    const t = today();
    if (d > t) throw new HttpError(422, "Tanggal ini belum terjadi.");
    if (diffDays(t, d) > 62) throw new HttpError(422, "Koreksi paling lama 62 hari ke belakang.");
    const lv = await leaveOn(u.id, d, ["approved"]);
    if (lv) throw new HttpError(409, `${u.name} tercatat ${lv.kind} (disetujui) pada ${fmtD(d)}; absensi tidak bisa dikoreksi untuk tanggal itu.`);
    const recs = await todayRecords(u.id, d);
    const at = (hm: string, day = d) => combine(day, hms(hm));
    const inAt = body.check_in ? at(body.check_in) : (recs.in?.checkedAt ?? null);
    let outAt = body.check_out ? at(body.check_out) : (recs.out?.checkedAt ?? null);
    if (body.check_out && inAt && outAt && outAt <= inAt) outAt = at(body.check_out, addDays(d, 1)); // pulang lewat tengah malam
    if (outAt && !inAt) throw new HttpError(422, "Isi jam check in terlebih dahulu.");
    if (inAt && outAt && outAt <= inAt) throw new HttpError(422, "Jam check out harus setelah check in.");
    if (inAt && outAt && outAt.getTime() - inAt.getTime() > 24 * 3600_000) throw new HttpError(422, "Check out lebih dari 24 jam setelah check in.");
    const now = new Date();
    if ((inAt && inAt > now) || (outAt && outAt > now)) throw new HttpError(422, "Jam koreksi belum terjadi.");

    const shift = await shiftFor(u.id, d);
    const reason = body.reason.trim();
    const changes: string[] = [];
    for (const [type, when] of [
      ["in", body.check_in ? inAt : null],
      ["out", body.check_out ? outAt : null],
    ] as const) {
      if (!when) continue;
      const cur = recs[type];
      const before = cur ? hhmm(cur.checkedAt) : null;
      const after = hhmm(when)!;
      if (cur && cur.checkedAt.getTime() === when.getTime() && cur.source === "manual") continue; // tidak berubah
      const set = {
        checkedAt: when,
        source: "manual",
        correctedById: me.id,
        correctionReason: reason,
        correctedAt: now,
        shiftTypeId: shift?.shiftTypeId ?? cur?.shiftTypeId ?? null,
        lateMinutes: type === "in" ? await lateMinutes(when, shift) : null,
      };
      if (cur) await db().update(attendances).set(set).where(eq(attendances.id, cur.id));
      else
        await db()
          .insert(attendances)
          .values({ userId: u.id, workDate: d, type, ...set });
      await audit(me, "attendance_correct", "attendance", u.id, { date: d, type, before, after, reason });
      changes.push(`${type === "in" ? "check in" : "check out"} ${before ? `${before} → ` : ""}${after}`);
    }
    if (changes.length) await notify(u.id, "attendance", `Absensi ${fmtD(d)} dikoreksi`, `${changes.join(", ")} oleh ${me.name}. Alasan: ${reason}`);
    return this.dailyDetail(u.id, d, me);
  }

  @Get("daily/:id")
  @Returns(DailyDetail)
  @Roles("monitor")
  async dailyDetail(@Param("id", IdPipe) id: number, @Query("date") date: string | undefined, @Me() me: User) {
    const u = ensureScope(me, await getUser(id));
    const d = date ?? today();
    if (!zDay.safeParse(d).success) throw new HttpError(422, "Format tanggal harus YYYY-MM-DD.");
    const rows = await buildRows([u], d, today());
    const row = rows[0] ?? emptyRow(u);
    const recs = await db()
      .select()
      .from(attendances)
      .where(and(eq(attendances.userId, u.id), eq(attendances.workDate, d)))
      .orderBy(asc(attendances.checkedAt));
    const atts = await db()
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, u.id), gte(attempts.createdAt, startOfDay(d)), lt(attempts.createdAt, startOfDay(addDays(d, 1)))))
      .orderBy(desc(attempts.createdAt));
    const logs = await db()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, "attendance"), eq(auditLogs.targetId, u.id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50);
    const [office] = u.officeId ? await db().select().from(offices).where(eq(offices.id, u.officeId)) : [await defaultOffice()];
    const people = new Map<number, string>();
    for (const pid of [...recs.map((r) => r.correctedById), ...logs.map((l) => l.actorId)]) if (pid && !people.has(pid)) people.set(pid, (await getUser(pid))?.name ?? "");
    return {
      row,
      date: d,
      records: recs.map((r) => ({
        id: r.id,
        type: r.type,
        time: hhmm(r.checkedAt),
        checked_at: r.checkedAt,
        lat: r.lat,
        lng: r.lng,
        accuracy: r.accuracy,
        distance_m: r.distanceM,
        match_score: r.matchScore,
        has_photo: !!r.photoPath,
        late_minutes: r.lateMinutes,
        manual: r.source === "manual",
        correction_reason: r.correctionReason,
        corrected_by: r.correctedById ? (people.get(r.correctedById) ?? null) : null,
      })),
      attempts: atts.map((a) => ({
        time: hhmm(a.createdAt),
        purpose: a.purpose,
        success: a.success,
        reason_code: a.reasonCode,
        message: a.success ? "Berhasil" : msg(a.reasonCode),
        distance_m: a.distanceM,
        match_score: attemptScore(a),
      })),
      logs: logs.filter((l) => (l.detail ?? {}).date === d).map((l) => ({ at: l.createdAt, actor: l.actorId ? (people.get(l.actorId) ?? null) : null, action: l.action, detail: l.detail })),
      office: office ? officeOut(office) : null,
    };
  }

  // ============================================================ ringkasan

  @Get("dashboard")
  @Returns(Dashboard)
  async dashboard(@Query("unit") unit: string | undefined, @Me() me: User) {
    const scope = effectiveUnit(me, unit);
    const staff = await staffIn(scope);
    const d = today();
    const rows = await buildRows(staff, d, d);
    const c: Record<string, number> = {};
    const byUnit = new Map<string, Record<string, number>>();
    const bump = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
    for (const r of rows) {
      bump(c, r.status);
      const name = r.unit || NO_UNIT;
      const bu = byUnit.get(name) ?? {};
      byUnit.set(name, bu);
      bump(bu, "total");
      bump(bu, ({ selesai: "hadir", gagal: "belum", alpa: "belum" } as Record<string, string>)[r.status] ?? r.status);
      if (r.status === "telat") bump(bu, "hadir");
    }
    const staffCount = new Map<string, number>();
    for (const u of staff) {
      const n = u.unit || NO_UNIT;
      if (!byUnit.has(n)) byUnit.set(n, {});
      staffCount.set(n, (staffCount.get(n) ?? 0) + 1);
    }
    const leaveConds = [eq(leaveRequests.status, "pending")];
    const swapConds = [eq(swapRequests.status, "pending")];
    if (scope) {
      leaveConds.push(inArray(users.unit, scope));
      swapConds.push(inArray(users.unit, scope));
    }
    const pend = (
      await db()
        .select({ l: leaveRequests })
        .from(leaveRequests)
        .innerJoin(users, eq(users.id, leaveRequests.userId))
        .where(and(...leaveConds))
        .orderBy(asc(leaveRequests.createdAt))
    ).map((r) => r.l);
    const [{ n: pendingSwaps }] = await db()
      .select({ n: count() })
      .from(swapRequests)
      .innerJoin(users, eq(users.id, swapRequests.userId))
      .where(and(...swapConds));
    const heads = new Map<string, string | null>();
    for (const h of await headsOfUnits(null)) heads.set(h.unit, heads.get(h.unit) ? `${heads.get(h.unit)}, ${h.name}` : h.name);
    const unitsOut = [...byUnit]
      .sort((a, b) => (staffCount.get(b[0]) ?? 0) - (staffCount.get(a[0]) ?? 0))
      .map(([name, v]) => ({
        name,
        head: heads.get(name) ?? null,
        total: staffCount.get(name) ?? 0,
        hadir: v.hadir ?? 0,
        telat: v.telat ?? 0,
        belum: v.belum ?? 0,
        izin: v.izin ?? 0,
        sakit: v.sakit ?? 0,
      }));
    // aktivitas terbaru hari ini
    const ids = staff.map((u) => u.id);
    const byId = new Map(staff.map((u) => [u.id, u]));
    const feed: { name: string; unit: string | null; shift: string | null; act: string; time: string | null; at: Date; kind: string; location_ok: boolean | null; face_ok: boolean | null }[] = [];
    if (ids.length) {
      const shiftsToday = (await loadRange(staff, d, d)).shifts;
      const s = startOfDay(d),
        e = startOfDay(addDays(d, 1));
      for (const a of await db()
        .select()
        .from(attendances)
        .where(and(inArray(attendances.userId, ids), gte(attendances.checkedAt, s), lt(attendances.checkedAt, e)))
        .orderBy(desc(attendances.checkedAt))
        .limit(12)) {
        const u = byId.get(a.userId)!;
        feed.push({
          name: u.name,
          unit: u.unit,
          shift: shiftsToday.get(key(u.id, a.workDate))?.type.name ?? null,
          act: a.type === "in" ? "check in" : "check out",
          time: hhmm(a.checkedAt),
          at: a.checkedAt,
          kind: a.type,
          location_ok: true,
          face_ok: a.source !== "manual",
        });
      }
      for (const a of (await failedAttempts(ids, d)).values()) {
        const u = byId.get(a.userId)!;
        const [loc, face] = attemptNote(a);
        feed.push({ name: u.name, unit: u.unit, shift: null, act: "gagal verifikasi", time: hhmm(a.createdAt), at: a.createdAt, kind: "fail", location_ok: loc === null, face_ok: face === null });
      }
      for (const lv of await db()
        .select()
        .from(leaveRequests)
        .where(and(inArray(leaveRequests.userId, ids), gte(leaveRequests.createdAt, s), lt(leaveRequests.createdAt, e)))) {
        const u = byId.get(lv.userId)!;
        feed.push({
          name: u.name,
          unit: u.unit,
          shift: null,
          act: `mengajukan ${lv.kind.charAt(0).toUpperCase()}${lv.kind.slice(1)}`,
          time: hhmm(lv.createdAt),
          at: lv.createdAt,
          kind: "leave",
          location_ok: null,
          face_ok: null,
        });
      }
    }
    feed.sort((a, b) => b.at.getTime() - a.at.getTime());
    let escalated = 0;
    for (const lv of pend) if (await isEscalated(lv.status, lv.createdAt)) escalated++;
    return {
      date: d,
      totals: {
        staff: staff.length,
        scheduled: rows.length,
        hadir: (c.hadir ?? 0) + (c.telat ?? 0) + (c.selesai ?? 0),
        telat: c.telat ?? 0,
        belum: c.belum ?? 0,
        izin: c.izin ?? 0,
        sakit: c.sakit ?? 0,
        selesai: c.selesai ?? 0,
        gagal: c.gagal ?? 0,
        pending: pend.length + pendingSwaps,
        escalated,
        no_face: staff.filter((u) => !u.faceEmbedding).length,
      },
      units: unitsOut,
      trend: await aggregateDays(staff, addDays(d, -13), d, d),
      feed: feed.slice(0, 8),
      pending: await leavesOut(pend.slice(0, 5), true),
    };
  }

  // ============================================================ karyawan

  /** Daftar karyawan (staff) + rekap bulan ini, termasuk yang nonaktif. */
  @Get("staff")
  @Returns(StaffRow, { list: true })
  async staff(@Query("unit") unit: string | undefined, @Query("month") month: string | undefined, @Me() me: User) {
    const list = await staffIn(effectiveUnit(me, unit), false);
    const [start, end] = monthOrThrow(month);
    const nowDay = today();
    const last = minDay(addDays(end, -1), nowDay);
    const data = await loadRange(list, start, last);
    return list.map((u) => {
      const c = { hadir: 0, telat: 0, izin: 0, sakit: 0, alpa: 0 };
      for (let d = start; d <= last; d = addDays(d, 1)) {
        const st = statusOf(data, u.id, d, nowDay);
        if (PRESENT.has(st)) {
          c.hadir++;
          if (isLate(data, u.id, d)) c.telat++;
        } else if (st === "izin" || st === "sakit" || st === "alpa") c[st]++;
      }
      return { user: userOut(u), status: u.isActive === false ? "nonaktif" : "aktif", ...c };
    });
  }

  @Get("staff/:id")
  @Returns(StaffDetail)
  async staffDetail(@Param("id", IdPipe) id: number, @Query("month") month: string | undefined, @Me() me: User) {
    const u = ensureScope(me, await getUser(id));
    const [start, end] = monthOrThrow(month);
    const nowDay = today();
    const last = minDay(addDays(end, -1), nowDay);
    const data = await loadRange([u], start, last);
    const leaves = await db().select().from(leaveRequests).where(eq(leaveRequests.userId, u.id)).orderBy(desc(leaveRequests.createdAt)).limit(50);
    const swaps = await db().select().from(swapRequests).where(eq(swapRequests.userId, u.id)).orderBy(desc(swapRequests.createdAt)).limit(50);
    const [ls] = await db()
      .select({ s: attendances.matchScore })
      .from(attendances)
      .where(and(eq(attendances.userId, u.id), isNotNull(attendances.matchScore)))
      .orderBy(desc(attendances.checkedAt))
      .limit(1);
    return {
      user: userOut(u),
      status: u.isActive === false ? "nonaktif" : "aktif",
      summary: await monthSummary(u.id, month ?? null),
      days: last >= start ? staffDays(data, u.id, start, last, nowDay) : [],
      leaves: await leavesOut(leaves, true),
      swaps: await swapsOut(swaps, { withUser: true }),
      last_score: ls?.s ?? null,
    };
  }

  // ============================================================ unit & kepala unit

  @Get("units")
  @Returns(UnitOut, { list: true })
  async units(@Me() me: User) {
    await syncUnits();
    const own = scopeUnits(me);
    const rows = await db()
      .select()
      .from(units)
      .where(own !== null ? inArray(units.name, own.length ? own : ["__none__"]) : undefined)
      .orderBy(asc(units.name));
    return Promise.all(rows.map(unitOut));
  }

  @Post("units")
  @Returns(UnitOut, { status: 201 })
  @Roles("hr")
  async createUnit(@Body({ schema: UnitIn }) body: z.output<typeof UnitIn>, @Me() me: User) {
    const name = body.name.trim();
    if (!body.head_user_ids.length) throw new HttpError(422, "Pilih minimal satu Kepala Unit untuk unit baru.");
    await checkNewHeads([...new Set(body.head_user_ids)]); // sebelum unit dibuat, agar tidak ada unit setengah jadi
    if (
      (
        await db()
          .select({ id: units.id })
          .from(units)
          .where(sql`lower(${units.name}) = ${name.toLowerCase()}`)
      ).length
    )
      throw new HttpError(409, "Unit dengan nama ini sudah ada.");
    const [{ id }] = await db().insert(units).values({ name }).$returningId();
    let [un] = await db().select().from(units).where(eq(units.id, id));
    await setUnitHeads(un, body.head_user_ids);
    await audit(me, "unit_create", "unit", id, { name, heads: body.head_user_ids });
    [un] = await db().select().from(units).where(eq(units.id, id));
    return unitOut(un);
  }

  @Put("units/:id")
  @Returns(UnitOut)
  @Roles("hr")
  async updateUnit(@Param("id", IdPipe) id: number, @Body({ schema: UnitIn }) body: z.output<typeof UnitIn>, @Me() me: User) {
    let [un] = await db().select().from(units).where(eq(units.id, id));
    if (!un) throw new HttpError(404, "Unit tidak ditemukan.");
    const name = body.name.trim();
    if (name !== un.name) {
      if (
        (
          await db()
            .select({ id: units.id })
            .from(units)
            .where(and(sql`lower(${units.name}) = ${name.toLowerCase()}`, ne(units.id, id)))
        ).length
      )
        throw new HttpError(409, "Unit dengan nama ini sudah ada.");
      await db().update(users).set({ unit: name }).where(eq(users.unit, un.name)); // ikut ganti nama di profil
      await db().update(units).set({ name }).where(eq(units.id, id));
      un = { ...un, name };
    }
    await setUnitHeads(un, body.head_user_ids);
    await audit(me, "unit_update", "unit", id, { name, heads: body.head_user_ids });
    [un] = await db().select().from(units).where(eq(units.id, id));
    return unitOut(un);
  }

  @Delete("units/:id")
  @Roles("hr")
  @HttpCode(204)
  async deleteUnit(@Param("id", IdPipe) id: number, @Me() me: User) {
    const [un] = await db().select().from(units).where(eq(units.id, id));
    if (!un) throw new HttpError(404, "Unit tidak ditemukan.");
    const [{ n }] = await db()
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.unit, un.name), eq(users.role, "staff")));
    if (n) throw new HttpError(409, "Unit masih punya karyawan. Pindahkan karyawan terlebih dahulu.");
    await audit(me, "unit_delete", "unit", id, { name: un.name });
    const heads = (await db().select({ userId: unitHeads.userId }).from(unitHeads).where(eq(unitHeads.unitId, id))).map((r) => r.userId);
    await db().delete(unitHeads).where(eq(unitHeads.unitId, id));
    await db().delete(units).where(eq(units.id, id));
    for (const h of heads) await refreshPrimaryUnit(h);
  }

  // ============================================================ pengaturan

  @Get("settings")
  @Returns(AppSettings)
  async settings() {
    return publicSettings(await allSettings());
  }

  @Put("settings")
  @Returns(AppSettings)
  @Roles("hr")
  async putSettings(@Body({ schema: SettingsIn }) body: z.output<typeof SettingsIn>, @Me() me: User) {
    if (body.helpdesk_email != null) {
      body.helpdesk_email = body.helpdesk_email.trim().toLowerCase();
      if (body.helpdesk_email && !EMAIL_RE.test(body.helpdesk_email)) throw new HttpError(422, "Email bantuan tidak valid.");
    }
    if (body.helpdesk_whatsapp != null) {
      let d = body.helpdesk_whatsapp.replace(/\D/g, "");
      d = d.startsWith("0") ? "62" + d.slice(1) : d.startsWith("8") ? "62" + d : d;
      if (d && !(d.startsWith("62") && d.length >= 10 && d.length <= 15)) throw new HttpError(422, "Nomor WhatsApp bantuan tidak valid. Contoh: 081234567890.");
      body.helpdesk_whatsapp = d;
    }
    const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null && v !== undefined));
    const vals = await putSettings(clean);
    await audit(me, "settings_update", "settings", null, clean);
    return publicSettings(vals);
  }

  @Get("smtp")
  @Returns(SmtpConfig)
  @Roles("hr")
  smtp() {
    return smtpOut();
  }

  @Put("smtp")
  @Returns(SmtpConfig)
  @Roles("hr")
  async putSmtp(@Body({ schema: SmtpIn }) body: z.output<typeof SmtpIn>, @Me() me: User) {
    const vals: Record<string, unknown> = {
      smtp_host: body.host.trim(),
      smtp_port: body.port,
      smtp_encryption: body.encryption,
      smtp_username: body.username.trim(),
      smtp_sender: body.sender.trim(),
    };
    if (body.password != null) vals.smtp_password = body.password;
    // string kosong tetap disimpan agar bisa dikosongkan
    for (const [k, v] of Object.entries(vals)) {
      const [row] = await db().select({ k: appSettings.key }).from(appSettings).where(eq(appSettings.key, k));
      if (row) await db().update(appSettings).set({ value: { v }, updatedAt: new Date() }).where(eq(appSettings.key, k));
      else await db().insert(appSettings).values({ key: k, value: { v } });
    }
    await putSettings({}); // segarkan cache
    await audit(me, "smtp_update", "settings", null, Object.fromEntries(Object.entries(vals).filter(([k]) => k !== "smtp_password")));
    return smtpOut();
  }

  @Post("smtp/test")
  @Returns(Message)
  @Roles("hr")
  @HttpCode(200)
  async testSmtp(@Body({ schema: SmtpTestIn }) body: z.output<typeof SmtpTestIn>, @Me() me: User) {
    const to = (body.to || me.email || "").trim();
    if (!EMAIL_RE.test(to)) throw new HttpError(422, "Isi alamat email tujuan yang valid.");
    try {
      await mail.send(to, "Email uji ABiTA", "SMTP ABiTA berhasil mengirim email.");
    } catch (e) {
      throw new HttpError(502, e instanceof MailError ? e.message : String(e));
    }
    return { message: `Email uji dikirim ke ${to}. Periksa kotak masuk atau folder spam.` };
  }

  // ============================================================ absensi rentang tanggal (> 1 hari)
  // Ringkasan per karyawan dulu; rincian harian dimuat hanya saat baris dibuka (/attendance/days).

  @Get("attendance/summary")
  @Returns(RangeSummary)
  @Roles("monitor")
  async attendanceSummary(@Query("from") from: string | undefined, @Query("to") to: string | undefined, @Query("unit") unit: string | undefined, @Me() me: User) {
    const staff = await staffIn(effectiveUnit(me, unit));
    const t = today();
    const end = minDay(to && zDay.safeParse(to).success ? to : t, t);
    let start = from && zDay.safeParse(from).success ? from : null;
    if (!start) {
      // "Semua": sejak catatan paling awal, maksimal 1 tahun
      const ids = staff.map((u) => u.id);
      let first: string | null = null;
      if (ids.length) {
        const [a] = await db()
          .select({ m: min(shiftAssignments.date) })
          .from(shiftAssignments)
          .where(inArray(shiftAssignments.userId, ids));
        const [b] = await db()
          .select({ m: min(attendances.workDate) })
          .from(attendances)
          .where(inArray(attendances.userId, ids));
        const xs = [a?.m, b?.m].filter((x): x is string => !!x);
        first = xs.length ? minDay(...xs) : null;
      }
      start = first ?? end;
    }
    start = maxDay(start, addDays(end, -(MAX_RANGE_DAYS - 1)));
    if (start > end) throw new HttpError(422, "Tanggal mulai setelah tanggal selesai.");
    const data = await loadRange(staff, start, end);
    const rows = [];
    for (const u of staff) {
      const c = { scheduled: 0, hadir: 0, telat: 0, izin: 0, sakit: 0, alpa: 0 };
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const st = statusOf(data, u.id, d, t);
        if (st === "libur") continue;
        c.scheduled++;
        if (PRESENT.has(st)) {
          c.hadir++;
          if (isLate(data, u.id, d)) c.telat++;
        } else if (st === "alpa" || st === "belum") c.alpa++;
        else if (st === "izin" || st === "sakit") c[st]++;
      }
      if (!c.scheduled && !c.hadir) continue;
      rows.push({ user_id: u.id, name: u.name, employee_code: u.employeeCode, employment_type: u.employmentType, unit: u.unit, ...c });
    }
    return { start, end, rows };
  }

  /** Rincian harian satu karyawan untuk baris yang dibuka (terbaru di atas). */
  @Get("attendance/days")
  @Returns(StaffDay, { list: true })
  @Roles("monitor")
  async attendanceDays(@Query("user_id") uid: string, @Query("from") from: string, @Query("to") to: string, @Me() me: User) {
    const u = ensureScope(me, await getUser(Number(uid)));
    if (!zDay.safeParse(from).success || !zDay.safeParse(to).success || to < from || diffDays(to, from) >= MAX_RANGE_DAYS) throw new HttpError(422, "Rentang tanggal tidak valid (maks. 1 tahun).");
    const t = today();
    const end = minDay(to, t);
    return staffDays(await loadRange([u], from, end), u.id, from, end, t);
  }
}
