# ABiTA — backend (API)

API presensi wajah RS Awal Bros Botania: **NestJS 12 + Drizzle ORM + MySQL**, verifikasi wajah ONNX (YuNet + SFace), Swagger.
Berdiri sendiri: konfigurasi, `.env`, dependensi, dan tes ada di folder ini. Frontend (folder `../frontend`) memanggil API
langsung di `/api/v1`; alamat frontend yang diizinkan = `PUBLIC_APP_URL` (+ `CORS_ORIGINS`), localhost selalu boleh saat pengembangan.

| Alamat | Isi |
|---|---|
| `http://localhost:3001/api/v1` | API |
| `http://localhost:3001/api/docs` | Dokumentasi (Swagger UI); JSON di `/api/docs/openapi.json` |
| `http://localhost:3001/api/v1/health` | Status (database & model wajah) |

## Menjalankan (pengembangan)

Syarat: **Node.js 22+** dan **XAMPP** (MySQL) di `C:\xampp`.

```bash
npm run dev
```

(Windows: klik dua kali `dev.cmd`.) Perintah ini: membuat `.env` dari `.env.example` (JWT_SECRET acak) bila belum ada,
`npm install` bila perlu, menyalakan MySQL XAMPP, membuat database + tabel + akun Admin SDM bawaan bila kosong, memeriksa model wajah
dan port, lalu menjalankan API dengan *watch* (berubah kode → dimuat ulang). `npm run dev -- --check` = cek saja.

## Struktur

```
backend/
├── .env / .env.example   konfigurasi (database, JWT, presensi, wajah, log, Web Push)
├── src/
│   ├── main.ts           bootstrap (helmet, validasi, Swagger, cek database)
│   ├── modules/          controller per fitur (auth, me, presence, admin, hr, console, schedule, reports, ...)
│   ├── domain/           aturan bisnis: presensi, jadwal, pengajuan, wajah (domain/face), push, email
│   ├── db/               skema Drizzle + ensure.ts (perubahan tabel otomatis saat start)
│   ├── core/             config, auth, waktu (WIB), penyimpanan, batas laju
│   └── shared/           kontrak API: skema zod (validasi body & Swagger) + tipe respons
├── scripts/              dev.mjs, seed.ts (akun uji), build-cpanel.mjs
├── test/                 tes integrasi (database abita_test)
├── models/               model wajah ONNX
└── storage/              foto absensi, avatar, lampiran SKD, dokumen (jangan dihapus)
```

`src/shared` disalin juga ke `../frontend/shared` (hanya tipe). Bila kontrak API berubah, ubah keduanya.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | cek lingkungan + API mode watch |
| `npm run build` / `npm start` | build ke `dist/` / jalankan hasil build (`dist/main.js`) |
| `npm run typecheck` | cek tipe |
| `npm test` | tes integrasi (database `abita_test`, tidak menyentuh `abita`) |
| `npm run db:push` | samakan struktur tabel dengan `src/db/schema.ts` |
| `npm run db:seed` | akun bawaan Admin SDM `adminsdm@gmail.com` / `adminsdm123` bila belum ada |
| `npm run db:seed -- --reset` | **kosongkan SEMUA data** (absensi, akun, log, pengaturan) lalu buat akun bawaan saja |
| `npm run db:seed:demo` | + data contoh (kantor, unit, akun uji, shift, jadwal); dipakai tes otomatis |
| `npm run build:cpanel` | paket unggah hosting cPanel, lihat `DEPLOY-CPANEL.md` |

## Log

Format `waktu LEVEL [area] pesan`, diatur `LOG_LEVEL`, `LOG_REQUESTS` (`errors` | `all` | `off`), `LOG_FORMAT` (`text` | `json`) di `.env`.
