/**
 * Bentuk JSON respons (snake_case, sama dengan API lama agar dasbor & aplikasi tidak berubah).
 * Tipe hasil = kontrak di src/shared (Wire<...>): field hilang/salah nama/berlebih gagal saat compile.
 */
import type * as Json from "../shared";
import type { Wire } from "../shared";
import { inArray } from "drizzle-orm";
import { scopeUnits } from "../core/auth";
import { db, schema, type DB } from "../db";
import type { Attendance, LeaveRequest, ShiftType, SwapRequest, User } from "../db/schema";
import { isEscalated } from "./services";
import { stage, summary } from "./swaps";

type EmploymentType = Json.EmploymentType | null;

export const shiftTypeOut = (t: ShiftType): Wire<Json.ShiftType> => ({ id: t.id, name: t.name, start_time: t.startTime, end_time: t.endTime, color: t.color, active: t.active });

export const userOut = (u: User): Wire<Json.User> => ({
  id: u.id,
  employee_code: u.employeeCode,
  name: u.name,
  role: u.role as Json.Role,
  office_id: u.officeId,
  face_enrolled_at: u.faceEnrolledAt,
  created_at: u.createdAt,
  email: u.email,
  phone: u.phone,
  employment_type: u.employmentType as EmploymentType,
  unit: u.unit,
  institution: u.institution,
  period_start: u.periodStart,
  is_active: u.isActive ?? true,
  last_seen_at: u.lastSeenAt,
  has_avatar: !!u.avatarPath,
  must_change_password: !!u.mustChangePassword,
  // unit yang dipimpin: lengkap bila dimuat lewat withLedUnits()/autentikasi, selain itu unit utama
  head_units: u.role === "unit_head" ? (scopeUnits(u) ?? []) : [],
});

export const officeOut = (o: typeof schema.offices.$inferSelect): Wire<Json.Office> => ({ id: o.id, name: o.name, lat: o.lat, lng: o.lng, radius_m: o.radiusM, address: o.address });

export const attendanceOut = (a: Attendance): Wire<Json.AttendanceOut> => ({
  id: a.id,
  user_id: a.userId,
  work_date: a.workDate,
  type: a.type as Json.AttendanceOut["type"],
  checked_at: a.checkedAt,
  lat: a.lat,
  lng: a.lng,
  accuracy: a.accuracy,
  distance_m: a.distanceM,
  match_score: a.matchScore,
  has_photo: !!a.photoPath,
  late_minutes: a.lateMinutes,
  shift_type_id: a.shiftTypeId,
});

export const notificationOut = (n: typeof schema.notifications.$inferSelect): Wire<Json.AppNotification> => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read_at: n.readAt, created_at: n.createdAt });

// ------------------------------------------------------------------ pemuat (hindari N+1)

export async function usersById(ids: (number | null | undefined)[], q: DB = db()): Promise<Map<number, User>> {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === "number"))];
  if (!uniq.length) return new Map();
  const rows = await q.select().from(schema.users).where(inArray(schema.users.id, uniq));
  return new Map(rows.map((u) => [u.id, u]));
}

export async function shiftTypesById(q: DB = db()): Promise<Map<number, ShiftType>> {
  const rows = await q.select().from(schema.shiftTypes);
  return new Map(rows.map((t) => [t.id, t]));
}

// ------------------------------------------------------------------ pengajuan izin/sakit

export type LeaveOut = Wire<Json.LeaveOut> & Record<string, unknown>;

const leaveBase = (lv: LeaveRequest): Wire<Json.LeaveOut> => ({
  id: lv.id,
  user_id: lv.userId,
  kind: lv.kind as Json.LeaveKind,
  start_date: lv.startDate,
  end_date: lv.endDate,
  reason: lv.reason,
  has_attachment: !!lv.attachmentPath,
  attachment_mime: lv.attachmentMime,
  status: lv.status as Json.ReqStatus,
  review_note: lv.reviewNote,
  created_at: lv.createdAt,
  reviewed_at: lv.reviewedAt,
  employee_code: null,
  name: null,
  unit: null,
  employment_type: null,
  phone: null,
  institution: null,
  reviewer_name: null,
  escalated: false,
  can_review: false,
});

export async function leaveOut(lv: LeaveRequest, users?: Map<number, User> | null) {
  const o = leaveBase(lv);
  if (users) {
    const u = users.get(lv.userId);
    if (u) Object.assign(o, { employee_code: u.employeeCode, name: u.name, unit: u.unit, employment_type: u.employmentType as EmploymentType, phone: u.phone, institution: u.institution });
    o.reviewer_name = lv.reviewerId ? (users.get(lv.reviewerId)?.name ?? null) : null;
    o.escalated = await isEscalated(lv.status, lv.createdAt);
  }
  return o;
}

export async function leavesOut(rows: LeaveRequest[], withUser: boolean, q: DB = db()) {
  const users = withUser ? await usersById(rows.flatMap((r) => [r.userId, r.reviewerId]), q) : null;
  return Promise.all(rows.map((r) => leaveOut(r, users)));
}

// ------------------------------------------------------------------ tukar shift

export type SwapCtx = { users: Map<number, User>; types: Map<number, ShiftType> };

export async function swapCtx(rows: SwapRequest[], q: DB = db()): Promise<SwapCtx> {
  return { users: await usersById(rows.flatMap((r) => [r.userId, r.targetUserId, r.reviewerId]), q), types: await shiftTypesById(q) };
}

export async function swapOut(s: SwapRequest, ctx: SwapCtx, opts: { withUser?: boolean; viewer?: Pick<User, "id"> | null } = {}): Promise<Wire<Json.SwapOut>> {
  const st = stage(s);
  const incoming = !!opts.viewer && s.targetUserId === opts.viewer.id;
  const u = ctx.users.get(s.userId);
  const t = s.targetUserId ? ctx.users.get(s.targetUserId) : undefined;
  const from = s.fromShiftTypeId ? ctx.types.get(s.fromShiftTypeId) : undefined;
  const to = ctx.types.get(s.toShiftTypeId)!;
  const show = opts.withUser || incoming;
  return {
    id: s.id,
    user_id: s.userId,
    date: s.date,
    from_shift: from ? shiftTypeOut(from) : null,
    to_shift: shiftTypeOut(to),
    reason: s.reason,
    status: s.status as Json.ReqStatus,
    review_note: s.reviewNote,
    created_at: s.createdAt,
    reviewed_at: s.reviewedAt,
    employee_code: show ? (u?.employeeCode ?? null) : null,
    name: show ? (u?.name ?? null) : null,
    unit: opts.withUser ? (u?.unit ?? null) : null,
    employment_type: opts.withUser ? ((u?.employmentType ?? null) as EmploymentType) : null,
    reviewer_name: s.reviewerId ? (ctx.users.get(s.reviewerId)?.name ?? null) : null,
    escalated: opts.withUser && st === "review" ? await isEscalated(s.status, s.createdAt) : false,
    can_review: false,
    target_user_id: s.targetUserId,
    target_name: t?.name ?? null,
    target_code: t?.employeeCode ?? null,
    target_date: s.targetDate,
    peer_status: s.peerStatus as Json.SwapOut["peer_status"],
    peer_note: s.peerNote,
    peer_responded_at: s.peerRespondedAt,
    stage: st,
    direction: incoming ? "in" : "out",
    can_respond: incoming && st === "peer",
    summary: summary(s, from?.name ?? null, to.name),
  };
}

export async function swapsOut(rows: SwapRequest[], opts: { withUser?: boolean; viewer?: Pick<User, "id"> | null } = {}, q: DB = db()) {
  const ctx = await swapCtx(rows, q);
  return Promise.all(rows.map((r) => swapOut(r, ctx, opts)));
}
