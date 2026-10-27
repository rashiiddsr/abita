/**
 * Akses lintas origin: daftar origin frontend yang diizinkan memanggil API dengan cookie sesi
 * (CORS dan validasi header Origin pada permintaan yang mengubah data), serta atribut cookie sesi.
 */
import type { CookieOptions } from "express";
import { settings } from "./config";

const originOf = (u: string) => {
  try {
    return new URL(u.trim()).origin;
  } catch {
    return null;
  }
};

/** Origin dari PUBLIC_APP_URL dan CORS_ORIGINS. */
export const WEB_ORIGINS = [...new Set([settings.PUBLIC_APP_URL, ...settings.CORS_ORIGINS.split(",")].map(originOf).filter((o): o is string => !!o))];

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Origin yang diizinkan memakai API dengan kredensial. Di luar production, localhost selalu diizinkan. */
export const allowedOrigin = (origin: string) => WEB_ORIGINS.includes(origin) || (settings.DEBUG && LOCAL.test(origin));

/** Atribut cookie sesi; dipakai saat menyetel maupun menghapus cookie. SameSite=None mensyaratkan Secure. */
export function sessionCookie(): CookieOptions {
  const sameSite = settings.COOKIE_SAMESITE;
  return { httpOnly: true, sameSite, secure: sameSite === "none" || !settings.DEBUG, path: "/" };
}
