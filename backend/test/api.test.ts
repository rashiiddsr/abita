/** Tes integrasi API (NestJS + MySQL uji): alur utama admin, Kepala Unit, karyawan. */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { as, BASE, Client, closeDb, q, wib } from "./helpers";

afterAll(closeDb);

/** Segel kata sandi sementara seperti domain/password-reset.ts (kunci dari JWT_SECRET yang sama dengan API uji). */
function sealResetPassword(text: string): string {
  const env = fs.existsSync(path.join(__dirname, "..", ".env")) ? fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8") : "";
  const secret = process.env.JWT_SECRET || /^JWT_SECRET=(.*)$/m.exec(env)?.[1]?.trim() || "ganti-dengan-string-acak-panjang";
  const key = crypto.createHash("sha256").update(`${secret}:password-reset`).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

describe("autentikasi & peran", () => {
  it("dasbor hanya untuk Admin SDM / Kepala Unit, aplikasi karyawan hanya untuk staff", async () => {
    const c = new Client();
    expect((await c.post("/auth/web-login", { employee_code: "20260001", password: "budi123" })).status).toBe(422); // dasbor pakai email
    // akun benar di aplikasi yang salah = sama persis dengan kata sandi salah (tidak membocorkan peran akun)
    const wrongApp = await c.post("/auth/web-login", { employee_code: "budi@example.com", password: "budi123" });
    const wrongPw = await c.post("/auth/web-login", { employee_code: "sdm@example.com", password: "salah-sekali1" });
    expect(wrongApp.status).toBe(401);
    expect(wrongApp.body).toEqual(wrongPw.body);
    const kaInApp = await c.post("/auth/app-login", { employee_code: "kepala.farmasi@example.com", password: "kepala123" });
    expect(kaInApp.status).toBe(401);
    expect(kaInApp.body.detail).toBe("Email/NIK atau kata sandi salah.");
    const ok = await c.post("/auth/app-login", { employee_code: "budi@example.com", password: "budi123" });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("staff");
    const me = await c.get("/me");
    expect(me.body.user.employee_code).toBe("20260001");
    expect(me.body.office).not.toBeNull();
    await c.post("/auth/logout");
    expect((await c.get("/me")).status).toBe(401);
  });

  it("endpoint lama sudah dihapus: login token native, alias /api tanpa versi", async () => {
    expect((await new Client().post("/auth/login", { employee_code: "20260003", password: "rina123" })).status).toBe(404);
    const me = await fetch(`${BASE}/me`, { headers: { Authorization: "Bearer apa-saja" } });
    expect(me.status).toBe(401); // hanya cookie sesi
  });

  it("frontend di origin lain: CORS untuk origin terdaftar, situs asing ditolak (CSRF)", async () => {
    const web = new URL(process.env.PUBLIC_APP_URL || "http://localhost:3000").origin;
    const pre = await fetch(`${BASE}/auth/web-login`, { method: "OPTIONS", headers: { Origin: web, "Access-Control-Request-Method": "POST" } });
    expect(pre.headers.get("access-control-allow-origin")).toBe(web);
    expect(pre.headers.get("access-control-allow-credentials")).toBe("true");
    const evil = await fetch(`${BASE}/auth/web-login`, {
      method: "POST",
      headers: { Origin: "https://situs-asing.example", "Content-Type": "application/json" },
      body: JSON.stringify({ employee_code: "sdm@example.com", password: "admin123" }),
    });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("set-cookie")).toBeNull();
    // membaca (GET) dari situs asing tidak diberi izin CORS
    const read = await fetch(`${BASE}/config`, { headers: { Origin: "https://situs-asing.example" } });
    expect(read.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("percobaan masuk dibatasi per akun (10 gagal / 15 menit)", async () => {
    const c = new Client();
    const bad = { employee_code: "tidak.ada@example.com", password: "salah123" };
    for (let i = 0; i < 10; i++) expect((await c.post("/auth/app-login", bad)).status).toBe(401);
    const r = await c.post("/auth/app-login", bad);
    expect(r.status).toBe(429);
    expect(r.body.detail).toMatch(/menit/);
  });

  it("validasi body bergaya FastAPI (422 + loc/msg)", async () => {
    const r = await new Client().post("/auth/web-login", { employee_code: "x" });
    expect(r.status).toBe(422);
    expect(r.body.detail[0].loc).toEqual(["body", "password"]);
  });

  it("matriks akses dasbor", async () => {
    const sdm = await as("sdm");
    const ka = await as("kaFarmasi");
    const budi = await as("budi");
    expect((await budi.get("/admin/users")).status).toBe(403);
    expect((await ka.get("/admin/users?role=manager")).status).toBe(403);
    expect((await ka.get("/admin/smtp")).status).toBe(403);
    expect((await sdm.put("/admin/shifts", { items: [] })).status).toBe(403); // jadwal diubah Kepala Unit
    const staff = await ka.get("/admin/users");
    expect(staff.body.every((u: { unit: string }) => u.unit === "Farmasi Rawat Jalan")).toBe(true);
    const rina = (await sdm.get("/admin/users")).body.find((u: { employee_code: string }) => u.employee_code === "20260003");
    expect((await ka.get(`/admin/staff/${rina.id}`)).status).toBe(403); // unit lain
    expect((await sdm.get(`/admin/staff/${rina.id}`)).status).toBe(200);
  });
});

describe("pengajuan izin", () => {
  it("staff mengajukan, Kepala Unit memutuskan, notifikasi sampai", async () => {
    const budi = await as("budi");
    const ka = await as("kaFarmasi");
    const sdm = await as("sdm");
    const d = wib(9);
    const fd = new FormData();
    fd.append("kind", "izin");
    fd.append("start_date", d);
    fd.append("end_date", d);
    fd.append("reason", "Ujian seminar proposal");
    const r = await budi.post("/me/leaves", fd);
    expect(r.status).toBe(201);
    const id = r.body.id;
    const fd2 = new FormData();
    for (const [k, v] of fd) fd2.append(k, v);
    expect((await budi.post("/me/leaves", fd2)).status).toBe(409); // tanggal bertumpuk
    const kaNotif = await ka.get("/me/notifications");
    expect(kaNotif.body.some((n: { link: string }) => n.link === `/requests/${id}`)).toBe(true);
    const lv = await ka.get(`/admin/leaves/${id}`);
    expect(lv.body.can_review).toBe(true);
    expect((await sdm.post(`/admin/leaves/${id}/review`, { approve: true })).status).toBe(403); // SDM hanya memantau
    const ok = await ka.post(`/admin/leaves/${id}/review`, { approve: true, note: "Semoga lancar" });
    expect(ok.body.status).toBe("approved");
    expect((await ka.post(`/admin/leaves/${id}/review`, { approve: true })).status).toBe(409);
    const notifs = await budi.get("/me/notifications");
    expect(notifs.body[0].title).toMatch(/disetujui/);
    expect(Number(notifs.headers.get("x-total-count"))).toBeGreaterThan(0);
  });

  it("sakit wajib lampiran SKD dan isi file dicek", async () => {
    const budi = await as("budi");
    const fd = new FormData();
    fd.append("kind", "sakit");
    fd.append("start_date", wib(0));
    fd.append("end_date", wib(0));
    fd.append("reason", "Demam tinggi");
    expect((await budi.post("/me/leaves", fd)).status).toBe(422);
    fd.append("attachment", new Blob(["bukan pdf"], { type: "application/pdf" }), "skd.pdf");
    const r = await budi.post("/me/leaves", fd);
    expect(r.status).toBe(422);
    expect(r.body.detail).toMatch(/tidak sesuai/);
  });

  it("setujui / tolak massal: hanya pengajuan di unit Kepala Unit yang diproses", async () => {
    const leave = async (c: Awaited<ReturnType<typeof as>>, day: number) => {
      const fd = new FormData();
      fd.append("kind", "izin");
      fd.append("start_date", wib(day));
      fd.append("end_date", wib(day));
      fd.append("reason", "Keperluan keluarga");
      const r = await c.post("/me/leaves", fd);
      expect(r.status).toBe(201);
      return r.body.id as number;
    };
    const budi = await as("budi");
    const rina = await as("rina");
    const ka = await as("kaFarmasi");
    const [b1, b2, r1] = [await leave(budi, 20), await leave(budi, 22), await leave(rina, 20)];
    const items = [b1, b2, r1].map((id) => ({ kind: "leave", id }));
    expect((await ka.post("/admin/requests/review", { items, approve: false })).status).toBe(200);
    const res = await ka.post("/admin/requests/review", { items: items.slice(0, 1).concat(items.slice(2)), approve: true, note: "Disetujui massal" });
    expect(res.status).toBe(200);
    // b1 sudah ditolak di atas -> 409; rina bukan unit Farmasi -> gagal
    expect(res.body.done).toBe(0);
    expect(res.body.failed).toHaveLength(2);
    expect(res.body.failed[1].label).toMatch(/Rina/);
    const st = await q<{ id: number; status: string }>("SELECT id, status FROM leave_requests WHERE id IN (?, ?, ?) ORDER BY id", [b1, b2, r1]);
    expect(st.map((x) => x.status)).toEqual(["rejected", "rejected", "pending"]);
    expect((await (await as("sdm")).post("/admin/requests/review", { items: [{ kind: "leave", id: r1 }], approve: true })).body.failed[0].error).toMatch(/Kepala Unit/); // SDM hanya memantau
    expect((await (await as("kaIgd")).post("/admin/requests/review", { items: [{ kind: "leave", id: r1 }], approve: true })).body.done).toBe(1);
  });
});

describe("jadwal, tukar shift, pola", () => {
  it("tukar shift: langsung ke Kepala Unit (rekan hanya diberi tahu), disetujui, jadwal berubah", async () => {
    const sdm = await as("sdm");
    const ka = await as("kaFarmasi");
    const budi = await as("budi");
    // rekan baru di unit yang sama
    const created = await sdm.post("/admin/users", {
      employee_code: "20269000",
      name: "Rekan Uji",
      email: "rekan.uji@example.com",
      phone: "+6281200000900",
      role: "staff",
      employment_type: "magang",
      unit: "Farmasi Rawat Jalan",
      institution: "Kampus Uji",
      password: "rekan1234",
    });
    expect(created.status).toBe(201);
    const rekanId = created.body.user.id;
    await q("UPDATE users SET must_change_password = 0 WHERE id = ?", [rekanId]);
    const types = (await ka.get("/admin/shift-types")).body;
    const pagi = types.find((t: { name: string }) => t.name === "Pagi").id;
    const malam = types.find((t: { name: string }) => t.name === "Malam").id;
    const budiId = (await budi.get("/me")).body.user.id;
    const d = wib(3);
    const set = await ka.put("/admin/shifts", {
      items: [
        { user_id: budiId, date: d, shift_type_id: pagi },
        { user_id: rekanId, date: d, shift_type_id: malam },
      ],
    });
    expect(set.status).toBe(200);
    // bulan tujuan harus terbit
    const month = d.slice(0, 7);
    if ((await ka.get(`/admin/schedule?month=${month}`)).body.units[0].status !== "published") expect((await ka.post("/admin/schedule/publish", { month })).status).toBe(200);
    const cands = await budi.get(`/me/swap-candidates?date=${d}`);
    expect(cands.body.map((c: { user_id: number }) => c.user_id)).toContain(rekanId);
    const s = await budi.post("/me/swaps", { date: d, target_user_id: rekanId, reason: "Seminar sertifikasi" });
    expect(s.status).toBe(201);
    expect(s.body.stage).toBe("review"); // tanpa persetujuan rekan
    const rekan = new Client();
    await rekan.post("/auth/app-login", { employee_code: "20269000", password: "rekan1234" });
    const incoming = (await rekan.get("/me/swaps")).body.find((x: { id: number }) => x.id === s.body.id);
    expect(incoming.can_respond).toBe(false);
    expect((await rekan.get("/me/notifications")).body[0].title).toMatch(/mengajukan tukar shift/);
    const approved = await ka.post(`/admin/swaps/${s.body.id}/review`, { approve: true });
    expect(approved.body.status).toBe("approved");
    const after = (await ka.get(`/admin/shifts?from=${d}&to=${d}`)).body;
    expect(after.find((x: { user_id: number }) => x.user_id === budiId).shift.name).toBe("Malam");
    expect(after.find((x: { user_id: number }) => x.user_id === rekanId).shift.name).toBe("Pagi");
  });

  it("Atur jadwal Sampai tanggal: mengisi hari yang terlewat sebelum pola berjalan, pola tetap", async () => {
    const ka = await as("kaFarmasi");
    const budiId = (await (await as("budi")).get("/me")).body.user.id;
    const types = (await ka.get("/admin/shift-types")).body as { id: number; name: string }[];
    const pagi = types.find((t) => t.name === "Pagi")!.id;
    const malam = types.find((t) => t.name === "Malam")!.id;
    const [gap, from] = [wib(20), wib(22)];
    // pola tanpa akhir mulai 22 hari lagi
    expect((await ka.post("/admin/schedule/assign", { user_ids: [budiId], sequence: [malam], start_date: from })).status).toBe(200);
    // tanpa akhir sebelum tanggal efektif terakhir: ditolak dengan petunjuk
    const late = await ka.post("/admin/schedule/assign", { user_ids: [budiId], sequence: [pagi], start_date: gap });
    expect(late.status).toBe(422);
    expect(late.body.detail).toMatch(/Sampai tanggal/);
    // satu hari yang terlewat: isi rentang saja (shift yang berbeda dari isi sekarang)
    type Cell = { user_id: number; date: string; shift: { id: number; name: string } | null };
    const cellsOf = async () => (await ka.get(`/admin/shifts?from=${gap}&to=${wib(24)}`)).body as Cell[];
    const before = (await cellsOf()).find((c) => c.user_id === budiId && c.date === gap)?.shift?.id ?? null;
    const fillType = types.find((t) => t.id !== before && t.id !== malam)!;
    const fill = await ka.post("/admin/schedule/assign", { user_ids: [budiId], sequence: [fillType.id], start_date: gap, end_date: gap });
    expect(fill.status).toBe(200);
    expect(fill.body.updated).toBe(1);
    const cells = await cellsOf();
    const mine = (d: string) => cells.find((c) => c.user_id === budiId && c.date === d)?.shift?.name ?? null;
    expect(mine(gap)).toBe(fillType.name);
    expect(mine(from)).toBe("Malam"); // pola berjalan tidak berubah
    expect(mine(wib(24))).toBe("Malam");
  });

  it("pola global Admin SDM (baca saja bagi Kepala Unit) dan pola per unit", async () => {
    const sdm = await as("sdm");
    const ka = await as("kaFarmasi");
    const kaIgd = await as("kaIgd");
    const types = (await sdm.get("/admin/shift-types")).body;
    const seq = [types[0].id, null];
    const g = await sdm.post("/admin/patterns", { name: "Standar Uji", sequence: seq });
    expect(g.status).toBe(201);
    expect(g.body.unit).toBeNull();
    const f = await ka.post("/admin/patterns", { name: "Farmasi 2-1", sequence: seq });
    expect(f.body.unit).toBe("Farmasi Rawat Jalan");
    expect((await kaIgd.post("/admin/patterns", { name: "standar uji", sequence: seq })).status).toBe(409); // sama dengan pola global
    expect((await ka.put(`/admin/patterns/${g.body.id}`, { name: "x1", sequence: seq })).status).toBe(403);
    const mine = (await ka.get("/admin/patterns")).body;
    expect(mine.find((p: { id: number }) => p.id === g.body.id).editable).toBe(false);
    expect((await ka.del(`/admin/patterns/${f.body.id}`)).status).toBe(204);
  });

  it("hari libur: hanya Admin SDM yang mengubah, tipe tervalidasi", async () => {
    const sdm = await as("sdm");
    const ka = await as("kaFarmasi");
    const h = { date: wib(40), name: "Hari Raya Uji", kind: "nasional" };
    expect((await ka.post("/admin/holidays", h)).status).toBe(403);
    const r = await sdm.post("/admin/holidays", h);
    expect(r.status).toBe(201);
    expect((await sdm.post("/admin/holidays", h)).status).toBe(409);
    expect((await sdm.put(`/admin/holidays/${r.body.id}`, { ...h, kind: "lain" })).status).toBe(422);
    expect((await sdm.put(`/admin/holidays/${r.body.id}`, { ...h, kind: "cuti_bersama" })).body.kind).toBe("cuti_bersama");
  });
});

describe("Web Push (aplikasi karyawan)", () => {
  it("berlangganan, push terenkripsi terkirim setelah notifikasi, langganan kedaluwarsa (410) dihapus", async () => {
    // layanan push palsu: catat permintaan; /gone/* membalas 410
    const got: { url: string; headers: http.IncomingHttpHeaders; bytes: number }[] = [];
    const srv = http.createServer((req, res) => {
      let n = 0;
      req.on("data", (c: Buffer) => (n += c.length));
      req.on("end", () => {
        got.push({ url: req.url ?? "", headers: req.headers, bytes: n });
        res.writeHead(req.url?.startsWith("/gone/") ? 410 : 201).end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    const keys = () => {
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.generateKeys();
      return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
    };
    try {
      const budi = await as("budi");
      expect((await (await as("sdm")).get("/me/push")).status).toBe(403); // hanya akun karyawan
      const cfg = await budi.get("/me/push");
      expect(cfg.status).toBe(200);
      expect(cfg.body.public_key).toMatch(/^[A-Za-z0-9_-]{80,}$/);
      const ok = `http://127.0.0.1:${port}/push/budi-hp`;
      const gone = `http://127.0.0.1:${port}/gone/budi-lama`;
      expect((await budi.post("/me/push", { endpoint: ok, keys: keys() })).status).toBe(204);
      expect((await budi.post("/me/push", { endpoint: gone, keys: keys() })).status).toBe(204);
      expect((await budi.get("/me/push")).body.devices).toBe(2);
      expect((await budi.post("/me/push/test")).status).toBe(404); // endpoint notifikasi uji telah dihapus
      // notifikasi (koreksi absensi oleh Kepala Unit) dikirim sebagai push ke setiap perangkat terdaftar
      const budiId = (await budi.get("/me")).body.user.id;
      expect((await (await as("kaFarmasi")).post("/admin/attendance/correct", { user_id: budiId, date: wib(-3), check_in: "07:00", reason: "Uji push koreksi" })).status).toBe(200);
      for (let i = 0; i < 30 && !got.some((g) => g.url === "/push/budi-hp"); i++) await new Promise((r) => setTimeout(r, 100));
      const push = got.find((g) => g.url === "/push/budi-hp")!;
      expect(push.headers["content-encoding"]).toBe("aes128gcm");
      expect(String(push.headers.authorization)).toMatch(/^vapid t=.+, k=/);
      expect(push.bytes).toBeGreaterThan(100); // isi terenkripsi
      let devices = 2;
      for (let i = 0; i < 30 && devices !== 1; i++) {
        await new Promise((r) => setTimeout(r, 100));
        devices = (await budi.get("/me/push")).body.devices;
      }
      expect(devices).toBe(1); // endpoint 410 dihapus
      expect((await budi.post("/me/push/unsubscribe", { endpoint: ok })).status).toBe(204);
      expect((await budi.get("/me/push")).body.devices).toBe(0);
    } finally {
      srv.close();
    }
  });
});

describe("satu tanggal satu keadaan: absensi, izin/sakit, tukar shift", () => {
  const H = 3600_000;
  const hhmm = (ms: number) => new Date(ms + 7 * H).toISOString().slice(11, 16);
  const form = (kind: string, d: string, skd = false) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("start_date", d);
    fd.append("end_date", d);
    fd.append("reason", "Keperluan mendesak");
    if (skd) fd.append("attachment", new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" }), "skd.pdf");
    return fd;
  };

  it("izin/sakit, check in, persetujuan, koreksi, dan tukar shift saling menjaga", async () => {
    const budi = await as("budi");
    const ka = await as("kaFarmasi");
    const uid = (await budi.get("/me")).body.user.id;
    const [d0, d12, d14] = [wib(0), wib(12), wib(14)];
    await q("UPDATE users SET face_embedding = ? WHERE id = ? AND face_embedding IS NULL", [Buffer.alloc(2048), uid]);
    const reset = async () => {
      await q("DELETE FROM attendances WHERE user_id = ? AND work_date IN (?, ?, ?)", [uid, d0, d12, d14]);
      await q("DELETE FROM shift_assignments WHERE user_id = ? AND date = ?", [uid, d0]);
      await q("DELETE FROM leave_requests WHERE user_id = ? AND start_date IN (?, ?, ?)", [uid, d0, d12, d14]);
    };
    // shift hari ini yang mulai 30 menit lalu (jendela check in masih buka)
    const start = Date.now() - 0.5 * H;
    const name = `UJI KONFLIK ${hhmm(start)}`;
    await q("INSERT INTO shift_types (name, start_time, end_time, color, active) VALUES (?, ?, ?, NULL, 1)", [name, `${hhmm(start)}:00`, `${hhmm(start + 8 * H)}:00`]);
    const [t] = await q<{ id: number }>("SELECT id FROM shift_types WHERE name = ? ORDER BY id DESC LIMIT 1", [name]);
    try {
      await reset();
      await q("INSERT INTO shift_assignments (user_id, date, shift_type_id, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP())", [uid, d0, t.id]);

      // izin hari ini setelah shift dimulai ditolak (ketidakhadiran tidak bisa diubah menjadi izin)
      const late = await budi.post("/me/leaves", form("izin", d0));
      expect(late.status).toBe(422);
      expect(late.body.detail).toMatch(/sebelum shift/);

      // sudah check in -> sakit untuk hari itu ditolak
      await q("INSERT INTO attendances (user_id, work_date, type, checked_at, late_minutes, source) VALUES (?, ?, 'in', ?, 0, 'manual')", [uid, d0, new Date(start)]);
      const sick = await budi.post("/me/leaves", form("sakit", d0, true));
      expect(sick.status).toBe(409);
      expect(sick.body.detail).toMatch(/sudah absen/);

      // tukar shift untuk hari yang sudah diabsen ditolak
      const swap = await budi.post("/me/swaps", { date: d0, target_user_id: uid + 1, reason: "Ada keperluan" });
      expect(swap.status).toBe(409);
      expect(swap.body.detail).toMatch(/sudah absen|sudah dimulai/);

      // izin/sakit disetujui -> check in hari itu ditolak (ON_LEAVE)
      await q("DELETE FROM attendances WHERE user_id = ? AND work_date = ?", [uid, d0]);
      await q("INSERT INTO leave_requests (user_id, kind, start_date, end_date, reason, status) VALUES (?, 'sakit', ?, ?, 'Uji', 'approved')", [uid, d0, d0]);
      const sess = await budi.post("/sessions", { purpose: "in" });
      expect(sess.body.detail?.reason_code).toBe("ON_LEAVE");
      // ... dan Kepala Unit tidak bisa mengoreksi absensi tanggal itu
      const corr = await ka.post("/admin/attendance/correct", { user_id: uid, date: d0, check_in: "07:00", reason: "Uji koreksi" });
      expect(corr.status).toBe(409);
      expect(corr.body.detail).toMatch(/disetujui/);

      // pengajuan menunggu, lalu karyawan sempat absen -> persetujuan ditolak, penolakan tetap bisa
      const p = await budi.post("/me/leaves", form("izin", d12));
      expect(p.status).toBe(201);
      await q("INSERT INTO attendances (user_id, work_date, type, checked_at, late_minutes, source) VALUES (?, ?, 'in', UTC_TIMESTAMP(), 0, 'manual')", [uid, d12]);
      const approve = await ka.post(`/admin/leaves/${p.body.id}/review`, { approve: true });
      expect(approve.status).toBe(409);
      expect(approve.body.detail).toMatch(/sudah absen/);
      expect((await ka.post(`/admin/leaves/${p.body.id}/review`, { approve: false, note: "Sudah masuk kerja" })).body.status).toBe("rejected");

      // karyawan membatalkan izin sendiri (menunggu); pembatalan kedua ditolak
      const c = await budi.post("/me/leaves", form("izin", d14));
      expect(c.status).toBe(201);
      const cancel = await budi.post(`/me/leaves/${c.body.id}/cancel`);
      expect(cancel.status).toBe(200);
      expect(cancel.body.status).toBe("cancelled");
      expect((await budi.post(`/me/leaves/${c.body.id}/cancel`)).status).toBe(409);
      // tanggal yang dibatalkan bisa diajukan lagi
      expect((await budi.post("/me/leaves", form("izin", d14))).status).toBe(201);
    } finally {
      await reset();
      await q("DELETE FROM shift_types WHERE id = ?", [t.id]);
    }
  });
});

describe("jendela absen, tanpa absen pulang, shift yang sudah mulai", () => {
  const H = 3600_000;
  const wibOf = (ms: number) => new Date(ms + 7 * H).toISOString();
  const hhmm = (ms: number) => wibOf(ms).slice(11, 16);
  const dayOf = (ms: number) => wibOf(ms).slice(0, 10);
  const hour = new Date(Date.now() + 7 * H).getUTCHours();

  it("check in 2 jam sebelum s.d. 1 jam sesudah mulai; check out 1 jam sebelum s.d. 2 jam sesudah selesai", async () => {
    const budi = await as("budi");
    const uid = (await budi.get("/me")).body.user.id;
    await q("UPDATE users SET face_embedding = ? WHERE id = ? AND face_embedding IS NULL", [Buffer.alloc(2048), uid]);
    const days = [wib(-1), wib(0), wib(1)];
    const reset = async () => {
      await q("DELETE FROM attendances WHERE user_id = ? AND work_date IN (?, ?, ?)", [uid, ...days]);
      await q("DELETE FROM shift_assignments WHERE user_id = ? AND date IN (?, ?, ?)", [uid, ...days]);
    };
    // shift 8 jam yang mulai pada instan startMs (tanggal kerja = tanggal mulainya, WIB)
    const shiftAt = async (startMs: number, checkedIn = false) => {
      await reset();
      const name = `UJI ${hhmm(startMs)}`;
      await q("INSERT INTO shift_types (name, start_time, end_time, color, active) VALUES (?, ?, ?, NULL, 1)", [name, `${hhmm(startMs)}:00`, `${hhmm(startMs + 8 * H)}:00`]);
      const [t] = await q<{ id: number }>("SELECT id FROM shift_types WHERE name = ? ORDER BY id DESC LIMIT 1", [name]);
      await q("INSERT INTO shift_assignments (user_id, date, shift_type_id, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP())", [uid, dayOf(startMs), t.id]);
      if (checkedIn) await q("INSERT INTO attendances (user_id, work_date, type, checked_at, late_minutes, source) VALUES (?, ?, 'in', ?, 0, 'manual')", [uid, dayOf(startMs), new Date(startMs)]);
      return t.id;
    };
    const tryAbsen = async (purpose: "in" | "out") => {
      const r = await budi.post("/sessions", { purpose });
      return r.status === 200 ? "OK" : (r.body.detail?.reason_code as string);
    };
    const now = Date.now();
    // "belum dibuka" / "sudah tutup" hanya bisa diuji bila shift itu jatuh pada tanggal hari ini (bukan lewat tengah malam)
    const today = (ms: number) => dayOf(ms) === dayOf(now);
    try {
      if (today(now + 3 * H)) {
        await shiftAt(now + 3 * H);
        expect(await tryAbsen("in")).toBe("CHECKIN_NOT_OPEN");
        expect((await budi.post("/sessions", { purpose: "in" })).body.detail.message).toMatch(/dibuka/);
      }
      await shiftAt(now - 0.5 * H);
      expect(await tryAbsen("in")).toBe("OK");
      expect((await budi.get("/me")).body.today.window.in_close).toBeTruthy();
      if (today(now - 2 * H)) {
        await shiftAt(now - 2 * H);
        expect(await tryAbsen("in")).toBe("CHECKIN_CLOSED");
      }
      // check out (sudah check in): selesai 3 jam lagi -> belum dibuka; selesai 30 mnt lalu -> boleh; selesai 3 jam lalu -> tutup
      await shiftAt(now - 5 * H, true);
      expect(await tryAbsen("out")).toBe("CHECKOUT_NOT_OPEN");
      await shiftAt(now - 8.5 * H, true);
      expect(await tryAbsen("out")).toBe("OK");
      const start = now - 11 * H;
      await shiftAt(start, true);
      expect(await tryAbsen("out")).toBe("CHECKOUT_CLOSED");
      // hari itu berstatus "tanpa_pulang" di dasbor, selisih check in = 0 menit
      const ka = await as("kaFarmasi");
      const d = (await ka.get(`/admin/daily/${uid}?date=${dayOf(start)}`)).body.row;
      expect(d.status).toBe("tanpa_pulang");
      expect(d.in_diff_min).toBe(0);
      expect(d.out_diff_min).toBeNull();
    } finally {
      await reset();
      await q("DELETE FROM shift_types WHERE name LIKE 'UJI %'");
    }
  });

  it.skipIf(hour < 3 || hour > 19)("Kepala Unit tidak bisa memasang / mengganti shift hari ini yang sudah mulai", async () => {
    const ka = await as("kaFarmasi");
    const uid = (await (await as("budi")).get("/me")).body.user.id;
    const now = Date.now();
    const d = wib(0);
    await q("DELETE FROM attendances WHERE user_id = ? AND work_date = ?", [uid, d]);
    await q("DELETE FROM shift_assignments WHERE user_id = ? AND date = ?", [uid, d]);
    await q("INSERT INTO shift_types (name, start_time, end_time, color, active) VALUES ('UJI lewat', ?, ?, NULL, 1), ('UJI nanti', ?, ?, NULL, 1)", [
      `${hhmm(now - H)}:00`,
      `${hhmm(now + 7 * H)}:00`,
      `${hhmm(now + 2 * H)}:00`,
      `${hhmm(now + 4 * H)}:00`,
    ]);
    const ids = Object.fromEntries((await q<{ id: number; name: string }>("SELECT id, name FROM shift_types WHERE name LIKE 'UJI %'")).map((r) => [r.name, r.id]));
    try {
      const put = async (shift_type_id: number | null) => (await ka.put("/admin/shifts", { items: [{ user_id: uid, date: d, shift_type_id }] })).body as { updated: number; skipped: number };
      expect(await put(ids["UJI lewat"])).toEqual({ updated: 0, skipped: 1 }); // mendadak: jam mulai sudah lewat
      expect(await put(ids["UJI nanti"])).toEqual({ updated: 1, skipped: 0 }); // shift berikutnya masih boleh
      await q("UPDATE shift_assignments SET shift_type_id = ? WHERE user_id = ? AND date = ?", [ids["UJI lewat"], uid, d]);
      expect(await put(null)).toEqual({ updated: 0, skipped: 1 }); // shift yang sedang berjalan tidak bisa dihapus / diganti
    } finally {
      await q("DELETE FROM shift_assignments WHERE user_id = ? AND date = ?", [uid, d]);
      await q("DELETE FROM shift_types WHERE name LIKE 'UJI %'");
    }
  });
});

describe("koreksi absensi (Kepala Unit)", () => {
  it("Kepala Unit mengisi/mengubah jam, tercatat manual + riwayat + notifikasi; SDM & unit lain ditolak", async () => {
    const ka = await as("kaFarmasi");
    const budi = await as("budi");
    const budiId = (await budi.get("/me")).body.user.id;
    const d = wib(-2);
    const body = { user_id: budiId, date: d, check_in: "07:05", check_out: "15:10", reason: "Lupa absen, dikonfirmasi rekan" };
    expect((await (await as("sdm")).post("/admin/attendance/correct", body)).status).toBe(403); // SDM hanya memantau
    expect((await (await as("kaIgd")).post("/admin/attendance/correct", body)).status).toBe(403); // bukan unitnya
    expect((await ka.post("/admin/attendance/correct", { ...body, reason: "x" })).status).toBe(422);
    expect((await ka.post("/admin/attendance/correct", { ...body, date: wib(1) })).status).toBe(422); // belum terjadi
    const r = await ka.post("/admin/attendance/correct", body);
    expect(r.status).toBe(200);
    expect(r.body.row.check_in).toBe("07:05");
    expect(r.body.row.check_out).toBe("15:10");
    expect(r.body.records.every((x: { manual: boolean }) => x.manual)).toBe(true);
    expect(r.body.logs.map((l: { detail: { type: string; after: string } }) => `${l.detail.type}:${l.detail.after}`).sort()).toEqual(["in:07:05", "out:15:10"]);
    // ubah check out saja; lebih awal dari check in = keesokan harinya (shift malam)
    const night = await ka.post("/admin/attendance/correct", { user_id: budiId, date: d, check_out: "06:30", reason: "Shift malam, pulang pagi" });
    expect(night.status).toBe(200);
    const out = night.body.records.find((x: { type: string }) => x.type === "out");
    expect(out.time).toBe("06:30");
    expect(new Date(out.checked_at).getTime()).toBeGreaterThan(new Date(night.body.records.find((x: { type: string }) => x.type === "in").checked_at).getTime());
    const notif = (await budi.get("/me/notifications")).body[0];
    expect(notif.title).toMatch(/dikoreksi/);
    expect(notif.body).toMatch(/Shift malam, pulang pagi/);
  });
});

describe("karyawan massal & laporan", () => {
  it("aktif / nonaktif massal akun admin; akun sendiri ditolak", async () => {
    const sdm = await as("sdm");
    const mk = await sdm.post("/admin/users", {
      employee_code: "massal.uji@example.com",
      email: "massal.uji@example.com",
      name: "Admin Massal",
      phone: "+6281200000912",
      role: "admin",
      employment_type: "tetap",
    });
    expect(mk.status).toBe(201);
    expect(mk.body.credentials.temp_password).toBeTruthy(); // kata sandi selalu tampil sekali di dasbor
    const selfId = (await sdm.get("/me")).body.user.id;
    const off = await sdm.post("/admin/users/bulk-status", { user_ids: [mk.body.user.id, selfId], is_active: false });
    expect(off.status).toBe(200);
    expect(off.body.done).toBe(1);
    expect(off.body.failed[0].id).toBe(selfId);
    expect((await new Client().post("/auth/web-login", { employee_code: "massal.uji@example.com", password: mk.body.credentials.temp_password })).status).toBe(403); // akun nonaktif
    expect((await sdm.post("/admin/users/bulk-status", { user_ids: [mk.body.user.id], is_active: true })).body.done).toBe(1);
    expect((await sdm.post("/admin/users/bulk-reset-password", { user_ids: [selfId] })).status).toBe(400);
    expect((await (await as("kaFarmasi")).post("/admin/users/bulk-status", { user_ids: [mk.body.user.id], is_active: false })).status).toBe(403);
  });

  it("ekspor Excel lalu impor ulang = tidak ada perubahan", async () => {
    const sdm = await as("sdm");
    // kolom wajib di template: nomor HP (data seed belum punya)
    const rina = (await sdm.get("/admin/users")).body.find((u: { employee_code: string }) => u.employee_code === "20260003");
    expect((await sdm.put(`/admin/users/${rina.id}`, { phone: "+6281277770003" })).status).toBe(200);
    const ex = await fetch(`${BASE}/admin/staff/export?unit=IGD`, { headers: { Cookie: sdm.cookie, "X-Forwarded-For": sdm.ip } });
    expect(ex.status).toBe(200);
    const buf = Buffer.from(await ex.arrayBuffer());
    const fd = new FormData();
    fd.append("file", new Blob([buf]), "k.xlsx");
    const r = await sdm.post("/admin/staff/import", fd);
    expect(r.status).toBe(200);
    expect([r.body.created, r.body.updated, r.body.errors]).toEqual([0, 0, []]);
    expect(r.body.unchanged).toBeGreaterThan(0);
  });

  it("laporan & ekspor tersimpan di riwayat", async () => {
    const ka = await as("kaFarmasi");
    for (const tab of ["hadir", "req", "jadwal", "kr"]) expect((await ka.get(`/admin/reports?tab=${tab}`)).status).toBe(200);
    const ex = await ka.post("/admin/reports/export", { tab: "hadir", format: "pdf" });
    expect(ex.body.ready).toBe(true);
    const list = (await ka.get("/admin/reports/exports")).body;
    expect(list[0].id).toBe(ex.body.id);
  });
});

describe("verifikasi wajah (model ONNX sungguhan)", () => {
  const photo = path.resolve(__dirname, "fixtures/face.jpg"); // foto uji (bukan data produksi)
  it("frame hadap-depan semua -> gerakan toleh tidak sesuai (pipeline jalan)", async () => {
    const rina = await as("rina");
    const s = await rina.post("/sessions", { purpose: "enroll" });
    expect(s.status).toBe(200);
    expect(s.body.challenges).toEqual(["center", "turn_left", "turn_right", "center"]);
    const fd = new FormData();
    const img = fs.readFileSync(photo);
    for (let i = 0; i < 4; i++) fd.append("frames", new Blob([img], { type: "image/jpeg" }), `f${i}.jpg`);
    fd.append("meta", "{}");
    const r = await rina.post(`/sessions/${s.body.session_id}/submit`, fd);
    expect(r.status).toBe(200);
    expect(r.body.reason_code).toBe("CHALLENGE_MISMATCH");
    expect(r.body.scores.frames[0].faces).toBe(1);
    expect(r.body.scores.frames[0].det_score).toBeGreaterThan(0.9);
    expect((await rina.post(`/sessions/${s.body.session_id}/submit`, fd)).body.reason_code).toBe("SESSION_USED");
  });
});

describe("real-time (SSE)", () => {
  it("perubahan jadwal oleh Kepala Unit sampai ke Admin SDM", async () => {
    const sdm = await as("sdm");
    const ka = await as("kaFarmasi");
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/events`, { headers: { Cookie: sdm.cookie }, signal: ctrl.signal });
    expect(res.headers.get("content-type")).toMatch(/event-stream/);
    const reader = res.body!.getReader();
    let text = "";
    const read = (async () => {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
        if (text.includes('"topic":"schedule"')) break;
      }
    })();
    await new Promise((r) => setTimeout(r, 300));
    await ka.put("/admin/shifts", { items: [] });
    await Promise.race([read, new Promise((r) => setTimeout(r, 3000))]);
    ctrl.abort();
    expect(text).toContain("event: ready");
    expect(text).toContain('"unit":"Farmasi Rawat Jalan"');
  });

  it("tersambung ulang: event terlewat dikirim ulang tanpa reset; id dari sebelum API dimulai = reset", async () => {
    const sdm = await as("sdm");
    const ka = await as("kaFarmasi");
    // baca aliran sampai event "ready" (berisi id kursor)
    const head = async (last?: string) => {
      const ctrl = new AbortController();
      const res = await fetch(`${BASE}/events`, { headers: { Cookie: sdm.cookie, ...(last ? { "Last-Event-ID": last } : {}) }, signal: ctrl.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let text = "";
      while (!text.includes("event: ready")) text += dec.decode((await reader.read()).value);
      ctrl.abort();
      return { text, cursor: /id: (\d+)\nevent: ready/.exec(text)![1] };
    };
    const first = await head();
    expect(first.text).not.toContain("event: reset");
    await ka.put("/admin/shifts", { items: [] }); // terjadi saat "terputus"
    const again = await head(first.cursor);
    expect(again.text).not.toContain("event: reset");
    expect(again.text).toContain('"topic":"schedule"');
    expect(again.cursor > first.cursor).toBe(true);
    expect((await head("000000000000001001")).text).toContain("event: reset");
  });
});

describe("NIK, lupa kata sandi karyawan, Kepala Unit 2 unit", () => {
  it("NIK karyawan hanya angka", async () => {
    const sdm = await as("sdm");
    const base = { name: "NIK Uji", phone: "+6281200000911", role: "staff", employment_type: "magang", unit: "IGD", institution: "Kampus Uji", password: "nikuji123" };
    const bad = await sdm.post("/admin/users", { ...base, employee_code: "2026.BT.01", email: "nik.uji@example.com" });
    expect(bad.status).toBe(422);
    expect(bad.body.detail[0].loc).toEqual(["body", "employee_code"]);
    expect((await sdm.post("/admin/users", { ...base, employee_code: "20269011", email: "nik.uji@example.com" })).status).toBe(201);
  });

  it("lupa kata sandi: email tak terdaftar ditolak; kata sandi baru lewat antrean, dikirim ulang sama, dibatasi 2 menit & 3x/24 jam", async () => {
    const c = new Client();
    const rows = (email: string) =>
      q<{ id: number; kind: string; token_hash: string; used_at: string | null }>(
        "SELECT r.id, r.kind, r.token_hash, r.used_at FROM password_resets r JOIN users u ON u.id = r.user_id WHERE u.email = ? AND r.kind LIKE 'pw%' ORDER BY r.id",
        [email],
      );
    const unknown = await c.post("/auth/app-forgot", { identifier: "tidak.ada@example.com" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.detail).toBe("Email tidak ditemukan.");
    expect((await c.post("/auth/app-forgot", { identifier: "sdm@example.com" })).status).toBe(404); // akun admin: bukan aplikasi karyawan
    expect((await c.post("/auth/forgot", { identifier: "budi@example.com" })).status).toBe(404); // dasbor hanya Admin SDM / Kepala Unit
    expect(await rows("sdm@example.com")).toHaveLength(0);

    const [u] = await q<{ id: number }>("SELECT id FROM users WHERE email = ?", ["nik.uji@example.com"]);
    // waktu permintaan sebelumnya dimundurkan (pengganti menunggu 2 menit)
    const later = () => q("UPDATE audit_logs SET created_at = DATE_SUB(created_at, INTERVAL 3 MINUTE) WHERE action = 'password_forgot' AND target_id = ?", [u.id]);
    expect((await c.post("/auth/app-forgot", { identifier: "nik.uji@example.com" })).status).toBe(200);
    const first = await rows("nik.uji@example.com");
    expect(first).toHaveLength(1); // masuk antrean (dikirim di latar belakang + cron)
    const gap = await c.post("/auth/app-forgot", { identifier: "nik.uji@example.com" });
    expect(gap.status).toBe(429);
    expect(gap.body.detail).toMatch(/2 menit/);

    // anggap email pertama terkirim berisi "KataBaru123" (disegel dengan kunci yang sama seperti API)
    const sealed = sealResetPassword("KataBaru123");
    await q("UPDATE password_resets SET kind = 'pw', token_hash = ? WHERE id = ?", [sealed, first[0].id]);
    // kata sandi lama tetap berlaku: orang lain yang menekan "Lupa kata sandi" tidak mengunci akun
    const old = await new Client().post("/auth/app-login", { employee_code: "20269011", password: "nikuji123" });
    expect(old.status).toBe(200);
    await later();
    expect((await c.post("/auth/app-forgot", { identifier: "nik.uji@example.com" })).status).toBe(200);
    const again = await rows("nik.uji@example.com");
    expect(again).toHaveLength(1); // permintaan ulang = kata sandi yang SAMA dikirim lagi
    expect(again[0].id).toBe(first[0].id);
    expect(again[0].token_hash).toBe(sealed);
    expect(again[0].kind).not.toBe("pw");
    await later();
    expect((await c.post("/auth/app-forgot", { identifier: "nik.uji@example.com" })).status).toBe(200);
    await later();
    const daily = await c.post("/auth/app-forgot", { identifier: "nik.uji@example.com" });
    expect(daily.status).toBe(429);
    expect(daily.body.detail).toMatch(/3 permintaan per 24 jam/);

    // masuk dengan kata sandi baru -> wajib membuat kata sandi sendiri; setelahnya kata sandi dari email tidak dikirim ulang
    const app = new Client();
    const login = await app.post("/auth/app-login", { employee_code: "20269011", password: "KataBaru123" });
    expect(login.status).toBe(200);
    expect(login.body.must_change_password).toBe(true);
    expect((await app.get("/me/summary")).status).toBe(403);
    expect((await app.post("/me/password", { old_password: "KataBaru123", new_password: "Sendiri12345" })).status).toBe(204);
    expect((await rows("nik.uji@example.com")).every((r) => r.used_at !== null)).toBe(true);
    expect((await new Client().post("/auth/app-login", { employee_code: "20269011", password: "nikuji123" })).status).toBe(401); // kata sandi lama berakhir setelah kata sandi sementara dipakai
    expect((await new Client().post("/auth/app-login", { employee_code: "20269011", password: "Sendiri12345" })).body.must_change_password).toBe(false);
  });

  it("satu unit bisa punya beberapa Kepala Unit; satu Kepala Unit bisa memimpin banyak unit", async () => {
    const sdm = await as("sdm");
    type U = { id: number; name: string; heads: { id: number; name: string }[]; head_name: string | null };
    const units = (await sdm.get("/admin/units")).body as U[];
    const rm = units.find((u) => u.name === "Rekam Medis")!;
    const igd = units.find((u) => u.name === "IGD")!;
    expect(rm.heads.map((h) => h.name)).toEqual(["Dewi Anggraini"]);
    const kaId = (await (await as("kaFarmasi")).get("/me")).body.user.id;
    // Kepala Farmasi ditambahkan ke Rekam Medis; kepala lama (Dewi) tetap
    const both = await sdm.put(`/admin/units/${rm.id}`, { name: rm.name, head_user_ids: [...rm.heads.map((h) => h.id), kaId] });
    expect(both.status).toBe(200);
    expect((both.body as U).heads.map((h) => h.name).sort()).toEqual(["Dewi Anggraini", "apt. Lina Marpaung"]);
    expect((both.body as U).head_name).toContain(", ");
    const dewi = new Client();
    expect((await dewi.post("/auth/web-login", { employee_code: "kepala.rm@example.com", password: "kepala123" })).status).toBe(200);
    expect((await dewi.get("/me")).body.user.head_units).toEqual(["Rekam Medis"]);
    const ka = await as("kaFarmasi");
    expect((await ka.get("/me")).body.user.head_units).toEqual(["Farmasi Rawat Jalan", "Rekam Medis"]);
    const staffUnits = new Set(((await ka.get("/admin/users")).body as { unit: string }[]).map((u) => u.unit));
    expect([...staffUnits].sort()).toEqual(["Farmasi Rawat Jalan", "Rekam Medis"]);
    // tanpa pilihan unit = semua unit yang dipimpin (panel "Semua unit")
    const idx = (await ka.get("/admin/schedule/index")).body as { unit: string }[];
    expect([...new Set(idx.map((r) => r.unit))].sort()).toEqual(["Farmasi Rawat Jalan", "Rekam Medis"]);
    expect((await ka.get("/admin/dashboard")).status).toBe(200);
    expect(((await ka.get("/admin/units")).body as unknown[]).length).toBe(2);
    expect((await ka.get("/admin/schedule/index?unit=Rekam%20Medis")).body.every((r: { unit: string }) => r.unit === "Rekam Medis")).toBe(true);
    // pengajuan staff Rekam Medis bisa diputuskan kedua kepala
    const fd = new FormData();
    fd.append("kind", "izin");
    fd.append("start_date", wib(40));
    fd.append("end_date", wib(40));
    fd.append("reason", "Uji dua kepala");
    const siti = new Client();
    await siti.post("/auth/app-login", { employee_code: "20260002", password: "siti123" });
    const lv = await siti.post("/me/leaves", fd);
    expect(lv.status).toBe(201);
    expect((await ka.get(`/admin/leaves/${lv.body.id}`)).body.can_review).toBe(true);
    expect((await dewi.get(`/admin/leaves/${lv.body.id}`)).body.can_review).toBe(true);
    // tanpa batas: unit ketiga untuk Kepala Farmasi juga boleh
    const third = await sdm.put(`/admin/units/${igd.id}`, { name: igd.name, head_user_ids: [...igd.heads.map((h) => h.id), kaId] });
    expect(third.status).toBe(200);
    expect((await (await as("kaFarmasi")).get("/me")).body.user.head_units).toEqual(["Farmasi Rawat Jalan", "IGD", "Rekam Medis"]);
    expect((await sdm.put(`/admin/units/${igd.id}`, { name: igd.name, head_user_ids: igd.heads.map((h) => h.id) })).status).toBe(200);
    // unit baru wajib punya Kepala Unit; akun Admin SDM bukan Kepala Unit
    expect((await sdm.post("/admin/units", { name: "Unit Tanpa Kepala" })).status).toBe(422);
    const sdmId = (await sdm.get("/me")).body.user.id;
    expect((await sdm.post("/admin/units", { name: "Unit Salah Kepala", head_user_ids: [sdmId] })).status).toBe(422);
    // kembalikan seperti semula
    expect((await sdm.put(`/admin/units/${rm.id}`, { name: rm.name, head_user_ids: rm.heads.map((h) => h.id) })).status).toBe(200);
    expect((await (await as("kaFarmasi")).get("/me")).body.user.head_units).toEqual(["Farmasi Rawat Jalan"]);
  });
});

describe("aplikasi karyawan: rekap sendiri & profil", () => {
  it("rekap kehadiran sendiri + unduh PDF/Excel", async () => {
    const budi = await as("budi");
    const from = wib(-30);
    const to = wib(0);
    const r = await budi.get(`/me/recap?from=${from}&to=${to}`);
    expect(r.status).toBe(200);
    expect(r.body.start).toBe(from);
    expect(r.body.present).toBe(r.body.on_time + r.body.late);
    expect(Array.isArray(r.body.days)).toBe(true);
    expect((await budi.get(`/me/recap?from=${to}&to=${from}`)).status).toBe(422);
    const pdf = await fetch(`${BASE}/me/recap/export?from=${from}&to=${to}`, { headers: { Cookie: budi.cookie } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toMatch(/pdf/);
    expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(500);
    const xlsx = await fetch(`${BASE}/me/recap/export?from=${from}&to=${to}&format=xlsx`, { headers: { Cookie: budi.cookie } });
    expect(xlsx.headers.get("content-type")).toMatch(/spreadsheet/);
  });

  it("nama karyawan tidak bisa diubah sendiri; email & HP bisa", async () => {
    const budi = await as("budi");
    const me = (await budi.get("/me")).body.user;
    expect((await budi.put("/me/profile", { name: "Nama Baru", email: me.email, phone: me.phone })).status).toBe(403);
    const ok = await budi.put("/me/profile", { email: me.email, phone: "+6281299990001" });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe(me.name);
    expect(ok.body.phone).toBe("+6281299990001");
  });
});

describe("dokumen: file perusahaan & file karyawan", () => {
  const PDF = "%PDF-1.4\n%%EOF\n";
  const upload = (blobs: [string, string][], category?: number) => {
    const fd = new FormData();
    if (category !== undefined) fd.append("category_id", String(category));
    for (const [content, name] of blobs) fd.append("files", new Blob([content]), name);
    return fd;
  };
  const tomorrow = () => wib(1);

  it("file perusahaan: Admin SDM mengelola, Kepala Unit membaca, karyawan sesuai kriteria", async () => {
    const [sdm, ka, budi, rina] = await Promise.all([as("sdm"), as("kaFarmasi"), as("budi"), as("rina")]);
    const all = await sdm.post("/admin/folders", { name: "SOP Umum", units: [], employment_types: [] });
    expect(all.status).toBe(201);
    const up = await sdm.post(`/admin/folders/${all.body.id}/files`, upload([[PDF, "SOP Cuci Tangan.pdf"]]));
    expect(up.status).toBe(201);
    expect(up.body[0]).toMatchObject({ name: "SOP Cuci Tangan", ext: ".pdf", inline: true, folder_id: all.body.id });
    const igd = await sdm.post("/admin/folders", { name: "Protokol IGD", units: ["IGD"], employment_types: [] });
    const igdFile = (await sdm.post(`/admin/folders/${igd.body.id}/files`, upload([[PDF, "triase.pdf"]]))).body[0];
    const later = await sdm.post("/admin/folders", { name: "Pengumuman Bulan Depan", available_from: tomorrow() });
    expect(later.status).toBe(201);

    // hanya Admin SDM yang mengubah
    expect((await ka.post("/admin/folders", { name: "X" })).status).toBe(403);
    expect((await ka.post(`/admin/folders/${all.body.id}/files`, upload([[PDF, "a.pdf"]]))).status).toBe(403);
    expect((await budi.get("/admin/folders")).status).toBe(403);
    expect((await ka.get("/admin/folders")).status).toBe(200);

    const budiSees = (await budi.get("/me/folders")).body.map((f: { name: string }) => f.name);
    expect(budiSees).toContain("SOP Umum");
    expect(budiSees).not.toContain("Protokol IGD");
    expect(budiSees).not.toContain("Pengumuman Bulan Depan");
    expect((await rina.get("/me/folders")).body.map((f: { name: string }) => f.name)).toContain("Protokol IGD");
    expect((await budi.get(`/me/folders/${igd.body.id}/files`)).status).toBe(404);
    expect((await budi.get(`/files/${igdFile.id}`)).status).toBe(404);

    const view = await fetch(`${BASE}/files/${up.body[0].id}`, { headers: { Cookie: budi.cookie } });
    expect(view.status).toBe(200);
    expect(view.headers.get("content-type")).toMatch(/pdf/);
    expect(view.headers.get("content-disposition")).toMatch(/^inline/);
    const dl = await fetch(`${BASE}/files/${up.body[0].id}?download=1`, { headers: { Cookie: budi.cookie } });
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename="SOP Cuci Tangan.pdf"/);

    expect((await sdm.del(`/admin/folders/${igd.body.id}`)).status).toBe(204);
    expect((await rina.get(`/files/${igdFile.id}`)).status).toBe(404);
  });

  it("file karyawan: diunggah Admin SDM, dibaca pemiliknya dan Kepala Unit unitnya saja", async () => {
    const [sdm, ka, kaIgd, budi, rina] = await Promise.all([as("sdm"), as("kaFarmasi"), as("kaIgd"), as("budi"), as("rina")]);
    const budiId = (await budi.get("/me")).body.user.id;
    const cats = (await sdm.get("/admin/file-categories")).body as { id: number; name: string }[];
    const str = cats.find((c) => c.name === "STR / SIP")!;
    expect(str).toBeTruthy();

    expect((await sdm.post(`/admin/staff/${budiId}/files`, upload([[PDF, "str.pdf"]]))).status).toBe(422); // tanpa kategori
    const r = await sdm.post(`/admin/staff/${budiId}/files`, upload([[PDF, "STR Budi.pdf"]], str.id));
    expect(r.status).toBe(201);
    const file = r.body[0];
    expect(file).toMatchObject({ owner_id: budiId, category: { id: str.id, name: "STR / SIP" } });
    expect((await ka.post(`/admin/staff/${budiId}/files`, upload([[PDF, "x.pdf"]], str.id))).status).toBe(403);

    expect((await budi.get("/me/files")).body.map((f: { id: number }) => f.id)).toContain(file.id);
    expect((await budi.get(`/files/${file.id}`)).status).toBe(200);
    expect((await rina.get(`/files/${file.id}`)).status).toBe(404);
    expect((await ka.get(`/admin/staff/${budiId}/files`)).status).toBe(200);
    expect((await ka.get(`/files/${file.id}`)).status).toBe(200);
    expect((await kaIgd.get(`/admin/staff/${budiId}/files`)).status).toBe(403);
    expect((await kaIgd.get(`/files/${file.id}`)).status).toBe(404);

    // kategori yang masih dipakai tidak bisa dihapus
    expect((await sdm.del(`/admin/file-categories/${str.id}`)).status).toBe(409);
    const renamed = await sdm.put(`/admin/files/${file.id}`, { name: "STR 2026", category_id: str.id });
    expect(renamed.body.name).toBe("STR 2026");
    expect((await sdm.del(`/admin/files/${file.id}`)).status).toBe(204);
    expect((await budi.get(`/files/${file.id}`)).status).toBe(404);
  });

  it("format & isi file diperiksa", async () => {
    const sdm = await as("sdm");
    const f = (await sdm.post("/admin/folders", { name: "Uji Format" })).body;
    expect((await sdm.post(`/admin/folders/${f.id}/files`, upload([["bukan pdf", "palsu.pdf"]]))).status).toBe(422);
    expect((await sdm.post(`/admin/folders/${f.id}/files`, upload([["MZ", "setup.exe"]]))).status).toBe(422);
    expect((await sdm.post(`/admin/folders/${f.id}/files`, new FormData())).status).toBe(422);
    const docx = await sdm.post(`/admin/folders/${f.id}/files`, upload([["PK\x03\x04isi", "Formulir.docx"]]));
    expect(docx.status).toBe(201);
    expect(docx.body[0].inline).toBe(false);
    expect((await sdm.get(`/admin/folders/${f.id}`)).body.file_count).toBe(1);
  });
});
