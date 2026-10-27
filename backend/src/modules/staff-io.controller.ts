/**
 * Karyawan massal: ekspor Excel, template impor, impor (tambah & perbarui per NIK), reset kata sandi massal.
 * Admin SDM: semua unit. Kepala Unit: hanya karyawan unitnya. Kolom template = 7 kolom pertama ekspor.
 */
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { asc, eq, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { BulkResetIn, BulkResetResult, StaffImportResult } from "../shared";
import { hashPassword, scopeUnits, unitFilter } from "../core/auth";
import { HttpError } from "../core/http";
import { checkUpload, ExcelJS, MAX_ROWS, readWorkbook, sheetRows, styleHeader, toBuffer, XLSX_MIME } from "../core/xlsx";
import { db, schema } from "../db";
import { closePasswordRequests } from "../domain/password-reset";
import type { User } from "../db/schema";
import { credentialsEmail, generatePassword, tempPasswordEmail, trySend } from "../domain/mailer";
import { staffIn } from "../domain/presence";
import { appUrl, audit, notify } from "../domain/services";
import { Me, Roles, type UploadFile } from "../common/nest";
import { Returns, Upload } from "../common/swagger";
import { defaultOffice, getUser, staffTarget } from "./admin.controller";
import { EMAIL_RE } from "./auth.controller";

const { users, units } = schema;
const COLS = ["NIK", "Nama", "Email", "Nomor HP", "Tipe", "Unit", "Institusi/Vendor"];
const TIPE: Record<string, string> = { magang: "magang", "magang/pkl": "magang", pkl: "magang", outsourcing: "outsourcing" };
const TIPE_LABEL: Record<string, string> = { magang: "Magang/PKL", outsourcing: "Outsourcing" };

async function unitNames(me: User): Promise<string[]> {
  return scopeUnits(me) ?? (await db().select({ n: units.name }).from(units).orderBy(asc(units.name))).map((r) => r.n);
}

const NIK_RE = /^\d{1,40}$/; // NIK karyawan: angka saja

function phone(v: string): string | null {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("62")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.startsWith("8") && d.length >= 9 && d.length <= 13 ? `+62${d}` : null;
}

const cell = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(typeof v === "number" && Number.isInteger(v) ? Math.trunc(v) : v).trim());

function sendXlsx(res: Response, buf: Buffer, name: string) {
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.type(XLSX_MIME).send(buf);
}

function header(ws: ExcelJS.Worksheet, cols: string[], widths: number[]) {
  styleHeader(ws.addRow(cols));
  cols.forEach((_, i) => (ws.getColumn(i + 1).width = widths[i] ?? 14));
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

@ApiTags("Admin · Impor & ekspor")
@Controller("admin")
@Roles("manager")
export class StaffIoController {
  @Get("staff/export")
  async export(@Query("unit") unit: string | undefined, @Me() me: User, @Res() res: Response) {
    const scope = unitFilter(me, unit); // Kepala Unit tanpa pilihan: semua unitnya
    const list = await staffIn(scope, false);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Karyawan");
    header(ws, [...COLS, "Status", "Wajah", "Mulai dinas"], [14, 28, 30, 18, 14, 24, 30, 10, 11, 12]);
    for (const u of list)
      ws.addRow([
        u.employeeCode,
        u.name,
        u.email ?? "",
        u.phone ?? "",
        TIPE_LABEL[u.employmentType ?? ""] ?? u.employmentType ?? "",
        u.unit ?? "",
        u.institution ?? "",
        u.isActive !== false ? "Aktif" : "Nonaktif",
        u.faceEmbedding ? "Terdaftar" : "Belum",
        u.periodStart ?? "",
      ]);
    const label = (scope?.join("_") ?? "Semua_unit").replace(/ /g, "_");
    sendXlsx(res, await toBuffer(wb), `Karyawan_${label}.xlsx`);
  }

  /** Template impor: daftar pilihan Tipe & Unit + lembar petunjuk. */
  @Get("staff/template")
  async template(@Me() me: User, @Res() res: Response) {
    const names = await unitNames(me);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Karyawan");
    header(ws, COLS, [14, 28, 30, 18, 14, 24, 30]);
    const ref = wb.addWorksheet("Pilihan", { state: "hidden" });
    ref.addRow(["Tipe", "Unit"]);
    for (let i = 0; i < Math.max(2, names.length); i++) ref.addRow([i < 2 ? ["Magang/PKL", "Outsourcing"][i] : null, names[i] ?? null]);
    for (let r = 2; r <= 501; r++) {
      ws.getCell(`A${r}`).numFmt = "@"; // NIK & HP sebagai teks agar angka 0 di depan tidak hilang
      ws.getCell(`D${r}`).numFmt = "@";
      ws.getCell(`E${r}`).dataValidation = { type: "list", allowBlank: false, formulae: ["Pilihan!$A$2:$A$3"] };
      ws.getCell(`F${r}`).dataValidation = { type: "list", allowBlank: false, formulae: [`Pilihan!$B$2:$B$${names.length + 1}`] };
    }
    const info = wb.addWorksheet("Petunjuk");
    for (const line of [
      ["Kolom", "Isi"],
      ["NIK", "Wajib, angka saja, unik. NIK yang sudah ada = data karyawan itu diperbarui."],
      ["Nama", "Wajib."],
      ["Email", "Wajib, unik. Kata sandi awal dikirim ke email ini."],
      ["Nomor HP", "Wajib. Contoh 081234567890 atau +6281234567890."],
      ["Tipe", "Magang/PKL atau Outsourcing."],
      ["Unit", "Pilih dari daftar." + (scopeUnits(me) ? " Kepala Unit hanya bisa mengisi unitnya." : "")],
      ["Institusi/Vendor", "Wajib. Kampus untuk magang, vendor untuk outsourcing."],
      [],
      ["Contoh", `20260501 | Andi Saputra | andi@email.com | 081234567890 | Magang/PKL | ${names[0] ?? "IGD"} | Poltekkes`],
    ])
      info.addRow(line);
    info.getColumn(1).width = 18;
    info.getColumn(2).width = 90;
    sendXlsx(res, await toBuffer(wb), "Template_impor_karyawan.xlsx");
  }

  /** Tambah karyawan baru & perbarui yang sudah ada (per NIK). Semua baris dicek dulu; ada kesalahan = tidak ada yang disimpan. */
  @Post("staff/import")
  @Returns(StaffImportResult)
  @HttpCode(200)
  @Upload({ file: "file" }, ["file"])
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 + 1 } }))
  async import(@UploadedFile() file: UploadFile | undefined, @Me() me: User, @Req() req: Request) {
    let rows: (string | number | null)[][];
    try {
      const wb = await readWorkbook(checkUpload(file));
      const ws = wb.getWorksheet("Karyawan") ?? wb.worksheets[0];
      rows = sheetRows(ws, MAX_ROWS + 2);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, "File tidak bisa dibaca. Gunakan template impor (.xlsx).");
    }
    if (!rows.length || COLS.some((c, i) => cell(rows[0][i]).toLowerCase() !== c.toLowerCase())) throw new HttpError(422, "Kolom tidak sesuai template. Unduh template impor lalu isi ulang.");
    if (rows.length > MAX_ROWS + 1) throw new HttpError(422, `Maksimal ${MAX_ROWS} baris per impor. Bagi file menjadi beberapa bagian.`);
    const own = scopeUnits(me); // Kepala Unit: unit-unit yang dipimpinnya
    const allowed = new Set(await unitNames(me));
    const errors: string[] = [];
    type Data = { employeeCode: string; name: string; email: string; phone: string; employmentType: string; unit: string; institution: string };
    const plan: [User | null, Data][] = [];
    const seenNik = new Set<string>();
    const seenEmail = new Set<string>();
    for (let n = 2; n <= rows.length; n++) {
      const v = Array.from({ length: 7 }, (_, i) => cell(rows[n - 1][i]));
      if (!v.some(Boolean)) continue;
      const [nik, name, emailRaw, phoneRaw, tipe, unitRaw, inst] = v;
      const email = emailRaw.toLowerCase();
      const unit = unitRaw || (own?.length === 1 ? own[0] : "");
      const bad: string[] = [];
      if (!nik) bad.push("NIK kosong");
      else if (!NIK_RE.test(nik)) bad.push("NIK hanya boleh berisi angka");
      if (name.length < 2) bad.push("nama kosong");
      if (!EMAIL_RE.test(email)) bad.push("email tidak valid");
      const ph = phone(phoneRaw);
      if (!ph) bad.push("nomor HP tidak valid");
      const t = TIPE[tipe.toLowerCase()];
      if (!t) bad.push("tipe harus Magang/PKL atau Outsourcing");
      if (!allowed.has(unit)) bad.push(own ? `unit harus ${own.join(" atau ") || "unit Anda"}` : `unit ${unit || "(kosong)"} tidak ada`);
      if (!inst) bad.push("institusi/vendor kosong");
      if (seenNik.has(nik)) bad.push("NIK dobel di file");
      if (seenEmail.has(email)) bad.push("email dobel di file");
      seenNik.add(nik);
      seenEmail.add(email);
      const [user] = nik ? await db().select().from(users).where(eq(users.employeeCode, nik)) : [];
      if (user) {
        if (user.role !== "staff") bad.push("NIK dipakai akun admin");
        else if (own && !own.includes(user.unit ?? "")) bad.push("karyawan ini bukan dari unit Anda");
      }
      const [other] = email ? await db().select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`) : [];
      if (other && (!user || other.id !== user.id)) bad.push("email sudah dipakai akun lain");
      if (bad.length) {
        errors.push(`Baris ${n}: ${bad.join(", ")}`);
        continue;
      }
      plan.push([user ?? null, { employeeCode: nik, name, email, phone: ph!, employmentType: t, unit, institution: inst }]);
    }
    if (errors.length) return { created: 0, updated: 0, unchanged: 0, errors: errors.slice(0, 100), credentials: [] };
    const office = await defaultOffice();
    const created: [Data, string][] = [];
    let updated = 0,
      unchanged = 0;
    await db().transaction(async (tx) => {
      for (const [user, data] of plan) {
        if (!user) {
          const pw = generatePassword();
          await tx.insert(users).values({ ...data, passwordHash: await hashPassword(pw), mustChangePassword: true, role: "staff", officeId: office?.id ?? null, isActive: true });
          created.push([data, pw]);
        } else {
          const diff: Record<string, string> = {};
          for (const [k, val] of Object.entries(data)) if (k !== "employeeCode" && !(own && k === "unit") && (user as Record<string, unknown>)[k] !== val) diff[k] = val;
          if (Object.keys(diff).length) {
            await tx.update(users).set(diff).where(eq(users.id, user.id));
            updated++;
          } else unchanged++;
        }
      }
    });
    await audit(me, "staff_import", "user", null, { created: created.length, updated, unchanged });
    const url = appUrl(req.headers.origin);
    const credentials = [];
    for (const [u, pw] of created) {
      const err = await trySend(u.email, ...credentialsEmail(u.name, `${u.email} / NIK ${u.employeeCode}`, pw, true, url));
      if (err) credentials.push({ name: u.name, email: u.email, temp_password: pw, error: err });
    }
    return { created: created.length, updated, unchanged, errors: [], credentials };
  }

  /** Reset kata sandi banyak akun (karyawan / admin); kata sandi baru dikirim ke email masing-masing. */
  @Post("users/bulk-reset-password")
  @Returns(BulkResetResult)
  @HttpCode(200)
  async bulkReset(@Body({ schema: BulkResetIn }) body: z.output<typeof BulkResetIn>, @Me() me: User) {
    const list: User[] = [];
    for (const id of new Set(body.user_ids)) {
      if (id === me.id) throw new HttpError(400, "Kata sandi sendiri diganti lewat Profil.");
      list.push(staffTarget(me, await getUser(id)));
    }
    const pws = new Map<number, string>();
    for (const u of list) {
      const pw = generatePassword();
      pws.set(u.id, pw);
      await db()
        .update(users)
        .set({ passwordHash: await hashPassword(pw), mustChangePassword: true, sessionVersion: sql`${users.sessionVersion} + 1` })
        .where(eq(users.id, u.id));
      await closePasswordRequests(u.id);
      await notify(u.id, "system", "Kata sandi direset admin", "Masuk dengan kata sandi baru dari admin, lalu buat kata sandi sendiri.");
    }
    await audit(me, "password_reset_bulk", "user", null, { users: list.map((u) => u.id) });
    const failed = [];
    for (const u of list) {
      const err = await trySend(u.email, ...tempPasswordEmail(u.name, u.email || u.employeeCode, pws.get(u.id)!));
      if (err) failed.push({ name: u.name, email: u.email || u.employeeCode, temp_password: pws.get(u.id)!, error: err });
    }
    return { sent: list.length - failed.length, failed };
  }
}
