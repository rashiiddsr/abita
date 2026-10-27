/** Endpoint karyawan yang masuk: profil, rekap, jadwal, notifikasi, izin/sakit, tukar shift. */
import { randomBytes } from "node:crypto";
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Response } from "express";
import { z } from "zod";
import {
  AppNotification,
  LeaveIn,
  PushConfig,
  PushSubscribeIn,
  PushUnsubscribeIn,
  LeaveOut,
  MonthSummary,
  MyRecap,
  PasswordIn,
  ProfileIn,
  PublicHoliday,
  ShiftDay,
  ShiftType,
  SwapCandidate,
  SwapIn,
  SwapOut,
  SwapRespondIn,
  User as UserSchema,
  zDay,
} from "../shared";
import { hashPassword, inScope, verifyPassword } from "../core/auth";
import { settings } from "../core/config";
import { HttpError } from "../core/http";
import { getSetting } from "../core/settings";
import { magicOk, MIME_EXT, mimeOf, readStored, removeStored, saveFile } from "../core/storage";
import { addDays, diffDays, fmtD, localHm, minDay, monthKey, shiftWindow, today, weekday } from "../core/time";
import { attendedDays } from "../domain/conflicts";
import { closePasswordRequests } from "../domain/password-reset";
import { setSession } from "./auth.controller";
import { removeSubscription, saveSubscription, vapidKeys } from "../domain/push";
import { loadRange, staffDays } from "../domain/presence";
import { db, schema } from "../db";
import type { User } from "../db/schema";
import { leavesOut, notificationOut, shiftTypeOut, swapOut, swapsOut, swapCtx, userOut } from "../domain/out";
import { shiftFor } from "../domain/rules";
import { extend, holidays } from "../domain/scheduling";
import { monthSummary, notify, notifyManagers } from "../domain/services";
import { candidates, periodStatus, stage, summaryOf, validate } from "../domain/swaps";
import { IdPipe, Me, type UploadFile } from "../common/nest";
import { Returns, Upload } from "../common/swagger";
import { writePdf, writeXlsx } from "./reports.controller";

const { users, shiftTypes, shiftAssignments, swapRequests, notifications, leaveRequests } = schema;

export function cleanEmail(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (!s.includes("@") || !s.split("@").pop()!.includes(".")) throw new HttpError(422, "Format email tidak valid.");
  return s;
}

export async function emailTaken(email: string | null, excludeId: number | null): Promise<boolean> {
  if (!email) return false;
  const conds = [sql`lower(${users.email}) = ${email.toLowerCase()}`];
  if (excludeId) conds.push(ne(users.id, excludeId));
  const [r] = await db()
    .select({ id: users.id })
    .from(users)
    .where(and(...conds))
    .limit(1);
  return !!r;
}

/** limit/offset + header X-Total-Count. */
export async function paged<T>(res: Response, total: number, rows: T[]) {
  res.setHeader("X-Total-Count", String(total));
  return rows;
}

const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const RECAP_STATUS: Record<string, string> = {
  hadir: "Hadir",
  telat: "Terlambat",
  selesai: "Hadir",
  izin: "Izin",
  sakit: "Sakit",
  alpa: "Tidak hadir",
  belum: "Belum absen",
  gagal: "Gagal verifikasi",
};
const PRESENT = new Set(["hadir", "telat", "selesai", "tanpa_pulang"]);
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Menit terlambat sebenarnya (sebelum toleransi) dari jam masuk "HH:MM" dan jam mulai shift; masuk lebih awal = 0. */
function lateBy(checkIn: string | null | undefined, start: string | null | undefined): number {
  if (!checkIn || !start) return 0;
  const d = (toMin(checkIn) - toMin(start) + 1440) % 1440;
  return d > 720 ? 0 : d; // > 12 jam = masuk sebelum jam mulai (melewati tengah malam)
}

/** Rekap kehadiran satu karyawan untuk rentang [from, to] (sampai hari ini). */
async function myRecap(user: User, from: string, to: string) {
  if (!zDay.safeParse(from).success || !zDay.safeParse(to).success || to < from || diffDays(to, from) > 366) throw new HttpError(422, "Rentang tanggal tidak valid (maks. 1 tahun).");
  const t = today();
  const end = minDay(to, t);
  const days = from <= end ? staffDays(await loadRange([user], from, end), user.id, from, end, t) : [];
  const present = days.filter((d) => PRESENT.has(d.status));
  const late = present.filter((d) => (d.late_minutes ?? 0) > 0).length;
  const n = (s: string) => days.filter((d) => d.status === s).length;
  return {
    start: from,
    end: to,
    label: from === to ? fmtD(from) : `${fmtD(from)} – ${fmtD(to)}`,
    scheduled: days.filter((d) => d.shift).length,
    present: present.length,
    on_time: present.length - late,
    late,
    izin: n("izin"),
    sakit: n("sakit"),
    absent: n("alpa"),
    punctuality_pct: present.length ? Math.round(((present.length - late) / present.length) * 1000) / 10 : null,
    days,
  };
}

@ApiTags("Akun saya")
@Controller()
export class MeController {
  // ------------------------------------------------------------------ profil

  @Put("me/profile")
  @Returns(UserSchema)
  async profile(@Body({ schema: ProfileIn }) body: z.output<typeof ProfileIn>, @Me() user: User) {
    const email = cleanEmail(body.email);
    if (await emailTaken(email, user.id)) throw new HttpError(409, "Email sudah dipakai akun lain.");
    const name = body.name?.trim() || user.name;
    if (user.role === "staff" && name !== user.name) throw new HttpError(403, "Nama karyawan hanya bisa diubah Admin SDM atau Kepala Unit.");
    const set = { name, email, phone: (body.phone ?? "").trim() || null };
    await db().update(users).set(set).where(eq(users.id, user.id));
    return userOut({ ...user, ...set });
  }

  /** Foto profil — hanya tampilan, TIDAK dipakai untuk verifikasi wajah. */
  @Post("me/avatar")
  @Returns(UserSchema)
  @HttpCode(200)
  @Upload({ photo: "file" }, ["photo"])
  @UseInterceptors(FileInterceptor("photo", { limits: { fileSize: 3 * 1024 * 1024 + 1 } }))
  async avatar(@UploadedFile() photo: UploadFile | undefined, @Me() user: User) {
    const mime = (photo?.mimetype ?? "").toLowerCase();
    if (!photo || !["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new HttpError(422, "Foto harus JPG, PNG, atau WEBP.");
    if (photo.size > 3 * 1024 * 1024) throw new HttpError(422, "Ukuran foto maksimal 3 MB.");
    if (!magicOk(mime, photo.buffer)) throw new HttpError(422, "Isi file tidak sesuai jenisnya.");
    const rel = await saveFile(`avatars/${user.id}-${randomBytes(4).toString("hex")}${MIME_EXT[mime]}`, photo.buffer);
    await db().update(users).set({ avatarPath: rel }).where(eq(users.id, user.id));
    await removeStored(user.avatarPath);
    return userOut({ ...user, avatarPath: rel });
  }

  @Delete("me/avatar")
  @Returns(UserSchema)
  async deleteAvatar(@Me() user: User) {
    if (user.avatarPath) {
      await removeStored(user.avatarPath);
      await db().update(users).set({ avatarPath: null }).where(eq(users.id, user.id));
    }
    return userOut({ ...user, avatarPath: null });
  }

  @Get("users/:id/avatar")
  async getAvatar(@Param("id", IdPipe) id: number, @Res() res: Response) {
    const [u] = await db().select({ p: users.avatarPath }).from(users).where(eq(users.id, id));
    const data = await readStored(u?.p);
    if (!data) throw new HttpError(404, "Foto tidak ditemukan.");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.type(mimeOf(u!.p!)).send(data);
  }

  @Post("me/password")
  @HttpCode(204)
  async password(@Body({ schema: PasswordIn }) body: z.output<typeof PasswordIn>, @Me() user: User, @Res({ passthrough: true }) res: Response) {
    if (!(await verifyPassword(body.old_password, user.passwordHash))) throw new HttpError(400, "Kata sandi lama salah.");
    if (body.old_password === body.new_password) throw new HttpError(422, "Kata sandi baru harus berbeda dari kata sandi lama.");
    if (!(/\p{L}/u.test(body.new_password) && /\d/.test(body.new_password))) throw new HttpError(422, "Kata sandi baru harus memuat huruf dan angka.");
    await db()
      .update(users)
      .set({ passwordHash: await hashPassword(body.new_password), mustChangePassword: false, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id));
    await closePasswordRequests(user.id); // kata sandi dari Lupa kata sandi tidak dikirim ulang lagi
    // perangkat lain keluar; perangkat ini tetap masuk dengan sesi baru
    const [fresh] = await db().select().from(users).where(eq(users.id, user.id));
    setSession(res, fresh, true, fresh.role === "staff");
  }

  // ------------------------------------------------------------------ rekap & jadwal

  /** Rekap kehadiran sendiri untuk rentang tanggal (maks. 1 tahun): ringkasan + per hari. Menu Shift › Rekap. */
  @Get("me/recap")
  @Returns(MyRecap)
  async recap(@Query("from") from: string, @Query("to") to: string, @Me() user: User) {
    return myRecap(user, from, to);
  }

  /** Unduh rekap kehadiran sendiri sebagai PDF (default) atau Excel (`format=xlsx`). */
  @Get("me/recap/export")
  async recapExport(@Query("from") from: string, @Query("to") to: string, @Query("format") format: string | undefined, @Me() user: User, @Res() res: Response) {
    if (format && format !== "pdf" && format !== "xlsx") throw new HttpError(422, "Format harus pdf atau xlsx.");
    const r = await myRecap(user, from, to);
    const header = ["Tanggal", "Shift", "Masuk", "Pulang", "Terlambat (mnt)", "Status"];
    const rows = [...r.days]
      .reverse()
      .map((d) => [
        `${HARI[weekday(d.date)]}, ${fmtD(d.date)}`,
        d.shift ? `${d.shift.name} ${d.shift.start}–${d.shift.end}` : "-",
        d.check_in ?? "-",
        d.check_out ?? "-",
        lateBy(d.check_in, d.shift?.start) || "-",
        RECAP_STATUS[d.status] ?? d.status,
      ]);
    const notes = [
      `Hari kerja ${r.scheduled}`,
      `Hadir ${r.present}`,
      `Tepat waktu ${r.on_time}`,
      `Terlambat ${r.late}`,
      `Izin ${r.izin}`,
      `Sakit ${r.sakit}`,
      `Tidak hadir ${r.absent}`,
      `Ketepatan ${r.punctuality_pct === null ? "-" : `${r.punctuality_pct}%`}`,
    ];
    const title = `Rekap Kehadiran · ${user.name} (${user.employeeCode}) · ${r.label}`;
    const xlsx = format === "xlsx";
    const buf = xlsx ? await writeXlsx(title, header, rows, null, notes) : await writePdf(title, header, rows, notes);
    res.setHeader("Content-Disposition", `attachment; filename="Rekap_${user.employeeCode}_${r.start}_${r.end}.${xlsx ? "xlsx" : "pdf"}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.type(xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf").send(buf);
  }

  @Get("me/summary")
  @Returns(MonthSummary)
  async summary(@Query("month") month: string | undefined, @Me() user: User) {
    if (month && !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(422, "Format bulan harus YYYY-MM.");
    return monthSummary(user.id, month ?? null);
  }

  @Get("shift-types")
  @Returns(ShiftType, { list: true })
  async shiftTypes() {
    const rows = await db().select().from(shiftTypes).where(eq(shiftTypes.active, true)).orderBy(asc(shiftTypes.startTime));
    return rows.map(shiftTypeOut);
  }

  @Get("me/shifts")
  @Returns(ShiftDay, { list: true })
  async shifts(@Query("from") from: string | undefined, @Query("to") to: string | undefined, @Me() user: User) {
    const start = from ?? today();
    const end = to ?? addDays(start, 13);
    if (![start, end].every((d) => zDay.safeParse(d).success)) throw new HttpError(422, "Format tanggal YYYY-MM-DD.");
    if (diffDays(end, start) > 62) throw new HttpError(422, "Rentang maksimal 62 hari.");
    await extend([user.id], end);
    const rows = await db()
      .select({ a: shiftAssignments, t: shiftTypes })
      .from(shiftAssignments)
      .innerJoin(shiftTypes, eq(shiftTypes.id, shiftAssignments.shiftTypeId))
      .where(and(eq(shiftAssignments.userId, user.id), gte(shiftAssignments.date, start), lte(shiftAssignments.date, end)))
      .orderBy(asc(shiftAssignments.date));
    const published = new Map<string, boolean>();
    for (const m of new Set(rows.map((r) => monthKey(r.a.date)))) published.set(m, (await periodStatus(user.unit, m)) === "published");
    const pending = new Set<string>();
    for (const r of await db()
      .select()
      .from(swapRequests)
      .where(and(eq(swapRequests.status, "pending"), or(eq(swapRequests.userId, user.id), eq(swapRequests.targetUserId, user.id))))) {
      pending.add(r.date);
      pending.add(r.targetDate ?? r.date);
    }
    return rows.filter((r) => published.get(monthKey(r.a.date))).map((r) => ({ date: r.a.date, user_id: r.a.userId, shift: shiftTypeOut(r.t), pending_swap: pending.has(r.a.date) }));
  }

  /** Hari libur dalam rentang (tab Jadwal aplikasi karyawan). */
  @Get("holidays")
  @Returns(PublicHoliday, { list: true })
  async holidays(@Query("from") from: string, @Query("to") to: string) {
    if (!zDay.safeParse(from).success || !zDay.safeParse(to).success) throw new HttpError(422, "Format tanggal YYYY-MM-DD.");
    if (diffDays(to, from) > 400) throw new HttpError(422, "Rentang terlalu panjang.");
    return [...(await holidays(from, to))].sort().map(([date, name]) => ({ date, name }));
  }

  // ------------------------------------------------------------------ notifikasi

  // ============================================================ Web Push (aplikasi karyawan)

  /** Kunci publik VAPID untuk berlangganan + jumlah perangkat akun ini yang menerima push. */
  @Get("me/push")
  @Returns(PushConfig)
  async pushConfig(@Me() me: User) {
    staffOnly(me);
    const [{ n }] = await db().select({ n: count() }).from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, me.id));
    return { public_key: (await vapidKeys()).publicKey, devices: n };
  }

  /** Daftarkan perangkat/browser ini untuk notifikasi push. */
  @Post("me/push")
  @HttpCode(204)
  async pushSubscribe(@Body({ schema: PushSubscribeIn }) body: z.output<typeof PushSubscribeIn>, @Me() me: User, @Headers("user-agent") ua: string | undefined) {
    staffOnly(me);
    await saveSubscription(me.id, body, ua || null);
  }

  /** Berhenti menerima push di perangkat/browser ini. */
  @Post("me/push/unsubscribe")
  @HttpCode(204)
  async pushUnsubscribe(@Body({ schema: PushUnsubscribeIn }) body: z.output<typeof PushUnsubscribeIn>, @Me() me: User) {
    await removeSubscription(me.id, body.endpoint);
  }

  @Get("me/notifications")
  @Returns(AppNotification, { list: true })
  async notifications(@Query("limit") limit = "50", @Query("offset") offset = "0", @Me() user: User, @Res({ passthrough: true }) res: Response) {
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    const where = eq(notifications.userId, user.id);
    const [{ n }] = await db().select({ n: count() }).from(notifications).where(where);
    const rows = await db().select().from(notifications).where(where).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(lim).offset(off);
    return paged(res, n, rows.map(notificationOut));
  }

  @Post("me/notifications/read-all")
  @HttpCode(204)
  async readAll(@Me() user: User) {
    await db()
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  }

  /** Detail satu notifikasi milik sendiri; dibuka = otomatis ditandai dibaca. */
  @Get("me/notifications/:id")
  @Returns(AppNotification)
  async notification(@Param("id", IdPipe) id: number, @Me() user: User) {
    const [n] = await db().select().from(notifications).where(eq(notifications.id, id));
    if (!n || n.userId !== user.id) throw new HttpError(404, "Notifikasi tidak ditemukan.");
    if (!n.readAt) {
      n.readAt = new Date();
      await db().update(notifications).set({ readAt: n.readAt }).where(eq(notifications.id, id));
    }
    return notificationOut(n);
  }

  @Post("me/notifications/:id/read")
  @HttpCode(204)
  async readOne(@Param("id", IdPipe) id: number, @Me() user: User) {
    const [n] = await db().select().from(notifications).where(eq(notifications.id, id));
    if (!n || n.userId !== user.id) throw new HttpError(404, "Notifikasi tidak ditemukan.");
    if (!n.readAt) await db().update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
  }

  // ------------------------------------------------------------------ izin / sakit

  @Get("me/leaves")
  @Returns(LeaveOut, { list: true })
  async leaves(@Query("limit") limit = "100", @Query("offset") offset = "0", @Me() user: User, @Res({ passthrough: true }) res: Response) {
    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    const where = eq(leaveRequests.userId, user.id);
    const [{ n }] = await db().select({ n: count() }).from(leaveRequests).where(where);
    const rows = await db()
      .select()
      .from(leaveRequests)
      .where(where)
      .orderBy(desc(leaveRequests.createdAt), desc(leaveRequests.id))
      .limit(lim)
      .offset(Math.max(0, Number(offset) || 0));
    return paged(res, n, await leavesOut(rows, false));
  }

  @Post("me/leaves")
  @Returns(LeaveOut, { status: 201 })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("attachment", { limits: { fileSize: settings.MAX_ATTACHMENT_MB * 1024 * 1024 + 1 } }))
  async createLeave(@Body({ schema: LeaveIn }) form: z.output<typeof LeaveIn>, @UploadedFile() file: UploadFile | undefined, @Me() user: User) {
    const { kind, start_date: start, end_date: end, reason } = form;
    const hasFile = !!file && !!file.originalname;
    await validateLeave(user, kind, start, end, hasFile);
    let path: string | null = null,
      mime: string | null = null;
    if (hasFile) [path, mime] = await saveAttachment(file!);
    const [{ id }] = await db()
      .insert(leaveRequests)
      .values({ userId: user.id, kind, startDate: start, endDate: end, reason: reason.trim(), attachmentPath: path, attachmentMime: mime })
      .$returningId();
    const span = fmtD(start) + (end !== start ? ` – ${fmtD(end)}` : "");
    await notifyManagers(user, "leave", `Pengajuan ${kind} · ${user.name}`, `${span} · ${reason.trim().slice(0, 80)}`, `/requests/${id}`);
    const [lv] = await db().select().from(leaveRequests).where(eq(leaveRequests.id, id));
    return (await leavesOut([lv], false))[0];
  }

  /** Batalkan izin/sakit sendiri: yang masih menunggu, atau yang sudah disetujui selama tanggalnya belum dimulai. */
  @Post("me/leaves/:id/cancel")
  @Returns(LeaveOut)
  @HttpCode(200)
  async cancelLeave(@Param("id", IdPipe) id: number, @Me() user: User) {
    const [lv] = await db().select().from(leaveRequests).where(eq(leaveRequests.id, id));
    if (!lv || lv.userId !== user.id) throw new HttpError(404, "Pengajuan tidak ditemukan.");
    if (lv.status !== "pending" && !(lv.status === "approved" && lv.startDate > today()))
      throw new HttpError(409, lv.status === "approved" ? "Pengajuan yang sudah berjalan tidak bisa dibatalkan. Hubungi Kepala Unit." : "Pengajuan ini sudah diproses.");
    await db().update(leaveRequests).set({ status: "cancelled" }).where(eq(leaveRequests.id, id));
    const span = fmtD(lv.startDate) + (lv.endDate !== lv.startDate ? ` – ${fmtD(lv.endDate)}` : "");
    await notifyManagers(user, "leave", `Pengajuan ${lv.kind} dibatalkan · ${user.name}`, span, `/requests/${id}`);
    return (await leavesOut([{ ...lv, status: "cancelled" }], false))[0];
  }

  @Get("leaves/:id/attachment")
  async attachment(@Param("id", IdPipe) id: number, @Me() user: User, @Res() res: Response) {
    const [lv] = await db().select().from(leaveRequests).where(eq(leaveRequests.id, id));
    if (!lv || !lv.attachmentPath) throw new HttpError(404, "Lampiran tidak ditemukan.");
    if (lv.userId !== user.id) {
      const [owner] = await db().select({ unit: users.unit }).from(users).where(eq(users.id, lv.userId));
      if (!["admin", "unit_head"].includes(user.role) || !inScope(user, owner?.unit)) throw new HttpError(404, "Lampiran tidak ditemukan.");
    }
    const data = await readStored(lv.attachmentPath);
    if (!data) throw new HttpError(404, "Lampiran tidak ditemukan.");
    res.setHeader("Cache-Control", "private, no-store");
    res.type(lv.attachmentMime ?? "application/octet-stream").send(data);
  }

  // ------------------------------------------------------------------ tukar shift

  @Get("me/swaps")
  @Returns(SwapOut, { list: true })
  async swaps(@Query("limit") limit = "100", @Query("offset") offset = "0", @Me() user: User, @Res({ passthrough: true }) res: Response) {
    const where = or(eq(swapRequests.userId, user.id), eq(swapRequests.targetUserId, user.id));
    const [{ n }] = await db().select({ n: count() }).from(swapRequests).where(where);
    const rows = await db()
      .select()
      .from(swapRequests)
      .where(where)
      .orderBy(desc(swapRequests.createdAt), desc(swapRequests.id))
      .limit(Math.min(500, Math.max(1, Number(limit) || 100)))
      .offset(Math.max(0, Number(offset) || 0));
    return paged(res, n, await swapsOut(rows, { viewer: user }));
  }

  /** Rekan satu unit yang bisa diajak tukar beserta shift mereka pada tanggal tujuan. */
  @Get("me/swap-candidates")
  @Returns(SwapCandidate, { list: true })
  async swapCandidates(@Query("date") d1: string, @Query("target_date") d2: string | undefined, @Me() user: User) {
    if (!zDay.safeParse(d1).success || (d2 && !zDay.safeParse(d2).success)) throw new HttpError(422, "Format tanggal YYYY-MM-DD.");
    return (await candidates(user, d1, d2 || d1)).map(([u, a]) => ({ user_id: u.id, name: u.name, employee_code: u.employeeCode, shift: shiftTypeOut(a.shiftType) }));
  }

  @Post("me/swaps")
  @Returns(SwapOut, { status: 201 })
  async createSwap(@Body({ schema: SwapIn }) body: z.output<typeof SwapIn>, @Me() user: User) {
    const d2 = body.target_date ?? body.date;
    const [mine, theirs, target] = await validate(user, body.target_user_id, body.date, d2);
    const [{ id }] = await db()
      .insert(swapRequests)
      .values({
        userId: user.id,
        date: body.date,
        fromShiftTypeId: mine.shiftTypeId,
        toShiftTypeId: theirs.shiftTypeId,
        targetUserId: target.id,
        targetDate: d2,
        peerStatus: null, // tanpa persetujuan rekan: langsung ke Kepala Unit
        reason: body.reason.trim(),
      })
      .$returningId();
    const s = await getSwap(id);
    const sum = await summaryOf(s);
    await notify(target.id, "swap", `${user.name} mengajukan tukar shift dengan Anda`, `${sum} · menunggu keputusan Kepala Unit`);
    await notifyManagers(user, "swap", `Tukar shift · ${user.name} ↔ ${target.name}`, sum, `/requests/swap/${s.id}`);
    return swapOut(s, await swapCtx([s]), { viewer: user });
  }

  /** Pengajuan lama yang masih menunggu rekan: rekan menerima / menolak. Pengajuan baru langsung ke Kepala Unit. */
  @Post("me/swaps/:id/respond")
  @Returns(SwapOut)
  @HttpCode(200)
  async respond(@Param("id", IdPipe) id: number, @Body({ schema: SwapRespondIn }) body: z.output<typeof SwapRespondIn>, @Me() user: User) {
    const s = await getSwap(id).catch(() => null);
    if (!s || s.targetUserId !== user.id) throw new HttpError(404, "Permintaan tidak ditemukan.");
    if (stage(s) !== "peer") throw new HttpError(409, "Permintaan ini sudah dijawab.");
    const note = (body.note ?? "").trim() || null;
    const set: Partial<typeof s> = { peerStatus: body.accept ? "accepted" : "declined", peerNote: note, peerRespondedAt: new Date() };
    if (!body.accept) set.status = "rejected";
    await db().update(swapRequests).set(set).where(eq(swapRequests.id, id));
    const after = { ...s, ...set };
    const sum = await summaryOf(after);
    const [requester] = await db().select().from(users).where(eq(users.id, s.userId));
    if (body.accept) {
      await notify(s.userId, "swap", `${user.name} menerima tukar shift`, `${sum} · menunggu Kepala Unit`);
      await notifyManagers(requester, "swap", `Tukar shift · ${requester.name} ↔ ${user.name}`, sum, `/requests/swap/${s.id}`);
    } else await notify(s.userId, "swap", `${user.name} menolak tukar shift`, note ?? sum);
    return swapOut(after, await swapCtx([after]), { viewer: user });
  }

  @Post("me/swaps/:id/cancel")
  @Returns(SwapOut)
  @HttpCode(200)
  async cancel(@Param("id", IdPipe) id: number, @Me() user: User) {
    const s = await getSwap(id).catch(() => null);
    if (!s || s.userId !== user.id) throw new HttpError(404, "Pengajuan tidak ditemukan.");
    if (s.status !== "pending") throw new HttpError(409, "Pengajuan ini sudah diproses.");
    const wasReview = stage(s) === "review"; // rekan sudah menerima: Kepala Unit sudah diberi tahu
    await db().update(swapRequests).set({ status: "cancelled" }).where(eq(swapRequests.id, id));
    const after = { ...s, status: "cancelled" };
    const sum = await summaryOf(after);
    if (s.targetUserId) await notify(s.targetUserId, "swap", `${user.name} membatalkan tukar shift`, sum);
    if (wasReview) await notifyManagers(user, "swap", `Tukar shift dibatalkan · ${user.name}`, sum, `/requests/swap/${s.id}`);
    return swapOut(after, await swapCtx([after]), { viewer: user });
  }
}

export async function getSwap(id: number) {
  const [s] = await db().select().from(swapRequests).where(eq(swapRequests.id, id));
  if (!s) throw new HttpError(404, "Pengajuan tidak ditemukan.");
  return s;
}

async function validateLeave(user: User, kind: string, start: string, end: string, hasAttachment: boolean) {
  const t = today();
  if (kind !== "izin" && kind !== "sakit") throw new HttpError(422, "Jenis pengajuan harus izin atau sakit.");
  if (end < start) throw new HttpError(422, "Tanggal selesai tidak boleh sebelum tanggal mulai.");
  if (diffDays(end, start) > 30) throw new HttpError(422, "Pengajuan maksimal 31 hari.");
  if (kind === "sakit") {
    if (!hasAttachment) throw new HttpError(422, "Pengajuan sakit wajib melampirkan Surat Keterangan Dokter (SKD).");
    if (start < addDays(t, -7)) throw new HttpError(422, "Pengajuan sakit maksimal 7 hari ke belakang.");
  } else {
    if (start < t) throw new HttpError(422, "Izin tidak bisa diajukan untuk tanggal yang sudah lewat.");
    // izin hari ini hanya sebelum shift dimulai; setelah itu ketidakhadiran tidak bisa diubah menjadi izin
    const sh = start === t ? await shiftFor(user.id, t) : null;
    if (sh) {
      const [begin] = shiftWindow(t, sh.shiftType.startTime, sh.shiftType.endTime);
      if (begin <= new Date()) throw new HttpError(422, `Izin untuk hari ini harus diajukan sebelum shift ${sh.shiftType.name} dimulai (${localHm(begin)}). Bila sakit, ajukan sakit dengan SKD.`);
    }
  }
  const [overlap] = await db()
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.userId, user.id), inArray(leaveRequests.status, ["pending", "approved"]), lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)))
    .limit(1);
  if (overlap) throw new HttpError(409, "Sudah ada pengajuan lain pada tanggal tersebut.");
  // satu tanggal satu keadaan: hari yang sudah diabsen tidak bisa sekaligus izin/sakit
  const attended = await attendedDays(user.id, start, end);
  if (attended.length)
    throw new HttpError(409, `Anda sudah absen pada ${fmtD(attended[0])}; ${kind} tidak bisa diajukan untuk tanggal itu. Bila sakit di tengah shift, minta Kepala Unit mengoreksi jam pulang.`);
  const [swap] = await db()
    .select({ date: swapRequests.date, targetDate: swapRequests.targetDate })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.status, "pending"),
        or(eq(swapRequests.userId, user.id), eq(swapRequests.targetUserId, user.id)),
        or(and(gte(swapRequests.date, start), lte(swapRequests.date, end)), and(gte(swapRequests.targetDate, start), lte(swapRequests.targetDate, end))),
      ),
    )
    .limit(1);
  if (swap) throw new HttpError(409, "Masih ada tukar shift yang menunggu keputusan pada tanggal tersebut. Batalkan tukar shift itu terlebih dahulu.");
}

async function saveAttachment(f: UploadFile): Promise<[string, string]> {
  const mime = (f.mimetype ?? "").toLowerCase();
  if (!(mime in MIME_EXT)) throw new HttpError(422, "Lampiran harus foto (JPG/PNG/WEBP) atau PDF.");
  if (f.size > settings.MAX_ATTACHMENT_MB * 1024 * 1024) throw new HttpError(422, `Ukuran lampiran maksimal ${settings.MAX_ATTACHMENT_MB} MB.`);
  if (!magicOk(mime, f.buffer)) throw new HttpError(422, "Isi file lampiran tidak sesuai jenisnya.");
  return [await saveFile(`leaves/${randomBytes(16).toString("hex")}${MIME_EXT[mime]}`, f.buffer), mime];
}

/** Web Push hanya untuk akun karyawan (aplikasi /staff). */
function staffOnly(me: User) {
  if (me.role !== "staff") throw new HttpError(403, "Notifikasi push hanya untuk aplikasi karyawan.");
}
