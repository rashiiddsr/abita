import { Body, Controller, Get, HttpCode, Post, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { and, eq, gt, or, sql } from "drizzle-orm";
import type { Response } from "express";
import { z } from "zod";
import { AppConfig, ForgotIn, LoginIn, Me as MeSchema, Message, User as UserSchema } from "../shared";
import { COOKIE_NAME, createToken, verifyPassword } from "../core/auth";
import { settings } from "../core/config";
import { HttpError } from "../core/http";
import { guard, limiter, WINDOW_S } from "../core/ratelimit";
import { getSetting } from "../core/settings";
import { sessionCookie } from "../core/web";
import { db, schema } from "../db";
import type { User } from "../db/schema";
import { officeOut, userOut } from "../domain/out";
import { processPasswordQueue, requestNewPassword, useTemporaryPassword } from "../domain/password-reset";
import { audit, pendingCount, todayStatus, unreadCount } from "../domain/services";
import { scheduleReminder } from "../domain/swaps";
import { log } from "../common/logger";
import { ClientIp, Me, Public } from "../common/nest";
import { Returns } from "../common/swagger";

const { users, offices, auditLogs } = schema;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// aplikasi karyawan & dasbor admin punya halaman masuk terpisah: akun peran lain tidak bisa masuk di sana
const STAFF = ["staff"] as const;
const MANAGERS = ["admin", "unit_head"] as const;
const ANY = ["staff", "admin", "unit_head"] as const;

const LOGIN_FAILS_PER_ACCOUNT = 10; // dalam 15 menit
const LOGIN_FAILS_PER_IP = 300; // satu IP bisa dipakai ratusan karyawan (Wi-Fi RS); per akun tetap 10
const RESET_REQUESTS_PER_IP = 60;
const RESET_PER_DAY = 3; // per akun per 24 jam
const RESET_GAP_MS = 120_000; // jeda antarpermintaan per akun (2 menit)

const byEmail = (email: string) => sql`lower(${users.email}) = ${email.toLowerCase()}`;

function loginGuard(ip: string, ident: string): [string, string] {
  const keys: [string, string] = [`login:acct:${ident.trim().toLowerCase()}`, `login:ip:${ip}`];
  guard(
    [
      [keys[0], LOGIN_FAILS_PER_ACCOUNT],
      [keys[1], LOGIN_FAILS_PER_IP],
    ],
    "percobaan masuk",
  );
  return keys;
}
const loginFailed = (keys: string[]) => keys.forEach((k) => limiter.hit(k, WINDOW_S));

/**
 * Cookie sesi httpOnly. Aplikasi karyawan + "Ingat saya": SESSION_REMEMBER_DAYS hari (tidak perlu masuk tiap shift);
 * selain itu JWT_TTL_HOURS (dasbor), tanpa "Ingat saya" = cookie sesi browser.
 */
export function setSession(res: Response, user: User, remember: boolean, staffApp = false) {
  const hours = staffApp && remember ? settings.SESSION_REMEMBER_DAYS * 24 : settings.JWT_TTL_HOURS;
  res.cookie(COOKIE_NAME, createToken(user, hours), { ...sessionCookie(), maxAge: remember ? hours * 3600_000 : undefined });
}

/** Akun aktif dengan email ini untuk aplikasi tertentu (karyawan hanya staff, dasbor hanya Admin SDM / Kepala Unit). */
async function activeByEmail(identifier: string, roles: readonly string[]): Promise<User | null> {
  const email = identifier.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(422, "Masukkan email yang valid.");
  const [u] = await db().select().from(users).where(byEmail(email));
  return u && u.isActive !== false && u.email && roles.includes(u.role) ? u : null;
}

/** Batas per akun agar Lupa kata sandi tidak dipakai untuk spam email: jeda 2 menit, maks. 3 permintaan per 24 jam. */
async function requestLimit(user: User, now: Date): Promise<string | null> {
  const rows = await db()
    .select({ at: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "password_forgot"), eq(auditLogs.targetId, user.id), gt(auditLogs.createdAt, new Date(now.getTime() - 24 * 3600_000))));
  if (rows.some((r) => now.getTime() - r.at.getTime() < RESET_GAP_MS)) return "Kata sandi baru saja diminta. Tunggu 2 menit sebelum meminta lagi.";
  if (rows.length >= RESET_PER_DAY) return "Batas 3 permintaan per 24 jam tercapai. Coba lagi besok atau hubungi Admin SDM.";
  return null;
}

@ApiTags("Auth")
@Controller()
export class AuthController {
  /** Info publik untuk layar masuk (nama organisasi, kontak bantuan dari Pengaturan Admin SDM). */
  @Public()
  @Get("config")
  @Returns(AppConfig)
  async config() {
    return {
      org_name: settings.ORG_NAME,
      helpdesk_whatsapp: (await getSetting("helpdesk_whatsapp")) || settings.HELPDESK_WHATSAPP,
      helpdesk_email: (await getSetting("helpdesk_email")) || "",
      max_attachment_mb: settings.MAX_ATTACHMENT_MB,
    };
  }

  /** Aplikasi karyawan web (/staff): email atau NIK, sesi di cookie httpOnly. */
  @Public()
  @Post("auth/app-login")
  @Returns(UserSchema)
  @HttpCode(200)
  async appLogin(@Body({ schema: LoginIn }) body: z.output<typeof LoginIn>, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    const user = await this.check(body.employee_code, body.password, ip, false, STAFF);
    setSession(res, user, body.remember, true);
    return userOut(user);
  }

  /** Dasbor admin (/admin): email, sesi di cookie httpOnly (tidak bisa dibaca JavaScript). */
  @Public()
  @Post("auth/web-login")
  @Returns(UserSchema)
  @HttpCode(200)
  async webLogin(@Body({ schema: LoginIn }) body: z.output<typeof LoginIn>, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    const email = body.employee_code.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(422, "Masukkan email yang valid.");
    const user = await this.check(email, body.password, ip, true, MANAGERS);
    setSession(res, user, body.remember);
    return userOut(user);
  }

  /**
   * Email/NIK + kata sandi untuk aplikasi tertentu. Akun peran lain (mis. akun admin di aplikasi karyawan) diperlakukan
   * sama persis dengan kata sandi salah: pesan sama, ikut dihitung percobaan gagal, tidak membocorkan akun mana yang ada.
   */
  private async check(ident: string, password: string, ip: string, emailOnly: boolean, roles: readonly string[]): Promise<User> {
    const keys = loginGuard(ip, ident);
    const id = ident.trim();
    const [user] = await db()
      .select()
      .from(users)
      .where(emailOnly ? byEmail(id) : or(eq(users.employeeCode, id), byEmail(id)));
    // kata sandi akun, atau kata sandi sementara dari "Lupa kata sandi" (kata sandi lama tetap berlaku sampai itu dipakai)
    const ok = !!user && ((await verifyPassword(password, user.passwordHash)) || (roles.includes(user.role) && (await useTemporaryPassword(user, password))));
    if (!user || !ok || !roles.includes(user.role)) {
      loginFailed(keys);
      throw new HttpError(401, emailOnly ? "Email atau kata sandi salah." : "Email/NIK atau kata sandi salah.");
    }
    limiter.reset(keys[0]);
    if (user.isActive === false) throw new HttpError(403, "Akun Anda tidak aktif. Hubungi admin.");
    // kata sandi sementara baru saja dipakai: muat ulang (hash, must_change_password, session_version)
    const [fresh] = await db().select().from(users).where(eq(users.id, user.id));
    return fresh ?? user;
  }

  @Public()
  @Post("auth/logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME, sessionCookie());
  }

  @Get("me")
  @Returns(MeSchema)
  async me(@Me() user: User) {
    if (user.role === "admin" || user.role === "unit_head") await scheduleReminder(user); // maks. sekali sehari
    // bagian-bagian ini saling lepas: dijalankan bersamaan (dibuka tiap kali aplikasi dibuka, puncaknya saat jam masuk)
    const [offs, today, unread, pending] = await Promise.all([
      user.officeId ? db().select().from(offices).where(eq(offices.id, user.officeId)) : Promise.resolve([]),
      todayStatus(user),
      unreadCount(user.id),
      pendingCount(user.id),
    ]);
    return {
      user: userOut(user),
      face_enrolled: !!user.faceEmbedding,
      today,
      office: offs[0] ? officeOut(offs[0]) : null,
      unread_notifications: unread,
      pending_requests: pending,
    };
  }

  /** Lupa kata sandi di dasbor (Admin SDM / Kepala Unit): kata sandi baru dikirim ke email. */
  @Public()
  @Post("auth/forgot")
  @Returns(Message)
  @HttpCode(200)
  async forgot(@Body({ schema: ForgotIn }) body: z.output<typeof ForgotIn>, @ClientIp() ip: string) {
    return this.requestNewPassword(body.identifier, MANAGERS, ip);
  }

  /** Lupa kata sandi di aplikasi karyawan: kata sandi baru dikirim ke email. */
  @Public()
  @Post("auth/app-forgot")
  @Returns(Message)
  @HttpCode(200)
  async appForgot(@Body({ schema: ForgotIn }) body: z.output<typeof ForgotIn>, @ClientIp() ip: string) {
    return this.requestNewPassword(body.identifier, STAFF, ip);
  }

  /**
   * Email tak terdaftar ditolak (404) agar tidak ada email terkirim sia-sia. Permintaan masuk antrean; email dikirim
   * langsung di latar belakang, dan cron mengulang yang gagal tiap menit (modules/password-reset.job.ts).
   * Permintaan ulang dalam 24 jam mengirim kata sandi yang sama.
   */
  private async requestNewPassword(identifier: string, roles: readonly string[], ip: string) {
    const key = `forgot:ip:${ip}`;
    guard([[key, RESET_REQUESTS_PER_IP]], "permintaan kata sandi baru");
    limiter.hit(key);
    const user = await activeByEmail(identifier, roles);
    if (!user) throw new HttpError(404, "Email tidak ditemukan.");
    const limited = await requestLimit(user, new Date());
    if (limited) throw new HttpError(429, limited);
    await audit(null, "password_forgot", "user", user.id);
    await requestNewPassword(user);
    void processPasswordQueue().catch((e) => log("error", "mail", `Password queue failed: ${(e as Error).message}`));
    return { message: "Kata sandi sementara sedang dikirim ke email Anda. Masuk dengan kata sandi itu, lalu buat kata sandi sendiri. Kata sandi lama tetap berlaku." };
  }
}
