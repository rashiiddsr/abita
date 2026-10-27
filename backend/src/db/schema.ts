/**
 * Skema MySQL (Drizzle).
 * - Tanggal (DATE) disimpan & dibaca sebagai string "YYYY-MM-DD" (tanpa zona waktu).
 * - Waktu (DATETIME) selalu UTC; koneksi memakai timezone "Z" (lihat db/index.ts).
 * - Jam shift (TIME) dibaca sebagai string "HH:MM:SS".
 */
import { boolean, customType, date, datetime, double, index, int, mysqlTable, text, time, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const blob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "blob",
});

/** JSON: MariaDB mengembalikan kolom JSON sebagai teks, jadi diurai di sini (MySQL 8 sudah objek). */
function json<T>(name: string) {
  return customType<{ data: T; driverData: string }>({
    dataType: () => "json",
    toDriver: (v) => JSON.stringify(v),
    fromDriver: (v) => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T)),
  })(name);
}

const dt = (name: string) => datetime(name, { mode: "date", fsp: 3 });
const day = (name: string) => date(name, { mode: "string" });
const now = () => new Date();

export const offices = mysqlTable("offices", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  lat: double("lat").notNull(),
  lng: double("lng").notNull(),
  radiusM: double("radius_m").notNull().default(100),
  address: varchar("address", { length: 255 }),
});

export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeCode: varchar("employee_code", { length: 40 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    passwordHash: varchar("password_hash", { length: 100 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default("staff"), // admin (Admin SDM) | unit_head (Kepala Unit) | staff
    officeId: int("office_id"),
    faceEmbedding: blob("face_embedding"),
    faceEnrolledAt: dt("face_enrolled_at"),
    createdAt: dt("created_at").notNull().$defaultFn(now),
    email: varchar("email", { length: 160 }),
    phone: varchar("phone", { length: 40 }),
    employmentType: varchar("employment_type", { length: 20 }), // magang | outsourcing | tetap
    unit: varchar("unit", { length: 120 }),
    institution: varchar("institution", { length: 160 }),
    periodStart: day("period_start"),
    isActive: boolean("is_active").default(true),
    avatarPath: varchar("avatar_path", { length: 255 }),
    mustChangePassword: boolean("must_change_password").default(false),
    /** naik saat kata sandi diganti / direset: sesi lama (perangkat lain) tidak berlaku lagi */
    sessionVersion: int("session_version").notNull().default(0),
    notifPrefs: json<Record<string, boolean> | null>("notif_prefs"),
    lastSeenAt: dt("last_seen_at"),
  },
  (t) => [
    uniqueIndex("uq_users_employee_code").on(t.employeeCode),
    uniqueIndex("uq_users_email").on(t.email),
    index("ix_users_role_unit").on(t.role, t.unit, t.isActive),
  ],
);

export const faceSessions = mysqlTable(
  "face_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("user_id").notNull(),
    purpose: varchar("purpose", { length: 10 }).notNull(), // enroll | reenroll | in | out
    challenges: json<string[]>("challenges").notNull(),
    createdAt: dt("created_at").notNull().$defaultFn(now),
    expiresAt: dt("expires_at").notNull(),
    usedAt: dt("used_at"),
  },
  (t) => [index("ix_face_sessions_user").on(t.userId)],
);

export const attempts = mysqlTable(
  "attempts",
  {
    id: int("id").autoincrement().primaryKey(),
    sessionId: varchar("session_id", { length: 36 }),
    userId: int("user_id").notNull(),
    purpose: varchar("purpose", { length: 10 }).notNull(),
    success: boolean("success").notNull().default(false),
    reasonCode: varchar("reason_code", { length: 40 }).notNull(),
    scores: json<Record<string, unknown>>("scores").notNull(),
    lat: double("lat"),
    lng: double("lng"),
    accuracy: double("accuracy"),
    distanceM: double("distance_m"),
    createdAt: dt("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("ix_attempt_user_created").on(t.userId, t.createdAt), index("ix_attempt_session").on(t.sessionId)],
);

export const attendances = mysqlTable(
  "attendances",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    workDate: day("work_date").notNull(),
    type: varchar("type", { length: 5 }).notNull(), // in | out
    checkedAt: dt("checked_at").notNull().$defaultFn(now),
    lat: double("lat"),
    lng: double("lng"),
    accuracy: double("accuracy"),
    distanceM: double("distance_m"),
    matchScore: double("match_score"),
    photoPath: varchar("photo_path", { length: 255 }),
    shiftTypeId: int("shift_type_id"),
    lateMinutes: int("late_minutes"),
    source: varchar("source", { length: 10 }),
    correctedById: int("corrected_by_id"),
    correctionReason: varchar("correction_reason", { length: 255 }),
    correctedAt: dt("corrected_at"),
  },
  (t) => [uniqueIndex("uq_user_date_type").on(t.userId, t.workDate, t.type), index("ix_att_date_user").on(t.workDate, t.userId)],
);

export const shiftTypes = mysqlTable("shift_types", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 40 }).notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(), // <= start_time berarti melewati tengah malam
  color: varchar("color", { length: 9 }),
  active: boolean("active").notNull().default(true),
});

export const shiftAssignments = mysqlTable(
  "shift_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    date: day("date").notNull(),
    shiftTypeId: int("shift_type_id").notNull(),
    updatedAt: dt("updated_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("uq_user_shift_date").on(t.userId, t.date), index("ix_shift_date_user").on(t.date, t.userId)],
);

export const leaveRequests = mysqlTable(
  "leave_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    kind: varchar("kind", { length: 10 }).notNull(), // izin | sakit
    startDate: day("start_date").notNull(),
    endDate: day("end_date").notNull(),
    reason: text("reason").notNull(),
    attachmentPath: varchar("attachment_path", { length: 255 }),
    attachmentMime: varchar("attachment_mime", { length: 60 }),
    status: varchar("status", { length: 10 }).notNull().default("pending"), // pending | approved | rejected
    reviewerId: int("reviewer_id"),
    reviewNote: varchar("review_note", { length: 255 }),
    createdAt: dt("created_at").notNull().$defaultFn(now),
    reviewedAt: dt("reviewed_at"),
  },
  (t) => [index("ix_leave_status_created").on(t.status, t.createdAt), index("ix_leave_user_dates").on(t.userId, t.startDate, t.endDate)],
);

/** Tukar shift dengan rekan satu unit: rekan menerima (peer_status) -> Kepala Unit memutuskan (status). */
export const swapRequests = mysqlTable(
  "shift_swap_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    date: day("date").notNull(),
    fromShiftTypeId: int("from_shift_type_id"),
    toShiftTypeId: int("to_shift_type_id").notNull(),
    targetUserId: int("target_user_id"),
    targetDate: day("target_date"),
    peerStatus: varchar("peer_status", { length: 10 }), // pending | accepted | declined
    peerNote: varchar("peer_note", { length: 255 }),
    peerRespondedAt: dt("peer_responded_at"),
    reason: text("reason").notNull(),
    status: varchar("status", { length: 10 }).notNull().default("pending"), // pending | approved | rejected | cancelled
    reviewerId: int("reviewer_id"),
    reviewNote: varchar("review_note", { length: 255 }),
    createdAt: dt("created_at").notNull().$defaultFn(now),
    reviewedAt: dt("reviewed_at"),
  },
  (t) => [index("ix_swap_status_created").on(t.status, t.createdAt), index("ix_swap_user").on(t.userId), index("ix_swap_target").on(t.targetUserId)],
);

export const notifications = mysqlTable(
  "notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    kind: varchar("kind", { length: 20 }).notNull(), // leave | swap | shift | schedule | attendance | system
    title: varchar("title", { length: 160 }).notNull(),
    body: text("body").notNull(),
    link: varchar("link", { length: 200 }), // tujuan di dasbor admin, mis. /pengajuan/12
    readAt: dt("read_at"),
    createdAt: dt("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("ix_notif_user_read").on(t.userId, t.readAt, t.createdAt)],
);

export const schedulePeriods = mysqlTable(
  "schedule_periods",
  {
    id: int("id").autoincrement().primaryKey(),
    unit: varchar("unit", { length: 80 }).notNull(),
    month: varchar("month", { length: 7 }).notNull(), // YYYY-MM
    status: varchar("status", { length: 10 }).notNull().default("draft"), // draft | published
    publishedAt: dt("published_at"),
    publishedById: int("published_by_id"),
  },
  (t) => [uniqueIndex("uq_schedule_unit_month").on(t.unit, t.month)],
);

/** Pola jadwal. unit null = pola global Admin SDM; unit terisi = pola khusus unit (Kepala Unit). sequence: id shift per hari, null = libur. */
export const schedulePatterns = mysqlTable(
  "schedule_patterns",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    unit: varchar("unit", { length: 80 }),
    sequence: json<(number | null)[]>("sequence").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: dt("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("ix_schedule_patterns_unit").on(t.unit)],
);

export const userPatterns = mysqlTable(
  "user_patterns",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    patternId: int("pattern_id"),
    name: varchar("name", { length: 80 }).notNull(),
    sequence: json<(number | null)[]>("sequence").notNull(),
    startDate: day("start_date").notNull(),
    endDate: day("end_date"),
    skipHolidays: boolean("skip_holidays").notNull().default(false),
    filledUntil: day("filled_until"),
    createdById: int("created_by_id"),
    createdAt: dt("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("ix_user_patterns_user").on(t.userId)],
);

export const holidays = mysqlTable(
  "holidays",
  {
    id: int("id").autoincrement().primaryKey(),
    date: day("date").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    kind: varchar("kind", { length: 20 }), // nasional | cuti_bersama | khusus (null = nasional)
  },
  (t) => [uniqueIndex("uq_holiday_date").on(t.date)],
);

export const units = mysqlTable(
  "units",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    createdAt: dt("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("uq_unit_name").on(t.name)],
);

/** Kepala Unit per unit (banyak-ke-banyak): satu unit boleh punya beberapa Kepala Unit, satu Kepala Unit boleh memimpin beberapa unit. */
export const unitHeads = mysqlTable(
  "unit_heads",
  {
    id: int("id").autoincrement().primaryKey(),
    unitId: int("unit_id").notNull(),
    userId: int("user_id").notNull(),
    createdAt: dt("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("uq_unit_head").on(t.unitId, t.userId), index("ix_unit_head_user").on(t.userId)],
);

/** Langganan Web Push aplikasi karyawan: satu browser/perangkat = satu endpoint (dari PushManager.subscribe). */
export const pushSubscriptions = mysqlTable(
  "push_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    endpoint: varchar("endpoint", { length: 500 }).notNull(),
    p256dh: varchar("p256dh", { length: 200 }).notNull(),
    auth: varchar("auth", { length: 100 }).notNull(),
    userAgent: varchar("user_agent", { length: 255 }),
    createdAt: dt("created_at").notNull().$defaultFn(now),
    lastUsedAt: dt("last_used_at"),
  },
  (t) => [uniqueIndex("uq_push_endpoint").on(t.endpoint), index("ix_push_user").on(t.userId)],
);

export const appSettings = mysqlTable("app_settings", {
  key: varchar("key", { length: 60 }).primaryKey(),
  value: json<{ v: unknown }>("value").notNull(),
  updatedAt: dt("updated_at").notNull().$defaultFn(now),
});

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorId: int("actor_id"),
    action: varchar("action", { length: 40 }).notNull(),
    targetType: varchar("target_type", { length: 30 }).notNull(),
    targetId: int("target_id"),
    detail: json<Record<string, unknown>>("detail").notNull(),
    createdAt: dt("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("ix_audit_actor").on(t.actorId), index("ix_audit_created").on(t.createdAt)],
);

export const passwordResets = mysqlTable(
  "password_resets",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 8 }), // link (web) | code (aplikasi, 6 digit)
    attempts: int("attempts"),
    expiresAt: dt("expires_at").notNull(),
    usedAt: dt("used_at"),
    createdAt: dt("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("uq_reset_token").on(t.tokenHash), index("ix_reset_user").on(t.userId)],
);

// ------------------------------------------------------------------ dokumen

/** Kategori file karyawan (Identitas, Kontrak, STR / SIP, …), dikelola Admin SDM. */
export const fileCategories = mysqlTable(
  "file_categories",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 60 }).notNull(),
    createdAt: dt("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("uq_file_category_name").on(t.name)],
);

/**
 * Folder file perusahaan. Penerima: units/employment_types kosong = semua karyawan; available_from null = langsung tampil.
 * notify_pending: pemberitahuan file baru menunggu available_from. reminder_*: pengingat sekali pada tanggalnya.
 */
export const fileFolders = mysqlTable("file_folders", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  description: varchar("description", { length: 500 }),
  availableFrom: day("available_from"),
  units: json<string[]>("units").notNull(),
  employmentTypes: json<string[]>("employment_types").notNull(),
  notifyPending: boolean("notify_pending").notNull().default(false),
  reminderDate: day("reminder_date"),
  reminderMessage: varchar("reminder_message", { length: 255 }),
  reminderSentAt: dt("reminder_sent_at"),
  createdBy: int("created_by"),
  createdAt: dt("created_at").notNull().$defaultFn(now),
  updatedAt: dt("updated_at").notNull().$defaultFn(now),
});

/** File: folder_id = file perusahaan, owner_id = file karyawan (tepat salah satu terisi). */
export const files = mysqlTable(
  "files",
  {
    id: int("id").autoincrement().primaryKey(),
    folderId: int("folder_id"),
    ownerId: int("owner_id"),
    categoryId: int("category_id"),
    name: varchar("name", { length: 160 }).notNull(),
    ext: varchar("ext", { length: 10 }).notNull(),
    mime: varchar("mime", { length: 120 }).notNull(),
    size: int("size").notNull(),
    path: varchar("path", { length: 255 }).notNull(),
    uploadedBy: int("uploaded_by"),
    createdAt: dt("created_at").notNull().$defaultFn(now),
    updatedAt: dt("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("ix_files_folder").on(t.folderId), index("ix_files_owner").on(t.ownerId, t.categoryId)],
);

export type User = typeof users.$inferSelect;
export type ShiftType = typeof shiftTypes.$inferSelect;
export type ShiftAssignment = typeof shiftAssignments.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type SwapRequest = typeof swapRequests.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type SchedulePattern = typeof schedulePatterns.$inferSelect;
export type UserPattern = typeof userPatterns.$inferSelect;
export type Holiday = typeof holidays.$inferSelect;
export type Unit = typeof units.$inferSelect;

export type FileCategory = typeof fileCategories.$inferSelect;
export type FileFolder = typeof fileFolders.$inferSelect;
export type StoredFile = typeof files.$inferSelect;
