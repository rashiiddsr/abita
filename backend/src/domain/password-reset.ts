/**
 * Lupa kata sandi = kata sandi BARU dikirim ke email, diproses lewat antrean (tabel password_resets):
 *   pw_q    menunggu dikirim          pw_run  sedang diproses (klaim atomik, tidak terkirim dua kali)
 *   pw      terkirim & berlaku        pw_fail gagal dikirim MAX_SEND_ATTEMPTS kali (Admin SDM diberi tahu)
 * token_hash menyimpan kata sandi terenkripsi (AES-256-GCM, kunci dari JWT_SECRET) agar permintaan ulang dalam
 * RESEND_WINDOW_H jam mengirim kata sandi YANG SAMA. Kata sandi dari email adalah kata sandi SEMENTARA tambahan:
 * kata sandi lama tetap berlaku (orang lain yang menekan "Lupa kata sandi" tidak bisa mengunci / mengeluarkan akun).
 * Saat pengguna masuk dengan kata sandi sementara (useTemporaryPassword), kata sandi itu menjadi kata sandi akun,
 * sesi lain dikeluarkan, dan pengguna wajib membuat kata sandi sendiri (must_change_password).
 * Baris dinonaktifkan (used_at) saat pengguna mengganti kata sandi atau admin mereset.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { hashPassword } from "../core/auth";
import { settings } from "../core/config";
import { db, schema } from "../db";
import type { User } from "../db/schema";
import { log } from "../common/logger";
import { forgotPasswordEmail, generatePassword, trySend } from "./mailer";
import { notifyRole } from "./services";

const { passwordResets, users } = schema;
export const RESEND_WINDOW_H = 24;
const MAX_SEND_ATTEMPTS = 3;
const ACTIVE = ["pw_q", "pw_run", "pw"];

// ------------------------------------------------------------------ enkripsi (token_hash varchar(64): iv 12 + tag 16 + teks <= 20 byte)
const key = () => createHash("sha256").update(`${settings.JWT_SECRET}:password-reset`).digest();
function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}
function open(sealed: string): string {
  const raw = Buffer.from(sealed, "base64url");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/**
 * Antrekan pengiriman kata sandi baru. Bila dalam RESEND_WINDOW_H jam terakhir sudah ada kata sandi baru yang belum
 * diganti pengguna, kata sandi yang sama dikirim ulang.
 */
export async function requestNewPassword(user: Pick<User, "id">) {
  const since = new Date(Date.now() - RESEND_WINDOW_H * 3600_000);
  const [cur] = await db()
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.userId, user.id), inArray(passwordResets.kind, ACTIVE), isNull(passwordResets.usedAt), gt(passwordResets.createdAt, since)))
    .orderBy(desc(passwordResets.id))
    .limit(1);
  if (cur) {
    if (cur.kind === "pw") await db().update(passwordResets).set({ kind: "pw_q", attempts: 0 }).where(eq(passwordResets.id, cur.id));
    return; // pw_q / pw_run: sudah dalam antrean
  }
  await db()
    .insert(passwordResets)
    .values({ userId: user.id, tokenHash: seal(generatePassword()), kind: "pw_q", attempts: 0, expiresAt: new Date(Date.now() + RESEND_WINDOW_H * 3600_000) });
}

/** Kirim semua antrean. Dipanggil langsung setelah permintaan dan oleh cron tiap menit (ulang yang gagal). */
export async function processPasswordQueue(): Promise<number> {
  const pending = await db().select().from(passwordResets).where(eq(passwordResets.kind, "pw_q")).orderBy(asc(passwordResets.id)).limit(50);
  let sent = 0;
  for (const row of pending) {
    const [res] = await db()
      .update(passwordResets)
      .set({ kind: "pw_run" })
      .where(and(eq(passwordResets.id, row.id), eq(passwordResets.kind, "pw_q")));
    if (!res.affectedRows) continue; // diambil proses lain
    const [user] = await db().select().from(users).where(eq(users.id, row.userId));
    if (!user || user.isActive === false || !user.email || row.usedAt) {
      await db().update(passwordResets).set({ kind: "pw_fail", usedAt: new Date() }).where(eq(passwordResets.id, row.id));
      continue;
    }
    const password = open(row.tokenHash);
    const login = user.role === "staff" ? `${user.email} / NIK ${user.employeeCode}` : user.email;
    const err = await trySend(user.email, ...forgotPasswordEmail(user.name, login, password));
    if (!err) {
      // kata sandi akun belum diganti: berlaku sebagai kata sandi sementara sampai dipakai masuk / kedaluwarsa
      await db().update(passwordResets).set({ kind: "pw" }).where(eq(passwordResets.id, row.id));
      sent++;
      continue;
    }
    const attempts = (row.attempts ?? 0) + 1;
    if (attempts >= MAX_SEND_ATTEMPTS) {
      await db().update(passwordResets).set({ kind: "pw_fail", attempts, usedAt: new Date() }).where(eq(passwordResets.id, row.id));
      await notifyRole("admin", "system", "Kata sandi baru gagal dikirim", `${user.name}: ${err}`, "/settings?sec=smtp");
      log("warn", "mail", "New password not delivered", { user: user.id, attempts });
    } else await db().update(passwordResets).set({ kind: "pw_q", attempts }).where(eq(passwordResets.id, row.id));
  }
  return sent;
}

/**
 * Masuk dengan kata sandi sementara dari email: bila cocok, kata sandi itu menjadi kata sandi akun (wajib diganti),
 * permintaan ditutup, dan sesi di perangkat lain dikeluarkan. true bila dipakai.
 */
export async function useTemporaryPassword(user: Pick<User, "id">, password: string): Promise<boolean> {
  const rows = await db()
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.userId, user.id), inArray(passwordResets.kind, ACTIVE), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
    .orderBy(desc(passwordResets.id))
    .limit(3);
  const given = Buffer.from(password, "utf8");
  const hit = rows.find((r) => {
    try {
      const temp = Buffer.from(open(r.tokenHash), "utf8");
      return temp.length === given.length && timingSafeEqual(temp, given);
    } catch {
      return false;
    }
  });
  if (!hit) return false;
  await db()
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, user.id));
  await closePasswordRequests(user.id);
  return true;
}

/** Kata sandi diganti sendiri / direset admin: kata sandi dari Lupa kata sandi tidak dikirim ulang lagi. */
export async function closePasswordRequests(userId: number) {
  await db()
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.userId, userId), inArray(passwordResets.kind, ACTIVE), isNull(passwordResets.usedAt)));
}

/** Pulihkan antrean yang tersangkut (proses mati di tengah pengiriman): pw_run > 10 menit kembali ke antrean. */
export async function requeueStuck() {
  await db()
    .update(passwordResets)
    .set({ kind: "pw_q" })
    .where(and(eq(passwordResets.kind, "pw_run"), lt(passwordResets.createdAt, new Date(Date.now() - 10 * 60_000))));
}
