/**
 * Bentuk respons /api/v1 (snake_case). Satu sumber untuk API (tipe pemeta di domain/out.ts),
 * dokumentasi Swagger, dan tipe di aplikasi admin & karyawan: ganti nama field di sini -> build gagal di semua pemakainya.
 */
import { z } from "zod";
import { Challenge, DayStatus, EmploymentType, HolidayKind, LeaveKind, ReqStatus, Role, zDay, zTimestamp } from "./common";

const n = <T extends z.ZodType>(t: T) => t.nullable();
const str = z.string();
const int = z.number().int();
const num = z.number();
const bool = z.boolean();

// ------------------------------------------------------------------ akun & kantor

export const User = z
  .object({
    id: int,
    employee_code: str,
    name: str,
    role: Role,
    office_id: n(int),
    face_enrolled_at: n(zTimestamp),
    created_at: zTimestamp,
    email: n(str),
    phone: n(str),
    employment_type: n(EmploymentType),
    unit: n(str),
    institution: n(str),
    period_start: n(zDay),
    is_active: n(bool),
    last_seen_at: n(zTimestamp),
    has_avatar: bool,
    must_change_password: bool.describe("akun baru / direset admin: wajib membuat kata sandi sendiri"),
    head_units: z.array(str).describe("Kepala Unit: unit yang dipimpin (unit utama dulu; diatur di Kelola Unit); selain itu kosong"),
  })
  .meta({ id: "User" });
export type User = z.infer<typeof User>;

export const Office = z.object({ id: int, name: str, lat: num, lng: num, radius_m: num, address: n(str) }).meta({ id: "Office" });
export type Office = z.infer<typeof Office>;

export const ShiftType = z.object({ id: int, name: str, start_time: str, end_time: str, color: n(str), active: bool }).meta({ id: "ShiftType" });
export type ShiftType = z.infer<typeof ShiftType>;

export const TodayStatus = z
  .object({
    work_date: zDay,
    check_in: n(zTimestamp),
    check_out: n(zTimestamp),
    late_minutes: n(int),
    shift: n(z.object({ shift: ShiftType, start: zTimestamp, end: zTimestamp })),
    leave: n(LeaveKind),
    window: n(z.object({ in_open: zTimestamp, in_close: zTimestamp, out_open: zTimestamp, out_close: zTimestamp })).describe("jendela check in / check out shift ini"),
  })
  .meta({ id: "TodayStatus" });
export type TodayStatus = z.infer<typeof TodayStatus>;

export const Me = z
  .object({ user: User, face_enrolled: bool, today: TodayStatus, office: n(Office), unread_notifications: int, pending_requests: int })
  .meta({ id: "Me" });
export type Me = z.infer<typeof Me>;

export const AppConfig = z
  .object({ org_name: str, helpdesk_whatsapp: str, helpdesk_email: str, max_attachment_mb: num })
  .meta({ id: "AppConfig" });
export type AppConfig = z.infer<typeof AppConfig>;

export const CredentialResult = z
  .object({ email_sent: bool, email_error: n(str), temp_password: n(str).describe("Kata sandi akun (buat / reset satu akun): tampilkan sekali ke admin") })
  .meta({ id: "CredentialResult" });
export type CredentialResult = z.infer<typeof CredentialResult>;

export const CreatedUserOut = z.object({ user: User, credentials: CredentialResult }).meta({ id: "CreatedUserOut" });
export type CreatedUserOut = z.infer<typeof CreatedUserOut>;

export const UnitHead = z.object({ id: int, name: str }).meta({ id: "UnitHead" });
export const UnitOut = z
  .object({
    id: int,
    name: str,
    heads: z.array(UnitHead).describe("Kepala Unit unit ini (bisa lebih dari satu)"),
    head_name: n(str).describe("nama Kepala Unit digabung koma; null bila belum ada"),
    staff_count: int,
  })
  .meta({ id: "UnitOut" });
export type UnitOut = z.infer<typeof UnitOut>;

// ------------------------------------------------------------------ presensi

export const AttendanceOut = z
  .object({
    id: int,
    user_id: int,
    work_date: zDay,
    type: z.enum(["in", "out"]),
    checked_at: zTimestamp,
    lat: n(num),
    lng: n(num),
    accuracy: n(num),
    distance_m: n(num),
    match_score: n(num),
    has_photo: bool,
    late_minutes: n(int),
    shift_type_id: n(int),
  })
  .meta({ id: "Attendance" });
export type AttendanceOut = z.infer<typeof AttendanceOut>;

export const AttendanceWithUser = AttendanceOut.extend({ employee_code: str, name: str }).meta({ id: "AttendanceWithUser" });
export type AttendanceWithUser = z.infer<typeof AttendanceWithUser>;

export const AttemptOut = z
  .object({
    id: int,
    session_id: str,
    user_id: int,
    employee_code: str,
    name: str,
    purpose: str,
    success: bool,
    reason_code: str,
    scores: z.record(str, z.unknown()),
    lat: n(num),
    lng: n(num),
    accuracy: n(num),
    distance_m: n(num),
    created_at: zTimestamp,
  })
  .meta({ id: "Attempt" });
export type AttemptOut = z.infer<typeof AttemptOut>;

export const FaceSession =z.object({ session_id: str, purpose: str, challenges: z.array(Challenge), expires_at: zTimestamp }).meta({ id: "FaceSession" });
export type FaceSession = z.infer<typeof FaceSession>;

export const SubmitResult = z
  .object({
    success: bool,
    reason_code: str,
    message: str,
    attendance: n(AttendanceOut),
    match_score: n(num),
    distance_m: n(num),
    scores: n(z.record(str, z.unknown())).optional().describe("hanya di mode pengembangan"),
  })
  .meta({ id: "SubmitResult" });
export type SubmitResult = z.infer<typeof SubmitResult>;

export const MonthSummary = z
  .object({ month: str, scheduled_days: int, present: int, on_time: int, late: int, izin: int, sakit: int, absent: int, punctuality_pct: n(num) })
  .meta({ id: "MonthSummary" });
export type MonthSummary = z.infer<typeof MonthSummary>;

export const ShiftMini = z.object({ id: int, name: str, start: str, end: str, color: n(str) }).meta({ id: "ShiftMini" });
export type ShiftMini = z.infer<typeof ShiftMini>;

export const DailyRow = z
  .object({
    user_id: int,
    name: str,
    employee_code: str,
    employment_type: n(EmploymentType),
    unit: n(str),
    has_avatar: bool,
    shift: n(ShiftMini),
    status: DayStatus,
    check_in: n(str),
    check_out: n(str),
    in_id: n(int),
    out_id: n(int),
    late_minutes: n(int),
    in_diff_min: n(int).describe("check in − jam mulai shift (menit; negatif = lebih awal)"),
    out_diff_min: n(int).describe("check out − jam selesai shift (menit; negatif = pulang lebih awal)"),
    has_photo: bool,
    location_ok: n(bool),
    location_note: n(str),
    face_ok: n(bool),
    face_note: n(str),
    distance_m: n(num),
    accuracy: n(num),
    match_score: n(num),
    manual: bool,
    lat: n(num),
    lng: n(num),
  })
  .meta({ id: "DailyRow" });
export type DailyRow = z.infer<typeof DailyRow>;

export const DayAgg = z.object({ date: zDay, scheduled: int, hadir: int, telat: int, alpa: int, izin: int, sakit: int, rate: n(num) }).meta({ id: "DayAgg" });
export type DayAgg = z.infer<typeof DayAgg>;

export const RecordOut = z
  .object({
    id: int,
    type: z.enum(["in", "out"]),
    time: str,
    checked_at: zTimestamp,
    lat: n(num),
    lng: n(num),
    accuracy: n(num),
    distance_m: n(num),
    match_score: n(num),
    has_photo: bool,
    late_minutes: n(int),
    manual: bool,
    correction_reason: n(str),
    corrected_by: n(str),
  })
  .meta({ id: "AttendanceRecord" });
export type RecordOut = z.infer<typeof RecordOut>;

export const AttemptMini = z
  .object({ time: str, purpose: str, success: bool, reason_code: str, message: str, distance_m: n(num), match_score: n(num) })
  .meta({ id: "AttemptMini" });
export type AttemptMini = z.infer<typeof AttemptMini>;

export const LogOut = z.object({ at: zTimestamp, actor: n(str), action: str, detail: z.record(str, n(str)) }).meta({ id: "AuditLog" });
export type LogOut = z.infer<typeof LogOut>;

export const DailyDetail = z
  .object({ row: DailyRow, date: zDay, records: z.array(RecordOut), attempts: z.array(AttemptMini), logs: z.array(LogOut), office: n(Office) })
  .meta({ id: "DailyDetail" });
export type DailyDetail = z.infer<typeof DailyDetail>;

export const RangeRow = z
  .object({
    user_id: int,
    name: str,
    employee_code: str,
    employment_type: n(EmploymentType),
    unit: n(str),
    scheduled: int,
    hadir: int,
    telat: int,
    izin: int,
    sakit: int,
    alpa: int,
  })
  .meta({ id: "RangeRow" });
export type RangeRow = z.infer<typeof RangeRow>;

export const RangeSummary = z.object({ start: zDay, end: zDay, rows: z.array(RangeRow) }).meta({ id: "RangeSummary" });
export type RangeSummary = z.infer<typeof RangeSummary>;

// ------------------------------------------------------------------ pengajuan

export const LeaveOut = z
  .object({
    id: int,
    user_id: int,
    kind: LeaveKind,
    start_date: zDay,
    end_date: zDay,
    reason: str,
    has_attachment: bool,
    attachment_mime: n(str),
    status: ReqStatus,
    review_note: n(str),
    created_at: zTimestamp,
    reviewed_at: n(zTimestamp),
    employee_code: n(str),
    name: n(str),
    unit: n(str),
    employment_type: n(EmploymentType),
    phone: n(str),
    institution: n(str),
    reviewer_name: n(str),
    escalated: bool,
    can_review: bool,
  })
  .meta({ id: "Leave" });
export type LeaveOut = z.infer<typeof LeaveOut>;

export const SwapStage = z.enum(["peer", "review", "done"]).describe("peer = menunggu rekan · review = menunggu Kepala Unit · done");
export const PeerStatus = z.enum(["pending", "accepted", "declined"]);

export const SwapOut = z
  .object({
    id: int,
    user_id: int,
    date: zDay,
    from_shift: n(ShiftType),
    to_shift: ShiftType,
    reason: str,
    status: ReqStatus,
    review_note: n(str),
    created_at: zTimestamp,
    reviewed_at: n(zTimestamp),
    employee_code: n(str),
    name: n(str),
    unit: n(str),
    employment_type: n(EmploymentType),
    reviewer_name: n(str),
    escalated: bool,
    can_review: bool,
    target_user_id: n(int).describe('rekan tujuan (null = pengajuan lama "ubah shift")'),
    target_name: n(str),
    target_code: n(str),
    target_date: n(zDay),
    peer_status: n(PeerStatus),
    peer_note: n(str),
    peer_responded_at: n(zTimestamp),
    stage: SwapStage,
    direction: z.enum(["in", "out"]).describe("in = pengajuan rekan untuk saya"),
    can_respond: bool,
    summary: str,
  })
  .meta({ id: "Swap" });
export type SwapOut = z.infer<typeof SwapOut>;

export const SwapCandidate = z.object({ user_id: int, name: str, employee_code: str, shift: ShiftType }).meta({ id: "SwapCandidate" });
export type SwapCandidate = z.infer<typeof SwapCandidate>;

export const AppNotification = z
  .object({ id: int, kind: str, title: str, body: str, link: n(str), read_at: n(zTimestamp), created_at: zTimestamp })
  .meta({ id: "Notification" });
export type AppNotification = z.infer<typeof AppNotification>;

// ------------------------------------------------------------------ jadwal

export const ShiftDay = z.object({ date: zDay, user_id: int, shift: ShiftType, pending_swap: bool }).meta({ id: "ShiftDay" });
export type ShiftDay = z.infer<typeof ShiftDay>;

export const SchedulePeriod = z
  .object({
    unit: str,
    status: z.enum(["draft", "published"]),
    published_at: n(zTimestamp),
    published_by: n(str),
    staff: int,
    scheduled_staff: int,
    shifts: int,
  })
  .meta({ id: "SchedulePeriod" });
export type SchedulePeriod = z.infer<typeof SchedulePeriod>;

export const ScheduleMonth = z.object({ month: str, label: str, deadline: zDay, editable: bool, units: z.array(SchedulePeriod) }).meta({ id: "ScheduleMonth" });
export type ScheduleMonth = z.infer<typeof ScheduleMonth>;

export const SchedulePattern = z
  .object({
    id: int,
    name: str,
    sequence: z.array(n(int)).describe("id jenis shift per hari; null = libur"),
    active: bool,
    users: int,
    unit: n(str).describe("null = pola global Admin SDM"),
    editable: bool.describe("boleh diubah oleh akun yang sedang masuk"),
  })
  .meta({ id: "SchedulePattern" });
export type SchedulePattern = z.infer<typeof SchedulePattern>;

export const ScheduleIndexRow = z
  .object({
    user_id: int,
    name: str,
    employee_code: str,
    employment_type: n(str),
    unit: n(str),
    schedule: str,
    kind: z.enum(["pola", "fleksibel", "manual"]),
    start_date: n(zDay),
    end_date: n(zDay),
    next_shift: n(z.object({ date: zDay, name: str, start_time: str, end_time: str, color: n(str) })),
  })
  .meta({ id: "ScheduleIndexRow" });
export type ScheduleIndexRow = z.infer<typeof ScheduleIndexRow>;

export const Holiday = z.object({ id: int, date: zDay, name: str, kind: HolidayKind }).meta({ id: "Holiday" });
export type Holiday = z.infer<typeof Holiday>;

export const BulkResult = z.object({ updated: int, skipped: int }).meta({ id: "BulkResult" });
export type BulkResult = z.infer<typeof BulkResult>;

export const KuNotifPrefs = z.object({ leave: bool, swap: bool, attendance: bool, schedule: bool }).meta({ id: "NotifPrefs" });
export type KuNotifPrefs = z.infer<typeof KuNotifPrefs>;

// ------------------------------------------------------------------ dasbor & karyawan (admin)

export const Dashboard = z
  .object({
    date: zDay,
    totals: z.object({
      staff: int,
      scheduled: int,
      hadir: int,
      telat: int,
      belum: int,
      izin: int,
      sakit: int,
      selesai: int,
      gagal: int,
      pending: int,
      escalated: int,
      no_face: int,
    }),
    units: z.array(z.object({ name: str, head: n(str), total: int, hadir: int, telat: int, belum: int, izin: int, sakit: int })),
    trend: z.array(DayAgg),
    feed: z.array(
      z.object({
        name: str,
        unit: n(str),
        shift: n(str),
        act: str,
        time: str,
        at: zTimestamp,
        kind: z.enum(["in", "out", "leave", "swap", "fail"]),
        location_ok: n(bool),
        face_ok: n(bool),
      }),
    ),
    pending: z.array(LeaveOut),
  })
  .meta({ id: "Dashboard" });
export type Dashboard = z.infer<typeof Dashboard>;

export const StaffStatus = z.enum(["aktif", "nonaktif"]);

export const StaffRow = z.object({ user: User, status: StaffStatus, hadir: int, telat: int, izin: int, sakit: int, alpa: int }).meta({ id: "StaffRow" });
export type StaffRow = z.infer<typeof StaffRow>;

export const StaffDay = z
  .object({ date: zDay, shift: n(ShiftMini), status: DayStatus, check_in: n(str), check_out: n(str), late_minutes: n(int), in_diff_min: n(int), out_diff_min: n(int), manual: bool })
  .meta({ id: "StaffDay" });
export type StaffDay = z.infer<typeof StaffDay>;

/** Rekap kehadiran karyawan sendiri (menu Shift › Rekap), untuk rentang tanggal. */
export const MyRecap = z
  .object({
    start: zDay,
    end: zDay,
    label: str,
    scheduled: int.describe("hari berjadwal"),
    present: int,
    on_time: int,
    late: int.describe("hadir melewati toleransi keterlambatan"),
    izin: int,
    sakit: int,
    absent: int,
    punctuality_pct: n(num),
    days: z.array(StaffDay),
  })
  .meta({ id: "MyRecap" });
export type MyRecap = z.infer<typeof MyRecap>;

export const StaffDetail = z
  .object({
    user: User,
    status: StaffStatus,
    summary: MonthSummary,
    days: z.array(StaffDay),
    leaves: z.array(LeaveOut),
    swaps: z.array(SwapOut),
    last_score: n(num),
  })
  .meta({ id: "StaffDetail" });
export type StaffDetail = z.infer<typeof StaffDetail>;

// ------------------------------------------------------------------ pengaturan

export const AppSettings = z
  .object({
    checkin_open_before_min: int.describe("check in dibuka N menit sebelum jam mulai shift"),
    checkin_close_after_min: int.describe("check in ditutup N menit setelah jam mulai shift"),
    checkout_open_before_min: int.describe("check out dibuka N menit sebelum jam selesai shift"),
    checkout_close_after_min: int.describe("check out ditutup N menit setelah jam selesai shift"),
    escalation_hours: num,
    sdm_decides_headless: bool,
    schedule_deadline_day: int,
    helpdesk_email: str.describe("kontak bantuan di aplikasi karyawan"),
    helpdesk_whatsapp: str,
  })
  .meta({ id: "AppSettings" });
export type AppSettings = z.infer<typeof AppSettings>;

export const SmtpConfig = z
  .object({ host: str, port: int, encryption: z.enum(["tls", "ssl", "none"]), username: str, has_password: bool, sender: str })
  .meta({ id: "SmtpConfig" });
export type SmtpConfig = z.infer<typeof SmtpConfig>;

// ------------------------------------------------------------------ laporan

export const ExportOut = z.object({ id: int, name: str, meta: str, by: n(str), at: zTimestamp, ready: bool }).meta({ id: "Export" });
export type ExportOut = z.infer<typeof ExportOut>;

export const AttendanceReport = z
  .object({
    tab: z.literal("hadir"),
    label: str,
    start: zDay,
    end: zDay,
    kpi: z.object({ rate: n(num), hadir: int, telat: int, izin: int, sakit: int, alpa: int, staff: int }),
    daily: z.array(z.object({ date: zDay, rate: n(num) })),
    units: z.array(z.object({ unit: str, rate: n(num) })),
    rows: z.array(
      z.object({
        user_id: int,
        name: str,
        employee_code: str,
        unit: n(str),
        employment_type: n(str),
        hadir: int,
        telat: int,
        izin: int,
        sakit: int,
        alpa: int,
        jam: num,
      }),
    ),
  })
  .meta({ id: "AttendanceReport" });
export type AttendanceReport = z.infer<typeof AttendanceReport>;

export const RequestReport = z
  .object({
    tab: z.literal("req"),
    label: str,
    kpi: z.object({
      total: int,
      izin: int,
      sakit: int,
      pending: int,
      approved: int,
      rejected: int,
      swaps: int,
      swaps_approved: int,
      avg_decision_hours: n(num),
      overdue: int,
    }),
    weeks: z.array(z.object({ label: str, start: zDay, izin: int, sakit: int })),
    units: z.array(z.object({ unit: str, total: int, pending: int, approved: int, rejected: int, avg_hours: n(num) })),
    rows: z.array(
      z.object({
        id: z.union([int, str]),
        name: str,
        employee_code: str,
        unit: n(str),
        kind: z.enum(["izin", "sakit", "tukar"]),
        start_date: zDay,
        end_date: zDay,
        reason: str,
        status: ReqStatus,
        reviewer: n(str),
        has_attachment: bool,
        target: n(str),
        href: str,
      }),
    ),
  })
  .meta({ id: "RequestReport" });
export type RequestReport = z.infer<typeof RequestReport>;

export const ScheduleReport = z
  .object({
    tab: z.literal("jadwal"),
    label: str,
    month: str,
    deadline: zDay,
    kpi: z.object({ units: int, published: int, late: int, shifts: int, unscheduled: int, swaps: int }),
    types: z.array(z.object({ name: str, count: int })),
    units: z.array(
      z.object({ unit: str, status: z.enum(["draft", "published"]), published_at: n(zTimestamp), on_time: n(bool), staff: int, unscheduled: int, shifts: int }),
    ),
    rows: z.array(
      z.object({
        user_id: int,
        name: str,
        employee_code: str,
        unit: n(str),
        employment_type: n(str),
        total: int,
        by_type: z.record(str, int),
        nights: int,
        off: int,
        swaps: int,
      }),
    ),
  })
  .meta({ id: "ScheduleReport" });
export type ScheduleReport = z.infer<typeof ScheduleReport>;

export const StaffReport = z
  .object({
    tab: z.literal("kr"),
    label: str,
    kpi: z.object({ total: int, aktif: int, magang: int, outsourcing: int, no_face: int }),
    units: z.array(z.object({ unit: str, total: int, magang: int, outsourcing: int, face: int, aktif: int })),
    rows: z.array(
      z.object({
        user_id: int,
        name: str,
        employee_code: str,
        employment_type: n(str),
        unit: n(str),
        phone: n(str),
        period_start: n(zDay),
        status: str,
        face: bool,
        institution: n(str),
      }),
    ),
  })
  .meta({ id: "StaffReport" });
export type StaffReport = z.infer<typeof StaffReport>;

export const Report = z.discriminatedUnion("tab", [AttendanceReport, RequestReport, ScheduleReport, StaffReport]).meta({ id: "Report" });
export type Report = z.infer<typeof Report>;

// ------------------------------------------------------------------ impor & reset massal

export const ImportCredential = z.object({ name: str, email: str, temp_password: n(str), error: n(str) }).meta({ id: "ImportCredential" });
export type ImportCredential = z.infer<typeof ImportCredential>;

export const StaffImportResult = z
  .object({ created: int, updated: int, unchanged: int, errors: z.array(str), credentials: z.array(ImportCredential) })
  .meta({ id: "StaffImportResult" });
export type StaffImportResult = z.infer<typeof StaffImportResult>;

export const ScheduleImportResult = BulkResult.extend({ errors: z.array(str) }).meta({ id: "ScheduleImportResult" });
export type ScheduleImportResult = z.infer<typeof ScheduleImportResult>;

/** Hasil aksi massal: jumlah berhasil + daftar yang gagal beserta alasannya. */
/** Kunci publik VAPID untuk PushManager.subscribe() + jumlah perangkat akun ini yang berlangganan. */
export const PushConfig = z.object({ public_key: str, devices: int }).meta({ id: "PushConfig" });
export type PushConfig = z.infer<typeof PushConfig>;

export const BulkActionResult = z
  .object({ done: int, failed: z.array(z.object({ id: int, label: str, error: str })) })
  .meta({ id: "BulkActionResult" });
export type BulkActionResult = z.infer<typeof BulkActionResult>;

export const BulkResetResult =z.object({ sent: int, failed: z.array(ImportCredential) }).meta({ id: "BulkResetResult" });
export type BulkResetResult = z.infer<typeof BulkResetResult>;

// ------------------------------------------------------------------ umum


export const Message = z.object({ message: str }).meta({ id: "Message" });
export type Message = z.infer<typeof Message>;

export const PublicHoliday = z.object({ date: zDay, name: str }).meta({ id: "PublicHoliday" });
export type PublicHoliday = z.infer<typeof PublicHoliday>;

export const Ok = z.object({ ok: bool }).meta({ id: "Ok" });
export type Ok = z.infer<typeof Ok>;

export const Health = z
  .object({
    status: z.enum(["ok", "degraded"]),
    version: str,
    uptime_s: num,
    checks: z.object({ database: z.enum(["ok", "error"]), face_models: z.enum(["ok", "loading", "error"]) }),
  })
  .meta({ id: "Health" });
export type Health = z.infer<typeof Health>;

// ------------------------------------------------------------------ dokumen

export const FileCategory = z.object({ id: int, name: str, file_count: int }).meta({ id: "FileCategory" });
export type FileCategory = z.infer<typeof FileCategory>;

export const FolderOut = z
  .object({
    id: int,
    name: str,
    description: n(str),
    available_from: n(zDay),
    units: z.array(str).describe("kosong = semua unit"),
    employment_types: z.array(EmploymentType).describe("kosong = semua tipe"),
    reminder_date: n(zDay),
    reminder_message: n(str),
    reminder_sent: bool,
    file_count: int,
    size: int.describe("total ukuran file (byte)"),
    updated_at: zTimestamp,
  })
  .meta({ id: "FolderOut" });
export type FolderOut = z.infer<typeof FolderOut>;

export const FileOut = z
  .object({
    id: int,
    name: str.describe("nama tampilan tanpa ekstensi"),
    ext: str.describe("mis. .pdf"),
    mime: str,
    size: int,
    inline: bool.describe("bisa dibuka langsung di browser (PDF/gambar)"),
    folder_id: n(int),
    owner_id: n(int),
    owner: n(z.object({ id: int, name: str, employee_code: str, unit: n(str) })).describe("pemilik file karyawan"),
    category: n(z.object({ id: int, name: str })),
    uploaded_by: n(str),
    created_at: zTimestamp,
    updated_at: zTimestamp,
  })
  .meta({ id: "FileOut" });
export type FileOut = z.infer<typeof FileOut>;
