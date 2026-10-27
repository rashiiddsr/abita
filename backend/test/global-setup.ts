/**
 * Siapkan database uji (abita_test), isi data seed, build & jalankan API di port 3099.
 * Database utama (abita) tidak pernah disentuh.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";

const API_DIR = path.resolve(__dirname, "..");
export const TEST_DB = process.env.TEST_DATABASE_URL ?? "mysql://root:@127.0.0.1:3306/abita_test";
const PORT = 3099;
let server: ChildProcess | null = null;

export async function setup() {
  if (!/abita_test|_test\b/.test(TEST_DB)) throw new Error("TEST_DATABASE_URL harus database uji (mengandung _test).");
  // file uji (foto absen, dokumen, lampiran) ditulis ke folder sementara, tidak bercampur dengan backend/storage
  const STORAGE_DIR = path.join(os.tmpdir(), "abita-test-storage");
  const env = { ...process.env, DATABASE_URL: TEST_DB, API_PORT: String(PORT), NODE_ENV: "test", API_RATE_PER_MIN: "100000", STORAGE_DIR };
  const run = (cmd: string, tty = false) => execSync(cmd, { cwd: API_DIR, env, stdio: tty ? "inherit" : "pipe" });
  // struktur tabel: drizzle-kit butuh terminal, jadi hanya dijalankan bila database uji masih kosong
  const conn = await mysql.createConnection({ uri: TEST_DB });
  const [rows] = (await conn.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")) as unknown as [{ n: number }[]];
  await conn.end();
  if (!rows[0].n) run("npx drizzle-kit push --config drizzle.config.ts --force", true);
  run("npx tsx scripts/seed.ts --reset --demo");
  run("npx nest build");
  server = spawn(process.execPath, ["dist/main.js"], { cwd: API_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout?.on("data", (d) => (log += d));
  server.stderr?.on("data", (d) => (log += d));
  for (let i = 0; i < 120; i++) { // maks. 60 dtk (start pertama memuat model wajah)
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/v1/config`);
      if (r.ok) return;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("API uji tidak menyala:\n" + log.slice(-2000));
}

export async function teardown() {
  server?.kill();
}
