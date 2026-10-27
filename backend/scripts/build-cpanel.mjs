#!/usr/bin/env node
/**
 * Paket deployment API untuk cPanel. Panduan: DEPLOY-CPANEL.md.
 *
 *   npm run build:cpanel                   build, paket, dan ekspor database lokal
 *   npm run build:cpanel -- --no-db        tanpa ekspor database
 *   npm run build:cpanel -- --schema-only  ekspor struktur tabel saja
 *
 * Keluaran (deploy/cpanel/):
 *   abita-api.zip  aplikasi Node.js (startup file: app.js). Digunakan untuk instalasi maupun pembaruan; berkas .env
 *                  tidak disertakan (hanya .env.example) sehingga konfigurasi dan storage/ di server tidak tertimpa.
 *   database.sql   ekspor database untuk diimpor melalui phpMyAdmin.
 */
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "deploy", "cpanel");
const args = new Set(process.argv.slice(2));
const step = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });

// ------------------------------------------------------------------ 1. build
step("Build API (NestJS)");
run("npm run build");

fs.rmSync(OUT, { recursive: true, force: true });

// ------------------------------------------------------------------ 2. abita-api (Node.js app)
step("Menyusun abita-api (aplikasi Node.js)");
const api = path.join(OUT, "abita-api");
fs.cpSync(path.join(ROOT, "dist"), path.join(api, "dist"), { recursive: true, filter: (src) => !src.endsWith(".map") });
fs.cpSync(path.join(ROOT, "models"), path.join(api, "models"), { recursive: true });
fs.writeFileSync(path.join(api, "nest-cli.json"), "{}\n"); // penanda direktori aplikasi untuk lokasi .env, models/, dan storage/
fs.writeFileSync(path.join(api, "app.js"), `// Startup file cPanel (Setup Node.js App)\nrequire("./dist/main.js");\n`);

const apiPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const deps = { ...apiPkg.dependencies };
fs.writeFileSync(
  path.join(api, "package.json"),
  JSON.stringify(
    {
      name: "abita-api",
      version: apiPkg.version ?? "1.0.0",
      private: true,
      description: "ABiTA API (hasil npm run build:cpanel)",
      main: "app.js",
      scripts: { start: "node app.js" },
      engines: { node: ">=20" },
      dependencies: deps,
    },
    null,
    2,
  ) + "\n",
);

const exampleEnv = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
const keep = (key) => exampleEnv.match(new RegExp(`^${key}=.*$`, "m"))?.[0] ?? "";
fs.writeFileSync(
  path.join(api, ".env.example"),
  `# ABiTA API — konfigurasi production
# Salin berkas ini menjadi .env, lalu isi DATABASE_URL dan PUBLIC_APP_URL.
# Environment variables di cPanel (Setup Node.js App) mengesampingkan nilai di berkas ini.

NODE_ENV=production

# Database MySQL. Karakter khusus pada kata sandi ditulis dalam URL encoding (@ = %40, # = %23).
DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/DATABASE

# URL frontend, tanpa garis miring di akhir. Digunakan untuk tautan email dan sebagai origin CORS.
PUBLIC_APP_URL=https://abita.example.com
# Origin tambahan yang diizinkan, dipisahkan koma.
CORS_ORIGINS=
# lax: frontend dan API berada pada domain induk yang sama. none: domain berbeda (memerlukan HTTPS).
COOKIE_SAMESITE=lax

# Kunci penandatanganan sesi, dibuat acak saat build. Mengganti nilai ini mengakhiri seluruh sesi aktif.
JWT_SECRET=${crypto.randomBytes(32).toString("hex")}
JWT_TTL_HOURS=12

${keep("ORG_NAME")}
${keep("TZ_NAME")}
STORAGE_DIR=storage
MODELS_DIR=models
${keep("MAX_ATTACHMENT_MB")}

${keep("SESSION_TTL_SECONDS")}
${keep("REJECT_MOCK_LOCATION")}
${keep("MAX_GPS_ACCURACY_M")}
${keep("GPS_ACCURACY_ALLOWANCE_MAX_M")}
${keep("MATCH_THRESHOLD")}
${keep("CONSISTENCY_THRESHOLD")}
${keep("SECOND_FACE_MAX_RATIO")}
${keep("API_RATE_PER_MIN")}
${keep("FACE_SUBMIT_PER_MIN")}
LOG_LEVEL=info
LOG_REQUESTS=errors
LOG_FORMAT=text

# Web Push (VAPID). Kosongkan untuk membuat kunci otomatis yang disimpan di database.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
`,
);

// ------------------------------------------------------------------ 3. database
if (!args.has("--no-db")) {
  step(args.has("--schema-only") ? "Ekspor struktur database lokal" : "Ekspor database lokal (struktur + data)");
  const env = Object.fromEntries(
    fs
      .readFileSync(path.join(ROOT, ".env"), "utf8")
      .split(/\r?\n/)
      .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  const db = new URL(env.DATABASE_URL ?? "mysql://root:@127.0.0.1:3306/abita");
  const dump = ["C:\\xampp\\mysql\\bin\\mysqldump.exe", "/opt/lampp/bin/mysqldump", "mysqldump"].find((p) => p === "mysqldump" || fs.existsSync(p));
  const dumpArgs = [
    `--host=${db.hostname}`,
    `--port=${db.port || 3306}`,
    `--user=${decodeURIComponent(db.username)}`,
    ...(db.password ? [`--password=${decodeURIComponent(db.password)}`] : []),
    "--single-transaction",
    "--skip-add-locks",
    "--no-tablespaces",
    "--default-character-set=utf8mb4",
    ...(args.has("--schema-only") ? ["--no-data"] : []),
    db.pathname.slice(1),
  ];
  try {
    const sql = execFileSync(dump, dumpArgs, { maxBuffer: 1024 * 1024 * 1024 });
    // tanpa CREATE DATABASE / USE: diimpor ke database apa pun yang dipilih di phpMyAdmin hosting
    fs.writeFileSync(path.join(OUT, "database.sql"), sql);
    console.log(`  database.sql (${(sql.length / 1024 / 1024).toFixed(1)} MB)`);
  } catch (e) {
    console.log(`  ! Ekspor database gagal (${e.message.split("\n")[0]}). Ekspor manual lewat phpMyAdmin lokal.`);
  }
}

// ------------------------------------------------------------------ 4. zip
step("Membuat zip");
{
  const zip = path.join(OUT, "abita-api.zip");
  // Windows: tar.exe bawaan (bsdtar) menghasilkan zip standar; platform lain: zip
  if (process.platform === "win32") execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", api, "."], { stdio: "inherit" });
  else execFileSync("zip", ["-qr", zip, "."], { cwd: api, stdio: "inherit" });
  console.log(`  ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB)`);
}

console.log(`\n\x1b[32m✓ Paket siap di ${path.relative(ROOT, OUT)}\x1b[0m — langkah unggah: DEPLOY-CPANEL.md\n`);
