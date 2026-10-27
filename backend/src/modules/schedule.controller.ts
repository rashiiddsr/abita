/** Jadwal per unit: draf/terbit, pola & penerapan, hari libur, ekspor/impor roster, preferensi notifikasi Kepala Unit. */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { and, asc, count, countDistinct, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Response } from "express";
import { z } from "zod";
import { AssignIn, BulkResult, Holiday, HolidayIn, KuNotifPrefs, NotifPrefsIn, PatternIn, PublishIn, ScheduleImportResult, ScheduleIndexRow, ScheduleMonth, SchedulePattern as SchedulePatternSchema, SchedulePeriod, zDay, zMonth } from "../shared";
import { activeUnit, inScope, ownUnit, scopeUnits, unitFilter } from "../core/auth";
import { HttpError } from "../core/http";
import { checkUpload, ExcelJS, readWorkbook, sheetRows, styleHeader, toBuffer, XLSX_MIME } from "../core/xlsx";
import { addDays, fmtD, lastDayOfMonth, monthKey, monthLabel, nextMonth, today, weekday } from "../core/time";
import { db, schema, type DB } from "../db";
import type { SchedulePattern, ShiftType, User } from "../db/schema";
import { assign, currentPattern, extend, fillRange, holidays, protectedDates, setCell } from "../domain/scheduling";
import { activeUser, audit, kuPrefs, notify, scopeCond } from "../domain/services";
import { deadline, periodStatus } from "../domain/swaps";
import { IdPipe, Me, Roles, type UploadFile } from "../common/nest";
import { Returns, Upload } from "../common/swagger";
import { getUser } from "./admin.controller";

const { users, units, schedulePeriods, shiftAssignments, shiftTypes, schedulePatterns, userPatterns, holidays: holidayT } = schema;


const bounds = (month: string): [string, string] => [`${month}-01`, lastDayOfMonth(month)];
const code = (t: ShiftType) => (t.name.trim().slice(0, 1) || "?").toUpperCase();
const holidayOut = (h: typeof holidayT.$inferSelect) => ({ id: h.id, date: h.date, name: h.name, kind: h.kind ?? "nasional" });

async function activeStaffOf(unit: string): Promise<User[]> {
  return db()
    .select()
    .from(users)
    .where(and(eq(users.unit, unit), eq(users.role, "staff"), activeUser()))
    .orderBy(asc(users.name));
}

async function period(unit: string, month: string) {
  const [start, end] = bounds(month);
  const staff = (await activeStaffOf(unit)).map((u) => u.id);
  const rows = staff.length
    ? await db()
        .select({ u: shiftAssignments.userId, n: count() })
        .from(shiftAssignments)
        .where(and(inArray(shiftAssignments.userId, staff), gte(shiftAssignments.date, start), lte(shiftAssignments.date, end)))
        .groupBy(shiftAssignments.userId)
    : [];
  const [row] = await db()
    .select()
    .from(schedulePeriods)
    .where(and(eq(schedulePeriods.unit, unit), eq(schedulePeriods.month, month)));
  const by = row?.publishedById ? await getUser(row.publishedById) : null;
  return {
    unit,
    status: await periodStatus(unit, month),
    published_at: row?.publishedAt ?? null,
    published_by: by?.name ?? null,
    staff: staff.length,
    scheduled_staff: rows.length,
    shifts: rows.reduce((s, r) => s + r.n, 0),
  };
}

const canEdit = (me: User, p: SchedulePattern) => (me.role === "admin" && p.unit === null) || (me.role === "unit_head" && p.unit !== null && inScope(me, p.unit));

async function patternOut(p: SchedulePattern, me: User) {
  const t = today();
  const [{ n }] = await db()
    .select({ n: countDistinct(userPatterns.userId) })
    .from(userPatterns)
    .where(and(eq(userPatterns.patternId, p.id), or(isNull(userPatterns.endDate), gte(userPatterns.endDate, t))));
  return { id: p.id, name: p.name, unit: p.unit, sequence: p.sequence, active: p.active, users: n, editable: canEdit(me, p) };
}

async function checkPattern(body: z.output<typeof PatternIn>, unit: string | null, exclude: number | null = null) {
  const valid = new Set((await db().select({ id: shiftTypes.id }).from(shiftTypes)).map((r) => r.id));
  if (body.sequence.some((x) => x !== null && !valid.has(x))) throw new HttpError(422, "Pola memuat jenis shift yang tidak ditemukan.");
  if (body.sequence.every((x) => x === null)) throw new HttpError(422, "Pola harus memuat minimal satu shift.");
  const conds = [
    sql`lower(${schedulePatterns.name}) = ${body.name.trim().toLowerCase()}`,
    // pola unit juga tidak boleh menyamai nama pola global agar tidak rancu saat dipilih
    unit === null ? isNull(schedulePatterns.unit) : or(isNull(schedulePatterns.unit), eq(schedulePatterns.unit, unit)),
  ];
  if (exclude !== null) conds.push(ne(schedulePatterns.id, exclude));
  if ((await db().select({ id: schedulePatterns.id }).from(schedulePatterns).where(and(...conds))).length) throw new HttpError(409, "Nama pola sudah dipakai.");
}

async function ownPattern(me: User, id: number): Promise<SchedulePattern> {
  const [p] = await db().select().from(schedulePatterns).where(eq(schedulePatterns.id, id));
  if (!p || (me.role !== "admin" && p.unit !== null && !inScope(me, p.unit))) throw new HttpError(404, "Pola tidak ditemukan.");
  if (!canEdit(me, p)) throw new HttpError(403, p.unit === null ? "Pola global hanya bisa diubah Admin SDM." : "Pola ini milik unit lain.");
  return p;
}

@ApiTags("Admin · Jadwal")
@Controller("admin")
export class ScheduleController {
  // ============================================================ status bulanan

  /** Status jadwal per unit untuk satu bulan (default: bulan depan). */
  @Get("schedule")
  @Returns(ScheduleMonth)
  @Roles("monitor")
  async month(@Query("month") monthQ: string | undefined, @Me() me: User) {
    if (monthQ && !zMonth.safeParse(monthQ).success) throw new HttpError(422, "Format bulan YYYY-MM.");
    const month = monthQ ?? nextMonth(today());
    const names = scopeUnits(me) ?? (await db().select({ n: units.name }).from(units).orderBy(asc(units.name))).map((r) => r.n);
    return {
      month,
      label: monthLabel(month),
      deadline: await deadline(month),
      editable: month >= monthKey(today()),
      units: await Promise.all(names.map((n) => period(n, month))),
    };
  }

  /** Terbitkan jadwal unit untuk satu bulan: karyawan bisa melihatnya dan menerima notifikasi. */
  @Post("schedule/publish")
  @Returns(SchedulePeriod)
  @Roles("head")
  @HttpCode(200)
  async publish(@Body({ schema: PublishIn }) body: z.output<typeof PublishIn>, @Me() me: User) {
    const unit = ownUnit(me, body.unit);
    if (body.month < monthKey(today())) throw new HttpError(422, "Jadwal bulan yang sudah lewat tidak bisa diterbitkan.");
    if ((await periodStatus(unit, body.month)) === "published") throw new HttpError(409, "Jadwal bulan ini sudah terbit.");
    if ((await period(unit, body.month)).shifts === 0) throw new HttpError(422, "Belum ada shift yang disusun untuk bulan ini.");
    const [row] = await db()
      .select()
      .from(schedulePeriods)
      .where(and(eq(schedulePeriods.unit, unit), eq(schedulePeriods.month, body.month)));
    const set = { status: "published", publishedAt: new Date(), publishedById: me.id };
    if (row) await db().update(schedulePeriods).set(set).where(eq(schedulePeriods.id, row.id));
    else await db().insert(schedulePeriods).values({ unit, month: body.month, ...set });
    const [start, end] = bounds(body.month);
    const label = monthLabel(body.month);
    for (const u of await activeStaffOf(unit)) {
      const [{ n }] = await db()
        .select({ n: count() })
        .from(shiftAssignments)
        .where(and(eq(shiftAssignments.userId, u.id), gte(shiftAssignments.date, start), lte(shiftAssignments.date, end)));
      await notify(u.id, "schedule", `Jadwal ${label} sudah terbit`, `${n} shift · lihat di tab Jadwal`);
    }
    await audit(me, "schedule_publish", "schedule", null, { unit, month: body.month });
    return period(unit, body.month);
  }

  // ============================================================ preferensi notifikasi Kepala Unit

  @Get("me/notif-prefs")
  @Returns(KuNotifPrefs)
  @Roles("head")
  prefs(@Me() me: User) {
    return kuPrefs(me);
  }

  @Put("me/notif-prefs")
  @Returns(KuNotifPrefs)
  @Roles("head")
  async putPrefs(@Body({ schema: NotifPrefsIn }) body: z.output<typeof NotifPrefsIn>, @Me() me: User) {
    await db().update(users).set({ notifPrefs: body }).where(eq(users.id, me.id));
    return body;
  }

  // ============================================================ pola jadwal

  /** Admin SDM: pola global + pola semua unit (baca saja). Kepala Unit: pola global (baca saja) + pola unitnya. */
  @Get("patterns")
  @Returns(SchedulePatternSchema, { list: true })
  @Roles("monitor")
  async patterns(@Me() me: User) {
    const rows = await db()
      .select()
      .from(schedulePatterns)
      .where(me.role !== "admin" ? or(isNull(schedulePatterns.unit), inArray(schedulePatterns.unit, scopeUnits(me)?.length ? scopeUnits(me)! : ["__none__"])) : undefined)
      .orderBy(sql`${schedulePatterns.unit} is not null`, asc(schedulePatterns.unit), asc(schedulePatterns.name));
    return Promise.all(rows.map((p) => patternOut(p, me)));
  }

  /** Admin SDM membuat pola global; Kepala Unit membuat pola khusus unitnya. */
  @Post("patterns")
  @Returns(SchedulePatternSchema, { status: 201 })
  @Roles("manager")
  async createPattern(@Body({ schema: PatternIn }) body: z.output<typeof PatternIn>, @Me() me: User) {
    const unit = me.role === "admin" ? null : ownUnit(me, body.unit);
    await checkPattern(body, unit);
    const [{ id }] = await db()
      .insert(schedulePatterns)
      .values({ name: body.name.trim(), unit, sequence: body.sequence, active: body.active })
      .$returningId();
    await audit(me, "pattern_create", "pattern", id, { name: body.name.trim(), unit });
    return patternOut((await db().select().from(schedulePatterns).where(eq(schedulePatterns.id, id)))[0], me);
  }

  @Put("patterns/:id")
  @Returns(SchedulePatternSchema)
  @Roles("manager")
  async updatePattern(@Param("id", IdPipe) id: number, @Body({ schema: PatternIn }) body: z.output<typeof PatternIn>, @Me() me: User) {
    const p = await ownPattern(me, id);
    await checkPattern(body, p.unit, p.id);
    // perubahan berlaku untuk penerapan berikutnya; penerapan lama menyimpan salinan urutannya
    await db().update(schedulePatterns).set({ name: body.name.trim(), sequence: body.sequence, active: body.active }).where(eq(schedulePatterns.id, id));
    return patternOut((await db().select().from(schedulePatterns).where(eq(schedulePatterns.id, id)))[0], me);
  }

  @Delete("patterns/:id")
  @Roles("manager")
  @HttpCode(204)
  async deletePattern(@Param("id", IdPipe) id: number, @Me() me: User) {
    const p = await ownPattern(me, id);
    if ((await db().select({ id: userPatterns.id }).from(userPatterns).where(eq(userPatterns.patternId, p.id)).limit(1)).length)
      throw new HttpError(409, "Pola sudah pernah diterapkan ke karyawan; nonaktifkan saja.");
    await db().delete(schedulePatterns).where(eq(schedulePatterns.id, id));
  }

  // ============================================================ daftar jadwal & penerapan

  /** Jadwal yang berlaku per karyawan + shift berikutnya. */
  @Get("schedule/index")
  @Returns(ScheduleIndexRow, { list: true })
  @Roles("monitor")
  async index(@Query("unit") unitQ: string | undefined, @Me() me: User) {
    const units = unitFilter(me, unitQ); // Kepala Unit tanpa pilihan: semua unitnya
    const staff = await db()
      .select()
      .from(users)
      .where(and(eq(users.role, "staff"), activeUser(), units ? inArray(users.unit, units) : undefined))
      .orderBy(asc(users.name));
    const t = today();
    await extend(
      staff.map((u) => u.id),
      addDays(t, 31),
    );
    return Promise.all(
      staff.map(async (u) => {
        const up = await currentPattern(u.id, t);
        const [nxt] = await db()
          .select({ a: shiftAssignments, st: shiftTypes })
          .from(shiftAssignments)
          .innerJoin(shiftTypes, eq(shiftTypes.id, shiftAssignments.shiftTypeId))
          .where(and(eq(shiftAssignments.userId, u.id), gte(shiftAssignments.date, t)))
          .orderBy(asc(shiftAssignments.date))
          .limit(1);
        return {
          user_id: u.id,
          name: u.name,
          employee_code: u.employeeCode,
          employment_type: u.employmentType,
          unit: u.unit,
          schedule: up ? up.name : "Manual",
          kind: up ? (up.patternId ? "pola" : "fleksibel") : "manual",
          start_date: up?.startDate ?? null,
          end_date: up?.endDate ?? null,
          next_shift: nxt ? { date: nxt.a.date, name: nxt.st.name, start_time: nxt.st.startTime.slice(0, 5), end_time: nxt.st.endTime.slice(0, 5), color: nxt.st.color } : null,
        };
      }),
    );
  }

  /**
   * Terapkan pola jadwal (atau urutan shift khusus) ke karyawan unit.
   * Tanpa tanggal akhir = pola baru mulai tanggal efektif; dengan tanggal akhir = isi rentang itu saja, pola berjalan tetap.
   */
  @Post("schedule/assign")
  @Returns(BulkResult)
  @Roles("head")
  @HttpCode(200)
  async assign(@Body({ schema: AssignIn }) body: z.output<typeof AssignIn>, @Me() me: User) {
    const staff = await db()
      .select()
      .from(users)
      .where(and(inArray(users.id, body.user_ids), scopeCond(me), eq(users.role, "staff")));
    if (staff.length !== new Set(body.user_ids).size) throw new HttpError(422, "Ada karyawan yang bukan dari unit Anda.");
    let name = "Fleksibel",
      seq: (number | null)[] = body.sequence ?? [];
    if (body.pattern_id != null) {
      const [p] = await db().select().from(schedulePatterns).where(eq(schedulePatterns.id, body.pattern_id));
      if (!p || !p.active || (p.unit !== null && !inScope(me, p.unit))) throw new HttpError(422, "Pola jadwal tidak ditemukan atau nonaktif.");
      if (p.unit !== null && staff.some((u) => u.unit !== p.unit)) throw new HttpError(422, `Pola ${p.name} hanya untuk karyawan unit ${p.unit}.`);
      name = p.name;
      seq = p.sequence;
    }
    const end = body.end_date ?? null;
    const [changed, skipped] = await db().transaction((tx) =>
      end !== null
        ? fillRange(staff, seq, body.start_date, end, body.skip_holidays, tx as unknown as DB)
        : assign(staff, name, body.pattern_id ?? null, seq, body.start_date, null, body.skip_holidays, me, tx as unknown as DB),
    );
    if (changed)
      for (const u of staff)
        if ((await periodStatus(u.unit, monthKey(body.start_date))) === "published") await notify(u.id, "shift", "Jadwal shift Anda diperbarui", end ? `${fmtD(body.start_date)} – ${fmtD(end)}` : `${name} mulai ${fmtD(body.start_date)}`);
    await audit(me, end ? "schedule_fill" : "schedule_assign", "schedule", null, { users: staff.map((u) => u.id), name, start: body.start_date, end });
    return { updated: changed, skipped };
  }

  // ============================================================ hari libur

  @Get("holidays")
  @Returns(Holiday, { list: true })
  @Roles("monitor")
  async holidays(@Query("from") from: string | undefined, @Query("to") to: string | undefined) {
    const conds = [];
    if (from && zDay.safeParse(from).success) conds.push(gte(holidayT.date, from));
    if (to && zDay.safeParse(to).success) conds.push(lte(holidayT.date, to));
    const rows = await db()
      .select()
      .from(holidayT)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(holidayT.date));
    return rows.map(holidayOut);
  }

  @Post("holidays")
  @Returns(Holiday, { status: 201 })
  @Roles("hr")
  async createHoliday(@Body({ schema: HolidayIn }) b: z.output<typeof HolidayIn>) {
    if ((await db().select({ id: holidayT.id }).from(holidayT).where(eq(holidayT.date, b.date))).length) throw new HttpError(409, "Tanggal ini sudah terdaftar sebagai hari libur.");
    const [{ id }] = await db()
      .insert(holidayT)
      .values({ date: b.date, name: b.name.trim(), kind: b.kind })
      .$returningId();
    return holidayOut((await db().select().from(holidayT).where(eq(holidayT.id, id)))[0]);
  }

  @Put("holidays/:id")
  @Returns(Holiday)
  @Roles("hr")
  async updateHoliday(@Param("id", IdPipe) id: number, @Body({ schema: HolidayIn }) b: z.output<typeof HolidayIn>) {
    const [h] = await db().select().from(holidayT).where(eq(holidayT.id, id));
    if (!h) throw new HttpError(404, "Hari libur tidak ditemukan.");
    if ((await db().select({ id: holidayT.id }).from(holidayT).where(and(eq(holidayT.date, b.date), ne(holidayT.id, id)))).length) throw new HttpError(409, "Tanggal itu sudah tercatat sebagai hari libur.");
    await db().update(holidayT).set({ date: b.date, name: b.name.trim(), kind: b.kind }).where(eq(holidayT.id, id));
    return holidayOut((await db().select().from(holidayT).where(eq(holidayT.id, id)))[0]);
  }

  @Delete("holidays/:id")
  @Roles("hr")
  @HttpCode(204)
  async deleteHoliday(@Param("id", IdPipe) id: number) {
    const [h] = await db().select().from(holidayT).where(eq(holidayT.id, id));
    if (!h) throw new HttpError(404, "Hari libur tidak ditemukan.");
    await db().delete(holidayT).where(eq(holidayT.id, id));
  }

  // ============================================================ ekspor / impor roster (Excel)

  /** Roster bulanan: baris karyawan, kolom tanggal, isi kode shift. Juga template impor. */
  @Get("schedule/export")
  @Roles("monitor")
  async exportRoster(@Query("month") month: string, @Query("unit") unitQ: string | undefined, @Me() me: User, @Res() res: Response) {
    if (!zMonth.safeParse(month).success) throw new HttpError(422, "Format bulan YYYY-MM.");
    const unit = activeUnit(me, unitQ);
    if (!unit) throw new HttpError(422, "Pilih unit.");
    const [start, end] = bounds(month);
    const staff = await activeStaffOf(unit);
    await extend(
      staff.map((u) => u.id),
      end,
    );
    const types = await db().select().from(shiftTypes).orderBy(asc(shiftTypes.startTime));
    const cells = new Map<string, ShiftType>();
    if (staff.length) {
      const rows = await db()
        .select({ a: shiftAssignments, t: shiftTypes })
        .from(shiftAssignments)
        .innerJoin(shiftTypes, eq(shiftTypes.id, shiftAssignments.shiftTypeId))
        .where(and(inArray(shiftAssignments.userId, staff.map((u) => u.id)), gte(shiftAssignments.date, start), lte(shiftAssignments.date, end)));
      for (const { a, t } of rows) cells.set(`${a.userId}|${a.date}`, t);
    }
    const hol = await holidays(start, end);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Roster", { views: [{ state: "frozen", xSplit: 2, ySplit: 3 }] });
    ws.addRow([`Jadwal ${monthLabel(month)} - ${unit}`]).getCell(1).font = { bold: true, size: 13 };
    const legend = types.filter((t) => t.active).map((t) => `${code(t)} = ${t.name} ${t.startTime.slice(0, 5)}-${t.endTime.slice(0, 5)}`).join(", ") + ", L = Libur";
    ws.addRow(["Bulan", month, "Kode:", legend]);
    const days: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    styleHeader(ws.addRow(["NIK", "Nama", ...days.map((d) => Number(d.slice(8)))]));
    for (const u of staff) ws.addRow([u.employeeCode, u.name, ...days.map((d) => (cells.has(`${u.id}|${d}`) ? code(cells.get(`${u.id}|${d}`)!) : "L"))]);
    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 28;
    days.forEach((d, i) => {
      const col = ws.getColumn(3 + i);
      col.width = 4.5;
      if (weekday(d) === 0 || hol.has(d))
        for (let r = 4; r <= ws.rowCount; r++) ws.getCell(r, 3 + i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6F8" } };
    });
    res.setHeader("Content-Disposition", `attachment; filename="Jadwal_${unit.replace(/ /g, "_")}_${month}.xlsx"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.type(XLSX_MIME).send(await toBuffer(wb));
  }

  /** Unggah roster dari template ekspor: kode shift per tanggal (L / kosong = libur). */
  @Post("schedule/import")
  @Returns(ScheduleImportResult)
  @Roles("head")
  @HttpCode(200)
  @Upload({ file: "file", unit: "Kepala Unit beberapa unit: unit jadwal ini (kosong = unit pertama)" }, ["file"])
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 + 1 } }))
  async importRoster(@UploadedFile() file: UploadFile | undefined, @Body() form: { unit?: string }, @Me() me: User) {
    const unit = ownUnit(me, form?.unit || null); // Kepala Unit beberapa unit: unit yang sedang dipilih
    let rows: (string | number | null)[][], month: string, start: string, end: string;
    try {
      const wb = await readWorkbook(checkUpload(file));
      rows = sheetRows(wb.worksheets[0]);
      month = String(rows[1][1] ?? "").trim();
      if (!zMonth.safeParse(month).success) throw new Error("bulan");
      [start, end] = bounds(month);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, "File tidak sesuai template. Unduh template lewat tombol Ekspor.");
    }
    if (month < monthKey(today())) throw new HttpError(422, "Jadwal bulan yang sudah lewat tidak bisa diimpor.");
    const types = await db().select().from(shiftTypes).where(eq(shiftTypes.active, true));
    const byCode = new Map<string, number>([...types.map((t) => [code(t), t.id] as const), ...types.map((t) => [t.name.trim().toUpperCase(), t.id] as const)]);
    const staff = new Map((await activeStaffOf(unit)).map((u) => [u.employeeCode, u]));
    const maxDay = Number(end.slice(8));
    const days = rows[2]
      .slice(2)
      .map((v) => (typeof v === "number" && v >= 1 && v <= maxDay ? addDays(start, Math.trunc(v) - 1) : null))
      .filter((d): d is string => !!d);
    const locked = await protectedDates(
      [...staff.values()].map((u) => u.id),
      start,
      end,
    );
    const t = today();
    let updated = 0,
      skipped = 0;
    const errors: string[] = [];
    await db().transaction(async (tx) => {
      for (const r of rows.slice(3)) {
        const nik = String(r[0] ?? "").trim();
        if (!nik) continue;
        const u = staff.get(nik);
        if (!u) {
          errors.push(`NIK ${nik} bukan karyawan aktif unit Anda.`);
          continue;
        }
        for (let i = 0; i < days.length; i++) {
          const d = days[i];
          const raw = String(r[2 + i] ?? "")
            .trim()
            .toUpperCase();
          let sid: number | null;
          if (raw === "" || raw === "L" || raw === "-") sid = null;
          else if (byCode.has(raw)) sid = byCode.get(raw)!;
          else {
            errors.push(`${u.name} tgl ${Number(d.slice(8))}: kode ${raw} tidak dikenal.`);
            continue;
          }
          if (d < t || locked.has(`${u.id}|${d}`)) {
            skipped++;
            continue;
          }
          if (await setCell(u.id, d, sid, tx as unknown as DB)) updated++;
        }
      }
    });
    await audit(me, "schedule_import", "schedule", null, { unit, month, updated });
    return { updated, skipped, errors: errors.slice(0, 50) };
  }
}

