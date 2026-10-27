#!/usr/bin/env node
/**
 * Paket deployment frontend untuk cPanel (npm run build:cpanel). Panduan: DEPLOY-CPANEL.md.
 *
 * Keluaran: deploy/cpanel/public_html.zip berisi /staff, /admin, .htaccess, dan 404.html.
 * URL backend diambil dari API_URL (.env.production atau .env) saat build.
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "deploy", "cpanel");
const step = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });

// ------------------------------------------------------------------ 1. build
step("Build frontend (admin + staff)");
run("npm run build");

// ------------------------------------------------------------------ 2. public_html
step("Menyusun public_html");
fs.rmSync(OUT, { recursive: true, force: true });
const web = path.join(OUT, "public_html");
fs.cpSync(path.join(ROOT, "dist/admin"), path.join(web, "admin"), { recursive: true });
fs.cpSync(path.join(ROOT, "dist/staff"), path.join(web, "staff"), { recursive: true });

fs.writeFileSync(
  path.join(web, ".htaccess"),
  `# ABiTA frontend — dihasilkan oleh npm run build:cpanel.
DirectoryIndex index.html
Options -Indexes
ErrorDocument 404 /404.html

<IfModule mod_rewrite.c>
RewriteEngine On

# HTTPS diperlukan untuk instalasi PWA, kamera, lokasi, dan notifikasi push
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !https
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# /api ditangani aplikasi Node.js bila backend berada pada domain yang sama
RewriteRule ^api(/|$) - [L]

# beranda diarahkan ke aplikasi karyawan
RewriteRule ^$ /staff/ [L,R=302]

# SPA: URL halaman (tanpa ekstensi) dilayani oleh index.html aplikasi terkait
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_URI} !\\.[A-Za-z0-9]+$
RewriteRule ^staff(/.*)?$ /staff/index.html [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_URI} !\\.[A-Za-z0-9]+$
RewriteRule ^admin(/.*)?$ /admin/index.html [L]
</IfModule>

AddType application/manifest+json .webmanifest
AddType application/wasm .wasm
AddType application/octet-stream .task

<IfModule mod_headers.c>
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "same-origin"
Header always set X-Frame-Options "SAMEORIGIN"
# kamera & lokasi hanya untuk situs ini (presensi), mikrofon tidak dipakai
Header always set Permissions-Policy "camera=(self), geolocation=(self), microphone=()"
# HTTPS saja (hanya dikirim bila permintaan memang lewat HTTPS)
Header always set Strict-Transport-Security "max-age=15552000" "expr=%{HTTPS} == 'on'"
# HTML, manifest, dan service worker selalu divalidasi ulang; aset ber-hash di-cache jangka panjang
<FilesMatch "(\\.html|\\.webmanifest|sw\\.js|push-sw\\.js)$">
Header set Cache-Control "no-cache"
</FilesMatch>
<FilesMatch "-[A-Za-z0-9_-]{8,}\\.(js|css|woff2|png|svg|wasm)$">
Header set Cache-Control "public, max-age=31536000, immutable"
</FilesMatch>
</IfModule>

<IfModule mod_deflate.c>
AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json application/manifest+json image/svg+xml
</IfModule>
`,
);
fs.writeFileSync(
  path.join(web, "404.html"),
  `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 · ABiTA</title>
<style>:root{color-scheme:light dark;--bg:#f6f7f9;--ink:#0d1726;--muted:#5b6678;--brand:#007a87}@media(prefers-color-scheme:dark){:root{--bg:#0b1118;--ink:#e8edf3;--muted:#93a0b2;--brand:#3cb4bf}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{text-align:center;max-width:360px}b{display:block;font-size:56px;line-height:1;color:var(--brand)}h1{font-size:18px;margin:14px 0 6px}p{margin:0 0 20px;color:var(--muted)}
a{display:inline-block;padding:10px 18px;border-radius:10px;background:var(--brand);color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main><b>404</b><h1>Halaman tidak ditemukan</h1><p>Alamat yang Anda buka tidak ada.</p><a href="/staff/">Ke beranda</a></main></body></html>
`,
);

// ------------------------------------------------------------------ 3. zip
step("Membuat zip");
for (const name of ["public_html"]) {
  const src = path.join(OUT, name);
  const zip = path.join(OUT, `${name}.zip`);
  fs.rmSync(zip, { force: true });
  // zip standar (garis miring "/"): Windows memakai tar.exe bawaan (bsdtar), selain itu `zip`
  if (process.platform === "win32") execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", src, "."], { stdio: "inherit" });
  else execFileSync("zip", ["-qr", zip, "."], { cwd: src, stdio: "inherit" });
  console.log(`  ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB)`);
}

console.log(`\n\x1b[32m✓ Paket siap di ${path.relative(ROOT, OUT)}\x1b[0m — langkah unggah: DEPLOY-CPANEL.md\n`);
