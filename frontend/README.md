# ABiTA — frontend

Dua aplikasi Vite + React + TanStack Router, disajikan satu server (`server.mjs`) di **http://localhost:3000**.
Browser memanggil backend langsung di `API_URL` (`.env`), tanpa proxy, jadi frontend dan backend bisa di subdomain atau server berbeda.

| Alamat | Aplikasi | Folder |
|---|---|---|
| `/staff` | Aplikasi karyawan (PWA: bisa dipasang ke layar utama, notifikasi push) | `staff/` |
| `/admin` | Dasbor Admin SDM & Kepala Unit (diketik manual) | `admin/` |

Berdiri sendiri: konfigurasi, `.env`, dependensi ada di folder ini.

## Menjalankan (pengembangan)

Jalankan backend dulu (`npm run dev` di folder `backend`), lalu di folder ini:

```bash
npm install   # sekali
npm run dev
```

(Windows: klik dua kali `dev.cmd`.) Edit halaman → langsung dimuat ulang (hot reload).
Port dan alamat backend diatur di `.env` (`WEB_PORT`, `API_URL=http://localhost:3001`; contoh di `.env.example`).
`API_URL` ditanam saat build: untuk hosting taruh di `.env.production` lalu `npm run build` ulang.

## Struktur

```
frontend/
├── .env / .env.example   WEB_PORT, API_URL (.env.production: API_URL hosting)
├── vite.shared.ts        API_URL -> kode, Content-Security-Policy di index.html
├── server.mjs            server :3000 (dev: Vite middleware; --prod: menyajikan dist/), halaman 404
├── admin/                dasbor: src/routes (rute = file), src/components, vite.config.ts
├── staff/                aplikasi karyawan (PWA): src/routes, src/pages, public/ (manifest, ikon, push-sw.js)
├── shared/               tipe kontrak API (salinan backend/src/shared; ubah keduanya bila kontrak berubah)
├── brand/                logo & generator ikon (npm run icons)
└── scripts/build-cpanel.mjs
```

Rute berbasis file (TanStack Router): `staff/src/routes/_auth/_tabs/dashboard.tsx` → `/staff/dashboard`.
`src/routeTree.gen.ts` dibuat otomatis, jangan diedit. Folder berawalan `_` = layout tanpa segmen URL; `$id` = parameter.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | server pengembangan :3000 |
| `npm run build` / `npm start` | typecheck + build ke `dist/` / sajikan hasil build |
| `npm run typecheck` · `npm run lint` | cek tipe · ESLint |
| `npm run icons` | buat ulang ikon dari `brand/*.svg` |
| `npm run build:cpanel` | paket unggah hosting cPanel, lihat `DEPLOY-CPANEL.md` |

Kamera, lokasi, instal aplikasi, dan notifikasi push di HP butuh **HTTPS** (hosting dengan SSL). Di komputer,
`localhost` sudah dianggap aman. Notifikasi push hanya aktif di versi build/hosting (service worker tidak dipasang saat `npm run dev`).
