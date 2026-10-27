/**
 * Isi database:
 *   npm run db:seed                  -> akun bawaan Admin SDM saja (adminsdm@gmail.com / adminsdm123), bila belum ada
 *   npm run db:seed -- --reset       -> KOSONGKAN SEMUA tabel (data, absensi, log, pengaturan) lalu buat akun bawaan
 *   npm run db:seed:demo             -> + data contoh: kantor, unit, akun per peran, staff, jenis shift, jadwal (dipakai tes)
 * Akun bawaan bisa diganti lewat SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Kata sandi akun yang sudah ada tidak diubah.
 */
import { and, eq, or } from "drizzle-orm";
import { hashPassword } from "../src/core/auth";
import { settings } from "../src/core/config";
import { addDays, today } from "../src/core/time";
import { db, pool, schema } from "../src/db";
import { ensureSchema } from "../src/db/ensure";
import { ledUnitsOf, syncUnitHead } from "../src/domain/services";

const { offices, units, users, shiftTypes, shiftAssignments } = schema;

const UNITS = ["Farmasi Rawat Jalan", "Rekam Medis", "IGD"];
// kode, nama, email, sandi uji, peran, unit
const ADMINS: [string, string, string, string, string, string | null][] = [
  ["admin", "Administrator SDM", "sdm@example.com", "admin123", "admin", null],
  ["sdm.uji", "Admin SDM Uji", "sdm.uji@example.com", "XuNkTetkCDb8", "admin", null],
  ["KU-FRJ", "apt. Lina Marpaung", "kepala.farmasi@example.com", "kepala123", "unit_head", "Farmasi Rawat Jalan"],
  ["KU-RM", "Dewi Anggraini", "kepala.rm@example.com", "kepala123", "unit_head", "Rekam Medis"],
  ["KU-IGD", "dr. Andi Pratama", "kepala.igd@example.com", "kepala123", "unit_head", "IGD"],
];
// NIK, nama, email, sandi uji, tipe, unit, institusi/vendor
const STAFF: [string, string, string, string, string, string, string][] = [
  ["20260001", "Budi Santoso", "budi@example.com", "budi123", "magang", "Farmasi Rawat Jalan", "Universitas Batam (UNIBA)"],
  ["20260002", "Siti Rahayu", "siti@example.com", "siti123", "outsourcing", "Rekam Medis", "PT Mitra Layanan"],
  ["20260003", "Rina Kartika", "rina@example.com", "rina123", "magang", "IGD", "Poltekkes Tanjungpinang"],
];
const SHIFT_TYPES: [string, string, string, string][] = [
  ["Pagi", "07:00:00", "15:00:00", "#0F766E"],
  ["Siang", "14:00:00", "22:00:00", "#B45309"],
  ["Malam", "22:00:00", "07:00:00", "#4338CA"],
];
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || "adminsdm@gmail.com").toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "adminsdm123";

/** Semua tabel di database ini dikosongkan (TRUNCATE: id mulai dari 1 lagi). */
async function resetAll() {
  const conn = await pool().getConnection();
  try {
    const [rows] = (await conn.query("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'")) as unknown as [{ n: string }[]];
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const { n } of rows) await conn.query(`TRUNCATE TABLE \`${n}\``);
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    console.log(`Cleared ${rows.length} tables.`);
  } finally {
    conn.release();
  }
}

/** Akun bawaan Admin SDM (tanpa kantor/unit; kantor diatur di Pengaturan › Lokasi presensi). */
async function defaultAdmin() {
  const [u] = await db().select().from(users).where(or(eq(users.email, ADMIN_EMAIL), eq(users.employeeCode, ADMIN_EMAIL)));
  if (u) return console.log(`Admin SDM ${ADMIN_EMAIL} already exists (password unchanged).`);
  await db()
    .insert(users)
    .values({ employeeCode: ADMIN_EMAIL, name: "Admin SDM", email: ADMIN_EMAIL, passwordHash: await hashPassword(ADMIN_PASSWORD), role: "admin", employmentType: "tetap", isActive: true, mustChangePassword: false });
  console.log(`Admin SDM created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

async function account(officeId: number, code: string, name: string, email: string, pw: string, role: string) {
  // akun yang sudah ada dikenali dari email (NIK lama seperti EMP001 tetap dipakai, tidak diubah)
  const [u] = await db().select().from(users).where(or(eq(users.email, email), eq(users.employeeCode, code)));
  if (u) return { user: u, created: false };
  const [{ id }] = await db()
    .insert(users)
    .values({ employeeCode: code, name, email, passwordHash: await hashPassword(pw), role, officeId, isActive: true })
    .$returningId();
  return { user: (await db().select().from(users).where(eq(users.id, id)))[0], created: true };
}

async function main() {
  await ensureSchema(pool());
  if (process.argv.includes("--reset")) await resetAll();
  await defaultAdmin();
  if (process.argv.includes("--demo")) await demo();
  await pool().end();
}

/** Data contoh untuk pengembangan & tes otomatis. */
async function demo() {
  let [office] = await db().select().from(offices).limit(1);
  if (!office) {
    // ubah lewat dasbor: Pengaturan › Lokasi presensi
    await db().insert(offices).values({ name: settings.ORG_NAME, lat: 1.1301, lng: 104.0529, radiusM: settings.DEFAULT_RADIUS_M, address: "Batam Kota" });
    [office] = await db().select().from(offices).limit(1);
  }
  for (const name of UNITS) if (!(await db().select().from(units).where(eq(units.name, name))).length) await db().insert(units).values({ name });

  const out: string[][] = [];
  for (const [code, name, email, pw, role, unit] of ADMINS) {
    const { user, created } = await account(office.id, code, name, email, pw, role);
    if (!user.employmentType) await db().update(users).set({ employmentType: "tetap" }).where(eq(users.id, user.id));
    // Kepala Unit uji yang belum memimpin unit apa pun dipasang ke unitnya (satu unit boleh punya beberapa kepala)
    if (role === "unit_head" && unit && !(await ledUnitsOf(user)).length) {
      await db().update(users).set({ unit }).where(eq(users.id, user.id));
      await syncUnitHead({ ...user, unit });
    }
    out.push([role, email, created ? pw : "(password unchanged)", role === "unit_head" ? (unit ?? "") : "All units"]);
  }
  const t = today();
  for (const [code, name, email, pw, etype, unit, inst] of STAFF) {
    const { user, created } = await account(office.id, code, name, email, pw, "staff");
    await db()
      .update(users)
      .set({ employmentType: user.employmentType ?? etype, unit: user.unit ?? unit, institution: user.institution ?? inst, periodStart: user.periodStart ?? `${t.slice(0, 8)}01` })
      .where(eq(users.id, user.id));
    out.push(["staff", `${email} / ${code}`, created ? pw : "(password unchanged)", unit]);
  }
  const types = new Map((await db().select().from(shiftTypes)).map((x) => [x.name, x]));
  for (const [name, s, e, color] of SHIFT_TYPES) {
    if (!types.has(name)) {
      await db().insert(shiftTypes).values({ name, startTime: s, endTime: e, color, active: true });
      types.set(name, (await db().select().from(shiftTypes).where(eq(shiftTypes.name, name)))[0]);
    }
  }
  // jadwal contoh untuk staff seed: awal bulan ini s.d. 3 minggu ke depan, Minggu libur
  const pattern = ["Pagi", "Pagi", "Siang", "Pagi", "Siang", "Pagi", null];
  let added = 0;
  for (const [i, [code]] of STAFF.entries()) {
    const [u] = await db().select().from(users).where(eq(users.employeeCode, code));
    for (let d = `${t.slice(0, 8)}01`; d <= addDays(t, 21); d = addDays(d, 1)) {
      const dow = new Date(d + "T00:00:00Z").getUTCDay();
      const ord = Math.floor(Date.parse(d + "T00:00:00Z") / 86400000);
      const name = dow !== 0 ? pattern[(ord + i) % 7] : null;
      if (!name) continue;
      const exists = await db().select({ id: shiftAssignments.id }).from(shiftAssignments).where(and(eq(shiftAssignments.userId, u.id), eq(shiftAssignments.date, d)));
      if (!exists.length) {
        await db().insert(shiftAssignments).values({ userId: u.id, date: d, shiftTypeId: types.get(name)!.id });
        added++;
      }
    }
  }
  console.log("\nTest accounts (localhost only):");
  for (const r of out) console.log(`  ${r[0].padEnd(10)} ${r[1].padEnd(36)} ${r[2].padEnd(22)} ${r[3]}`);
  console.log(`\n${added} sample shift assignments added.`);
}

main().catch(async (e) => {
  console.error("Seed failed:", e.message);
  await pool().end();
  process.exit(1);
});
