/** Kata sandi (bcrypt, kompatibel dengan hash lama Python), token JWT, guard peran. */
import jwt from "jsonwebtoken";
import { settings } from "./config";
import type { User } from "../db/schema";
import { HttpError } from "./http";
import { bcryptCompare, bcryptHash } from "./password";

export const COOKIE_NAME = "abita_session";
export const MANAGER_ROLES = ["admin", "unit_head"] as const;
export const PASSWORD_GATE_ALLOW = new Set(["/me", "/me/password", "/auth/logout", "/config"]);

export const hashPassword = (pw: string) => bcryptHash(pw);

/** Hash pembanding untuk akun yang tidak ada: waktu respons login sama, sehingga keberadaan email/NIK tidak bocor. */
const DUMMY_HASH = "$2b$12$D4a/FpVAqfbRHtXshEUQmedUvDbEzvd2m.gKsBg.nwKz1liHFnvxC";

export async function verifyPassword(pw: string, hashed: string | null | undefined): Promise<boolean> {
  const real = !!hashed && hashed.startsWith("$2");
  try {
    const ok = await bcryptCompare(pw, real ? hashed! : DUMMY_HASH);
    return real && ok;
  } catch {
    return false;
  }
}

/** Token sesi; `v` = users.session_version saat masuk (ganti kata sandi -> token lama ditolak). */
export function createToken(user: Pick<User, "id" | "role" | "sessionVersion">, hours: number = settings.JWT_TTL_HOURS): string {
  return jwt.sign({ role: user.role, v: user.sessionVersion ?? 0 }, settings.JWT_SECRET, { algorithm: "HS256", subject: String(user.id), expiresIn: `${hours}h` });
}

/** Isi token yang valid (id pengguna + versi sesi), atau null bila tidak valid / kedaluwarsa. */
export function tokenClaims(token: string | null | undefined): { id: number; v: number } | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, settings.JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    const id = Number(payload.sub);
    return Number.isInteger(id) ? { id, v: Number(payload.v ?? 0) } : null;
  } catch {
    return null;
  }
}

/** id pengguna dari token, atau null bila tidak valid / kedaluwarsa. */
export const tokenUserId = (token: string | null | undefined): number | null => tokenClaims(token)?.id ?? null;

// ------------------------------------------------------------------ jangkauan unit

type Scoped = Pick<User, "role" | "unit">;
const led = new WeakMap<object, string[]>();

/** Diisi saat autentikasi: unit yang dipimpin Kepala Unit, unit utama (User.unit) lebih dulu. */
export const setLedUnits = (u: object, names: string[]) => led.set(u, names);

/** Unit dalam jangkauan akun: null = semua (Admin SDM); Kepala Unit = unit yang dipimpinnya; karyawan = unitnya. */
export function scopeUnits(u: Scoped): string[] | null {
  if (u.role === "admin") return null;
  return led.get(u) ?? (u.unit ? [u.unit] : []);
}

/** Unit data yang ditampilkan: Admin SDM = unit pilihan (kosong/'all' = semua); Kepala Unit = unit pilihannya bila miliknya, selain itu unit pertamanya. */
export function activeUnit(me: Scoped, requested?: string | null): string | null {
  const units = scopeUnits(me);
  if (units === null) return !requested || requested === "all" ? null : requested;
  if (requested && units.includes(requested)) return requested;
  return units[0] ?? "__none__";
}

/**
 * Filter unit untuk data yang ditampilkan: null = semua unit (Admin SDM tanpa pilihan), selain itu daftar unit.
 * Kepala Unit: unit pilihannya bila miliknya, selain itu SEMUA unit yang dipimpinnya ("Semua unit" di sidebar).
 */
export function unitFilter(me: Scoped, requested?: string | null): string[] | null {
  const units = scopeUnits(me);
  const r = requested && requested !== "all" ? requested : null;
  if (units === null) return r ? [r] : null;
  if (r && units.includes(r)) return [r];
  return units.length ? units : ["__none__"];
}

/** Unit milik Kepala Unit untuk aksi yang butuh tepat satu unit (menyusun jadwal, menambah karyawan). */
export function ownUnit(me: Scoped, requested?: string | null): string {
  const units = scopeUnits(me) ?? [];
  if (!units.length) throw new HttpError(422, "Akun Anda belum ditugaskan ke unit.");
  if (requested && !units.includes(requested)) throw new HttpError(403, "Unit ini bukan unit Anda.");
  return requested || units[0];
}

/** Unit target termasuk jangkauan akun (Admin SDM: selalu). */
export const inScope = (me: Scoped, unit: string | null | undefined) => {
  const units = scopeUnits(me);
  return units === null || (!!unit && units.includes(unit));
};

export function ensureScope<T extends Pick<User, "unit">>(me: Scoped, target: T | null | undefined): T {
  if (!target) throw new HttpError(404, "Pengguna tidak ditemukan.");
  if (!inScope(me, target.unit)) throw new HttpError(403, "Karyawan ini bukan dari unit Anda.");
  return target;
}

export const ROLE_MSG = {
  manager: "Hanya pengguna dasbor yang boleh mengakses.",
  monitor: "Menu ini untuk Admin SDM dan Kepala Unit.",
  hr: "Hanya Admin SDM yang boleh mengubah pengaturan ini.",
  head: "Hanya Kepala Unit yang boleh mengubah jadwal unitnya.",
};
