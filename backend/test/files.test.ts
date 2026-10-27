/** Tes dokumen lanjutan: pemberitahuan & pengingat, daftar semua file karyawan, rekap Excel, ekspor ZIP. */
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { as, BASE, closeDb, q, TEST_DB, wib } from "./helpers";

// pengingat terjadwal diuji langsung (fungsi cron), selalu terhadap database uji
if (!/abita_test|_test\b/.test(TEST_DB)) throw new Error("TEST_DATABASE_URL harus database uji (mengandung _test).");
process.env.DATABASE_URL = TEST_DB;
const domain = () => import("../src/domain/files");

afterAll(async () => {
  await closeDb();
  const { pool } = await import("../src/db");
  await pool().end();
});

const PDF = "%PDF-1.4\n%%EOF\n";
function upload(names: string[], extra: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  for (const n of names) fd.append("files", new Blob([PDF]), n);
  return fd;
}
type Notif = { title: string; body: string; link: string | null; kind: string };
const notifs = async (c: Awaited<ReturnType<typeof as>>) => (await c.get("/me/notifications?limit=200")).body as Notif[];
const at8 = () => new Date(`${wib(0)}T08:00:00+07:00`);

describe("dokumen: pemberitahuan & pengingat", () => {
  it("unggah ke folder memberi tahu penerima (bisa dimatikan); file karyawan memberi tahu pemiliknya saja", async () => {
    const [sdm, budi, rina] = await Promise.all([as("sdm"), as("budi"), as("rina")]);
    const f = (await sdm.post("/admin/folders", { name: "Notif Farmasi", units: ["Farmasi Rawat Jalan"] })).body;
    expect((await sdm.post(`/admin/folders/${f.id}/files`, upload(["SOP A.pdf", "SOP B.pdf"]))).status).toBe(201);
    const n = (await notifs(budi)).find((x) => x.title === "Dokumen baru: Notif Farmasi");
    expect(n).toMatchObject({ kind: "document", link: `/documents/${f.id}`, body: "SOP A.pdf, SOP B.pdf" });
    expect((await notifs(rina)).some((x) => x.title === "Dokumen baru: Notif Farmasi")).toBe(false); // bukan unit penerima

    const before = (await notifs(budi)).length;
    await sdm.post(`/admin/folders/${f.id}/files`, upload(["Tanpa notif.pdf"], { notify: "false" }));
    expect((await notifs(budi)).length).toBe(before);

    const budiId = (await budi.get("/me")).body.user.id;
    const cat = ((await sdm.get("/admin/file-categories")).body as { id: number; name: string }[]).find((c) => c.name === "Sertifikat")!;
    await sdm.post(`/admin/staff/${budiId}/files`, upload(["BLS.pdf"], { category_id: String(cat.id) }));
    expect((await notifs(budi)).find((x) => x.title === "Dokumen baru: Sertifikat")).toMatchObject({ link: "/documents?tab=mine", body: "BLS.pdf" });
    expect((await notifs(rina)).some((x) => x.title === "Dokumen baru: Sertifikat")).toBe(false);
  });

  it("folder yang tampil nanti: pemberitahuan ditahan sampai tanggal tampil", async () => {
    const [sdm, budi] = await Promise.all([as("sdm"), as("budi")]);
    const f = (await sdm.post("/admin/folders", { name: "Notif Nanti", available_from: wib(1) })).body;
    await sdm.post(`/admin/folders/${f.id}/files`, upload(["Edaran.pdf"]));
    expect((await notifs(budi)).some((x) => x.title === "Dokumen baru: Notif Nanti")).toBe(false);
    expect((await q("SELECT notify_pending p FROM file_folders WHERE id = ?", [f.id]))[0].p).toBe(1);

    const { sendDueFolderNotices } = await domain();
    await q("UPDATE file_folders SET available_from = ? WHERE id = ?", [wib(0), f.id]);
    expect((await sendDueFolderNotices(new Date(`${wib(0)}T06:00:00+07:00`)))[0]).toBe(0); // belum pukul 07.00
    const [announced] = await sendDueFolderNotices(at8());
    expect(announced).toBeGreaterThanOrEqual(1);
    expect((await notifs(budi)).filter((x) => x.title === "Dokumen baru: Notif Nanti")).toHaveLength(1);
    expect((await q("SELECT notify_pending p FROM file_folders WHERE id = ?", [f.id]))[0].p).toBe(0);
  });

  it("pengingat dikirim sekali pada tanggalnya; tanggal lewat / sebelum tanggal tampil ditolak", async () => {
    const [sdm, budi] = await Promise.all([as("sdm"), as("budi")]);
    expect((await sdm.post("/admin/folders", { name: "X", reminder_date: wib(-1) })).status).toBe(422);
    expect((await sdm.post("/admin/folders", { name: "X", available_from: wib(3), reminder_date: wib(2) })).status).toBe(422);
    const f = (await sdm.post("/admin/folders", { name: "Wajib Baca", reminder_date: wib(0), reminder_message: "Baca sebelum akreditasi." })).body;
    expect(f).toMatchObject({ reminder_date: wib(0), reminder_message: "Baca sebelum akreditasi.", reminder_sent: false });

    const { sendDueFolderNotices } = await domain();
    await sendDueFolderNotices(at8());
    await sendDueFolderNotices(at8());
    const got = (await notifs(budi)).filter((x) => x.title === "Pengingat: Wajib Baca");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ body: "Baca sebelum akreditasi.", link: `/documents/${f.id}` });
    expect((await sdm.get(`/admin/folders/${f.id}`)).body.reminder_sent).toBe(true);
  });
});

describe("dokumen: semua file karyawan, rekap, ekspor", () => {
  it("daftar, rekap Excel, dan ZIP mengikuti jangkauan unit", async () => {
    const [sdm, ka, kaIgd, budi] = await Promise.all([as("sdm"), as("kaFarmasi"), as("kaIgd"), as("budi")]);
    const budiId = (await budi.get("/me")).body.user.id;
    const str = ((await sdm.get("/admin/file-categories")).body as { id: number; name: string }[]).find((c) => c.name === "STR / SIP")!;
    await sdm.post(`/admin/staff/${budiId}/files`, upload(["STR Budi.pdf", "STR Budi.pdf"], { category_id: String(str.id), notify: "false" }));

    const mine = (await ka.get("/admin/files")).body as { owner: { id: number; unit: string } }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((f) => f.owner.unit === "Farmasi Rawat Jalan")).toBe(true);
    expect(((await kaIgd.get("/admin/files")).body as { owner_id: number }[]).some((f) => f.owner_id === budiId)).toBe(false);
    expect(((await sdm.get(`/admin/files?q=STR Budi&category_id=${str.id}`)).body as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect((await budi.get("/admin/files")).status).toBe(403);

    const rep = await fetch(`${BASE}/admin/files/report`, { headers: { Cookie: ka.cookie } });
    expect(rep.headers.get("content-type")).toMatch(/spreadsheet/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await rep.arrayBuffer());
    const rows = wb.worksheets[0].getSheetValues().filter(Boolean) as unknown[][];
    const header = rows.find((r) => r.includes("NIK"))!;
    expect(header).toContain("STR / SIP");
    const budiRow = rows.find((r) => r.includes("20260001"))!;
    expect(Number(budiRow[header.indexOf("STR / SIP")])).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.includes("20260003"))).toBe(false); // Rina (IGD) di luar unit Kepala Unit Farmasi

    const zip = await fetch(`${BASE}/admin/files/export?category_id=${str.id}`, { headers: { Cookie: ka.cookie } });
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toMatch(/zip/);
    const buf = Buffer.from(await zip.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const text = buf.toString("latin1");
    expect(text).toContain("20260001 - Budi Santoso/STR _ SIP/STR Budi.pdf");
    expect(text).toContain("20260001 - Budi Santoso/STR _ SIP/STR Budi (2).pdf");
    expect((await kaIgd.get(`/admin/files/export?category_id=${str.id}`)).status).toBe(404);
  });
});

describe("keamanan: IP klien untuk batas laju", () => {
  it("X-Forwarded-For dibaca dari kanan; entri palsu dari klien diabaikan", async () => {
    const { clientIp } = await import("../src/core/ratelimit");
    const h = (v: string) => new Headers({ "x-forwarded-for": v });
    expect(clientIp(h("1.2.3.4"), "203.0.113.9")).toBe("203.0.113.9"); // langsung dari internet: header tidak dipercaya
    expect(clientIp(h("6.6.6.6, 203.0.113.9"), "127.0.0.1")).toBe("203.0.113.9"); // lewat proxy lokal: alamat yang dilihat proxy
    expect(clientIp(h("203.0.113.9, 127.0.0.1"), "127.0.0.1")).toBe("203.0.113.9");
    expect(clientIp(h(""), "127.0.0.1")).toBe("127.0.0.1");
  });
});
