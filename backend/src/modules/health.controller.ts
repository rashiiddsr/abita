/** GET /api/v1/health: status API untuk monitoring (PM2, load balancer, uptime checker). Tanpa login. */
import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { Health } from "../shared";
import type { Response } from "express";
import { pool } from "../db";
import { modelState } from "../domain/face/models";
import { Public } from "../common/nest";

const VERSION = process.env.npm_package_version ?? "1.0.0";

@ApiTags("Sistem")
@Controller()
export class HealthController {
  @Public()
  @Get("health")
  @ApiOperation({ summary: "Status API", description: "200 bila database tersambung; 503 bila database tidak bisa dipakai." })
  @ApiOkResponse({ standardSchema: Health })
  @ApiServiceUnavailableResponse({ standardSchema: Health })
  async health(@Res({ passthrough: true }) res: Response): Promise<Health> {
    const database = await pool()
      .query("SELECT 1")
      .then(() => "ok" as const)
      .catch(() => "error" as const);
    const out: Health = {
      status: database === "ok" ? "ok" : "degraded",
      version: VERSION,
      uptime_s: Math.round(process.uptime()),
      checks: { database, face_models: modelState() },
    };
    if (database !== "ok") res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return out;
  }
}
