import { z } from "zod";

export const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD");
export const zTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Format jam HH:MM");
export const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format bulan YYYY-MM");
/** NIK karyawan: angka saja. */
export const zNik = z.string().regex(/^\d{1,40}$/, "NIK hanya boleh berisi angka.");
/** Unit yang dipimpin Kepala Unit: nama unit berbeda (tanpa batas jumlah). */
export const zHeadUnits = z
  .array(z.string().trim().min(1).max(120))
  .max(200)
  .refine((a) => new Set(a).size === a.length, "Unit tidak boleh sama.");

/** Waktu ISO 8601 (dikirim API sebagai string). */
export const zTimestamp = z.string().meta({ format: "date-time" });

export const Role = z.enum(["admin", "unit_head", "staff"]).meta({ id: "Role", description: "admin = Admin SDM · unit_head = Kepala Unit · staff = karyawan" });
export type Role = z.infer<typeof Role>;

export const EmploymentType = z.enum(["magang", "outsourcing", "tetap"]).meta({ id: "EmploymentType" });
export type EmploymentType = z.infer<typeof EmploymentType>;

export const ReqStatus = z.enum(["pending", "approved", "rejected", "cancelled"]).meta({ id: "ReqStatus" });
export type ReqStatus = z.infer<typeof ReqStatus>;

/** tanpa_pulang = sudah check in, jendela check out lewat tanpa check out (perlu koreksi Kepala Unit). */
export const DayStatus = z.enum(["hadir", "telat", "selesai", "tanpa_pulang", "izin", "sakit", "gagal", "belum", "alpa", "libur"]).meta({ id: "DayStatus" });
export type DayStatus = z.infer<typeof DayStatus>;

export const HolidayKind = z.enum(["nasional", "cuti_bersama", "khusus"]).meta({ id: "HolidayKind" });
export type HolidayKind = z.infer<typeof HolidayKind>;

export const LeaveKind = z.enum(["izin", "sakit"]);
export type LeaveKind = z.infer<typeof LeaveKind>;

export const Challenge = z.enum(["center", "turn_left", "turn_right"]).meta({ id: "Challenge" });
export type Challenge = z.infer<typeof Challenge>;

export const FacePurpose = z.enum(["enroll", "reenroll", "in", "out"]);
export type FacePurpose = z.infer<typeof FacePurpose>;

/** Bentuk error semua endpoint: {"detail": "pesan"} atau daftar galat validasi (422). */
export const ApiErrorBody = z
  .object({
    detail: z.union([z.string(), z.array(z.object({ loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), type: z.string() })), z.record(z.string(), z.unknown())]),
  })
  .meta({ id: "ApiError" });
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
