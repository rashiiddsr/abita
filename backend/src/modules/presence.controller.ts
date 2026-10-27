/** Sesi verifikasi wajah (daftar wajah, absen masuk/pulang) dan riwayat absensi karyawan. */
import { randomUUID } from "node:crypto";
import { Body, Controller, Get, HttpCode, Param, Post, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { AttendanceOut, FaceSession, SessionIn, SubmitResult } from "../shared";
import { settings } from "../core/config";
import { HttpError } from "../core/http";
import { monthBounds } from "../core/time";
import { db, schema } from "../db";
import type { User } from "../db/schema";
import { MAX_FRAME_BYTES, runVerification } from "../domain/face/verify";
import { attendanceOut } from "../domain/out";
import { msg, pickChallenges, prerequisite } from "../domain/rules";
import { Me, type UploadFile } from "../common/nest";
import { Returns, Upload } from "../common/swagger";

const SUCCESS: Record<string, string> = {
  enroll: "Wajah berhasil didaftarkan.",
  reenroll: "Data wajah berhasil diperbarui.",
  in: "Absen masuk berhasil.",
  out: "Absen pulang berhasil.",
};

@ApiTags("Presensi wajah")
@Controller()
export class PresenceController {
  @Post("sessions")
  @Returns(FaceSession)
  @HttpCode(200)
  async create(@Body({ schema: SessionIn }) body: z.output<typeof SessionIn>, @Me() user: User) {
    const block = await prerequisite(user, body.purpose);
    if (block) throw new HttpError(409, { reason_code: block.code, message: block.message });
    const now = new Date();
    const row = {
      id: randomUUID(),
      userId: user.id,
      purpose: body.purpose,
      challenges: pickChallenges(body.purpose),
      createdAt: now,
      expiresAt: new Date(now.getTime() + settings.SESSION_TTL_SECONDS * 1000),
    };
    await db().insert(schema.faceSessions).values(row);
    return { session_id: row.id, purpose: row.purpose, challenges: row.challenges, expires_at: row.expiresAt };
  }

  @Post("sessions/:id/submit")
  @Returns(SubmitResult)
  @HttpCode(200)
  @Upload({ frames: "files", meta: "JSON: lokasi, akurasi GPS, hasil tantangan gerak kepala" }, ["frames"])
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_FRAME_BYTES + 1, files: 8 } }))
  async submit(@Param("id") id: string, @UploadedFiles() files: UploadFile[] = [], @Body() body: { meta?: string }, @Me() user: User) {
    let meta: Record<string, unknown> = {};
    try {
      const m = body?.meta ? JSON.parse(body.meta) : {};
      if (m && typeof m === "object" && !Array.isArray(m)) meta = m;
    } catch {
      meta = {};
    }
    const frames = files.filter((f) => f.fieldname === "frames").map((f) => f.buffer);
    const res = await runVerification(user, id, frames, meta);
    return {
      success: res.success,
      reason_code: res.reasonCode,
      message: res.success ? (SUCCESS[res.purpose] ?? "Berhasil.") : msg(res.reasonCode),
      attendance: res.attendance ? attendanceOut(res.attendance) : null,
      match_score: settings.DEBUG ? res.matchScore : null,
      distance_m: (res.scores.distance_m as number | undefined) ?? null,
      scores: settings.DEBUG ? res.scores : null,
    };
  }

  @Get("attendance/me")
  @Returns(AttendanceOut, { list: true })
  async mine(@Query("month") month: string | undefined, @Me() user: User) {
    if (month && !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(422, "Format bulan harus YYYY-MM.");
    const [start, end] = monthBounds(month);
    const a = schema.attendances;
    const rows = await db()
      .select()
      .from(a)
      .where(and(eq(a.userId, user.id), gte(a.workDate, start), lt(a.workDate, end)))
      .orderBy(desc(a.workDate), asc(a.type));
    return rows.map(attendanceOut);
  }
}
