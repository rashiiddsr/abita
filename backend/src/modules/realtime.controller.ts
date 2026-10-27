/** GET /api/v1/events: aliran Server-Sent Events untuk dasbor admin & aplikasi karyawan (lihat core/events.ts). */
import { Controller, Get, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { bus, type Evt } from "../core/events";
import { scopeUnits } from "../core/auth";
import { HttpError } from "../core/http";
import { authenticate, Public } from "../common/nest";

const PING_MS = 15_000;
// Sambungan ditutup berkala (server menunggu aliran terbuka selesai saat restart);
// EventSource tersambung ulang otomatis dan event yang terlewat dikirim ulang lewat Last-Event-ID.
const MAX_LIFETIME_MS = 25_000;

@ApiTags("Real-time")
@Controller()
export class RealtimeController {
  @Public() // autentikasi dilakukan sendiri agar error tetap berupa JSON sebelum aliran dibuka
  @Get("events")
  async events(@Req() req: Request, @Res() res: Response) {
    let user;
    try {
      user = await authenticate(req);
    } catch (e) {
      const err = e as HttpError;
      res.status(err.status ?? 401).json({ detail: err.detail ?? "Silakan login terlebih dahulu." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform", // no-transform: proxy (Next.js) tidak meng-gzip & menahan aliran
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (e: Evt) => res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    const sub = { userId: user.id, role: user.role, units: scopeUnits(user), push: send };
    const last = (req.headers["last-event-id"] as string | undefined) ?? (req.query.last as string | undefined) ?? null;
    res.write("retry: 3000\n\n");
    // Event yang terlewat dikirim ulang; bila tidak lagi lengkap (API dimulai ulang / buffer terlewati), klien memuat ulang semua data.
    if (last && !bus.covers(last)) res.write("event: reset\ndata: {}\n\n");
    else for (const e of bus.since(sub, last)) send(e);
    res.write(`id: ${bus.cursor()}\nevent: ready\ndata: {}\n\n`);
    const off = bus.subscribe(sub);
    const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
    const end = setTimeout(() => res.end(), MAX_LIFETIME_MS);
    req.on("close", () => {
      off();
      clearInterval(ping);
      clearTimeout(end);
    });
  }
}
