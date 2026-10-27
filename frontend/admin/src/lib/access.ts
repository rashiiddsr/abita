import type { Role } from "./types";

/**
 * Matriks akses dasbor web (cermin aturan backend: @Roles dan jangkauan unit di core/auth.ts).
 *
 * | Menu               | Admin SDM                                   | Kepala Unit                          |
 * |--------------------|---------------------------------------------|--------------------------------------|
 * | Filter unit        | global (bisa dipilih)                       | — (terkunci ke unitnya, tidak tampil) |
 * | Dashboard          | baca                                        | baca (unitnya)                       |
 * | Absensi            | baca                                        | baca (unitnya)                       |
 * | Pengajuan          | baca (baris → detail)                       | setujui / tolak (unitnya)            |
 * | Karyawan           | tambah / ubah / nonaktifkan (semua unit)    | tambah / ubah / nonaktifkan (unitnya) |
 * | Jadwal / Shift     | baca                                        | ubah (unitnya)                       |
 * | Laporan            | baca + ekspor                               | baca + ekspor (unitnya)              |
 * | Dokumen            | penuh (file perusahaan, kategori, file karyawan) | baca (file karyawan: unitnya)   |
 * | Kelola Unit/Admin  | penuh                                       | —                                    |
 * | Pengaturan         | Lokasi, Jam shift, Pola, Hari libur, Aturan, SMTP | Notifikasi                     |
 */
export type MenuKey = "dashboard" | "absensi" | "pengajuan" | "karyawan" | "jadwal" | "laporan" | "dokumen" | "kelolaUnit" | "kelolaAdmin" | "pengaturan" | "profil";
export type SettingsSection = "lokasi" | "shift" | "pola" | "libur" | "bantuan" | "smtp" | "notif";

export interface Access {
  menus: ReadonlySet<MenuKey>;
  /** Filter unit di sidebar (Admin SDM). Kepala Unit selalu terkunci ke unitnya, tanpa filter. */
  unitFilter: boolean;
  /** Kelola akun admin & unit (Admin SDM). */
  manage: boolean;
  /** Tambah/ubah/nonaktifkan karyawan: Admin SDM semua unit, Kepala Unit hanya unitnya. */
  manageStaff: boolean;
  /** Mengubah jadwal unit sendiri (Kepala Unit; bisa dinonaktifkan Admin SDM di Aturan persetujuan). */
  editSchedule: boolean;
  /** Memutuskan pengajuan unit sendiri (Kepala Unit). Tombol tetap mengikuti flag can_review dari server. */
  review: boolean;
  /** Unggah, ubah, hapus dokumen dan kelola kategori file (Admin SDM). */
  manageFiles: boolean;
  /** Melihat riwayat absensi & pengajuan karyawan di halaman detail. */
  monitor: boolean;
  settings: readonly SettingsSection[];
}

const ACCESS: Record<Exclude<Role, "staff">, Access> = {
  admin: {
    menus: new Set(["dashboard", "absensi", "pengajuan", "karyawan", "jadwal", "laporan", "dokumen", "kelolaUnit", "kelolaAdmin", "pengaturan", "profil"]),
    unitFilter: true,
    manage: true,
    manageStaff: true,
    editSchedule: false,
    review: false,
    manageFiles: true,
    monitor: true,
    settings: ["lokasi", "shift", "pola", "libur", "bantuan", "smtp"],
  },
  unit_head: {
    menus: new Set(["dashboard", "absensi", "pengajuan", "karyawan", "jadwal", "laporan", "dokumen", "pengaturan", "profil"]),
    unitFilter: false,
    manage: false,
    manageStaff: true,
    editSchedule: true,
    review: true,
    manageFiles: false,
    monitor: true,
    settings: ["pola", "notif"],
  },
};

const NONE: Access = { menus: new Set(), unitFilter: false, manage: false, manageStaff: false, editSchedule: false, review: false, manageFiles: false, monitor: false, settings: [] };

export function accessFor(role: Role): Access {
  return role === "staff" ? NONE : ACCESS[role];
}

/** Menu pemilik sebuah path (untuk penjaga rute). */
export const ROUTES: [prefix: string, menu: MenuKey][] = [
  ["/attendance", "absensi"],
  ["/requests", "pengajuan"],
  ["/staff", "karyawan"],
  ["/schedule", "jadwal"],
  ["/reports", "laporan"],
  ["/documents", "dokumen"],
  ["/units", "kelolaUnit"],
  ["/admins", "kelolaAdmin"],
  ["/settings", "pengaturan"],
  ["/profile", "profil"],
];

export function menuOf(path: string): MenuKey {
  return ROUTES.find(([p]) => path === p || path.startsWith(p + "/"))?.[1] ?? "dashboard";
}
