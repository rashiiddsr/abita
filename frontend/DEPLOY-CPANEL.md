# Frontend di hosting cPanel

Frontend = file statis (`/staff` dan `/admin`). Browser memanggil backend langsung di `API_URL`, jadi frontend boleh di
subdomain atau server lain dari backend. Pasang backend dulu (`backend/DEPLOY-CPANEL.md`).

## 1. Atur alamat backend, lalu buat paket

`API_URL` ditanam ke file saat build: **setiap kali diubah, build ulang**. Agar `.env` tetap untuk lokal, taruh alamat
production di `.env.production` (dipakai otomatis oleh `npm run build`):

```ini
# .env.production
API_URL=https://abita-api.domain.com
```

```bash
npm run build:cpanel
```

Hasil: `deploy/cpanel/public_html.zip` (`staff/`, `admin/`, `.htaccess`, `404.html`).

## 2. Unggah

1. Subdomain frontend (mis. `abita.domain.com`) atau domain utama: **File Manager** › document root-nya
   (mis. `public_html` atau `abita.domain.com/`) › unggah `public_html.zip` › **Extract**.
2. Buka `https://abita.domain.com/staff` (karyawan) dan `/admin` (Admin SDM / Kepala Unit).
3. Di `.env` backend, `PUBLIC_APP_URL` harus alamat frontend ini (`https://abita.domain.com`).

`.htaccess` memaksa HTTPS, mengarahkan `/` ke `/staff/`, dan alamat halaman ke `index.html` aplikasinya.
Kebijakan keamanan konten (CSP) sudah tertanam di `index.html`: halaman hanya boleh memuat file situs ini,
backend (`API_URL`), peta ArcGIS dan Google Fonts.

## Bila gagal

| Gejala | Penyebab |
|---|---|
| Masih memanggil `domain-frontend/api/v1` | belum build ulang setelah mengubah `API_URL` |
| "Tidak bisa terhubung ke server" / CORS di console | `PUBLIC_APP_URL` / `CORS_ORIGINS` backend tidak sama persis dengan alamat frontend (https, tanpa `/` di akhir) |
| Masuk berhasil tapi langsung keluar lagi | frontend & backend beda domain induk: pakai subdomain, atau `COOKIE_SAMESITE=none` di backend |

## Memperbarui

`npm run build:cpanel`, unggah & extract `public_html.zip` (timpa).
