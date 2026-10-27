import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { FEATURE_MODULES } from "./modules";

// API saja: halaman /admin & /staff disajikan aplikasi frontend (folder frontend), yang meneruskan /api ke sini.
// ScheduleModule: tugas terjadwal (@Cron), mis. antrean kata sandi baru (lupa kata sandi).
@Module({ imports: [ScheduleModule.forRoot(), ...FEATURE_MODULES] })
export class AppModule {}
