/**
 * Konfigurasi dari environment (.env / .env.local). Divalidasi sekali saat server mulai:
 * nilai salah langsung gagal dengan pesan jelas, bukan error aneh di tengah jalan. Lihat .env.example.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// .env di folder backend (.env.local menimpa .env). Variabel sistem tetap menang.
// folder backend: dari src/core (tsx/dev) maupun dist/core (build), cari ke atas sampai nest-cli.json
function apiDir(): string {
  for (let d = __dirname; d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, "nest-cli.json"))) return d;
  return process.cwd();
}
const API_DIR = apiDir();
for (const f of [path.join(API_DIR, ".env.local"), path.join(API_DIR, ".env")]) {
  if (fs.existsSync(f)) dotenv.config({ path: f, quiet: true });
}
// Paket deployment hanya menyertakan .env.example; instalasi baru wajib membuat .env terlebih dahulu.
if (!process.env.DATABASE_URL && !fs.existsSync(path.join(API_DIR, ".env")) && fs.existsSync(path.join(API_DIR, ".env.example")) && process.env.NODE_ENV === "production") {
  throw new Error("Configuration file not found: copy .env.example to .env and set DATABASE_URL and PUBLIC_APP_URL.");
}

const bool = (d: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? d : ["1", "true", "yes", "on"].includes(v.toLowerCase())));
const num = (d: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return d;
      const n = Number(v);
      if (Number.isNaN(n)) ctx.addIssue({ code: "custom", message: `harus angka, didapat "${v}"` });
      return n;
    });
const str = (d: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? d : v));

const Env = z.object({
  // --- umum ---
  DATABASE_URL: str("mysql://root:@127.0.0.1:3306/abita"),
  JWT_SECRET: str("ganti-dengan-string-acak-panjang"),
  JWT_TTL_HOURS: num(12),
  TZ_NAME: str("Asia/Jakarta"),
  API_PORT: num(3001),
  MODELS_DIR: str("models"),
  STORAGE_DIR: str("storage"),
  API_RATE_PER_MIN: num(300),
  // permintaan tanpa sesi dibatasi per IP; batas dibuat longgar karena banyak perangkat dapat berbagi satu IP (NAT)
  API_RATE_PER_MIN_IP: num(1200),
  DB_POOL_SIZE: num(10), // jumlah koneksi MySQL per proses; sesuaikan dengan max_user_connections hosting
  API_DOCS: bool(false), // aktifkan Swagger (/api/docs) di production; di luar production selalu aktif
  SESSION_REMEMBER_DAYS: num(30), // masa berlaku sesi aplikasi karyawan dengan opsi "Ingat saya" (hari)
  FACE_SUBMIT_PER_MIN: num(10),
  TRUSTED_PROXIES: str(""),
  // --- sesi & lokasi ---
  SESSION_TTL_SECONDS: num(90),
  MAX_GPS_ACCURACY_M: num(0), // 0 = akurasi rendah tidak ditolak
  REJECT_MOCK_LOCATION: bool(true),
  GPS_ACCURACY_ALLOWANCE_MAX_M: num(100),
  DEFAULT_RADIUS_M: num(100),
  // --- shift & pengajuan ---
  MAX_ATTACHMENT_MB: num(8),
  // --- dokumen ---
  MAX_DOCUMENT_MB: num(10), // per file (menu Dokumen); maksimal 10 file per unggahan
  // --- identitas aplikasi ---
  ORG_NAME: str("RS Awal Bros Botania"),
  PUBLIC_APP_URL: str("http://localhost:3000"), // URL frontend: tautan email dan origin CORS utama
  // --- akses lintas origin ---
  CORS_ORIGINS: str(""), // origin tambahan yang diizinkan, dipisahkan koma
  // lax: frontend dan API pada domain induk yang sama; none: domain berbeda (memerlukan HTTPS)
  COOKIE_SAMESITE: z
    .string()
    .optional()
    .transform((v) => (v || "lax").toLowerCase())
    .pipe(z.enum(["lax", "strict", "none"])),
  // --- Web Push (aplikasi karyawan); kosong = kunci VAPID dibuat sekali & disimpan di database ---
  VAPID_PUBLIC_KEY: str(""),
  VAPID_PRIVATE_KEY: str(""),
  VAPID_SUBJECT: str(""),
  HELPDESK_WHATSAPP: str(""),
  // --- pengenalan wajah (SFace cosine). Data uji: orang sama 0.70–0.92, orang lain 0.33–0.41 ---
  MATCH_THRESHOLD: num(0.5),
  CONSISTENCY_THRESHOLD: num(0.45),
  MIN_DETECTION_SCORE: num(0.6),
  // kualitas foto wajah (setiap frame): lebar wajah minimal terhadap lebar foto, kecerahan wajah 0–255,
  // ketajaman (varian Laplacian; 0 = tidak dicek, nilai tiap percobaan tercatat di attempts.scores untuk penyetelan)
  MIN_FACE_WIDTH: num(0.15),
  MIN_FACE_BRIGHTNESS: num(40),
  MAX_FACE_BRIGHTNESS: num(235),
  MIN_FACE_SHARPNESS: num(0),
  SECOND_FACE_MAX_RATIO: num(0.8),
  TEMPLATE_UPDATE_MIN: num(0.65),
  TEMPLATE_UPDATE_WEIGHT: num(0.1),
  // --- gerakan kepala dicek ulang di server (posisi hidung di antara kedua mata, 0.5 = lurus) ---
  YAW_LEFT_MIN: num(0.58),
  YAW_RIGHT_MAX: num(0.42),
  YAW_CENTER_MIN: num(0.36),
  YAW_CENTER_MAX: num(0.64),
  SWAP_LEFT_RIGHT: bool(false),
});

function load() {
  const r = Env.safeParse(process.env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid .env configuration:\n${lines}`);
  }
  const e = r.data;
  if (process.env.NODE_ENV === "production" && e.JWT_SECRET === "ganti-dengan-string-acak-panjang") {
    throw new Error("Invalid .env configuration:\n  JWT_SECRET: must be changed in production (use a long random string).");
  }
  return {
    ...e,
    MODELS_DIR: path.resolve(API_DIR, e.MODELS_DIR),
    STORAGE_DIR: path.resolve(API_DIR, e.STORAGE_DIR),
    API_DIR,
    DEBUG: process.env.NODE_ENV !== "production",
  };
}

export const settings = load();
export type Settings = typeof settings;
