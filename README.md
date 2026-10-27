<p align="center">
  <img src="brand/abita-mark.svg" width="88" alt="ABiTA logo" />
</p>

<h1 align="center">ABiTA</h1>

<p align="center">
  <strong>Awal Bros Integrated Time &amp; Attendance</strong><br />
  Face-verified attendance, shift scheduling, leave approvals, and HR documents for interns, outsourced, and permanent staff at RS Awal Bros Botania.
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%E2%89%A520.19-339933?logo=nodedotjs&logoColor=white" />
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" />
  <img alt="MySQL" src="https://img.shields.io/badge/MySQL%20%2F%20MariaDB-4479A1?logo=mysql&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white" />
</p>

---

## Contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Features](#features)
- [Roles](#roles)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Commands](#commands)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Documentation](#documentation)

## Overview

ABiTA replaces manual attendance with a phone app that verifies **who** checks in (face recognition with liveness), **where** (GPS geofence), and **when** (shift-based check-in windows). Every decision is made on the server; the phone only guides the camera.

The system has two applications served from one domain and one API:

| Application | Path | Users |
|---|---|---|
| **Staff app** (installable PWA) | `/staff` | Employees: check in/out, schedule, leave, documents, notifications |
| **Dashboard** | `/admin` | HR Admin (Admin SDM) and Unit Heads (Kepala Unit) |
| **REST API** | `/api/v1` | Both applications; OpenAPI docs at `/api/docs` |

**At a glance:** 35 pages (16 staff, 19 dashboard) · 129 API endpoints · 23 database tables · 37 integration tests.

## Screenshots

<table>
  <tr>
    <td width="62%"><img src="docs/screenshots/admin-dashboard.jpg" alt="Dashboard: today's attendance, status per unit, items needing attention" /></td>
    <td width="19%"><img src="docs/screenshots/staff-home.jpg" alt="Staff app home: today's shift, check-in button, location, app menu" /></td>
    <td width="19%"><img src="docs/screenshots/staff-documents.jpg" alt="Staff app documents: company folders" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/admin-documents.jpg" alt="Dashboard documents: employee files with category filter, Excel summary, ZIP export, bulk upload" /></td>
    <td colspan="2"><img src="docs/screenshots/staff-notifications.jpg" width="48%" alt="Staff app notifications grouped by date" /></td>
  </tr>
</table>

<sub>Screenshots use sample data.</sub>

## Features

### Staff app (`/staff`)

| | Feature | Details |
|---|---|---|
| 🙂 | **Face check-in / check-out** | Guided camera (distance, lighting, head turn), three frames verified on the server, GPS geofence, shift-based time window |
| 📅 | **Schedule & history** | Monthly shift calendar, upcoming shifts, attendance history, monthly summary, PDF/Excel export |
| 📝 | **Requests** | Leave (izin), sick leave with doctor's note (SKD), shift swap with a colleague, cancel pending requests |
| 📁 | **Documents** | Company folders targeted by unit and employment type; personal files grouped by category |
| 🔔 | **Notifications** | Web Push (even when the app is closed), in-app inbox with filters, real-time updates |
| ⚙️ | **Account** | Profile photo, password, face re-scan, light/dark/system theme, helpdesk contact, "remember me" for 30 days |

### Dashboard (`/admin`)

| | Feature | Details |
|---|---|---|
| 📊 | **Overview** | Today's totals, attendance per unit, items needing attention, next month's schedule status |
| 🕘 | **Attendance & corrections** | Daily or date-range view, filters, verification photo and match score, corrections by Unit Heads (≤ 62 days, reason required, audited) |
| ✅ | **Approvals** | Single or bulk approve/reject, reason required to reject, escalation after 48 hours |
| 👥 | **Staff management** | Create/edit, Excel import/export, credentials by email, password and face reset (single or bulk), deactivate |
| 🗓️ | **Scheduling** | Repeating shift patterns, date-range fill, protected dates, publish deadline on the 25th |
| 📈 | **Reports** | Attendance, requests, schedules, staff; weekly/monthly; Excel or PDF; export history |
| 📂 | **Documents** | Company folders with audience, publish date, and reminders; employee files by category; bulk folder upload; Excel summary and ZIP export |
| 🏥 | **Organisation & settings** | Units (several heads per unit), admin accounts, attendance location on a map, shift hours and check-in windows, holidays, SMTP |

### System services

- **Server-side face verification** with ONNX Runtime: YuNet (detection) and SFace (recognition), plus liveness, image quality checks, and second-face rejection.
- **Real-time updates** via Server-Sent Events; **Web Push** notifications (VAPID).
- **Scheduled jobs** (single-instance via a MySQL lock): check-out reminders, document notices and reminders, temporary-password email queue.
- **Audit log** for every approval, correction, and administrative change.

## Roles

| Capability | Staff | Unit Head (Kepala Unit) | HR Admin (Admin SDM) |
|---|:---:|:---:|:---:|
| Check in / out, own schedule and requests | ✅ | | |
| Monitor attendance and reports | | Own units | All units |
| Approve leave and shift swaps | | ✅ | Units without a head |
| Build and publish schedules | | ✅ | View |
| Correct attendance | | ✅ | |
| Manage staff | | Own units | All units |
| Documents | Read (own + targeted) | Read (own units) | Full control |
| Units, admins, system settings | | | ✅ |

Staff accounts sign in only at `/staff`; Admin SDM and Kepala Unit accounts sign in only at `/admin`. Every rule is enforced by the API, not just hidden in the UI.

## Architecture

```mermaid
flowchart LR
  subgraph Clients
    S["Staff app /staff<br/>PWA on phone<br/>(MediaPipe camera guidance)"]
    A["Dashboard /admin<br/>browser"]
  end

  subgraph Backend["NestJS API · /api/v1"]
    AUTH["Auth & roles<br/>(httpOnly cookie)"]
    FACE["Face verification<br/>YuNet + SFace (ONNX)"]
    RULES["Business rules<br/>windows · geofence · schedules"]
    JOBS["Scheduled jobs"]
    RT["SSE · Web Push"]
  end

  S -- "HTTPS JSON" --> AUTH
  A -- "HTTPS JSON" --> AUTH
  AUTH --> FACE --> RULES
  RULES --> DB[("MySQL / MariaDB")]
  RULES --> FS[("File storage<br/>photos · sick notes · documents")]
  JOBS --> MAIL["SMTP"]
  RT -. "push / events" .-> S
  RT -. "events" .-> A
```

**Check-in flow:** the app opens a single-use session with a random head-turn challenge → the camera captures three frames → the server decodes them, detects the closest face, checks image quality and the head turn, compares the frames with each other (≥ 0.45) and with the enrolled template (≥ 0.50) → then applies the check-in window, mock-location, and geofence rules → stores the attendance and photo and notifies the dashboard in real time.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, TanStack Router & Query, Tailwind CSS 4, vite-plugin-pwa, MediaPipe Tasks Vision |
| Backend | NestJS 12, Drizzle ORM, Zod 4 (validation + OpenAPI), mysql2 |
| Face recognition | ONNX Runtime (Node), sharp, OpenCV Zoo YuNet & SFace models |
| Notifications | Web Push (VAPID), Nodemailer (SMTP), Server-Sent Events |
| Reports & files | ExcelJS, PDFKit, archiver |
| Quality | TypeScript, Vitest, ESLint |
| Hosting | cPanel (Node.js App for the API, static files for the frontend) or any Node.js server |

## Repository structure

```
.
├── backend/                 NestJS API (port 3001)
│   ├── src/
│   │   ├── modules/         controllers per feature + scheduled jobs
│   │   ├── domain/          business rules, face verification, documents, notifications
│   │   ├── db/              Drizzle schema + safe automatic migrations (ensure.ts)
│   │   ├── core/            config, auth, time (WIB), storage, rate limiting
│   │   └── shared/          API contracts (Zod schemas + response types)
│   ├── test/                integration tests (separate abita_test database)
│   ├── scripts/             dev, seed, cPanel packaging
│   └── models/              face models (not in git, see below)
├── frontend/                Vite apps (port 3000)
│   ├── staff/               staff PWA (/staff)
│   ├── admin/               dashboard (/admin)
│   ├── shared/              copy of the API contract types
│   └── server.mjs           single server for development and production
├── brand/                   logo source files
└── docs/screenshots/        images used in this README
```

The backend and frontend are independent projects, each with its own `package.json`, `.env`, README, and deployment guide.

## Getting started

### Prerequisites

- **Node.js 22 LTS** (≥ 20.19)
- **MySQL 8 or MariaDB 10.4+**; on Windows, [XAMPP](https://www.apachefriends.org/) installed at `C:\xampp` is detected and started automatically
- **Face models**: they are not stored in git. Download them from [OpenCV Zoo](https://github.com/opencv/opencv_zoo) and place them in `backend/models/`:
  - `face_detection_yunet_2023mar.onnx` (models/face_detection_yunet)
  - `face_recognition_sface_2021dec.onnx` (models/face_recognition_sface)

### 1. Backend

```bash
cd backend
npm run dev
```

On first run this creates `.env` from `.env.example` (with a random `JWT_SECRET`), installs dependencies, starts XAMPP's MySQL if needed, creates the database and tables, creates the default HR Admin account, checks the face models and ports, then starts the API in watch mode. On Windows you can double-click `dev.cmd` instead.

The default HR Admin credentials are listed in [`backend/README.md`](backend/README.md). **Change the password immediately after the first sign-in.**

For sample data (units, shifts, schedules, test accounts): `npm run db:seed:demo`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

| URL | |
|---|---|
| http://localhost:3000/staff | Staff app |
| http://localhost:3000/admin | Dashboard |
| http://localhost:3001/api/docs | API documentation (Swagger) |
| http://localhost:3001/api/v1/health | Health check (database and face models) |

> The camera, location, app installation, and push notifications require **HTTPS** on phones. `localhost` counts as secure on a computer. Push notifications are active only in a production build.

## Configuration

Both projects read a `.env` file (never committed). Start from the `.env.example` in each folder.

**Backend (`backend/.env`)**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection, e.g. `mysql://user:pass@localhost:3306/abita` |
| `JWT_SECRET` | Session signing key; use a long random value (≥ 32 characters) |
| `PUBLIC_APP_URL`, `CORS_ORIGINS` | Frontend origin(s) allowed to call the API |
| `COOKIE_SAMESITE` | `lax` for subdomains of one domain, `none` for different domains (HTTPS) |
| `API_PORT`, `TZ_NAME`, `ORG_NAME` | Port, time zone (Asia/Jakarta), organisation name |
| `MATCH_THRESHOLD`, `CONSISTENCY_THRESHOLD` | Face match and frame consistency thresholds |
| `MIN_FACE_WIDTH`, `MIN_FACE_BRIGHTNESS`, `MAX_FACE_BRIGHTNESS`, `MIN_FACE_SHARPNESS` | Server-side photo quality gates |
| `REJECT_MOCK_LOCATION`, `MAX_GPS_ACCURACY_M` | Location rules |
| `API_RATE_PER_MIN`, `API_RATE_PER_MIN_IP`, `FACE_SUBMIT_PER_MIN` | Rate limits |
| `MAX_ATTACHMENT_MB`, `MAX_DOCUMENT_MB`, `STORAGE_DIR` | Upload limits and storage folder |
| `API_DOCS` | Enable Swagger in production (off by default) |
| `LOG_LEVEL`, `LOG_REQUESTS`, `LOG_FORMAT` | Logging (`text` or `json`) |

**Frontend (`frontend/.env`, `frontend/.env.production`)**

| Variable | Purpose |
|---|---|
| `API_URL` | Backend address called by the browser (built into the app at build time) |
| `WEB_PORT` | Development/production server port (default 3000) |

## Commands

| Backend (`backend/`) | |
|---|---|
| `npm run dev` | Environment checks + API in watch mode |
| `npm run build` / `npm start` | Build to `dist/` / run the build |
| `npm test` | Integration tests |
| `npm run typecheck` | Type check |
| `npm run db:seed:demo` | Sample data and test accounts |
| `npm run build:cpanel` | Hosting package (`abita-api.zip`) |

| Frontend (`frontend/`) | |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm start` | Type check + build / serve the build |
| `npm run typecheck` · `npm run lint` | Type check · ESLint |
| `npm run icons` | Regenerate app icons from `brand/` |
| `npm run build:cpanel` | Hosting package (`public_html.zip`) |

## Testing

```bash
cd backend
npm test
```

The suite starts a real API against a separate `abita_test` database and a temporary storage folder; the main database is never touched. It covers authentication and roles, CORS/CSRF, face verification with the real ONNX models, check-in windows, schedules and shift swaps, approvals, corrections, documents (permissions, formats, notifications, reminders, reports, ZIP export), and rate-limit IP handling.

## Deployment

Each project produces **one zip** for both first install and updates; extracting it never overwrites the server's `.env` or uploaded files.

1. `npm run build:cpanel` in `backend/` and `frontend/`.
2. Backend: upload `abita-api.zip` outside `public_html`, create `.env`, then in cPanel's **Setup Node.js App** run **NPM Install** and **Restart**. New tables are created automatically on start.
3. Frontend: extract `public_html.zip` into the site's `public_html`.
4. Check `https://<api-domain>/api/v1/health` and schedule a health-check cron every 5 minutes.

Step-by-step guides: [`backend/DEPLOY-CPANEL.md`](backend/DEPLOY-CPANEL.md) and [`frontend/DEPLOY-CPANEL.md`](frontend/DEPLOY-CPANEL.md). Back up the database and `backend/storage/` regularly.

## Security

- httpOnly, Secure session cookies; sessions end on other devices after a password change.
- Origin checks on state-changing requests (CSRF) and an explicit CORS allow-list.
- Role and unit scope enforced on every API endpoint.
- Login and password-reset rate limits per account and per IP (proxy headers parsed safely); uniform responses that do not reveal which accounts exist.
- "Forgot password" sends a temporary password; the current password keeps working until the temporary one is used.
- Uploads validated by file content, not by name; files served only through permission-checked endpoints.
- Password hashing (bcrypt) runs on worker threads so sign-in bursts never block check-ins.
- Security headers: CSP, `nosniff`, HSTS, `Permissions-Policy`.

Never commit `.env` files, `backend/storage/`, or database dumps: they contain secrets and personal data (face templates, photos, medical notes).

## Documentation

| Document | Contents |
|---|---|
| [`backend/README.md`](backend/README.md) | API development, structure, commands, logging |
| [`frontend/README.md`](frontend/README.md) | Frontend development, routing, structure |
| [`backend/DEPLOY-CPANEL.md`](backend/DEPLOY-CPANEL.md) | API hosting on cPanel |
| [`frontend/DEPLOY-CPANEL.md`](frontend/DEPLOY-CPANEL.md) | Frontend hosting on cPanel |
| `http://<api>/api/docs` | Interactive API reference (Swagger) |

---

<p align="center"><sub>ABiTA · RS Awal Bros Botania · Internal use only. All rights reserved.</sub></p>
