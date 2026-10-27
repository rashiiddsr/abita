/** Dasbor: akun pengguna, reset wajah, absensi per tanggal, percobaan verifikasi, lokasi kantor. */
import { Body, Controller, Get, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { AttemptOut, AttendanceWithUser, CreatedUserOut, Office, OfficeIn, User as UserSchema, UserCreateIn, zDay } from "../shared";
import { ensureScope, hashPassword, ownUnit, scopeUnits } from "../core/auth";
import { HttpError } from "../core/http";
import { readStored } from "../core/storage";
import { addDays, startOfDay, today } from "../core/time";
import { db, schema } from "../db";
import type { User } from "../db/schema";
import { credentialsEmail, generatePassword, trySend } from "../domain/mailer";
import { attendanceOut, officeOut, userOut } from "../domain/out";
import { appUrl, notify, scopeCond, syncUnitHead, withLedUnits } from "../domain/services";
import { IdPipe, Me, Roles } from "../common/nest";
import { Returns } from "../common/swagger";
import { cleanEmail, emailTaken } from "./me.controller";

const { users, offices, attendances, attempts } = schema;


export async function getUser(id: number): Promise<User | null> {
  const [u] = await db().select().from(users).where(eq(users.id, id));
  return u ?? null;
}

/** Akun yang boleh dikelola penampil: Admin SDM semua, Kepala Unit hanya karyawan (staff) unitnya. */
export function staffTarget(me: User, user: User | null): User {
  if (!user) throw new HttpError(404, "Pengguna tidak ditemukan.");
  if (me.role === "unit_head") {
    ensureScope(me, user);
    if (user.role !== "staff") throw new HttpError(403, "Kepala Unit hanya bisa mengelola akun karyawan unitnya.");
  }
  return user;
}

export async function defaultOffice() {
  const [o] = await db().select().from(offices).orderBy(asc(offices.id)).limit(1);
  return o ?? null;
}

const day = (d: string | undefined) => {
  if (!d) return today();
  if (!zDay.safeParse(d).success) throw new HttpError(422, "Format tanggal harus YYYY-MM-DD.");
  return d;
};

@ApiTags("Admin · Akun & kantor")
@Controller("admin")
@Roles("manager")
export class AdminController {
  @Get("users")
  @Returns(UserSchema, { list: true })
  async list(@Query("role") role: string | undefined, @Me() me: User) {
    let where;
    if (scopeUnits(me) !== null) {
      // Kepala Unit: hanya staff unit-unitnya (tidak punya menu Kelola Admin)
      if (role && role !== "staff") throw new HttpError(403, "Kepala Unit hanya bisa melihat karyawan unitnya.");
      where = and(scopeCond(me), eq(users.role, "staff"));
    } else if (role === "manager") where = inArray(users.role, ["admin", "unit_head"]);
    else if (role) where = eq(users.role, role);
    const rows = await db().select().from(users).where(where).orderBy(asc(users.name));
    return (await withLedUnits(rows)).map((u) => userOut(u));
  }

  /** Admin SDM: semua akun. Kepala Unit: hanya akun karyawan (staff) di unitnya sendiri. */
  @Post("users")
  @Returns(CreatedUserOut, { status: 201 })
  async create(@Body({ schema: UserCreateIn }) body: z.output<typeof UserCreateIn>, @Me() me: User, @Req() req: Request) {
    if (me.role === "unit_head") {
      if (body.role !== "staff") throw new HttpError(403, "Kepala Unit hanya bisa membuat akun karyawan.");
      body.unit = ownUnit(me, body.unit?.trim() || null); // salah satu unit yang dipimpinnya
    }
    if (body.role === "unit_head" && body.head_units?.length) body.unit = body.head_units[0];
    const code = body.employee_code.trim();
    if (!(body.email ?? "").trim()) throw new HttpError(422, "Email wajib diisi.");
    if (!(body.phone ?? "").trim()) throw new HttpError(422, "Nomor HP wajib diisi.");
    if (body.role === "staff" && !(body.institution ?? "").trim()) throw new HttpError(422, "Institusi pendidikan / vendor wajib diisi.");
    const [dup] = await db().select({ id: users.id }).from(users).where(eq(users.employeeCode, code));
    if (dup) throw new HttpError(409, body.role === "staff" ? "NIK sudah dipakai." : "Kode karyawan sudah dipakai.");
    let officeId = body.office_id ?? null;
    if (officeId === null) officeId = (await defaultOffice())?.id ?? null;
    else if (!(await db().select().from(offices).where(eq(offices.id, officeId))).length) throw new HttpError(422, "Kantor tidak ditemukan.");
    const email = cleanEmail(body.email);
    if (await emailTaken(email, null)) throw new HttpError(409, "Email sudah dipakai akun lain.");
    const password = body.password || generatePassword();
    const [{ id }] = await db()
      .insert(users)
      .values({
        employeeCode: code,
        name: body.name.trim(),
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        role: body.role,
        officeId,
        email,
        phone: (body.phone ?? "").trim() || null,
        employmentType: body.employment_type ?? null,
        unit: (body.unit ?? "").trim() || null,
        institution: (body.institution ?? "").trim() || null,
        periodStart: body.period_start ?? null,
        isActive: true,
      })
      .$returningId();
    let user = (await getUser(id))!;
    await syncUnitHead(user, body.head_units);
    user = (await withLedUnits([(await getUser(id))!]))[0];
    // kredensial dikirim ke email; bila gagal, kata sandi ditampilkan sekali ke admin
    const login = user.role !== "staff" ? user.email! : `${user.email} / NIK ${user.employeeCode}`;
    const err = await trySend(user.email, ...credentialsEmail(user.name, login, password, user.role === "staff", appUrl(req.headers.origin)));
    // akun baru satu per satu: kata sandi selalu ditampilkan sekali ke admin (juga dikirim ke email)
    return { user: userOut(user), credentials: { email_sent: err === null, email_error: err, temp_password: password } };
  }

  @Post("users/:id/reset-face")
  @Returns(UserSchema, { status: 201 })
  async resetFace(@Param("id", IdPipe) id: number, @Me() me: User) {
    const user = staffTarget(me, await getUser(id));
    await db().update(users).set({ faceEmbedding: null, faceEnrolledAt: null }).where(eq(users.id, user.id));
    await notify(user.id, "system", "Data wajah direset", "Daftarkan wajah Anda kembali saat membuka aplikasi.");
    return userOut({ ...user, faceEmbedding: null, faceEnrolledAt: null });
  }

  @Get("attendance")
  @Returns(AttendanceWithUser, { list: true })
  @Roles("monitor")
  async attendance(@Query("date") date: string | undefined, @Me() me: User) {
    const d = day(date);
    const conds = [eq(attendances.workDate, d)];
    const scope = scopeCond(me);
    if (scope) conds.push(scope);
    const rows = await db()
      .select({ a: attendances, u: users })
      .from(attendances)
      .innerJoin(users, eq(users.id, attendances.userId))
      .where(and(...conds))
      .orderBy(asc(users.employeeCode), asc(attendances.type));
    return rows.map(({ a, u }) => ({ ...attendanceOut(a), employee_code: u.employeeCode, name: u.name }));
  }

  @Get("attendance/:id/photo")
  @Roles("monitor")
  async photo(@Param("id", IdPipe) id: number, @Me() me: User, @Res() res: Response) {
    const [a] = await db().select().from(attendances).where(eq(attendances.id, id));
    if (!a || !a.photoPath) throw new HttpError(404, "Foto tidak ditemukan.");
    ensureScope(me, await getUser(a.userId));
    const data = await readStored(a.photoPath);
    if (!data) throw new HttpError(404, "Foto tidak ditemukan.");
    res.setHeader("Cache-Control", "private, no-store");
    res.type("image/jpeg").send(data);
  }

  @Get("attempts")
  @Returns(AttemptOut, { list: true })
  @Roles("monitor")
  async attempts(@Query("date") date: string | undefined, @Me() me: User) {
    const d = day(date);
    const conds = [gte(attempts.createdAt, startOfDay(d)), lt(attempts.createdAt, startOfDay(addDays(d, 1)))];
    const scope = scopeCond(me);
    if (scope) conds.push(scope);
    const rows = await db()
      .select({ a: attempts, u: users })
      .from(attempts)
      .innerJoin(users, eq(users.id, attempts.userId))
      .where(and(...conds))
      .orderBy(desc(attempts.createdAt));
    return rows.map(({ a, u }) => ({
      id: a.id,
      session_id: a.sessionId,
      user_id: a.userId,
      employee_code: u.employeeCode,
      name: u.name,
      purpose: a.purpose,
      success: a.success,
      reason_code: a.reasonCode,
      scores: a.scores,
      lat: a.lat,
      lng: a.lng,
      accuracy: a.accuracy,
      distance_m: a.distanceM,
      created_at: a.createdAt,
    }));
  }

  @Get("office")
  @Returns(Office)
  async office() {
    const o = await defaultOffice();
    if (!o) throw new HttpError(404, "Kantor belum dibuat.");
    return officeOut(o);
  }

  @Put("office")
  @Returns(Office)
  @Roles("hr")
  async putOffice(@Body({ schema: OfficeIn }) body: z.output<typeof OfficeIn>) {
    const o = await defaultOffice();
    const v = { name: body.name, lat: body.lat, lng: body.lng, radiusM: body.radius_m, address: body.address ?? null };
    if (!o) {
      const [{ id }] = await db().insert(offices).values(v).$returningId();
      await db().update(users).set({ officeId: id }).where(isNull(users.officeId)); // akun yang dibuat sebelum kantor ada
    } else await db().update(offices).set(v).where(eq(offices.id, o.id));
    return officeOut((await defaultOffice())!);
  }
}
