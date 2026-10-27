/** Dasbor: ubah akun, reset kata sandi, jenis shift, grid jadwal, persetujuan izin/sakit & tukar shift. */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { and, asc, count, desc, eq, gte, lte, ne, or, sql, inArray } from "drizzle-orm";
import type { Response } from "express";
import { z } from "zod";
import {
  BulkActionResult,
  BulkResult,
  BulkReviewIn,
  BulkStatusIn,
  CredentialResult,
  LeaveOut,
  MonthSummary,
  PasswordResetIn,
  ReviewIn,
  ShiftBulkIn,
  ShiftDay,
  ShiftType,
  ShiftTypeIn,
  SwapOut,
  User as UserSchema,
  UserUpdateIn,
  zDay,
} from "../shared";
import { activeUnit, ensureScope, hashPassword, inScope, unitFilter } from "../core/auth";
import { HttpError } from "../core/http";
import { getSetting } from "../core/settings";
import { diffDays, fmtD, hms, maxDay, minDay, monthKey, today } from "../core/time";
import { db, schema, type DB } from "../db";
import { closePasswordRequests } from "../domain/password-reset";
import type { LeaveRequest, SwapRequest, User } from "../db/schema";
import { generatePassword, tempPasswordEmail, trySend } from "../domain/mailer";
import { leaveOut, shiftTypeOut, swapOut, swapCtx, userOut, usersById } from "../domain/out";
import { attendedDays } from "../domain/conflicts";
import { extend, protectedDates, runningLock } from "../domain/scheduling";
import { audit, canReview, monthSummary, notify, scopeCond, syncUnitHead, withLedUnits } from "../domain/services";
import { applySwap, periodStatus, stage, summaryOf } from "../domain/swaps";
import { IdPipe, Me, Roles } from "../common/nest";
import { Returns } from "../common/swagger";
import { getUser, staffTarget } from "./admin.controller";
import { cleanEmail, emailTaken, paged } from "./me.controller";

const { users, shiftTypes, shiftAssignments, attendances, swapRequests, leaveRequests } = schema;

const FIELD: Record<string, keyof User> = {
  name: "name",
  role: "role",
  email: "email",
  phone: "phone",
  employment_type: "employmentType",
  unit: "unit",
  institution: "institution",
  period_start: "periodStart",
  is_active: "isActive",
};

async function uniqueShiftName(name: string, exclude: number | null = null) {
  const conds = [sql`lower(${shiftTypes.name}) = ${name.trim().toLowerCase()}`];
  if (exclude !== null) conds.push(ne(shiftTypes.id, exclude));
  if (
    (
      await db()
        .select({ id: shiftTypes.id })
        .from(shiftTypes)
        .where(and(...conds))
    ).length
  )
    throw new HttpError(409, "Nama shift sudah dipakai.");
}

/** can_review untuk penampil (tukar shift: rekan harus menerima lebih dulu). */
async function leaveWithReview(me: User, lv: LeaveRequest, users: Map<number, User>) {
  const o = await leaveOut(lv, users);
  const owner = users.get(lv.userId);
  o.can_review = !!owner && canReview(me, owner, lv.status);
  return o;
}

async function swapWithReview(me: User, rows: SwapRequest[], q: DB = db()) {
  const ctx = await swapCtx(rows, q);
  return Promise.all(
    rows.map(async (s) => {
      const o = await swapOut(s, ctx, { withUser: true });
      const owner = ctx.users.get(s.userId);
      o.can_review = !!owner && canReview(me, owner, s.status) && stage(s) === "review";
      return o;
    }),
  );
}

@ApiTags("Admin · Karyawan, shift & pengajuan")
@Controller("admin")
@Roles("manager")
export class HrController {
  // ============================================================ akun

  @Put("users/:id")
  @Returns(UserSchema)
  async update(@Param("id", IdPipe) id: number, @Body({ schema: UserUpdateIn }) data: z.output<typeof UserUpdateIn>, @Me() me: User) {
    const user = staffTarget(me, await getUser(id));
    if (me.role === "unit_head" && ((data.unit != null && !inScope(me, data.unit)) || (data.role != null && data.role !== "staff") || data.head_units !== undefined))
      throw new HttpError(403, "Kepala Unit tidak bisa memindahkan karyawan ke unit lain atau mengubah perannya.");
    const { head_units: headUnits, ...fields } = data;
    if (headUnits?.length) fields.unit = headUnits[0]; // unit utama Kepala Unit
    if ("email" in data) {
      data.email = cleanEmail(data.email);
      if (await emailTaken(data.email, user.id)) throw new HttpError(409, "Email sudah dipakai akun lain.");
    }
    if (user.id === me.id && (data.is_active === false || data.role === "staff")) throw new HttpError(422, "Tidak bisa menonaktifkan atau menurunkan peran akun sendiri.");
    if (user.role === "staff" && data.role != null && data.role !== "staff") throw new HttpError(422, "Akun staff tidak bisa diubah menjadi akun admin.");
    if (user.role !== "staff" && data.role === "staff") throw new HttpError(422, "Akun admin tidak bisa diubah menjadi staff.");
    const set: Record<string, unknown> = {};
    for (const [k, v0] of Object.entries(fields)) {
      let v: unknown = v0;
      if (typeof v === "string") v = k === "name" ? v.trim() : v.trim() || null;
      set[FIELD[k]] = v;
    }
    if (Object.keys(set).length) await db().update(users).set(set).where(eq(users.id, user.id));
    const after = (await getUser(user.id))!;
    await syncUnitHead(after, headUnits);
    return userOut((await withLedUnits([(await getUser(user.id))!]))[0]);
  }

  /** Kata sandi baru ke email pengguna (bila gagal, tampil sekali ke admin). */
  @Post("users/:id/reset-password")
  @Returns(CredentialResult)
  @HttpCode(200)
  async resetPassword(@Param("id", IdPipe) id: number, @Body() raw: unknown, @Me() me: User) {
    const body = raw && typeof raw === "object" && Object.keys(raw).length ? PasswordResetIn.parse(raw) : null;
    const user = staffTarget(me, await getUser(id));
    const password = body?.new_password || generatePassword();
    await db()
      .update(users)
      .set({ passwordHash: await hashPassword(password), mustChangePassword: true, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id));
    await closePasswordRequests(user.id);
    await notify(user.id, "system", "Kata sandi direset admin", "Masuk dengan kata sandi baru dari admin, lalu buat kata sandi sendiri.");
    await audit(me, "password_reset", "user", user.id);
    const err = await trySend(user.email, ...tempPasswordEmail(user.name, user.email || user.employeeCode, password));
    // reset satu akun: kata sandi selalu ditampilkan sekali ke admin (juga dikirim ke email)
    return { email_sent: err === null, email_error: err, temp_password: password };
  }

  @Get("users/:id/summary")
  @Returns(MonthSummary)
  @Roles("monitor")
  async summary(@Param("id", IdPipe) id: number, @Query("month") month: string | undefined, @Me() me: User) {
    ensureScope(me, await getUser(id));
    if (month && !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(422, "Format bulan harus YYYY-MM.");
    return monthSummary(id, month ?? null);
  }

  // ============================================================ jenis shift

  @Get("shift-types")
  @Returns(ShiftType, { list: true })
  async shiftTypes() {
    return (await db().select().from(shiftTypes).orderBy(asc(shiftTypes.startTime))).map(shiftTypeOut);
  }

  @Post("shift-types")
  @Returns(ShiftType, { status: 201 })
  @Roles("hr")
  async createShiftType(@Body({ schema: ShiftTypeIn }) b: z.output<typeof ShiftTypeIn>) {
    await uniqueShiftName(b.name);
    const [{ id }] = await db()
      .insert(shiftTypes)
      .values({ name: b.name.trim(), startTime: hms(b.start_time), endTime: hms(b.end_time), color: b.color ?? null, active: b.active })
      .$returningId();
    return shiftTypeOut((await db().select().from(shiftTypes).where(eq(shiftTypes.id, id)))[0]);
  }

  @Put("shift-types/:id")
  @Returns(ShiftType)
  @Roles("hr")
  async updateShiftType(@Param("id", IdPipe) id: number, @Body({ schema: ShiftTypeIn }) b: z.output<typeof ShiftTypeIn>) {
    const [st] = await db().select().from(shiftTypes).where(eq(shiftTypes.id, id));
    if (!st) throw new HttpError(404, "Jenis shift tidak ditemukan.");
    await uniqueShiftName(b.name, id);
    await db()
      .update(shiftTypes)
      .set({ name: b.name.trim(), startTime: hms(b.start_time), endTime: hms(b.end_time), color: b.color ?? null, active: b.active })
      .where(eq(shiftTypes.id, id));
    return shiftTypeOut((await db().select().from(shiftTypes).where(eq(shiftTypes.id, id)))[0]);
  }

  /** Hapus jenis shift hanya bila belum pernah dipakai (jadwal, presensi, atau tukar shift). */
  @Delete("shift-types/:id")
  @Roles("hr")
  @HttpCode(204)
  async deleteShiftType(@Param("id", IdPipe) id: number, @Me() me: User) {
    const [st] = await db().select().from(shiftTypes).where(eq(shiftTypes.id, id));
    if (!st) throw new HttpError(404, "Jenis shift tidak ditemukan.");
    const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const upcoming = await n(
      db()
        .select({ n: count() })
        .from(shiftAssignments)
        .where(and(eq(shiftAssignments.shiftTypeId, id), gte(shiftAssignments.date, today()))),
    );
    if (upcoming) throw new HttpError(409, `Shift ${st.name} masih dipakai di ${upcoming} jadwal mendatang. Ubah jadwalnya dulu atau nonaktifkan shift ini.`);
    const used =
      (await n(db().select({ n: count() }).from(shiftAssignments).where(eq(shiftAssignments.shiftTypeId, id)))) +
      (await n(db().select({ n: count() }).from(attendances).where(eq(attendances.shiftTypeId, id)))) +
      (await n(
        db()
          .select({ n: count() })
          .from(swapRequests)
          .where(or(eq(swapRequests.fromShiftTypeId, id), eq(swapRequests.toShiftTypeId, id))),
      ));
    if (used) throw new HttpError(409, `Shift ${st.name} sudah tercatat di riwayat jadwal/presensi. Nonaktifkan saja agar riwayat tetap utuh.`);
    await audit(me, "shift_type_delete", "shift_type", id, { name: st.name });
    await db().delete(shiftTypes).where(eq(shiftTypes.id, id));
  }

  // ============================================================ jadwal

  @Get("shifts")
  @Returns(ShiftDay, { list: true })
  @Roles("monitor")
  async shifts(@Query("from") start: string, @Query("to") end: string, @Query("unit") unitQ: string | undefined, @Me() me: User) {
    if (!zDay.safeParse(start).success || !zDay.safeParse(end).success || end < start || diffDays(end, start) > 62) throw new HttpError(422, "Rentang tanggal tidak valid (maks. 62 hari).");
    const units = unitFilter(me, unitQ); // Kepala Unit tanpa pilihan: semua unitnya
    const staff = await db()
      .select({ id: users.id })
      .from(users)
      .where(units ? and(eq(users.role, "staff"), inArray(users.unit, units)) : eq(users.role, "staff"));
    await extend(
      staff.map((s) => s.id),
      end,
    );
    const conds = [gte(shiftAssignments.date, start), lte(shiftAssignments.date, end)];
    if (units) conds.push(inArray(users.unit, units));
    const rows = await db()
      .select({ a: shiftAssignments, t: shiftTypes })
      .from(shiftAssignments)
      .innerJoin(shiftTypes, eq(shiftTypes.id, shiftAssignments.shiftTypeId))
      .innerJoin(users, eq(users.id, shiftAssignments.userId))
      .where(and(...conds))
      .orderBy(asc(shiftAssignments.date));
    const pending = new Set<string>();
    for (const r of await db().select().from(swapRequests).where(eq(swapRequests.status, "pending"))) {
      pending.add(`${r.userId}|${r.date}`);
      if (r.targetUserId) pending.add(`${r.targetUserId}|${r.targetDate ?? r.date}`);
    }
    return rows.map(({ a, t }) => ({ date: a.date, user_id: a.userId, shift: shiftTypeOut(t), pending_swap: pending.has(`${a.userId}|${a.date}`) }));
  }

  /** Set/hapus banyak sel jadwal sekaligus (grid jadwal). shift_type_id null = libur. Hanya Kepala Unit. */
  @Put("shifts")
  @Returns(BulkResult)
  @Roles("head")
  async setShifts(@Body({ schema: ShiftBulkIn }) body: z.output<typeof ShiftBulkIn>, @Me() me: User) {
    const types = new Map((await db().select().from(shiftTypes)).map((t) => [t.id, t]));
    // karyawan di unit-unit yang dipimpin Kepala Unit ini
    const unitOf = new Map((await db().select({ id: users.id, unit: users.unit }).from(users).where(scopeCond(me))).map((r) => [r.id, r.unit]));
    const unitUsers = new Set(unitOf.keys());
    const t = today();
    const dates = body.items.map((i) => i.date);
    const locked = dates.length ? await protectedDates([...unitUsers], minDay(...dates), maxDay(...dates)) : new Set<string>();
    const published = new Map<string, boolean>();
    const changed = new Map<number, string[]>();
    let updated = 0,
      skipped = 0;
    await db().transaction(async (tx) => {
      for (const it of body.items) {
        if (!unitUsers.has(it.user_id)) throw new HttpError(422, `Pengguna ${it.user_id} tidak ditemukan di unit Anda.`);
        if (it.date < t) throw new HttpError(422, "Jadwal tanggal yang sudah lewat tidak bisa diubah.");
        if (it.shift_type_id !== null && !types.has(it.shift_type_id)) throw new HttpError(422, `Jenis shift ${it.shift_type_id} tidak ditemukan.`);
        if (locked.has(`${it.user_id}|${it.date}`) || (await runningLock(it.user_id, it.date, it.shift_type_id, undefined, tx as unknown as DB))) {
          skipped++; // sudah ada absensi / izin disetujui, atau shift hari ini yang sudah mulai
          continue;
        }
        const [cur] = await tx
          .select()
          .from(shiftAssignments)
          .where(and(eq(shiftAssignments.userId, it.user_id), eq(shiftAssignments.date, it.date)));
        if (it.shift_type_id === null) {
          if (!cur) continue;
          await tx.delete(shiftAssignments).where(eq(shiftAssignments.id, cur.id));
        } else if (!cur) await tx.insert(shiftAssignments).values({ userId: it.user_id, date: it.date, shiftTypeId: it.shift_type_id });
        else if (cur.shiftTypeId !== it.shift_type_id) await tx.update(shiftAssignments).set({ shiftTypeId: it.shift_type_id, updatedAt: new Date() }).where(eq(shiftAssignments.id, cur.id));
        else continue;
        updated++;
        const m = `${unitOf.get(it.user_id)}|${monthKey(it.date)}`;
        if (!published.has(m)) published.set(m, (await periodStatus(unitOf.get(it.user_id) ?? null, monthKey(it.date), tx as unknown as DB)) === "published");
        // draf bulan depan: karyawan diberi tahu saat jadwal diterbitkan
        if (published.get(m)) {
          const label = `${it.date.slice(8, 10)}/${it.date.slice(5, 7)} ` + (it.shift_type_id ? types.get(it.shift_type_id)!.name : "libur");
          changed.set(it.user_id, [...(changed.get(it.user_id) ?? []), label]);
        }
      }
    });
    for (const [uid, items] of changed) await notify(uid, "shift", "Jadwal shift Anda diubah", items.slice(0, 6).join(", ") + (items.length > 6 ? ` +${items.length - 6} lagi` : ""));
    return { updated, skipped };
  }

  // ============================================================ persetujuan izin / sakit

  @Get("leaves")
  @Returns(LeaveOut, { list: true })
  @Roles("monitor")
  async leaves(@Query("status") status: string | undefined, @Query("limit") limit = "500", @Query("offset") offset = "0", @Me() me: User, @Res({ passthrough: true }) res: Response) {
    const conds = [];
    if (status) conds.push(eq(leaveRequests.status, status));
    const scope = scopeCond(me);
    if (scope) conds.push(scope);
    const where = conds.length ? and(...conds) : undefined;
    const [{ n }] = await db().select({ n: count() }).from(leaveRequests).innerJoin(users, eq(users.id, leaveRequests.userId)).where(where);
    const rows = await db()
      .select({ l: leaveRequests })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .where(where)
      .orderBy(desc(leaveRequests.createdAt), desc(leaveRequests.id))
      .limit(Math.min(2000, Math.max(1, Number(limit) || 500)))
      .offset(Math.max(0, Number(offset) || 0));
    const list = rows.map((r) => r.l);
    const map = await usersById(list.flatMap((l) => [l.userId, l.reviewerId]));
    return paged(res, n, await Promise.all(list.map((l) => leaveWithReview(me, l, map))));
  }

  @Get("leaves/:id")
  @Returns(LeaveOut)
  @Roles("monitor")
  async leave(@Param("id", IdPipe) id: number, @Me() me: User) {
    const [lv] = await db().select().from(leaveRequests).where(eq(leaveRequests.id, id));
    if (!lv) throw new HttpError(404, "Pengajuan tidak ditemukan.");
    const map = await usersById([lv.userId, lv.reviewerId]);
    ensureScope(me, map.get(lv.userId));
    return leaveWithReview(me, lv, map);
  }

  @Post("leaves/:id/review")
  @Returns(LeaveOut)
  @Roles("monitor")
  @HttpCode(200)
  async reviewLeave(@Param("id", IdPipe) id: number, @Body({ schema: ReviewIn }) body: z.output<typeof ReviewIn>, @Me() me: User) {
    const [lv] = await db().select().from(leaveRequests).where(eq(leaveRequests.id, id));
    if (!lv) throw new HttpError(404, "Pengajuan tidak ditemukan.");
    const owner = ensureScope(me, await getUser(lv.userId));
    if (lv.status !== "pending") throw new HttpError(409, "Pengajuan ini sudah diproses.");
    if (!canReview(me, owner, lv.status)) throw new HttpError(403, "Pengajuan diputuskan oleh Kepala Unit dari unit karyawan.");
    if (body.approve) {
      // karyawan sempat absen setelah mengajukan: hari itu sudah tercatat hadir
      const attended = await attendedDays(lv.userId, lv.startDate, lv.endDate);
      if (attended.length) throw new HttpError(409, `${owner.name} sudah absen pada ${fmtD(attended[0])}. Tolak pengajuan ini; karyawan dapat mengajukan ulang tanpa tanggal tersebut.`);
    }
    const set = { status: body.approve ? "approved" : "rejected", reviewerId: me.id, reviewNote: body.note ?? null, reviewedAt: new Date() };
    await db().update(leaveRequests).set(set).where(eq(leaveRequests.id, id));
    const span = fmtD(lv.startDate) + (lv.endDate !== lv.startDate ? ` – ${fmtD(lv.endDate)}` : "");
    const kind = lv.kind.charAt(0).toUpperCase() + lv.kind.slice(1);
    await notify(lv.userId, "leave", `${kind} ${span} ${body.approve ? "disetujui" : "ditolak"}`, body.note || `Diputuskan ${me.name}`);
    await audit(me, "leave_" + set.status, "leave", lv.id, { note: body.note ?? null });
    const after = { ...lv, ...set };
    return leaveWithReview(me, after, await usersById([after.userId, after.reviewerId]));
  }

  // ============================================================ tukar shift

  @Get("swaps")
  @Returns(SwapOut, { list: true })
  @Roles("monitor")
  async swaps(
    @Query("status") status: string | undefined,
    @Query("unit") unitQ: string | undefined,
    @Query("limit") limit = "500",
    @Query("offset") offset = "0",
    @Me() me: User,
    @Res({ passthrough: true }) res: Response,
  ) {
    const conds = [];
    if (status) conds.push(eq(swapRequests.status, status));
    const scope = unitQ && unitQ !== "all" ? eq(users.unit, activeUnit(me, unitQ)!) : scopeCond(me);
    if (scope) conds.push(scope);
    const where = conds.length ? and(...conds) : undefined;
    const [{ n }] = await db().select({ n: count() }).from(swapRequests).innerJoin(users, eq(users.id, swapRequests.userId)).where(where);
    const rows = await db()
      .select({ s: swapRequests })
      .from(swapRequests)
      .innerJoin(users, eq(users.id, swapRequests.userId))
      .where(where)
      .orderBy(desc(swapRequests.createdAt), desc(swapRequests.id))
      .limit(Math.min(2000, Math.max(1, Number(limit) || 500)))
      .offset(Math.max(0, Number(offset) || 0));
    return paged(
      res,
      n,
      await swapWithReview(
        me,
        rows.map((r) => r.s),
      ),
    );
  }

  @Get("swaps/:id")
  @Returns(SwapOut)
  @Roles("monitor")
  async swap(@Param("id", IdPipe) id: number, @Me() me: User) {
    const [s] = await db().select().from(swapRequests).where(eq(swapRequests.id, id));
    if (!s) throw new HttpError(404, "Pengajuan tidak ditemukan.");
    ensureScope(me, await getUser(s.userId));
    return (await swapWithReview(me, [s]))[0];
  }

  @Post("swaps/:id/review")
  @Returns(SwapOut)
  @Roles("monitor")
  @HttpCode(200)
  async reviewSwap(@Param("id", IdPipe) id: number, @Body({ schema: ReviewIn }) body: z.output<typeof ReviewIn>, @Me() me: User) {
    const [s] = await db().select().from(swapRequests).where(eq(swapRequests.id, id));
    if (!s) throw new HttpError(404, "Pengajuan tidak ditemukan.");
    const owner = ensureScope(me, await getUser(s.userId));
    if (s.status !== "pending") throw new HttpError(409, "Pengajuan ini sudah diproses.");
    if (!canReview(me, owner, s.status)) throw new HttpError(403, "Pengajuan diputuskan oleh Kepala Unit dari unit karyawan.");
    if (stage(s) === "peer") throw new HttpError(409, "Menunggu jawaban rekan yang diajak tukar.");
    const set = { status: body.approve ? "approved" : "rejected", reviewerId: me.id, reviewNote: body.note ?? null, reviewedAt: new Date() };
    await db().transaction(async (tx) => {
      if (body.approve) await applySwap(s, tx as unknown as DB);
      await tx.update(swapRequests).set(set).where(eq(swapRequests.id, id));
    });
    const after = { ...s, ...set };
    const detail = body.note || (await summaryOf(after));
    for (const uid of [s.userId, s.targetUserId].filter((x): x is number => !!x)) await notify(uid, "swap", `Tukar shift ${body.approve ? "disetujui" : "ditolak"}`, detail);
    await audit(me, "swap_" + set.status, "swap", s.id, { note: body.note ?? null });
    return (await swapWithReview(me, [after]))[0];
  }

  // ============================================================ aksi massal

  /** Aktifkan / nonaktifkan banyak akun sekaligus (Kelola Admin). Akun sendiri tidak bisa dinonaktifkan. */
  @Post("users/bulk-status")
  @Returns(BulkActionResult)
  @Roles("hr")
  @HttpCode(200)
  async bulkStatus(@Body({ schema: BulkStatusIn }) body: z.output<typeof BulkStatusIn>, @Me() me: User) {
    const failed: { id: number; label: string; error: string }[] = [];
    let done = 0;
    for (const id of new Set(body.user_ids)) {
      try {
        await this.update(id, { is_active: body.is_active }, me);
        done++;
      } catch (e) {
        failed.push({ id, label: (await getUser(id))?.name ?? `#${id}`, error: e instanceof HttpError ? String(e.detail) : "Gagal diproses." });
      }
    }
    await audit(me, body.is_active ? "users_activate" : "users_deactivate", "user", null, { count: done });
    return { done, failed };
  }

  /** Setujui / tolak banyak pengajuan (izin, sakit, tukar shift) sekaligus. Hanya Kepala Unit dari unit karyawan. */
  @Post("requests/review")
  @Returns(BulkActionResult)
  @Roles("monitor")
  @HttpCode(200)
  async bulkReview(@Body({ schema: BulkReviewIn }) body: z.output<typeof BulkReviewIn>, @Me() me: User) {
    const failed: { id: number; label: string; error: string }[] = [];
    let done = 0;
    for (const it of body.items) {
      try {
        const review = { approve: body.approve, note: body.note ?? null };
        if (it.kind === "leave") await this.reviewLeave(it.id, review, me);
        else await this.reviewSwap(it.id, review, me);
        done++;
      } catch (e) {
        const t = it.kind === "leave" ? leaveRequests : swapRequests;
        const [row] = await db().select({ userId: t.userId }).from(t).where(eq(t.id, it.id));
        const who = row ? (await getUser(row.userId))?.name : null;
        const label = `${it.kind === "leave" ? "Izin/sakit" : "Tukar shift"} · ${who ?? `#${it.id}`}`;
        failed.push({ id: it.id, label, error: e instanceof HttpError ? String(e.detail) : "Gagal diproses." });
      }
    }
    return { done, failed };
  }
}
