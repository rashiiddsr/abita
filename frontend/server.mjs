#!/usr/bin/env node
/**
 * ABiTA frontend server: one process, one port (WEB_PORT, default 3000).
 *
 *   /             -> redirect to /staff
 *   /staff/*      -> staff app (PWA, staff/)
 *   /admin/*      -> dashboard for Admin SDM & Kepala Unit (admin/)
 *   anything else -> 404 page
 *
 * The browser calls the backend directly at API_URL (.env, baked in at build time; see vite.shared.ts).
 * No proxy: frontend and backend can live on different subdomains or servers.
 *
 * HTTPS is provided by the hosting (cPanel / reverse proxy); see DEPLOY-CPANEL.md.
 *
 * Development (`node server.mjs`): both apps run through Vite in middleware mode, with hot reload.
 * Production (`node server.mjs --prod`): serves the builds in dist/admin and dist/karyawan (`npm run build` first).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PROD = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
/** URL base -> source folder (and dist/<folder>). */
const APPS = { admin: "admin", staff: "staff" };

// ------------------------------------------------------------------ config (.env in this folder; real env vars win)
function readEnv() {
  const env = {};
  for (const file of [".env", ".env.local"]) {
    try {
      for (const line of fs.readFileSync(path.join(DIR, file), "utf8").split(/\r?\n/)) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      }
    } catch {
      /* optional file */
    }
  }
  return { ...env, ...process.env };
}
const env = readEnv();
const PORT = Number(env.WEB_PORT) || 3000;

// ------------------------------------------------------------------ logging (same shape as the API logs)
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const stamp = () => {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};
const log = (level, msg) => {
  const color = { INFO: 32, WARN: 33, ERROR: 31 }[level];
  const lvl = tty ? `\x1b[${color}m${level.padEnd(5)}\x1b[0m` : level.padEnd(5);
  (level === "ERROR" ? console.error : console.log)(`${stamp()}  ${lvl} [web]   ${msg}`);
};

// ------------------------------------------------------------------ static files (production) & error pages
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
const COMPRESSIBLE = /\.(html|js|mjs|css|json|webmanifest|svg|map|txt)$/;
const SECURITY_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" };

function sendFile(req, res, file, status = 200) {
  const ext = path.extname(file);
  const name = path.basename(file);
  const immutable = /[\\/]assets[\\/]/.test(file) && /-[\w-]{8,}\.\w+$/.test(name); // hashed by Vite
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : ext === ".html" || name === "sw.js" || ext === ".webmanifest" ? "no-cache" : "public, max-age=3600",
  };
  const gzip = COMPRESSIBLE.test(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
  if (gzip) Object.assign(headers, { "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(file);
  (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
}

const NOT_FOUND_HTML = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 · ABiTA</title>
<style>:root{color-scheme:light dark;--bg:#f6f7f9;--ink:#0d1726;--muted:#5b6678;--brand:#007a87}@media(prefers-color-scheme:dark){:root{--bg:#0b1118;--ink:#e8edf3;--muted:#93a0b2;--brand:#3cb4bf}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{text-align:center;max-width:360px}b{display:block;font-size:56px;line-height:1;color:var(--brand);letter-spacing:-.02em}h1{font-size:18px;margin:14px 0 6px}p{margin:0 0 20px;color:var(--muted)}
a{display:inline-block;padding:10px 18px;border-radius:10px;background:var(--brand);color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main><b>404</b><h1>Halaman tidak ditemukan</h1><p>Alamat yang Anda buka tidak ada.</p><a href="/staff">Ke beranda</a></main></body></html>`;

function notFound(res) {
  res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(NOT_FOUND_HTML);
}

const redirect = (res, to, status = 302) => {
  res.writeHead(status, { Location: to, "Cache-Control": "no-cache" });
  res.end();
};

/** Production: file from dist/<app>, otherwise the app's index.html for page URLs (client-side routes, 404 page included). */
function serveBuilt(req, res, app, rest) {
  const base = path.join(DIR, "dist", APPS[app]);
  const file = path.normalize(path.join(base, decodeURIComponent(rest)));
  if (!file.startsWith(base)) return notFound(res);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(req, res, file);
  if (path.extname(rest) && !rest.endsWith(".html")) return notFound(res); // missing asset
  sendFile(req, res, path.join(base, "index.html"));
}

// ------------------------------------------------------------------ server
const server = http.createServer();
let vites = {};

if (!PROD) {
  const { createServer } = await import("vite");
  for (const [app, dir] of Object.entries(APPS)) {
    vites[app] = await createServer({
      configFile: path.join(DIR, dir, "vite.config.ts"),
      appType: "spa",
      // HMR websocket shares port 3000; each app answers only upgrades on its own base path
      server: { middlewareMode: true, hmr: { server } },
    });
  }
} else {
  for (const dir of Object.values(APPS)) {
    if (!fs.existsSync(path.join(DIR, "dist", dir, "index.html"))) {
      log("ERROR", `dist/${dir} is missing. Run \`npm run build\` first.`);
      process.exit(1);
    }
  }
}

function handle(req, res) {
  const url = req.url ?? "/";
  const pathname = url.split("?")[0];
  if (req.method !== "GET" && req.method !== "HEAD") return notFound(res);
  if (pathname === "/") return redirect(res, "/staff");
  const app = Object.keys(APPS).find((a) => pathname === `/${a}` || pathname.startsWith(`/${a}/`));
  if (!app) return notFound(res);
  if (pathname === `/${app}`) return redirect(res, `/${app}/${url.slice(pathname.length)}`, 301);
  if (PROD) return serveBuilt(req, res, app, pathname.slice(app.length + 2) || "index.html");
  vites[app].middlewares(req, res, () => notFound(res));
}
server.on("request", handle);

const onError = (port, key) => (e) => {
  if (e.code === "EADDRINUSE") log("ERROR", `Port ${port} is already in use. Stop the other server or set ${key} in .env.`);
  else log("ERROR", e.message);
  process.exit(1);
};
server.on("error", onError(PORT, "WEB_PORT"));

server.listen(PORT, "0.0.0.0", () => {
  log("INFO", `Listening on port ${PORT} mode=${PROD ? "production (API_URL from the build)" : `development api=${env.API_URL || "(same domain)"}`}`);
});

const stop = async () => {
  await Promise.all(Object.values(vites).map((v) => v.close()));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
