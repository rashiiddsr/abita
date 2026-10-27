/**
 * Dokumen.
 * - File perusahaan: folder berkriteria (unit, tipe karyawan, tanggal tampil). Admin SDM mengelola; Kepala Unit membaca.
 * - File karyawan: per orang dan berkategori. Admin SDM mengunggah; Kepala Unit membaca karyawan unitnya; karyawan membaca miliknya.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FilesInterceptor } from "@nestjs/platform-express";
import fs from "node:fs";
import archiver from "archiver";
import { and, asc, desc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import type { Response } from "express";
import { z } from "zod";
import { FileCategory, FileCategoryIn, FileOut, FileUpdateIn, FileUploadIn, FolderIn, FolderOut } from "../shared";
import { unitFilter } from "../core/auth";
import { settings } from "../core/config";
import { HttpError } from "../core/http";
import { readStored, removeStored, resolveStored } from "../core/storage";
import { today } from "../core/time";
import { db, schema } from "../db";
import type { FileFolder, StoredFile, User } from "../db/schema";
import { canRead, categoryCounts, categoryNameTaken, filesOut, folderVisibleTo, foldersOut, MAX_FILES_PER_UPLOAD, noticeFolderUpload, noticeOwnerUpload, storeUploads } from "../domain/files";
import { activeUser, audit } from "../domain/services";
import { IdPipe, Me, Roles, type UploadFile } from "../common/nest";
import { Returns, Upload } from "../common/swagger";
import { getUser, staffTarget } from "./admin.controller";
import { writeXlsx } from "./reports.controller";

const { files, fileFolders, fileCategories, units, users } = schema;

const uploads = () => FilesInterceptor("files", MAX_FILES_PER_UPLOAD, { limits: { fileSize: settings.MAX_DOCUMENT_MB * 1024 * 1024 + 1 } });

async function folderOr404(id: number): Promise<FileFolder> {
  const [f] = await db().select().from(fileFolders).where(eq(fileFolders.id, id));
  if (!f) throw new HttpError(404, "Folder tidak ditemukan.");
  return f;
}

async function fileOr404(id: number): Promise<StoredFile> {
  const [f] = await db().select().from(files).where(eq(files.id, id));
  if (!f) throw new HttpError(404, "File tidak ditemukan.");
  return f;
}

async function categoryOr422(id: number | null | undefined): Promise<number | null> {
  if (id === null || id === undefined) return null;
  const [c] = await db().select({ id: fileCategories.id }).from(fileCategories).where(eq(fileCategories.id, id));
  if (!c) throw new HttpError(422, "Kategori tidak ditemukan.");
  return c.id;
}

async function folderValues(body: z.output<typeof FolderIn>, prev: FileFolder | null = null) {
  const reminder = body.reminder_date || null;
  if (reminder && reminder !== prev?.reminderDate) {
    if (reminder < today()) throw new HttpError(422, "Tanggal pengingat sudah lewat.");
    if (body.available_from && reminder < body.available_from) throw new HttpError(422, "Tanggal pengingat tidak boleh sebelum tanggal tampil.");
  }
  const wanted = [...new Set(body.units)];
  if (wanted.length) {
    const found = new Set((await db().select({ name: units.name }).from(units).where(inArray(units.name, wanted))).map((u) => u.name));
    const missing = wanted.filter((u) => !found.has(u));
    if (missing.length) throw new HttpError(422, `Unit tidak ditemukan: ${missing.join(", ")}.`);
  }
  return {
    name: body.name,
    description: body.description || null,
    availableFrom: body.available_from || null,
    units: wanted,
    employmentTypes: [...new Set(body.employment_types)],
    reminderDate: reminder,
    reminderMessage: reminder ? body.reminder_message || null : null,
    // tanggal pengingat diganti: kirim lagi pada tanggal baru
    ...(reminder !== (prev?.reminderDate ?? null) ? { reminderSentAt: null } : {}),
  };
}

async function removeFiles(rows: StoredFile[]) {
  if (!rows.length) return;
  await db()
    .delete(files)
    .where(
      inArray(
        files.id,
        rows.map((r) => r.id),
      ),
    );
  for (const r of rows) await removeStored(r.path);
}

/** Nama aman untuk folder/file di dalam ZIP (karakter terlarang di Windows diganti). */
const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 120) || "_";

/** Syarat file karyawan dalam jangkauan akun (+ filter unit / kategori). */
function staffFileConds(me: User, unit: string | undefined, category: string | undefined): SQL[] {
  const conds: SQL[] = [eq(users.role, "staff")];
  const scope = unitFilter(me, unit);
  if (scope) conds.push(inArray(users.unit, scope));
  if (category && Number(category)) conds.push(eq(files.categoryId, Number(category)));
  return conds;
}

/** Nama unduhan: ASCII untuk browser lama, UTF-8 (RFC 5987) untuk sisanya. */
function disposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

@ApiTags("Dokumen")
@Controller()
export class FilesController {
  // ------------------------------------------------------------------ file perusahaan (dasbor)

  @Get("admin/folders")
  @Roles("monitor")
  @Returns(FolderOut, { list: true })
  async folders() {
    return foldersOut(await db().select().from(fileFolders).orderBy(asc(fileFolders.name)));
  }

  @Get("admin/folders/:id")
  @Roles("monitor")
  @Returns(FolderOut)
  async folder(@Param("id", IdPipe) id: number) {
    return (await foldersOut([await folderOr404(id)]))[0];
  }

  @Post("admin/folders")
  @Roles("hr")
  @Returns(FolderOut, { status: 201 })
  async createFolder(@Body({ schema: FolderIn }) body: z.output<typeof FolderIn>, @Me() me: User) {
    const [{ id }] = await db()
      .insert(fileFolders)
      .values({ ...(await folderValues(body)), createdBy: me.id })
      .$returningId();
    await audit(me, "folder.create", "file_folder", id, { name: body.name });
    return (await foldersOut([await folderOr404(id)]))[0];
  }

  @Put("admin/folders/:id")
  @Roles("hr")
  @Returns(FolderOut)
  async updateFolder(@Param("id", IdPipe) id: number, @Body({ schema: FolderIn }) body: z.output<typeof FolderIn>, @Me() me: User) {
    const prev = await folderOr404(id);
    await db()
      .update(fileFolders)
      .set({ ...(await folderValues(body, prev)), updatedAt: new Date() })
      .where(eq(fileFolders.id, id));
    await audit(me, "folder.update", "file_folder", id, { name: body.name });
    return (await foldersOut([await folderOr404(id)]))[0];
  }

  /** Hapus folder beserta semua filenya. */
  @Delete("admin/folders/:id")
  @Roles("hr")
  @HttpCode(204)
  async deleteFolder(@Param("id", IdPipe) id: number, @Me() me: User) {
    const f = await folderOr404(id);
    await removeFiles(await db().select().from(files).where(eq(files.folderId, id)));
    await db().delete(fileFolders).where(eq(fileFolders.id, id));
    await audit(me, "folder.delete", "file_folder", id, { name: f.name });
  }

  @Get("admin/folders/:id/files")
  @Roles("monitor")
  @Returns(FileOut, { list: true })
  async folderFiles(@Param("id", IdPipe) id: number) {
    await folderOr404(id);
    return filesOut(await db().select().from(files).where(eq(files.folderId, id)).orderBy(asc(files.name)));
  }

  @Post("admin/folders/:id/files")
  @Roles("hr")
  @Returns(FileOut, { list: true, status: 201 })
  @Upload({ files: "files", notify: "true | false: beri tahu penerima (default true)" }, ["files"])
  @UseInterceptors(uploads())
  async uploadCompany(@Param("id", IdPipe) id: number, @Body({ schema: FileUploadIn }) body: z.output<typeof FileUploadIn>, @UploadedFiles() list: UploadFile[] | undefined, @Me() me: User) {
    const folder = await folderOr404(id);
    const saved = await storeUploads(list, { folderId: id }, me);
    await db().update(fileFolders).set({ updatedAt: new Date() }).where(eq(fileFolders.id, id));
    const notified = body.notify ? await noticeFolderUpload(folder, saved) : 0;
    await audit(me, "file.upload", "file_folder", id, { files: saved.map((f) => f.name + f.ext), notified });
    return filesOut(saved);
  }

  // ------------------------------------------------------------------ kategori file karyawan

  @Get("admin/file-categories")
  @Roles("monitor")
  @Returns(FileCategory, { list: true })
  async categories() {
    const counts = await categoryCounts();
    const rows = await db().select().from(fileCategories).orderBy(asc(fileCategories.name));
    return rows.map((c) => ({ id: c.id, name: c.name, file_count: counts.get(c.id) ?? 0 }));
  }

  @Post("admin/file-categories")
  @Roles("hr")
  @Returns(FileCategory, { status: 201 })
  async createCategory(@Body({ schema: FileCategoryIn }) body: z.output<typeof FileCategoryIn>, @Me() me: User) {
    if (await categoryNameTaken(body.name)) throw new HttpError(409, "Nama kategori sudah dipakai.");
    const [{ id }] = await db().insert(fileCategories).values({ name: body.name }).$returningId();
    await audit(me, "file_category.create", "file_category", id, { name: body.name });
    return { id, name: body.name, file_count: 0 };
  }

  @Put("admin/file-categories/:id")
  @Roles("hr")
  @Returns(FileCategory)
  async updateCategory(@Param("id", IdPipe) id: number, @Body({ schema: FileCategoryIn }) body: z.output<typeof FileCategoryIn>, @Me() me: User) {
    if (!(await categoryOr422(id))) throw new HttpError(404, "Kategori tidak ditemukan.");
    if (await categoryNameTaken(body.name, id)) throw new HttpError(409, "Nama kategori sudah dipakai.");
    await db().update(fileCategories).set({ name: body.name }).where(eq(fileCategories.id, id));
    await audit(me, "file_category.update", "file_category", id, { name: body.name });
    return { id, name: body.name, file_count: (await categoryCounts()).get(id) ?? 0 };
  }

  @Delete("admin/file-categories/:id")
  @Roles("hr")
  @HttpCode(204)
  async deleteCategory(@Param("id", IdPipe) id: number, @Me() me: User) {
    const [c] = await db().select().from(fileCategories).where(eq(fileCategories.id, id));
    if (!c) throw new HttpError(404, "Kategori tidak ditemukan.");
    const used = (await categoryCounts()).get(id) ?? 0;
    if (used) throw new HttpError(409, `Kategori masih dipakai ${used} file. Pindahkan atau hapus filenya dulu.`);
    await db().delete(fileCategories).where(eq(fileCategories.id, id));
    await audit(me, "file_category.delete", "file_category", id, { name: c.name });
  }

  // ------------------------------------------------------------------ file karyawan (dasbor)

  @Get("admin/staff/:id/files")
  @Roles("monitor")
  @Returns(FileOut, { list: true })
  async staffFiles(@Param("id", IdPipe) id: number, @Me() me: User) {
    const u = staffTarget(me, await getUser(id));
    return filesOut(await db().select().from(files).where(eq(files.ownerId, u.id)).orderBy(desc(files.createdAt), desc(files.id)));
  }

  @Post("admin/staff/:id/files")
  @Roles("hr")
  @Returns(FileOut, { list: true, status: 201 })
  @Upload({ category_id: "id kategori file", files: "files", notify: "true | false: beri tahu karyawan (default true)" }, ["category_id", "files"])
  @UseInterceptors(uploads())
  async uploadStaff(@Param("id", IdPipe) id: number, @Body({ schema: FileUploadIn }) body: z.output<typeof FileUploadIn>, @UploadedFiles() list: UploadFile[] | undefined, @Me() me: User) {
    const u = await getUser(id);
    if (!u) throw new HttpError(404, "Pengguna tidak ditemukan.");
    const categoryId = await categoryOr422(body.category_id);
    if (categoryId === null) throw new HttpError(422, "Pilih kategori file.");
    const saved = await storeUploads(list, { ownerId: u.id, categoryId }, me);
    if (body.notify) {
      const [cat] = await db().select({ name: fileCategories.name }).from(fileCategories).where(eq(fileCategories.id, categoryId));
      await noticeOwnerUpload(u, cat?.name ?? "Dokumen", saved);
    }
    await audit(me, "file.upload", "user", u.id, { files: saved.map((f) => f.name + f.ext) });
    return filesOut(saved);
  }

  /** Semua file karyawan dalam jangkauan (Kepala Unit: unit yang dipimpinnya), disaring per unit, kategori, dan kata kunci. */
  @Get("admin/files")
  @Roles("monitor")
  @Returns(FileOut, { list: true })
  async allStaffFiles(@Query("unit") unit: string | undefined, @Query("category_id") category: string | undefined, @Query("q") q: string | undefined, @Me() me: User) {
    const conds = staffFileConds(me, unit, category);
    const k = (q ?? "").trim();
    if (k) conds.push(or(like(files.name, `%${k}%`), like(users.name, `%${k}%`), like(users.employeeCode, `%${k}%`))!);
    const rows = await db()
      .select({ f: files })
      .from(files)
      .innerJoin(users, eq(users.id, files.ownerId))
      .where(and(...conds))
      .orderBy(desc(files.createdAt), desc(files.id))
      .limit(5000);
    return filesOut(rows.map((r) => r.f));
  }

  /** Excel: jumlah file per kategori untuk setiap karyawan aktif (termasuk yang belum punya file). */
  @Get("admin/files/report")
  @Roles("monitor")
  async report(@Query("unit") unit: string | undefined, @Me() me: User, @Res() res: Response) {
    const scope = unitFilter(me, unit);
    const staff = await db()
      .select({ id: users.id, nik: users.employeeCode, name: users.name, unit: users.unit, type: users.employmentType })
      .from(users)
      .where(and(eq(users.role, "staff"), activeUser(), ...(scope ? [inArray(users.unit, scope)] : [])))
      .orderBy(asc(users.unit), asc(users.name));
    const cats = await db().select().from(fileCategories).orderBy(asc(fileCategories.name));
    const counts = new Map<string, number>();
    if (staff.length) {
      const ids = staff.map((u) => u.id);
      for (const r of await db().select({ owner: files.ownerId, cat: files.categoryId }).from(files).where(inArray(files.ownerId, ids))) {
        const key = `${r.owner}|${r.cat}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const TYPE: Record<string, string> = { tetap: "Tetap", outsourcing: "Outsourcing", magang: "Magang/PKL" };
    const body = staff.map((u) => {
      const per = cats.map((c) => counts.get(`${u.id}|${c.id}`) ?? 0);
      return [u.nik, u.name, u.unit ?? "", TYPE[u.type ?? ""] ?? "", ...per, per.reduce((a, b) => a + b, 0)];
    });
    const label = scope ? scope.join(", ") : "Semua unit";
    const buf = await writeXlsx(`Rekap file karyawan · ${label}`, ["NIK", "Nama", "Unit", "Tipe", ...cats.map((c) => c.name), "Total"], body, null);
    res.setHeader("Content-Disposition", disposition("attachment", `Rekap_File_Karyawan_${today()}.xlsx`));
    res.setHeader("Cache-Control", "private, no-store");
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buf);
  }

  /** ZIP semua file karyawan: "<NIK> - <Nama>/<Kategori>/<file>". Dialirkan langsung, tidak disimpan di server. */
  @Get("admin/files/export")
  @Roles("monitor")
  async exportZip(@Query("unit") unit: string | undefined, @Query("category_id") category: string | undefined, @Me() me: User, @Res() res: Response) {
    const rows = await db()
      .select({ f: files, nik: users.employeeCode, owner: users.name, cat: fileCategories.name })
      .from(files)
      .innerJoin(users, eq(users.id, files.ownerId))
      .leftJoin(fileCategories, eq(fileCategories.id, files.categoryId))
      .where(and(...staffFileConds(me, unit, category)))
      .orderBy(asc(users.name), asc(files.name));
    if (!rows.length) throw new HttpError(404, "Tidak ada file untuk diunduh.");
    await audit(me, "file.export", "file", null, { files: rows.length, unit: unit ?? null, category_id: category ?? null });
    res.setHeader("Content-Disposition", disposition("attachment", `File_Karyawan_${today()}.zip`));
    res.setHeader("Cache-Control", "private, no-store");
    res.type("application/zip");
    const zip = archiver("zip", { zlib: { level: 1 } }); // PDF/gambar/Office sudah terkompresi
    zip.on("error", () => res.destroy());
    zip.pipe(res);
    const used = new Set<string>();
    for (const r of rows) {
      const src = resolveStored(r.f.path);
      if (!fs.existsSync(src)) continue; // file hilang dari disk: lewati, jangan putuskan unduhan
      const dir = `${safeName(`${r.nik} - ${r.owner}`)}/${safeName(r.cat ?? "Lainnya")}`;
      let name = `${dir}/${safeName(r.f.name)}${r.f.ext}`;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${dir}/${safeName(r.f.name)} (${i})${r.f.ext}`;
      used.add(name.toLowerCase());
      zip.file(src, { name });
    }
    await zip.finalize();
  }

  // ------------------------------------------------------------------ ubah & hapus file (Admin SDM)

  @Put("admin/files/:id")
  @Roles("hr")
  @Returns(FileOut)
  async updateFile(@Param("id", IdPipe) id: number, @Body({ schema: FileUpdateIn }) body: z.output<typeof FileUpdateIn>, @Me() me: User) {
    const f = await fileOr404(id);
    const categoryId = f.ownerId !== null && body.category_id !== undefined ? await categoryOr422(body.category_id) : f.categoryId;
    if (f.ownerId !== null && categoryId === null) throw new HttpError(422, "Pilih kategori file.");
    await db().update(files).set({ name: body.name, categoryId, updatedAt: new Date() }).where(eq(files.id, id));
    await audit(me, "file.update", "file", id, { name: body.name });
    return (await filesOut([await fileOr404(id)]))[0];
  }

  @Delete("admin/files/:id")
  @Roles("hr")
  @HttpCode(204)
  async deleteFile(@Param("id", IdPipe) id: number, @Me() me: User) {
    const f = await fileOr404(id);
    await removeFiles([f]);
    await audit(me, "file.delete", "file", id, { name: f.name + f.ext, owner_id: f.ownerId, folder_id: f.folderId });
  }

  // ------------------------------------------------------------------ aplikasi karyawan

  /** Folder perusahaan yang tampil untuk akun ini. */
  @Get("me/folders")
  @Returns(FolderOut, { list: true })
  async myFolders(@Me() me: User) {
    const rows = await db().select().from(fileFolders).orderBy(asc(fileFolders.name));
    return foldersOut(rows.filter((f) => folderVisibleTo(f, me)));
  }

  @Get("me/folders/:id")
  @Returns(FolderOut)
  async myFolder(@Param("id", IdPipe) id: number, @Me() me: User) {
    const f = await folderOr404(id);
    if (!folderVisibleTo(f, me)) throw new HttpError(404, "Folder tidak ditemukan.");
    return (await foldersOut([f]))[0];
  }

  @Get("me/folders/:id/files")
  @Returns(FileOut, { list: true })
  async myFolderFiles(@Param("id", IdPipe) id: number, @Me() me: User) {
    const f = await folderOr404(id);
    if (!folderVisibleTo(f, me)) throw new HttpError(404, "Folder tidak ditemukan.");
    return filesOut(await db().select().from(files).where(eq(files.folderId, id)).orderBy(asc(files.name)));
  }

  /** File milik akun ini (diunggah Admin SDM). */
  @Get("me/files")
  @Returns(FileOut, { list: true })
  async myFiles(@Me() me: User) {
    return filesOut(await db().select().from(files).where(eq(files.ownerId, me.id)).orderBy(desc(files.createdAt), desc(files.id)));
  }

  // ------------------------------------------------------------------ buka / unduh

  /** Isi file. PDF & gambar dibuka di browser; `?download=1` atau format Office selalu diunduh. */
  @Get("files/:id")
  async content(@Param("id", IdPipe) id: number, @Query("download") download: string | undefined, @Me() me: User, @Res() res: Response) {
    const f = await fileOr404(id);
    if (!(await canRead(me, f))) throw new HttpError(404, "File tidak ditemukan.");
    const data = await readStored(f.path);
    if (!data) throw new HttpError(404, "File tidak ditemukan.");
    const inline = !download && (f.mime === "application/pdf" || f.mime.startsWith("image/"));
    res.setHeader("Content-Disposition", disposition(inline ? "inline" : "attachment", f.name + f.ext));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(f.mime).send(data);
  }
}
