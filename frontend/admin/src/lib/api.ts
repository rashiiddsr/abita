// Klien API backend (/api/v1) dengan autentikasi cookie sesi httpOnly.

/** URL backend dari API_URL; string kosong berarti origin yang sama. */
export const API_URL = __API_URL__;
/** URL absolut untuk path API ("/api/v1/..."); dipakai oleh fetch, <img>, iframe, unduhan, dan EventSource. */
export const apiUrl = (path: string) => (path.startsWith("/api/") ? API_URL + path : path);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function url(path: string, query?: Query) {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "" && v !== "all") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

function detailOf(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d[0] && typeof d[0] === "object" && "msg" in d[0]) return "Data tidak valid: " + String(d[0].msg);
    if (d && typeof d === "object" && "message" in d) return String((d as { message: unknown }).message);
  }
  return fallback;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(url(path, opts.query)), {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      // FormData (unggah file) dikirim apa adanya; browser mengatur boundary multipart
      headers: opts.body !== undefined && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
      body: opts.body instanceof FormData ? opts.body : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "include", // backend dapat berada di origin lain
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Server presensi tidak merespons. Periksa koneksi jaringan, lalu coba lagi.");
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
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/v1/auth/")) {
      // sesi habis: muat ulang penuh ke halaman login (cache kueri ikut dibersihkan)
      window.location.href = "/admin/login";
    }
    const fallback = res.status >= 500 ? "Terjadi kesalahan di server. Coba lagi beberapa saat." : `Permintaan gagal (${res.status}).`;
    throw new ApiError(res.status, detailOf(body, fallback));
  }
  return body as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Terjadi kesalahan.");

/** Unduh file dari endpoint yang memerlukan sesi (Excel/PDF ekspor). */
export async function download(path: string, filename: string) {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, "File tidak bisa diunduh.");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
