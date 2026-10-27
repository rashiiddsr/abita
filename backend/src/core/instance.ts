/**
 * Penentuan proses utama per database. Bila hosting menjalankan lebih dari satu proses API, tugas terjadwal
 * (pengingat check out, antrean email) hanya dijalankan oleh satu proses untuk mencegah pengiriman ganda.
 * Menggunakan MySQL GET_LOCK pada koneksi khusus; kunci dilepas otomatis saat proses berhenti dan diambil alih proses lain.
 */
import mysql from "mysql2/promise";
import { log } from "../common/logger";
import { settings } from "./config";

const TICK_MS = 30_000; // sekaligus menjaga koneksi kunci tetap aktif (mencegah idle timeout MySQL)
let conn: mysql.Connection | null = null;
let primary = false;
let warned = false;

export const isPrimary = () => primary;

const url = () => process.env.DATABASE_URL || settings.DATABASE_URL;
const lockName = () => `abita:${new URL(url()).pathname.slice(1) || "abita"}:jobs`.slice(0, 64);

function drop() {
  primary = false;
  conn?.destroy();
  conn = null;
}

async function tick() {
  try {
    if (primary && conn) {
      await conn.query("SELECT 1");
      return;
    }
    if (!conn) {
      conn = await mysql.createConnection({ uri: url() });
      conn.on("error", drop); // koneksi terputus: kunci dilepas dan diambil kembali pada putaran berikutnya
    }
    const [rows] = (await conn.query("SELECT GET_LOCK(?, 0) AS ok", [lockName()])) as unknown as [{ ok: number | null }[]];
    primary = Number(rows[0]?.ok) === 1;
    if (primary) log("info", "app", "Scheduled jobs run in this process", { pid: process.pid });
    else if (!warned) {
      warned = true;
      log("warn", "app", "Another API process uses this database; scheduled jobs run there", { hint: "Expected briefly during a restart; if persistent, the host runs multiple API processes." });
    }
  } catch (e) {
    drop();
    log("warn", "app", `Job lock unavailable: ${(e as Error).message}`);
  }
}

/** Dipanggil sekali saat server dimulai; proses lain mencoba mengambil alih setiap 30 detik. */
export function startInstanceLock() {
  void tick();
  setInterval(() => void tick(), TICK_MS).unref();
}
