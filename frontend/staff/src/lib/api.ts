/** Klien API backend (/api/v1) dengan autentikasi cookie sesi httpOnly. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reasonCode?: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;
const BASE = `${__API_URL__}/api/v1`;

function url(path: string, query?: Query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `${BASE}${path}${s ? `?${s}` : ""}`;
}

function detailOf(body: unknown, fallback: string): { msg: string; code?: string } {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return { msg: d };
    if (Array.isArray(d) && d[0] && typeof d[0] === "object" && "msg" in d[0]) return { msg: "Data tidak valid: " + String((d[0] as { msg: unknown }).msg) };
    if (d && typeof d === "object" && "message" in d) return { msg: String((d as { message: unknown }).message), code: String((d as { reason_code?: unknown }).reason_code ?? "") || undefined };
  }
  return { msg: fallback };
}

/** Dipanggil saat sesi habis (401) agar aplikasi kembali ke layar masuk. */
export const onUnauthorized: { fn: (() => void) | null } = { fn: null };

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(path, opts.query), {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: opts.body !== undefined && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
      body: opts.body instanceof FormData ? opts.body : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "include", // backend dapat berada di origin lain
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Tidak bisa terhubung ke server. Periksa koneksi internet, lalu coba lagi.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const { msg, code } = detailOf(body, res.status >= 500 ? "Terjadi kesalahan di server. Coba lagi beberapa saat." : `Permintaan gagal (${res.status}).`);
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized.fn?.();
    throw new ApiError(res.status, msg, code);
  }
  return body as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Terjadi kesalahan.");
export const fileUrl = (path: string) => `${BASE}${path}`;
