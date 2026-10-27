/**
 * Body/query permintaan ke /api/v1. Dipakai API untuk validasi (ZodPipe) dan dokumentasi Swagger,
 * serta aplikasi admin/staff untuk tipe body (z.input<...>).
 */
import { z } from "zod";
import { EmploymentType, FacePurpose, HolidayKind, Role, zDay, zHeadUnits, zMonth, zNik, zTime } from "./common";

// ------------------------------------------------------------------ auth

export const LoginIn = z
  .object({
    employee_code: z.string().min(1).max(160).describe('"Email atau NIK" (nama field lama dipertahankan)'),
    password: z.string().min(1).max(200),
    remember: z.boolean().default(true),
  })
  .meta({ id: "LoginIn" });
/** Lupa kata sandi: email akun; kata sandi baru dikirim ke email itu. */
export const ForgotIn = z.object({ identifier: z.string().min(1).max(160) }).meta({ id: "ForgotIn" });

// ------------------------------------------------------------------ akun sendiri

/** `name` hanya untuk akun dasbor; nama karyawan diubah Admin SDM / Kepala Unit. */
export const ProfileIn = z.object({ name: z.string().min(1).max(120).optional(), email: z.string().max(160).nullish(), phone: z.string().max(40).nullish() }).meta({ id: "ProfileIn" });
export const PasswordIn = z.object({ old_password: z.string(), new_password: z.string().min(8).max(128) }).meta({ id: "PasswordIn" });
/** multipart/form-data; file `attachment` (SKD) dibaca terpisah oleh API, di sini hanya untuk dokumentasi. */
export const LeaveIn = z
  .object({
    kind: z.string().describe("izin | sakit"),
    start_date: zDay,
    end_date: zDay,
    reason: z.string().min(3).max(1000),
    attachment: z.unknown().optional().meta({ type: "string", format: "binary", description: "Lampiran/SKD (opsional, gambar atau PDF)" }),
  })
  .meta({ id: "LeaveIn" });
export const SwapIn = z.object({ date: zDay, target_user_id: z.number().int(), target_date: zDay.nullish(), reason: z.string().min(3).max(500) }).meta({ id: "SwapIn" });
export const SwapRespondIn = z.object({ accept: z.boolean(), note: z.string().max(255).nullish() }).meta({ id: "SwapRespondIn" });
/** Langganan Web Push dari PushManager.subscribe() (toJSON()). */
export const PushSubscribeIn = z
  .object({
    endpoint: z.string().url().max(500),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  })
  .meta({ id: "PushSubscribeIn" });
export const PushUnsubscribeIn = z.object({ endpoint: z.string().max(500) }).meta({ id: "PushUnsubscribeIn" });
export const NotifPrefsIn = z
  .object({ leave: z.boolean().default(true), swap: z.boolean().default(true), attendance: z.boolean().default(true), schedule: z.boolean().default(true) })
  .meta({ id: "NotifPrefsIn" });

// ------------------------------------------------------------------ presensi wajah

export const SessionIn = z.object({ purpose: FacePurpose }).meta({ id: "SessionIn" });

// ------------------------------------------------------------------ admin: karyawan & akun

export const UserCreateIn = z
  .object({
    employee_code: z.string().min(1).max(160).describe("NIK karyawan (angka saja); akun admin memakai email"),
    name: z.string().min(1).max(120),
    password: z.string().min(6).nullish().describe("kosong = dibuat sistem & dikirim lewat email"),
    role: Role.default("staff"),
    office_id: z.number().int().nullish(),
    email: z.string().max(160).nullish(),
    phone: z.string().max(40).nullish(),
    employment_type: EmploymentType.nullish(),
    unit: z.string().max(120).nullish(),
    institution: z.string().max(160).nullish(),
    period_start: zDay.nullish(),
    head_units: zHeadUnits.nullish().describe("Kepala Unit: unit yang dipimpin; kosong = unit di atas"),
  })
  .refine((b) => b.role !== "staff" || zNik.safeParse(b.employee_code.trim()).success, { path: ["employee_code"], message: "NIK hanya boleh berisi angka." })
  .meta({ id: "UserCreateIn" });
export const UserUpdateIn = z
  .object({
    name: z.string().min(1).max(120),
    role: Role,
    email: z.string().max(160).nullable(),
    phone: z.string().max(40).nullable(),
    employment_type: EmploymentType.nullable(),
    unit: z.string().max(120).nullable(),
    institution: z.string().max(160).nullable(),
    period_start: zDay.nullable(),
    is_active: z.boolean().nullable(),
    head_units: zHeadUnits.nullable(),
  })
  .partial()
  .meta({ id: "UserUpdateIn" });
export const PasswordResetIn = z.object({ new_password: z.string().min(6).nullish() }).meta({ id: "PasswordResetIn" });
export const BulkResetIn = z.object({ user_ids: z.array(z.number().int()).min(1).max(500) }).meta({ id: "BulkResetIn" });
/** Aktifkan / nonaktifkan banyak akun sekaligus (Kelola Admin). */
export const BulkStatusIn = z.object({ user_ids: z.array(z.number().int()).min(1).max(500), is_active: z.boolean() }).meta({ id: "BulkStatusIn" });
/** Setujui / tolak banyak pengajuan sekaligus (Kepala Unit). */
export const BulkReviewIn = z
  .object({
    items: z.array(z.object({ kind: z.enum(["leave", "swap"]), id: z.number().int() })).min(1).max(200),
    approve: z.boolean(),
    note: z.string().max(255).nullish(),
  })
  .meta({ id: "BulkReviewIn" });
/**
 * Koreksi absensi oleh Kepala Unit (lupa check out, kamera rusak, dsb.). Jam lokal WIB "HH:MM" pada tanggal kerja;
 * check out yang lebih awal dari check in dianggap keesokan harinya (shift malam). Kolom yang tidak diisi tidak diubah.
 */
export const AttendanceCorrectIn = z
  .object({
    user_id: z.number().int(),
    date: zDay,
    check_in: zTime.nullish(),
    check_out: zTime.nullish(),
    reason: z.string().trim().min(5, "Alasan koreksi minimal 5 karakter.").max(255),
  })
  .refine((b) => !!b.check_in || !!b.check_out, { path: ["check_in"], message: "Isi jam check in atau check out." })
  .meta({ id: "AttendanceCorrectIn" });
export const OfficeIn = z
  .object({
    name: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radius_m: z.number().min(10).max(1000),
    address: z.string().nullish(),
  })
  .meta({ id: "OfficeIn" });
/** `head_user_ids`: Kepala Unit unit ini (boleh lebih dari satu; unit baru minimal satu). Daftar ini menggantikan kepala sebelumnya. */
export const UnitIn = z
  .object({ name: z.string().min(2).max(120), head_user_ids: z.array(z.number().int()).max(20).default([]) })
  .meta({ id: "UnitIn" });

// ------------------------------------------------------------------ admin: pengaturan

export const SettingsIn = z
  .object({
    checkin_open_before_min: z.number().int().min(0).max(360).nullish(),
    checkin_close_after_min: z.number().int().min(0).max(360).nullish(),
    checkout_open_before_min: z.number().int().min(0).max(360).nullish(),
    checkout_close_after_min: z.number().int().min(0).max(720).nullish(),
    escalation_hours: z.number().min(0).max(720).nullish(),
    schedule_deadline_day: z.number().int().min(1).max(28).nullish(),
    helpdesk_email: z.string().max(160).nullish(),
    helpdesk_whatsapp: z.string().max(20).nullish(),
    sdm_decides_headless: z.boolean().nullish(),
  })
  .meta({ id: "SettingsIn" });
export const SmtpIn = z
  .object({
    host: z.string().max(200),
    port: z.number().int().min(1).max(65535),
    encryption: z.enum(["tls", "ssl", "none"]),
    username: z.string().max(200).default(""),
    password: z.string().max(200).nullish().describe("null = tidak diubah"),
    sender: z.string().max(200),
  })
  .meta({ id: "SmtpIn" });
export const SmtpTestIn = z.object({ to: z.string().max(200).nullish() }).meta({ id: "SmtpTestIn" });

// ------------------------------------------------------------------ admin: shift, jadwal, pengajuan

export const ShiftTypeIn = z
  .object({ name: z.string().min(1).max(40), start_time: zTime, end_time: zTime, color: z.string().max(9).nullish(), active: z.boolean().default(true) })
  .meta({ id: "ShiftTypeIn" });
export const ShiftBulkIn = z
  .object({ items: z.array(z.object({ user_id: z.number().int(), date: zDay, shift_type_id: z.number().int().nullable() })).max(2000) })
  .meta({ id: "ShiftBulkIn" });
export const ReviewIn = z.object({ approve: z.boolean(), note: z.string().max(255).nullish() }).meta({ id: "ReviewIn" });
/** `unit`: Kepala Unit yang memimpin beberapa unit memilih unitnya (kosong = unit pertama). */
export const PublishIn = z.object({ month: zMonth, unit: z.string().max(120).nullish() }).meta({ id: "PublishIn" });
export const PatternIn = z
  .object({
    name: z.string().min(2).max(80),
    sequence: z.array(z.number().int().nullable()).min(1).max(62),
    active: z.boolean().default(true),
    unit: z.string().max(120).nullish().describe("Kepala Unit beberapa unit: unit pemilik pola (kosong = unit pertama)"),
  })
  .meta({ id: "PatternIn" });
export const AssignIn = z
  .object({
    user_ids: z.array(z.number().int()).min(1).max(500),
    pattern_id: z.number().int().nullish(),
    sequence: z.array(z.number().int().nullable()).max(62).nullish(),
    start_date: zDay,
    end_date: zDay.nullish(),
    skip_holidays: z.boolean().default(false),
  })
  .meta({ id: "AssignIn" });
export const HolidayIn = z.object({ date: zDay, name: z.string().min(2).max(120), kind: HolidayKind.default("nasional") }).meta({ id: "HolidayIn" });

// ------------------------------------------------------------------ admin: laporan

export const ReportFilters = z
  .object({
    tab: z.enum(["hadir", "req", "jadwal", "kr"]).default("hadir"),
    period: z.enum(["mingguan", "bulanan"]).default("bulanan"),
    month: z.string().nullish(),
    week: zDay.nullish(),
    unit: z.string().nullish(),
    tipe: z.string().nullish(),
    status: z.string().nullish(),
  })
  .meta({ id: "ReportFilters" });
export const ExportIn = ReportFilters.extend({ format: z.enum(["xlsx", "pdf"]).default("xlsx"), columns: z.array(z.string()).nullish() }).meta({ id: "ExportIn" });

// ------------------------------------------------------------------ tipe body untuk aplikasi

export type LoginBody = z.input<typeof LoginIn>;
export type ProfileBody = z.input<typeof ProfileIn>;
export type PasswordBody = z.input<typeof PasswordIn>;
export type SwapBody = z.input<typeof SwapIn>;
export type UserCreateBody = z.input<typeof UserCreateIn>;
export type UserUpdateBody = z.input<typeof UserUpdateIn>;
export type OfficeBody = z.input<typeof OfficeIn>;
export type UnitBody = z.input<typeof UnitIn>;
export type SettingsBody = z.input<typeof SettingsIn>;
export type SmtpBody = z.input<typeof SmtpIn>;
export type ShiftTypeBody = z.input<typeof ShiftTypeIn>;
export type ReviewBody = z.input<typeof ReviewIn>;
export type PatternBody = z.input<typeof PatternIn>;
export type AssignBody = z.input<typeof AssignIn>;
export type HolidayBody = z.input<typeof HolidayIn>;
export type ExportBody = z.input<typeof ExportIn>;

// ------------------------------------------------------------------ dokumen

/** Folder file perusahaan. units / employment_types kosong = semua karyawan; available_from kosong = langsung tampil. */
export const FolderIn = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullish(),
    available_from: zDay.nullish(),
    units: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
    employment_types: z.array(EmploymentType).max(3).default([]),
    /** pengingat sekali ke penerima pada tanggal ini (pukul 07.00 WIB) */
    reminder_date: zDay.nullish(),
    reminder_message: z.string().trim().max(255).nullish(),
  })
  .meta({ id: "FolderIn" });
export const FileCategoryIn = z.object({ name: z.string().trim().min(1).max(60) }).meta({ id: "FileCategoryIn" });
/** Ubah nama / kategori file. category_id hanya berlaku untuk file karyawan. */
export const FileUpdateIn = z.object({ name: z.string().trim().min(1).max(160), category_id: z.number().int().nullish() }).meta({ id: "FileUpdateIn" });
/** multipart/form-data: `files` (1–10 file), `notify` (beri tahu penerima, default true) dan, untuk file karyawan, `category_id`. */
export const FileUploadIn = z
  .object({
    category_id: z.coerce.number().int().optional(),
    notify: z.stringbool().default(true),
    files: z.unknown().optional().meta({ type: "array", items: { type: "string", format: "binary" }, description: "PDF, JPG, PNG, WEBP, DOCX, XLSX, PPTX" }),
  })
  .meta({ id: "FileUploadIn" });
