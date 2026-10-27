/** Laporan dasbor: kehadiran, pengajuan, jadwal, karyawan + ekspor Excel/PDF (riwayat ekspor di audit_logs). */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { and, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import type { Response } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { ExportIn, ExportOut, Report, ReportFilters } from "../shared";
import { scopeUnits } from "../core/auth";
import { settings } from "../core/config";
import { HttpError } from "../core/http";
import { readStored, resolveStored, saveFile } from "../core/storage";
import { addDays, BULAN, crossesMidnight, diffDays, localHm, minDay, monthBounds, today, weekday, workDateOf } from "../core/time";
import { ExcelJS, styleHeader, toBuffer, XLSX_MIME } from "../core/xlsx";
import { db, schema } from "../db";
import type { User } from "../db/schema";
import { usersById } from "../domain/out";
import { effectiveUnit, hhmm, key, loadRange, NO_UNIT, pct, PRESENT, staffIn, statusOf } from "../domain/presence";
import { deadline, periodStatus, summary } from "../domain/swaps";
import { IdPipe, Me, Roles } from "../common/nest";
import { Returns } from "../common/swagger";

const { leaveRequests, swapRequests, shiftAssignments, shiftTypes, schedulePeriods, users, auditLogs } = schema;

const TYPE_LABEL: Record<string, string> = { magang: "Magang/PKL", outsourcing: "Outsourcing", tetap: "Tetap" };
const STATUS_LABEL: Record<string, string> = { pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak", cancelled: "Dibatalkan" };
const KIND_LABEL: Record<string, string> = { izin: "Izin", sakit: "Sakit", tukar: "Tukar shift" };
const COLUMNS: Record<string, string[]> = {
  hadir: ["Nama & NIK", "Unit", "Hadir", "Terlambat", "Izin", "Sakit", "Alpa", "Total jam", "Detail check in/out"],
  req: ["Karyawan", "Unit", "Jenis", "Tanggal", "Alasan", "Status", "Penanggung jawab", "Rekan tukar"],
  jadwal: ["Nama & NIK", "Unit", "Total shift", "Rincian shift", "Malam", "Libur", "Tukar disetujui"],
  kr: ["Nama & NIK", "Tipe", "Unit", "Nomor HP", "Mulai dinas", "Status", "Wajah"],
};

type F = z.output<typeof ReportFilters>;

type Rep = Record<string, unknown> & { label: string; rows: Record<string, unknown>[]; _detail?: unknown[][] };

/** [awal, akhir] inklusif + label ('September 2026' / '6–12 Okt 2026'). */
function periodRange(f: F): [string, string, string] {
  if (f.period === "mingguan") {
    const ref = f.week ?? today();
    const start = addDays(ref, -((weekday(ref) + 6) % 7)); // Senin
    const end = addDays(start, 6);
    const [, sm, sd] = start.split("-").map(Number);
    const [ey, em, ed] = end.split("-").map(Number);
    const label = sm === em ? `${sd}–${ed} ${BULAN[em - 1].slice(0, 3)} ${ey}` : `${sd} ${BULAN[sm - 1].slice(0, 3)} – ${ed} ${BULAN[em - 1].slice(0, 3)} ${ey}`;
    return [start, end, label];
  }
  if (f.month && !/^\d{4}-\d{2}$/.test(f.month)) throw new HttpError(422, "Format bulan harus YYYY-MM.");
  const [start, nxt] = monthBounds(f.month);
  return [start, addDays(nxt, -1), `${BULAN[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`];
}

async function scopedStaff(me: User, f: F, activeOnly = true) {
  const list = await staffIn(effectiveUnit(me, f.unit), activeOnly);
  return f.tipe && ["magang", "outsourcing", "tetap"].includes(f.tipe) ? list.filter((u) => u.employmentType === f.tipe) : list;
}

// ------------------------------------------------------------ kehadiran

async function attendanceReport(me: User, f: F): Promise<Rep> {
  const [start, end, label] = periodRange(f);
  const list = await scopedStaff(me, f);
  const nowDay = today();
  const last = minDay(end, nowDay);
  const perUser = [];
  const daily = [];
  const unitC = new Map<string, [number, number]>(); // hadir, basis
  const totals: Record<string, number> = { hadir: 0, telat: 0, izin: 0, sakit: 0, alpa: 0 };
  const detail: unknown[][] = [];
  if (last >= start) {
    const data = await loadRange(list, start, last);
    const stats = new Map(list.map((u) => [u.id, { hadir: 0, telat: 0, izin: 0, sakit: 0, alpa: 0, jam: 0 } as Record<string, number>]));
    for (let d = start; d <= last; d = addDays(d, 1)) {
      let present = 0,
        base = 0;
      for (const u of list) {
        const st = statusOf(data, u.id, d, nowDay);
        if (st === "libur" || st === "belum") continue;
        const s = stats.get(u.id)!;
        const rec = data.att.get(key(u.id, d)) ?? {};
        const uc = unitC.get(u.unit || NO_UNIT) ?? [0, 0];
        unitC.set(u.unit || NO_UNIT, uc);
        if (PRESENT.has(st)) {
          s.hadir++;
          present++;
          base++;
          uc[0]++;
          uc[1]++;
          if ((rec.in!.lateMinutes ?? 0) > 0) s.telat++;
          if (rec.out) s.jam += (rec.out.checkedAt.getTime() - rec.in!.checkedAt.getTime()) / 3600_000;
        } else if (st === "alpa") {
          s.alpa++;
          base++;
          uc[1]++;
        } else s[st] = (s[st] ?? 0) + 1;
        const sh = data.shifts.get(key(u.id, d));
        detail.push([d, u.name, u.employeeCode, u.unit || "-", sh?.type.name ?? "-", hhmm(rec.in?.checkedAt) ?? "-", hhmm(rec.out?.checkedAt) ?? "-", rec.in?.lateMinutes ?? 0, st]);
      }
      daily.push({ date: d, rate: pct(present, base) });
    }
    for (const u of list) {
      const s = stats.get(u.id)!;
      const row = { user_id: u.id, name: u.name, employee_code: u.employeeCode, unit: u.unit, employment_type: u.employmentType, hadir: s.hadir, telat: s.telat, izin: s.izin, sakit: s.sakit, alpa: s.alpa, jam: Math.round(s.jam * 10) / 10 };
      if (f.status === "telat" && !row.telat) continue;
      if (f.status === "alpa" && !row.alpa) continue;
      perUser.push(row);
      for (const k of Object.keys(totals)) totals[k] += (row as unknown as Record<string, number>)[k];
    }
  }
  return {
    tab: "hadir",
    label,
    start,
    end,
    kpi: { rate: pct(totals.hadir, totals.hadir + totals.alpa), ...totals, staff: list.length },
    daily,
    units: [...unitC].map(([unit, v]) => ({ unit, rate: pct(v[0], v[1]) })).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)),
    rows: perUser.sort((a, b) => (a.unit ?? "").localeCompare(b.unit ?? "") || a.name.localeCompare(b.name)),
    _detail: detail,
  };
}

// ------------------------------------------------------------ pengajuan

async function requestsReport(me: User, f: F): Promise<Rep> {
  const [start, end, label] = periodRange(f);
  const scope = effectiveUnit(me, f.unit);
  const lc = [lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)];
  const sc = [gte(swapRequests.date, start), lte(swapRequests.date, end)];
  if (scope) {
    lc.push(inArray(users.unit, scope));
    sc.push(inArray(users.unit, scope));
  }
  if (f.tipe) {
    lc.push(eq(users.employmentType, f.tipe));
    sc.push(eq(users.employmentType, f.tipe));
  }
  if (f.status && f.status in STATUS_LABEL) {
    lc.push(eq(leaveRequests.status, f.status));
    sc.push(eq(swapRequests.status, f.status));
  }
  const leaves = (
    await db()
      .select({ l: leaveRequests })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .where(and(...lc))
      .orderBy(desc(leaveRequests.createdAt))
  ).map((r) => r.l);
  const swaps = (
    await db()
      .select({ s: swapRequests })
      .from(swapRequests)
      .innerJoin(users, eq(users.id, swapRequests.userId))
      .where(and(...sc))
      .orderBy(desc(swapRequests.createdAt))
  ).map((r) => r.s);
  const people = await usersById([...leaves.flatMap((l) => [l.userId, l.reviewerId]), ...swaps.flatMap((s) => [s.userId, s.targetUserId, s.reviewerId])]);
  const types = new Map((await db().select().from(shiftTypes)).map((t) => [t.id, t.name]));
  const weeks = new Map<string, [number, number]>();
  for (let w = addDays(start, -((weekday(start) + 6) % 7)); w <= end; w = addDays(w, 7)) weeks.set(w, [0, 0]);
  for (const lv of leaves) {
    const k = addDays(lv.startDate, -((weekday(lv.startDate) + 6) % 7));
    const w = weeks.get(k);
    if (w) w[lv.kind === "izin" ? 0 : 1]++;
  }
  const rows = [
    ...leaves.map((lv) => {
      const u = people.get(lv.userId)!;
      return {
        id: lv.id,
        name: u.name,
        employee_code: u.employeeCode,
        unit: u.unit,
        kind: lv.kind,
        start_date: lv.startDate,
        end_date: lv.endDate,
        reason: lv.reason,
        status: lv.status,
        reviewer: lv.reviewerId ? (people.get(lv.reviewerId)?.name ?? null) : null,
        has_attachment: !!lv.attachmentPath,
        target: null as string | null,
        href: `/requests/${lv.id}`,
      };
    }),
    ...swaps.map((sw) => {
      const u = people.get(sw.userId)!;
      return {
        id: `s${sw.id}`,
        name: u.name,
        employee_code: u.employeeCode,
        unit: u.unit,
        kind: "tukar",
        start_date: sw.date,
        end_date: sw.targetDate ?? sw.date,
        reason: summary(sw, sw.fromShiftTypeId ? (types.get(sw.fromShiftTypeId) ?? null) : null, types.get(sw.toShiftTypeId) ?? "—"),
        status: sw.status,
        reviewer: sw.reviewerId ? (people.get(sw.reviewerId)?.name ?? null) : null,
        has_attachment: false,
        target: sw.targetUserId ? (people.get(sw.targetUserId)?.name ?? null) : null,
        href: `/requests/swap/${sw.id}`,
      };
    }),
  ].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const items = [...leaves.map((l) => ({ ...l, kindOf: "leave" })), ...swaps.map((s) => ({ ...s, kindOf: "swap" }))];
  const now = Date.now();
  const perUnit = new Map<string, { total: number; pending: number; approved: number; rejected: number; hours: number[] }>();
  for (const x of items) {
    const u = people.get(x.userId)!;
    const c = perUnit.get(u.unit || NO_UNIT) ?? { total: 0, pending: 0, approved: 0, rejected: 0, hours: [] };
    perUnit.set(u.unit || NO_UNIT, c);
    c.total++;
    if (x.status === "pending" || x.status === "approved" || x.status === "rejected") c[x.status]++;
    if (x.reviewedAt) c.hours.push((x.reviewedAt.getTime() - x.createdAt.getTime()) / 3600_000);
  }
  const decided = leaves.filter((l) => l.reviewedAt);
  const avg = decided.length ? Math.round((decided.reduce((s, l) => s + (l.reviewedAt!.getTime() - l.createdAt.getTime()), 0) / 3600_000 / decided.length) * 10) / 10 : null;
  return {
    tab: "req",
    label,
    start,
    end,
    kpi: {
      total: leaves.length,
      izin: leaves.filter((l) => l.kind === "izin").length,
      sakit: leaves.filter((l) => l.kind === "sakit").length,
      pending: leaves.filter((l) => l.status === "pending").length,
      approved: leaves.filter((l) => l.status === "approved").length,
      rejected: leaves.filter((l) => l.status === "rejected").length,
      swaps: swaps.length,
      swaps_approved: swaps.filter((s) => s.status === "approved").length,
      avg_decision_hours: avg,
      overdue: items.filter((x) => x.status === "pending" && now - x.createdAt.getTime() > 86400_000).length,
    },
    units: [...perUnit]
      .map(([unit, v]) => ({ unit, total: v.total, pending: v.pending, approved: v.approved, rejected: v.rejected, avg_hours: v.hours.length ? Math.round((v.hours.reduce((a, b) => a + b, 0) / v.hours.length) * 10) / 10 : null }))
      .sort((a, b) => b.total - a.total),
    weeks: [...weeks].map(([k, v]) => ({ label: `${Number(k.slice(8))} ${BULAN[Number(k.slice(5, 7)) - 1].slice(0, 3)}`, start: k, izin: v[0], sakit: v[1] })),
    rows,
  };
}

// ------------------------------------------------------------ jadwal

/** Distribusi shift per karyawan + status terbit jadwal per unit (tepat waktu terhadap batas). */
async function scheduleReport(me: User, f: F): Promise<Rep> {
  const [start, end, label] = periodRange(f);
  const list = await scopedStaff(me, f);
  const ids = list.map((u) => u.id);
  const days = diffDays(end, start) + 1;
  const assigns = ids.length
    ? await db()
        .select({ a: shiftAssignments, t: shiftTypes })
        .from(shiftAssignments)
        .innerJoin(shiftTypes, eq(shiftTypes.id, shiftAssignments.shiftTypeId))
        .where(and(inArray(shiftAssignments.userId, ids), gte(shiftAssignments.date, start), lte(shiftAssignments.date, end)))
    : [];
  const byUser = new Map<number, Record<string, number>>();
  const nights = new Map<number, number>();
  const byType = new Map<string, number>();
  for (const { a, t } of assigns) {
    const m = byUser.get(a.userId) ?? {};
    byUser.set(a.userId, m);
    m[t.name] = (m[t.name] ?? 0) + 1;
    byType.set(t.name, (byType.get(t.name) ?? 0) + 1);
    if (crossesMidnight(t.startTime, t.endTime)) nights.set(a.userId, (nights.get(a.userId) ?? 0) + 1);
  }
  const swapped = new Map<number, number>();
  let nSwaps = 0;
  if (ids.length) {
    for (const sw of await db()
      .select()
      .from(swapRequests)
      .where(and(eq(swapRequests.status, "approved"), gte(swapRequests.date, start), lte(swapRequests.date, end), or(inArray(swapRequests.userId, ids), inArray(swapRequests.targetUserId, ids))))) {
      nSwaps++;
      for (const uid of [sw.userId, sw.targetUserId]) if (uid) swapped.set(uid, (swapped.get(uid) ?? 0) + 1);
    }
  }
  const rows = list.map((u) => {
    const bt = byUser.get(u.id) ?? {};
    const total = Object.values(bt).reduce((a, b) => a + b, 0);
    return { user_id: u.id, name: u.name, employee_code: u.employeeCode, unit: u.unit, employment_type: u.employmentType, total, by_type: bt, nights: nights.get(u.id) ?? 0, off: days - total, swaps: swapped.get(u.id) ?? 0 };
  });
  const month = start.slice(0, 7);
  const due = await deadline(month);
  const unitsOut = [];
  for (const name of [...new Set(list.map((u) => u.unit).filter((x): x is string => !!x))].sort()) {
    const [row] = await db()
      .select()
      .from(schedulePeriods)
      .where(and(eq(schedulePeriods.unit, name), eq(schedulePeriods.month, month)));
    const st = await periodStatus(name, month);
    const pub = row?.publishedAt ? workDateOf(row.publishedAt) : null;
    const members = rows.filter((r) => r.unit === name);
    unitsOut.push({ unit: name, status: st, published_at: pub, on_time: pub === null ? null : pub <= due, staff: members.length, unscheduled: members.filter((r) => !r.total).length, shifts: members.reduce((s, r) => s + r.total, 0) });
  }
  return {
    tab: "jadwal",
    label,
    start,
    end,
    month,
    deadline: due,
    kpi: {
      units: unitsOut.length,
      published: unitsOut.filter((x) => x.status === "published").length,
      late: unitsOut.filter((x) => x.on_time === false || (x.status !== "published" && today() > due)).length,
      shifts: assigns.length,
      unscheduled: rows.filter((r) => !r.total).length,
      swaps: nSwaps,
    },
    types: [...byType].map(([name, c]) => ({ name, count: c })).sort((a, b) => b.count - a.count),
    units: unitsOut,
    rows: rows.sort((a, b) => (a.unit ?? "").localeCompare(b.unit ?? "") || a.name.localeCompare(b.name)),
  };
}

// ------------------------------------------------------------ karyawan

async function staffReport(me: User, f: F): Promise<Rep> {
  const list = await scopedStaff(me, f, false);
  const t = today();
  const rows = list
    .map((u) => ({
      user_id: u.id,
      name: u.name,
      employee_code: u.employeeCode,
      employment_type: u.employmentType,
      unit: u.unit,
      phone: u.phone,
      period_start: u.periodStart,
      status: u.isActive === false ? "nonaktif" : "aktif",
      face: !!u.faceEmbedding,
      institution: u.institution,
    }))
    .filter((r) => !(f.status === "aktif" || f.status === "nonaktif") || r.status === f.status);
  const units = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const c = units.get(r.unit || NO_UNIT) ?? { total: 0, magang: 0, outsourcing: 0, face: 0, aktif: 0 };
    units.set(r.unit || NO_UNIT, c);
    c.total++;
    c[r.employment_type === "magang" ? "magang" : "outsourcing"]++;
    if (r.face) c.face++;
    if (r.status === "aktif") c.aktif++;
  }
  return {
    tab: "kr",
    label: `Per ${Number(t.slice(8))} ${BULAN[Number(t.slice(5, 7)) - 1]} ${t.slice(0, 4)}`,
    kpi: {
      total: rows.length,
      aktif: rows.filter((r) => r.status === "aktif").length,
      magang: rows.filter((r) => r.employment_type === "magang").length,
      outsourcing: rows.filter((r) => r.employment_type === "outsourcing").length,
      no_face: rows.filter((r) => !r.face && r.status === "aktif").length,
    },
    units: [...units].map(([unit, v]) => ({ unit, total: v.total, magang: v.magang, outsourcing: v.outsourcing, face: v.face, aktif: v.aktif })).sort((a, b) => b.total - a.total),
    rows,
  };
}

const build = (me: User, f: F) => ({ hadir: attendanceReport, req: requestsReport, jadwal: scheduleReport, kr: staffReport })[f.tab](me, f);

// ------------------------------------------------------------ ekspor

function tableRows(rep: Rep, tab: string): (string | number)[][] {
  const R = rep.rows as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (tab === "hadir") return R.map((r) => [`${r.name} (${r.employee_code})`, r.unit || "-", r.hadir, r.telat, r.izin, r.sakit, r.alpa, r.jam, "lihat sheet Detail"]);
  if (tab === "req")
    return R.map((r) => [
      `${r.name} (${r.employee_code})`,
      r.unit || "-",
      KIND_LABEL[r.kind] ?? r.kind,
      r.start_date === r.end_date ? r.start_date : `${r.start_date} s.d. ${r.end_date}`,
      r.reason,
      STATUS_LABEL[r.status] ?? r.status,
      r.reviewer || "-",
      r.target || "-",
    ]);
  if (tab === "jadwal")
    return R.map((r) => [
      `${r.name} (${r.employee_code})`,
      r.unit || "-",
      r.total,
      Object.entries(r.by_type as Record<string, number>)
        .sort()
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") || "-",
      r.nights,
      r.off,
      r.swaps,
    ]);
  return R.map((r) => [
    `${r.name} (${r.employee_code})`,
    TYPE_LABEL[r.employment_type ?? ""] ?? r.employment_type ?? "-",
    r.unit || "-",
    r.phone || "-",
    r.period_start || "-",
    String(r.status).charAt(0).toUpperCase() + String(r.status).slice(1),
    r.face ? "Terdaftar" : "Belum daftar",
  ]);
}

const stamp = () => {
  const now = new Date();
  const d = workDateOf(now);
  return `Dibuat ${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${localHm(now)} WIB · ${settings.ORG_NAME}`;
};

/** Excel laporan: judul, cap waktu, ringkasan opsional (`notes`), tabel. Dipakai laporan admin & rekap karyawan. */
export async function writeXlsx(title: string, header: string[], rows: (string | number)[][], detail: unknown[][] | null, notes: string[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Laporan", { views: [{ state: "frozen", ySplit: 4 + notes.length }] });
  ws.addRow([title]).getCell(1).font = { bold: true, size: 13 };
  ws.addRow([stamp()]);
  for (const n of notes) ws.addRow([n]);
  ws.addRow([]);
  styleHeader(ws.addRow(header));
  for (const r of rows) ws.addRow(r).eachCell((c) => (c.alignment = { vertical: "top", wrapText: typeof c.value === "string" && c.value.length > 40 }));
  header.forEach((h, i) => (ws.getColumn(i + 1).width = Math.min(Math.max(Math.max(h.length, ...rows.slice(0, 500).map((r) => String(r[i] ?? "").length)) + 2, 10), 60)));
  if (detail) {
    const d = wb.addWorksheet("Detail", { views: [{ state: "frozen", ySplit: 1 }] });
    styleHeader(d.addRow(["Tanggal", "Nama", "NIK", "Unit", "Shift", "Masuk", "Pulang", "Terlambat (mnt)", "Status"]));
    for (const r of detail) d.addRow(r);
  }
  return toBuffer(wb);
}

/** PDF laporan (A4 mendatar): judul, cap waktu, ringkasan opsional (`notes`), tabel. */
export function writePdf(title: string, header: string[], rows: (string | number)[][], notes: string[] = []): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 34 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica-Bold").fontSize(15).text(title);
    doc.font("Helvetica").fontSize(9).fillColor("#5B6678").text(stamp()).fillColor("#0D1726");
    if (notes.length) doc.moveDown(0.6).font("Helvetica").fontSize(10).text(notes.join("   ·   "));
    doc.moveDown(1);
    const width = doc.page.width - 68;
    const colW = header.map((h, i) => Math.max(h.length, ...rows.slice(0, 200).map((r) => Math.min(String(r[i] ?? "").length, 50))) + 2);
    const sum = colW.reduce((a, b) => a + b, 0);
    const ws = colW.map((w) => (w / sum) * width);
    const drawRow = (vals: string[], bold: boolean, fill?: string) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      const h = Math.max(...vals.map((v, i) => doc.heightOfString(v, { width: ws[i] - 6 }))) + 6;
      if (doc.y + h > doc.page.height - 34) {
        doc.addPage();
        if (!bold) drawRow(header, true, "#E5F3F4");
      }
      const y = doc.y;
      if (fill) doc.rect(34, y, width, h).fill(fill).fillColor("#0D1726");
      let x = 34;
      vals.forEach((v, i) => {
        doc.text(v, x + 3, y + 3, { width: ws[i] - 6 });
        x += ws[i];
      });
      doc.moveTo(34, y + h).lineTo(34 + width, y + h).lineWidth(0.25).strokeColor("#E7EBEF").stroke();
      doc.x = 34;
      doc.y = y + h;
    };
    drawRow(header, true, "#E5F3F4");
    rows.forEach((r, i) =>
      drawRow(
        r.map((v) => String(v ?? "")),
        false,
        i % 2 ? "#F7F9FA" : undefined,
      ),
    );
    doc.end();
  });
}

async function visibleExports(me: User) {
  const rows = await db().select().from(auditLogs).where(eq(auditLogs.action, "report_export")).orderBy(desc(auditLogs.createdAt)).limit(20);
  // Kepala Unit hanya melihat ekspor miliknya sendiri
  return scopeUnits(me) === null ? rows : rows.filter((l) => l.actorId === me.id);
}

async function exportOut(lg: typeof auditLogs.$inferSelect) {
  const d = lg.detail as Record<string, string>;
  let ready = false;
  try {
    ready = !!d.path && fs.existsSync(resolveStored(d.path));
  } catch {
    ready = false;
  }
  const by = lg.actorId ? (await usersById([lg.actorId])).get(lg.actorId) : null;
  return { id: lg.id, name: d.name ?? "", meta: d.meta ?? "", by: by?.name ?? null, at: lg.createdAt, ready };
}

@ApiTags("Admin · Laporan")
@Controller("admin/reports")
@Roles("monitor")
export class ReportsController {
  @Get()
  @Returns(Report)
  async report(@Query() q: Record<string, string>, @Me() me: User) {
    const f = ReportFilters.parse(Object.fromEntries(Object.entries(q).filter(([, v]) => v !== "")));
    const rep = await build(me, f);
    delete rep._detail;
    return rep;
  }

  @Post("export")
  @Returns(ExportOut)
  @HttpCode(200)
  async export(@Body({ schema: ExportIn }) body: z.output<typeof ExportIn>, @Me() me: User) {
    const rep = await build(me, body);
    const all = COLUMNS[body.tab];
    const keep = all.map((h, i) => [h, i] as const).filter(([h]) => !body.columns || body.columns.includes(h));
    if (!keep.length) throw new HttpError(422, "Pilih minimal satu kolom.");
    const header = keep.map(([h]) => h);
    const rows = tableRows(rep, body.tab).map((r) => keep.map(([, i]) => r[i]));
    const tabName = { hadir: "Kehadiran", req: "Pengajuan", jadwal: "Jadwal", kr: "Karyawan" }[body.tab];
    const unit = effectiveUnit(me, body.unit)?.join(", ") ?? "Semua unit";
    const title = `Laporan ${tabName} · ${rep.label} · ${unit}`;
    const name = `${tabName}_${rep.label.replace(/ /g, "_").replace(/–/g, "-")}.${body.format}`;
    const buf =
      body.format === "xlsx"
        ? await writeXlsx(title, header, rows, body.tab === "hadir" && header.includes("Detail check in/out") ? (rep._detail ?? null) : null)
        : await writePdf(title, header, rows);
    const rel = await saveFile(`exports/${randomBytes(16).toString("hex")}.${body.format}`, buf);
    const detail = { name, path: rel, meta: `${unit} · ${rep.label}`, tab: body.tab, format: body.format, unit_scope: scopeUnits(me) === null ? null : (effectiveUnit(me, body.unit)?.join(", ") ?? null) };
    const [{ id }] = await db().insert(auditLogs).values({ actorId: me.id, action: "report_export", targetType: "report", targetId: null, detail }).$returningId();
    return exportOut((await db().select().from(auditLogs).where(eq(auditLogs.id, id)))[0]);
  }

  @Get("exports")
  @Returns(ExportOut, { list: true })
  async exports(@Me() me: User) {
    return Promise.all((await visibleExports(me)).map(exportOut));
  }

  @Get("exports/:id/file")
  async file(@Param("id", IdPipe) id: number, @Me() me: User, @Res() res: Response) {
    const lg = (await visibleExports(me)).find((x) => x.id === id);
    if (!lg) throw new HttpError(404, "File ekspor tidak ditemukan.");
    const d = lg.detail as Record<string, string>;
    const data = await readStored(d.path);
    if (!data) throw new HttpError(404, "File ekspor sudah tidak tersedia.");
    res.setHeader("Content-Disposition", `attachment; filename="${d.name}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.type(d.path.endsWith(".pdf") ? "application/pdf" : XLSX_MIME).send(data);
  }
}
