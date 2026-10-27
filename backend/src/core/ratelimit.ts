/**
 * Pembatas laju di memori (satu proses): login, lupa & reset kata sandi, dan batas API umum.
 * Banyak instance server: ganti dengan penyimpanan bersama (mis. Redis).
 */
import { settings } from "./config";
import { HttpError } from "./http";

export const WINDOW_S = 15 * 60;

class Limiter {
  private hits = new Map<string, number[]>();

  private trim(key: string, windowS: number, now: number): number[] {
    const q = this.hits.get(key) ?? [];
    while (q.length && now - q[0] > windowS * 1000) q.shift();
    if (q.length) this.hits.set(key, q);
    else this.hits.delete(key);
    return q;
  }

  /** Detik sampai boleh mencoba lagi (0 = boleh). */
  retryAfter(key: string, limit: number, windowS = WINDOW_S): number {
    const now = Date.now();
    const q = this.trim(key, windowS, now);
    return q.length >= limit ? Math.floor((windowS * 1000 - (now - q[0])) / 1000) + 1 : 0;
  }

  hit(key: string, windowS = WINDOW_S) {
    const now = Date.now();
    const q = this.trim(key, windowS, now);
    q.push(now);
    this.hits.set(key, q);
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  clear() {
    this.hits.clear();
  }
}

const g = globalThis as unknown as { __abitaLimiter?: Limiter };
export const limiter = (g.__abitaLimiter ??= new Limiter());

const TRUSTED = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", ...settings.TRUSTED_PROXIES.split(",").map((s) => s.trim()).filter(Boolean)]);

/** IP klien. X-Forwarded-For hanya dipercaya dari proxy tepercaya (bisa dipalsukan klien lain). */
export function clientIp(headers: Headers, remote: string | null): string {
  const host = remote || "unknown";
  if (!TRUSTED.has(host)) return host;
  // dibaca dari kanan: entri paling kiri ditulis klien sendiri (bisa dipalsukan untuk menghindari batas laju);
  // alamat pertama yang bukan proxy tepercaya adalah yang benar-benar dilihat proxy kita
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!TRUSTED.has(hops[i])) return hops[i];
  return host;
}

/** Tolak (429) bila salah satu kunci sudah mencapai batasnya dalam 15 menit. */
export function guard(rules: [string, number][], what: string) {
  const wait = Math.max(0, ...rules.map(([k, n]) => limiter.retryAfter(k, n)));
  if (wait) throw new HttpError(429, `Terlalu banyak ${what}. Coba lagi dalam ${Math.max(1, Math.round(wait / 60))} menit.`);
}
