/** Klien HTTP untuk tes: masuk sebagai akun seed (cookie) atau langsung dengan token. */
import mysql from "mysql2/promise";

export const BASE = "http://127.0.0.1:3099/api/v1";
export const TEST_DB = process.env.TEST_DATABASE_URL ?? "mysql://root:@127.0.0.1:3306/abita_test";

export type Res<T = any> = { status: number; body: T; headers: Headers }; // eslint-disable-line @typescript-eslint/no-explicit-any

export class Client {
  cookie = "";
  constructor(public ip = "10.0.0." + Math.floor(Math.random() * 200 + 1)) {}

  async req<T = any>(method: string, path: string, body?: unknown): Promise<Res<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const headers: Record<string, string> = { "X-Forwarded-For": this.ip };
    if (this.cookie) headers.Cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const r = await fetch(BASE + path, { method, headers, body: payload });
    const set = r.headers.get("set-cookie");
    if (set) {
      const m = set.match(/abita_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `abita_session=${m[1]}` : "";
    }
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* bukan JSON */
    }
    return { status: r.status, body: parsed as T, headers: r.headers };
  }
  get = <T = any>(p: string) => this.req<T>("GET", p); // eslint-disable-line @typescript-eslint/no-explicit-any
  post = <T = any>(p: string, b?: unknown) => this.req<T>("POST", p, b ?? {}); // eslint-disable-line @typescript-eslint/no-explicit-any
  put = <T = any>(p: string, b: unknown) => this.req<T>("PUT", p, b); // eslint-disable-line @typescript-eslint/no-explicit-any
  del = <T = any>(p: string) => this.req<T>("DELETE", p); // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Akun seed (scripts/seed.ts). */
export const ACC = {
  sdm: ["sdm@example.com", "admin123"],
  kaFarmasi: ["kepala.farmasi@example.com", "kepala123"],
  kaIgd: ["kepala.igd@example.com", "kepala123"],
  budi: ["20260001", "budi123"], // staff Farmasi Rawat Jalan
  rina: ["20260003", "rina123"], // staff IGD
} as const;

export async function as(who: keyof typeof ACC): Promise<Client> {
  const c = new Client();
  const [id, pw] = ACC[who];
  const staff = who === "budi" || who === "rina";
  const r = await c.post(staff ? "/auth/app-login" : "/auth/web-login", { employee_code: id, password: pw });
  if (r.status !== 200) throw new Error(`login ${who} gagal: ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

let pool: mysql.Pool | null = null;
export function sql() {
  pool ??= mysql.createPool({ uri: TEST_DB, timezone: "Z", dateStrings: ["DATE"] });
  return pool;
}
export async function q<T = any>(s: string, args: unknown[] = []): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [rows] = await sql().query(s, args);
  return rows as T[];
}
export async function closeDb() {
  await pool?.end();
  pool = null;
}

/** Tanggal kerja WIB "YYYY-MM-DD" + n hari. */
export function wib(n = 0): string {
  const d = new Date(Date.now() + 7 * 3600_000 + n * 86400_000);
  return d.toISOString().slice(0, 10);
}
