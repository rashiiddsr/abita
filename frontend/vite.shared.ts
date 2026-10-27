/**
 * Konfigurasi Vite bersama untuk /admin dan /staff:
 * - API_URL (.env; .env.production saat build): URL backend yang dipanggil langsung oleh browser.
 * - Content-Security-Policy disisipkan ke index.html saat build sehingga berlaku di server mana pun.
 */
import crypto from "node:crypto";
import { loadEnv, type Plugin } from "vite";

export const FRONTEND_DIR = import.meta.dirname;

/** URL backend tanpa garis miring di akhir, mis. "https://api.example.com". String kosong berarti origin yang sama. */
export function apiUrl(mode: string): string {
  const raw = (loadEnv(mode, FRONTEND_DIR, "").API_URL ?? "").trim();
  if (!raw) return "";
  try {
    new URL(raw);
  } catch {
    throw new Error(`API_URL di .env frontend tidak valid: "${raw}" (contoh: https://api.domain.com)`);
  }
  return raw.replace(/\/+$/, "").replace(/\/api(\/v1)?$/, ""); // akhiran /api atau /api/v1 dinormalisasi
}

/** CSP: origin sendiri, backend (API_URL), tile peta ArcGIS, dan Google Fonts; skrip inline diizinkan melalui hash. */
export function csp(api: string): Plugin {
  const backend = api ? new URL(api).origin : "";
  return {
    name: "abita-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`);
        const policy = {
          "default-src": ["'self'"],
          "script-src": ["'self'", "'wasm-unsafe-eval'", ...inline], // WebAssembly untuk MediaPipe
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
          "img-src": ["'self'", "data:", "blob:", backend, "https://server.arcgisonline.com"],
          "connect-src": ["'self'", backend],
          "frame-src": ["'self'", backend], // pratinjau PDF lampiran
          "media-src": ["'self'", "blob:"],
          "worker-src": ["'self'", "blob:"],
          "manifest-src": ["'self'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
        };
        const content = Object.entries(policy)
          .map(([k, v]) => `${k} ${v.filter(Boolean).join(" ")}`)
          .join("; ");
        return html.replace(/<head>/, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${content}" />`);
      },
    },
  };
}
