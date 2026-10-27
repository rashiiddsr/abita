/** Dokumen: file perusahaan (folder untuk karyawan sesuai kriteria) dan file karyawan (per orang, berkategori). */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { and, count, eq, inArray, isNotNull, isNull, lte, or, sql, sum } from "drizzle-orm";
import type { FileOut, FolderOut, Wire } from "../shared";
import { inScope } from "../core/auth";
import { settings } from "../core/config";
import { HttpError } from "../core/http";
import { DOC_TYPES, saveFile } from "../core/storage";
import { localHm, today } from "../core/time";
import { db, schema } from "../db";
import type { FileFolder, StoredFile, User } from "../db/schema";
import type { UploadFile } from "../common/nest";
import { activeUser, notify } from "./services";

const { files, fileFolders, fileCategories, users } = schema;

export const MAX_FILES_PER_UPLOAD = 10;

/** Folder tampil untuk karyawan ini: sudah dibuka (available_from) dan cocok dengan unit & tipe karyawannya. */
export function folderVisibleTo(f: FileFolder, u: Pick<User, "unit" | "employmentType">, day = today()): boolean {
  if (f.availableFrom && f.availableFrom > day) return false;
  if (f.units.length && !(u.unit && f.units.includes(u.unit))) return false;
  if (f.employmentTypes.length && !(u.employmentType && f.employmentTypes.includes(u.employmentType))) return false;
  return true;
}

/** Hak baca satu file: Admin SDM semua; Kepala Unit file perusahaan + file karyawan unitnya; karyawan file sendiri + folder yang tampil untuknya. */
export async function canRead(me: User, f: StoredFile): Promise<boolean> {
  if (me.role === "admin") return true;
  if (f.ownerId !== null) {
    if (f.ownerId === me.id) return true;
    if (me.role !== "unit_head") return false;
    const [owner] = await db().select({ unit: users.unit, role: users.role }).from(users).where(eq(users.id, f.ownerId));
    return !!owner && owner.role === "staff" && inScope(me, owner.unit);
  }
  if (me.role === "unit_head") return true;
  const [folder] = await db().select().from(fileFolders).where(eq(fileFolders.id, f.folderId!));
  return !!folder && folderVisibleTo(folder, me);
}

export async function foldersOut(rows: FileFolder[]): Promise<Wire<FolderOut>[]> {
  const ids = rows.map((r) => r.id);
  const stats = ids.length
    ? await db()
        .select({ id: files.folderId, n: count(), size: sum(files.size) })
        .from(files)
        .where(inArray(files.folderId, ids))
        .groupBy(files.folderId)
    : [];
  const by = new Map(stats.map((s) => [s.id, s]));
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    available_from: f.availableFrom,
    units: f.units,
    employment_types: f.employmentTypes as FolderOut["employment_types"],
    reminder_date: f.reminderDate,
    reminder_message: f.reminderMessage,
    reminder_sent: !!f.reminderSentAt,
    file_count: Number(by.get(f.id)?.n ?? 0),
    size: Number(by.get(f.id)?.size ?? 0),
    updated_at: f.updatedAt,
  }));
}

export async function filesOut(rows: StoredFile[]): Promise<Wire<FileOut>[]> {
  const uploaderIds = [...new Set(rows.map((r) => r.uploadedBy).filter((x): x is number => x !== null))];
  const catIds = [...new Set(rows.map((r) => r.categoryId).filter((x): x is number => x !== null))];
  const names = new Map(uploaderIds.length ? (await db().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, uploaderIds))).map((u) => [u.id, u.name]) : []);
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((x): x is number => x !== null))];
  const owners = new Map(
    ownerIds.length ? (await db().select({ id: users.id, name: users.name, employee_code: users.employeeCode, unit: users.unit }).from(users).where(inArray(users.id, ownerIds))).map((u) => [u.id, u]) : [],
  );
  const cats = new Map(catIds.length ? (await db().select().from(fileCategories).where(inArray(fileCategories.id, catIds))).map((c) => [c.id, c.name]) : []);
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    ext: f.ext,
    mime: f.mime,
    size: f.size,
    inline: DOC_TYPES[f.ext]?.inline ?? false,
    folder_id: f.folderId,
    owner_id: f.ownerId,
    owner: f.ownerId !== null ? (owners.get(f.ownerId) ?? null) : null,
    category: f.categoryId !== null && cats.has(f.categoryId) ? { id: f.categoryId, name: cats.get(f.categoryId)! } : null,
    uploaded_by: f.uploadedBy !== null ? (names.get(f.uploadedBy) ?? null) : null,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
  }));
}

/** Multer membaca nama file sebagai latin1; kembalikan ke UTF-8 bila memang UTF-8. */
function originalName(f: UploadFile): string {
  const utf8 = Buffer.from(f.originalname, "latin1").toString("utf8");
  return utf8.includes("�") ? f.originalname : utf8;
}

/** Periksa lalu simpan file unggahan. Semua file diperiksa dulu agar satu file salah tidak menyisakan sebagian. */
export async function storeUploads(list: UploadFile[] | undefined, target: { folderId: number } | { ownerId: number; categoryId: number | null }, by: User): Promise<StoredFile[]> {
  const picked = (list ?? []).filter((f) => f.originalname);
  if (!picked.length) throw new HttpError(422, "Pilih minimal satu file.");
  if (picked.length > MAX_FILES_PER_UPLOAD) throw new HttpError(422, `Maksimal ${MAX_FILES_PER_UPLOAD} file sekali unggah.`);
  const max = settings.MAX_DOCUMENT_MB * 1024 * 1024;
  const checked = picked.map((f) => {
    const name = originalName(f);
    const ext = path.extname(name).toLowerCase();
    const type = DOC_TYPES[ext];
    if (!type) throw new HttpError(422, `${name}: format tidak didukung. Gunakan PDF, JPG, PNG, WEBP, DOCX, XLSX, atau PPTX.`);
    if (f.size > max) throw new HttpError(422, `${name}: ukuran maksimal ${settings.MAX_DOCUMENT_MB} MB.`);
    if (!type.magic.some((m) => f.buffer.subarray(0, m.length).equals(m))) throw new HttpError(422, `${name}: isi file tidak sesuai formatnya.`);
    return { f, ext, mime: type.mime, base: (path.basename(name, path.extname(name)).trim() || "Dokumen").slice(0, 160) };
  });
  const dir = "folderId" in target ? `files/company/${target.folderId}` : `files/users/${target.ownerId}`;
  const ids: number[] = [];
  for (const c of checked) {
    const rel = await saveFile(`${dir}/${randomBytes(8).toString("hex")}${c.ext}`, c.f.buffer);
    const [{ id }] = await db()
      .insert(files)
      .values({
        folderId: "folderId" in target ? target.folderId : null,
        ownerId: "ownerId" in target ? target.ownerId : null,
        categoryId: "ownerId" in target ? target.categoryId : null,
        name: c.base,
        ext: c.ext,
        mime: c.mime,
        size: c.f.size,
        path: rel,
        uploadedBy: by.id,
      })
      .$returningId();
    ids.push(id);
  }
  return db().select().from(files).where(inArray(files.id, ids));
}

/** Jumlah file karyawan per kategori (untuk daftar kategori). */
export async function categoryCounts(): Promise<Map<number, number>> {
  const rows = await db()
    .select({ id: files.categoryId, n: count() })
    .from(files)
    .where(and(isNotNull(files.ownerId), isNotNull(files.categoryId)))
    .groupBy(files.categoryId);
  return new Map(rows.map((r) => [r.id!, Number(r.n)]));
}

/** Nama kategori sudah dipakai (tanpa membedakan huruf besar/kecil). */
export async function categoryNameTaken(name: string, exclude: number | null = null): Promise<boolean> {
  const rows = await db()
    .select({ id: fileCategories.id })
    .from(fileCategories)
    .where(sql`lower(${fileCategories.name}) = ${name.toLowerCase()}`);
  return rows.some((r) => r.id !== exclude);
}

// ------------------------------------------------------------------ pemberitahuan & pengingat

const NOTICE_HOUR = "07:00"; // pengingat terjadwal dikirim mulai pukul 07.00 WIB, bukan tengah malam

/** Karyawan aktif yang termasuk penerima folder (unit & tipe sesuai kriteria). */
export async function folderRecipients(f: FileFolder): Promise<number[]> {
  const conds = [eq(users.role, "staff"), activeUser()];
  if (f.units.length) conds.push(inArray(users.unit, f.units));
  if (f.employmentTypes.length) conds.push(inArray(users.employmentType, f.employmentTypes));
  return (await db().select({ id: users.id }).from(users).where(and(...conds))).map((u) => u.id);
}

const listNames = (names: string[]) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} dan ${names.length - 3} lainnya`);

/** File baru di folder: penerima diberi tahu sekarang, atau saat folder mulai tampil (available_from). */
export async function noticeFolderUpload(f: FileFolder, saved: StoredFile[]): Promise<number> {
  if (f.availableFrom && f.availableFrom > today()) {
    await db().update(fileFolders).set({ notifyPending: true }).where(eq(fileFolders.id, f.id));
    return 0;
  }
  const to = await folderRecipients(f);
  const body = listNames(saved.map((x) => x.name + x.ext));
  for (const uid of to) await notify(uid, "document", `Dokumen baru: ${f.name}`, body, `/documents/${f.id}`);
  return to.length;
}

/** File karyawan baru: pemiliknya diberi tahu (hanya akun karyawan aktif). */
export async function noticeOwnerUpload(owner: User, categoryName: string, saved: StoredFile[]) {
  if (owner.role !== "staff" || owner.isActive === false) return;
  await notify(owner.id, "document", `Dokumen baru: ${categoryName}`, listNames(saved.map((x) => x.name + x.ext)), "/documents?tab=mine");
}

/** Cron: pemberitahuan yang menunggu tanggal tampil dan pengingat yang jatuh tempo. Hasil: [folder diumumkan, pengingat terkirim]. */
export async function sendDueFolderNotices(now: Date = new Date()): Promise<[number, number]> {
  if (localHm(now) < NOTICE_HOUR) return [0, 0];
  const day = today();
  const visible = or(isNull(fileFolders.availableFrom), lte(fileFolders.availableFrom, day))!;
  let announced = 0,
    reminded = 0;
  const pending = await db().select().from(fileFolders).where(and(eq(fileFolders.notifyPending, true), visible));
  for (const f of pending) {
    await db().update(fileFolders).set({ notifyPending: false }).where(eq(fileFolders.id, f.id));
    const names = (await db().select({ n: files.name, e: files.ext }).from(files).where(eq(files.folderId, f.id))).map((x) => x.n + x.e);
    if (!names.length) continue;
    for (const uid of await folderRecipients(f)) await notify(uid, "document", `Dokumen baru: ${f.name}`, listNames(names), `/documents/${f.id}`);
    announced++;
  }
  const due = await db()
    .select()
    .from(fileFolders)
    .where(and(isNotNull(fileFolders.reminderDate), lte(fileFolders.reminderDate, day), isNull(fileFolders.reminderSentAt), visible));
  for (const f of due) {
    await db().update(fileFolders).set({ reminderSentAt: now }).where(eq(fileFolders.id, f.id));
    for (const uid of await folderRecipients(f)) await notify(uid, "document", `Pengingat: ${f.name}`, f.reminderMessage || "Baca dokumen di folder ini.", `/documents/${f.id}`);
    reminded++;
  }
  return [announced, reminded];
}
