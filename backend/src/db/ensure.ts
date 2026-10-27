/**
 * Perubahan struktur kecil yang aman diulang, dijalankan saat API menyala (dan oleh seed) agar database lama
 * (mis. di hosting) tidak perlu `npm run db:push` manual.
 */
import type mysql from "mysql2/promise";

/** Semua perubahan struktur di bawah, berurutan. */
export async function ensureSchema(pool: mysql.Pool) {
  await ensureUnitHeads(pool);
  await ensurePushSubscriptions(pool);
  await ensureSessionVersion(pool);
  await ensureFiles(pool);
}

/** Tabel unit_heads (banyak Kepala Unit per unit); kolom lama units.head_user_id dipindah ke sana lalu dihapus. */
export async function ensureUnitHeads(pool: mysql.Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS unit_heads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unit_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_unit_head (unit_id, user_id),
    KEY ix_unit_head_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // kolom lama units.head_user_id (satu kepala per unit): pindahkan isinya lalu hapus kolomnya
  const [cols] = (await pool.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'units' AND COLUMN_NAME = 'head_user_id'")) as unknown as [{ n: number }[]];
  if (Number(cols[0].n)) {
    await pool.query("INSERT IGNORE INTO unit_heads (unit_id, user_id, created_at) SELECT id, head_user_id, UTC_TIMESTAMP(3) FROM units WHERE head_user_id IS NOT NULL");
    await pool.query("ALTER TABLE units DROP COLUMN head_user_id");
  }
}

/** Tabel push_subscriptions (Web Push aplikasi karyawan). */
export async function ensurePushSubscriptions(pool: mysql.Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    p256dh VARCHAR(200) NOT NULL,
    auth VARCHAR(100) NOT NULL,
    user_agent VARCHAR(255) NULL,
    created_at DATETIME(3) NOT NULL,
    last_used_at DATETIME(3) NULL,
    UNIQUE KEY uq_push_endpoint (endpoint),
    KEY ix_push_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

/** Kolom users.session_version (sesi lama tidak berlaku setelah kata sandi diganti / direset). */
export async function ensureSessionVersion(pool: mysql.Pool) {
  const [cols] = (await pool.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'session_version'")) as unknown as [{ n: number }[]];
  if (!Number(cols[0].n)) await pool.query("ALTER TABLE users ADD COLUMN session_version INT NOT NULL DEFAULT 0");
}

/** Kategori awal file karyawan (hanya saat tabel masih kosong). */
export const DEFAULT_FILE_CATEGORIES = ["Identitas", "Kontrak kerja", "STR / SIP", "Sertifikat", "Lainnya"];

/** Tabel dokumen: file_categories, file_folders (file perusahaan), files. */
export async function ensureFiles(pool: mysql.Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS file_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_file_category_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS file_folders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    available_from DATE NULL,
    units JSON NOT NULL,
    employment_types JSON NOT NULL,
    notify_pending TINYINT(1) NOT NULL DEFAULT 0,
    reminder_date DATE NULL,
    reminder_message VARCHAR(255) NULL,
    reminder_sent_at DATETIME(3) NULL,
    created_by INT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folder_id INT NULL,
    owner_id INT NULL,
    category_id INT NULL,
    name VARCHAR(160) NOT NULL,
    ext VARCHAR(10) NOT NULL,
    mime VARCHAR(120) NOT NULL,
    size INT NOT NULL,
    path VARCHAR(255) NOT NULL,
    uploaded_by INT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY ix_files_folder (folder_id),
    KEY ix_files_owner (owner_id, category_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // kolom pengingat (ditambahkan setelah tabel pertama dibuat)
  const cols: [string, string][] = [
    ["notify_pending", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["reminder_date", "DATE NULL"],
    ["reminder_message", "VARCHAR(255) NULL"],
    ["reminder_sent_at", "DATETIME(3) NULL"],
  ];
  const [have] = (await pool.query("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'file_folders'")) as unknown as [{ c: string }[]];
  const existing = new Set(have.map((r) => r.c));
  for (const [name, type] of cols) if (!existing.has(name)) await pool.query(`ALTER TABLE file_folders ADD COLUMN ${name} ${type}`);
  const [rows] = (await pool.query("SELECT COUNT(*) n FROM file_categories")) as unknown as [{ n: number }[]];
  if (!Number(rows[0].n)) await pool.query("INSERT IGNORE INTO file_categories (name, created_at) VALUES ?", [DEFAULT_FILE_CATEGORIES.map((n) => [n, new Date()])]);
}
