# Backend (API) di hosting cPanel

Backend dan frontend berdiri sendiri. Frontend memanggil backend langsung di alamat `API_URL` (lihat
`frontend/DEPLOY-CPANEL.md`), jadi keduanya boleh di subdomain atau server berbeda.

| Susunan | Frontend | Backend (folder ini) | `.env` backend |
|---|---|---|---|
| **Beda subdomain** (disarankan) | `https://abita.domain.com` | `https://abita-api.domain.com` | `PUBLIC_APP_URL=https://abita.domain.com` |
| Satu domain | `https://domain.com/staff`, `/admin` | `https://domain.com/api` | `PUBLIC_APP_URL=https://domain.com` |
| Domain berbeda | `https://abita.com` | `https://api-lain.net` | + `COOKIE_SAMESITE=none` (lihat Catatan) |

Subdomain boleh di server berbeda; yang penting satu domain induk (`*.domain.com`).

Syarat hosting: **Setup Node.js App** (CloudLinux) dengan Node.js **20 atau 22**, SSL aktif, RAM ≥ 1 GB,
Linux 64-bit dengan glibc ≥ 2.28 (mis. CloudLinux 8) untuk onnxruntime & sharp.

## 1. Paket

```bash
npm run build:cpanel
```

Hasil di `deploy/cpanel/`: **`abita-api.zip`** (satu zip untuk pasang pertama maupun memperbarui) dan `database.sql`
(hanya untuk pasang pertama). `-- --no-db` = tanpa `database.sql`, `-- --schema-only` = struktur tabel saja.

Zip tidak menyertakan `.env` (hanya `.env.example`), sehingga extract ulang tidak menimpa `.env` dan `storage/` di server.

## 2. Database

cPanel › **MySQL Database Wizard** (database + user, ALL PRIVILEGES) › **phpMyAdmin** › Import `database.sql`.

## 3. API

1. Subdomain: cPanel › **Domains** › buat `abita-api.domain.com` (SSL otomatis lewat AutoSSL).
2. **File Manager**: folder `abita-api` di home (di luar `public_html`), unggah `abita-api.zip`, **Extract**.
3. Salin `.env.example` menjadi `.env` (sekali, saat instalasi pertama; `JWT_SECRET` sudah dibuat acak), lalu isi:
   ```ini
   DATABASE_URL=mysql://USER:KATA_SANDI@localhost:3306/NAMA_DATABASE
   PUBLIC_APP_URL=https://abita.domain.com
   ```
   Karakter khusus di kata sandi database ditulis `@` → `%40`, `#` → `%23`. `PUBLIC_APP_URL` = alamat frontend.
4. **Setup Node.js App** › Create: Node.js 22 · **Production** · root `abita-api` · Application URL
   `abita-api.domain.com` (kosongkan path; susunan satu domain: `domain.com` + `api`) · startup `app.js`
   › Create › **Run NPM Install** › **Restart**.
5. Cek `https://abita-api.domain.com/api/v1/health` → `"status":"ok"`. Log galat: `abita-api/stderr.log`.

## 4. Cron agar API tidak tidur

cPanel menidurkan aplikasi Node saat sepi; selama tidur, tugas terjadwal (pengingat check out, email kata sandi)
ikut berhenti. cPanel › **Cron Jobs** › Common Settings *Once Per Five Minutes* (`*/5 * * * *`), Command:

```bash
curl -fsS https://abita-api.domain.com/api/v1/health > /dev/null
```

## Memperbarui

`npm run build:cpanel -- --no-db`, unggah `abita-api.zip` yang sama ke folder `abita-api` › **Extract** (timpa) ›
Setup Node.js App › **Run NPM Install** (bila dependensi berubah) › **Restart**. `.env` dan `storage/` tetap aman;
tabel baru dibuat otomatis saat API menyala.

## Catatan

- **Frontend lebih dari satu alamat**: tambahkan di `CORS_ORIGINS` (pisahkan koma). Permintaan dari alamat lain ditolak (403).
- **Domain berbeda** (bukan subdomain): `COOKIE_SAMESITE=none`. Safari/iPhone sering memblokir cookie lintas situs,
  jadi aplikasi karyawan di iPhone bisa gagal masuk; pakai susunan subdomain bila memungkinkan.
- **Satu proses**: notifikasi realtime dan batas percobaan masuk disimpan di memori proses. Passenger menjalankan
  aplikasi Node sebagai satu proses; bila hosting menjalankan beberapa, tugas terjadwal tetap hanya jalan di satu
  proses (kunci MySQL), dan log menulis `Another API process uses this database`.
- `storage/` berisi foto absensi, lampiran SKD, dan dokumen (menu Dokumen): ikut dicadangkan (cPanel › Backup).
