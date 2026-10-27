import { Module } from "@nestjs/common";
import { CheckoutReminderJob } from "./checkout-reminder.job";
import { PasswordResetJob } from "./password-reset.job";
import { AdminController } from "./admin.controller";
import { AuthController } from "./auth.controller";
import { ConsoleController } from "./console.controller";
import { HealthController } from "./health.controller";
import { DocumentNoticeJob } from "./document-notice.job";
import { FilesController } from "./files.controller";
import { HrController } from "./hr.controller";
import { MeController } from "./me.controller";
import { PresenceController } from "./presence.controller";
import { RealtimeController } from "./realtime.controller";
import { ReportsController } from "./reports.controller";
import { ScheduleController } from "./schedule.controller";
import { StaffIoController } from "./staff-io.controller";

/** Status (health) & aliran real-time (SSE). */
@Module({ controllers: [HealthController, RealtimeController] })
export class SystemModule {}

/** Masuk, keluar, lupa kata sandi (+ cron antrean kata sandi baru), konfigurasi publik, profil sesi (/me). */
@Module({ controllers: [AuthController], providers: [PasswordResetJob] })
export class AuthModule {}

/** Akun karyawan: profil, jadwal, notifikasi, pengajuan izin/sakit & tukar shift. */
@Module({ controllers: [MeController] })
export class MeModule {}

/** Pendaftaran & verifikasi wajah, check in/out (+ cron pengingat check out). */
@Module({ controllers: [PresenceController], providers: [CheckoutReminderJob] })
export class PresenceModule {}

/**
 * Dasbor Admin SDM & Kepala Unit.
 * Urutan penting: /admin/staff/export & /staff/template (StaffIo) harus terdaftar sebelum /admin/staff/:id (Console).
 */
@Module({ controllers: [StaffIoController, AdminController, HrController, ConsoleController] })
export class AdminModule {}

/** Jadwal bulanan, pola shift, hari libur. */
@Module({ controllers: [ScheduleController] })
export class ScheduleModule {}

/** Laporan & ekspor Excel/PDF. */
@Module({ controllers: [ReportsController] })
export class ReportsModule {}

/** Dokumen: file perusahaan & file karyawan (+ cron pemberitahuan & pengingat). */
@Module({ controllers: [FilesController], providers: [DocumentNoticeJob] })
export class FilesModule {}

export const FEATURE_MODULES = [SystemModule, AuthModule, MeModule, PresenceModule, AdminModule, ScheduleModule, ReportsModule, FilesModule];
