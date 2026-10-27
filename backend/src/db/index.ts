import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { settings } from "../core/config";
import * as schema from "./schema";

export type DB = MySql2Database<typeof schema>;

// Satu pool per proses (dev HMR memuat ulang modul: simpan di globalThis agar tidak membuat pool baru tiap edit).
const g = globalThis as unknown as { __abitaPool?: mysql.Pool; __abitaDb?: DB; __abitaUrl?: string };

export function pool(): mysql.Pool {
  const url = process.env.DATABASE_URL || settings.DATABASE_URL;
  if (!g.__abitaPool || g.__abitaUrl !== url) {
    g.__abitaPool = mysql.createPool({
      uri: url,
      connectionLimit: settings.DB_POOL_SIZE,
      timezone: "Z", // DATETIME = UTC
      dateStrings: ["DATE"], // DATE dibaca sebagai "YYYY-MM-DD"
      supportBigNumbers: true,
      charset: "utf8mb4",
    });
    g.__abitaDb = drizzle(g.__abitaPool, { schema, mode: "default" });
    g.__abitaUrl = url;
  }
  return g.__abitaPool;
}

export function db(): DB {
  pool();
  return g.__abitaDb!;
}

export { schema };
