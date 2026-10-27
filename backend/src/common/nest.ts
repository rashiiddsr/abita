/**
 * Infrastruktur Nest untuk API:
 * - AuthGuard global: semua route butuh login kecuali @Public(); @Roles(...) membatasi peran.
 * - SchemaValidationPipe: validasi body/query dari skema zod (src/shared), error 422 seperti API lama.
 * - ApiExceptionFilter: semua error -> {"detail": ...}.
 * - requestContext: AsyncLocalStorage per permintaan, batas laju API, event real-time setelah tulis berhasil.
 */
import {
  ArgumentMetadata,
  ArgumentsHost,
  CanActivate,
  Catch,
  createParamDecorator,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  PipeTransform,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { COOKIE_NAME, PASSWORD_GATE_ALLOW, ROLE_MSG, scopeUnits, setLedUnits, tokenClaims, tokenUserId } from "../core/auth";
import { settings } from "../core/config";
import { bus, topicFor } from "../core/events";
import { HttpError, parse, reqStore, type ReqStore } from "../core/http";
import { clientIp, limiter } from "../core/ratelimit";
import { db, schema } from "../db";
import type { User } from "../db/schema";
import { pushNotifications } from "../domain/push";
import { ledUnitsOf } from "../domain/services";
import { log } from "./logger";

export const API_PREFIX = "api/v1";
export const relPath = (req: Request) => req.path.replace(/^\/api\/v1/, "") || "/";

// ------------------------------------------------------------------ dekorator

const PUBLIC = "abita:public";
const ROLES = "abita:roles";
export type RoleRule = keyof typeof ROLE_MSG;
const RULES: Record<RoleRule, string[]> = { manager: ["admin", "unit_head"], monitor: ["admin", "unit_head"], hr: ["admin"], head: ["unit_head"] };

const SWAGGER_OPERATION = "swagger/apiOperation"; // kunci metadata @ApiOperation (@nestjs/swagger)

/** Route tanpa login (masuk, lupa kata sandi, konfigurasi aplikasi). Di Swagger ditandai tanpa autentikasi. */
export const Public = (): MethodDecorator => (target, key, descriptor) => {
  SetMetadata(PUBLIC, true)(target, key, descriptor);
  const fn = descriptor.value as object;
  Reflect.defineMetadata(SWAGGER_OPERATION, { ...Reflect.getMetadata(SWAGGER_OPERATION, fn), security: [] }, fn);
  return descriptor;
};
/** Batasi peran: manager/monitor (Admin SDM & Kepala Unit), hr (Admin SDM), head (Kepala Unit). */
export const Roles = (rule: RoleRule) => SetMetadata(ROLES, rule);
/** Pengguna yang masuk (diisi AuthGuard). */
export const Me = createParamDecorator((_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest<Request & { user: User }>().user);
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return clientIp(new Headers(req.headers as Record<string, string>), req.socket.remoteAddress ?? null);
});

/** Sesi dari cookie httpOnly (dasbor & aplikasi karyawan). */
export function tokenOf(req: Request): string | null {
  const m = (req.headers.cookie ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Unit yang dipimpin Kepala Unit (unit_heads), unit utama (User.unit) lebih dulu. */
export async function ledUnitNames(u: Pick<User, "id" | "unit">): Promise<string[]> {
  const names = await ledUnitsOf(u);
  return names.length ? names : u.unit ? [u.unit] : [];
}

/** Muat & periksa pengguna dari token (dipakai AuthGuard dan aliran SSE). */
export async function authenticate(req: Request): Promise<User> {
  const t = tokenOf(req);
  if (!t) throw new HttpError(401, "Silakan login terlebih dahulu.");
  const claims = tokenClaims(t);
  if (claims === null) throw new HttpError(401, "Sesi login tidak valid atau kedaluwarsa.");
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, claims.id));
  if (!u) throw new HttpError(401, "Akun tidak ditemukan.");
  if (claims.v !== (u.sessionVersion ?? 0)) throw new HttpError(401, "Kata sandi akun ini sudah diganti. Silakan masuk lagi.");
  if (u.isActive === false) throw new HttpError(401, "Akun Anda tidak aktif. Hubungi admin.");
  if (u.role === "unit_head") setLedUnits(u, await ledUnitNames(u));
  const store = reqStore.getStore();
  if (store) store.actor = { id: u.id, role: u.role, units: scopeUnits(u) };
  if (req.res) (req.res.locals as { userId?: number }).userId = u.id; // untuk log permintaan
  // kata sandi dari admin/email: hanya boleh membaca profil & mengganti kata sandi
  if (u.mustChangePassword && !PASSWORD_GATE_ALLOW.has(relPath(req))) throw new HttpError(403, "Buat kata sandi baru terlebih dahulu.");
  const now = new Date();
  if (!u.lastSeenAt || now.getTime() - u.lastSeenAt.getTime() > 120_000) {
    await db().update(schema.users).set({ lastSeenAt: now }).where(eq(schema.users.id, u.id));
    u.lastSeenAt = now;
  }
  return u;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user: User }>();
    req.user = await authenticate(req);
    const rule = this.reflector.getAllAndOverride<RoleRule | undefined>(ROLES, targets);
    if (rule && !RULES[rule].includes(req.user.role)) throw new HttpError(403, ROLE_MSG[rule]);
    return true;
  }
}

// ------------------------------------------------------------------ validasi

/**
 * Pipe global: parameter dengan skema zod (`@Body({ schema: LoginIn })`, `@Query({ schema })`) divalidasi di sini,
 * dengan galat 422 {"detail": [{loc, msg, type}]} seperti API lama. Skema yang sama dipakai Swagger untuk dokumentasi.
 */
export class SchemaValidationPipe implements PipeTransform {
  transform(value: unknown, meta: ArgumentMetadata): unknown {
    const schema = meta.schema as unknown as ZodType | undefined;
    if (!schema || typeof (schema as { safeParse?: unknown }).safeParse !== "function") return value;
    return parse(schema, value ?? {}, meta.type === "custom" ? "body" : meta.type);
  }
}

/** id path -> angka positif (422 bila bukan). */
export class IdPipe implements PipeTransform<string, number> {
  transform(v: string): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(422, [{ loc: ["path", "id"], msg: "Harus berupa angka", type: "int" }]);
    return n;
  }
}

// ------------------------------------------------------------------ error -> {"detail": ...}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      if (err.headers) for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
      res.status(err.status).json({ detail: err.detail });
      return;
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const r = err.getResponse();
      let detail: unknown = typeof r === "string" ? r : ((r as { message?: unknown }).message ?? err.message);
      if (status === 404 && /^Cannot /.test(String(detail))) detail = "Not Found";
      if (status === 413) detail = "Ukuran data terlalu besar.";
      // multer: file melebihi maxCount
      if (status === 400 && (detail === "Too many files" || detail === "Unexpected field")) return void res.status(422).json({ detail: "Terlalu banyak file sekali unggah." });
      res.status(status).json({ detail });
      return;
    }
    const code = (err as { code?: string })?.code;
    if (code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ detail: "File terlalu besar." });
      return;
    }
    log("error", "http", `${req.method} ${req.originalUrl.split("?")[0]} 500 Internal Server Error: ${err instanceof Error ? err.message : String(err)}`, {
      ip: req.ip,
      user: (res.locals as { userId?: number }).userId,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ detail: "Terjadi kesalahan di server. Coba lagi beberapa saat." });
  }
}

// ------------------------------------------------------------------ konteks permintaan + batas laju + event

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const store: ReqStore = { notifyUids: new Set(), pushes: [] };
  const path = relPath(req);
  if (req.path.startsWith("/api/") && path !== "/events") {
    // batas laju API umum per akun (atau per IP bila belum login); verifikasi wajah dibatasi lebih ketat
    const uid = tokenUserId(tokenOf(req));
    const ident = uid !== null ? `u:${uid}` : `ip:${clientIp(new Headers(req.headers as Record<string, string>), req.socket.remoteAddress ?? null)}`;
    const rules: [string, number][] = [[`api:${ident}`, uid !== null ? settings.API_RATE_PER_MIN : settings.API_RATE_PER_MIN_IP]];
    if (/^\/sessions\/[^/]+\/submit$/.test(path)) rules.push([`face:${ident}`, settings.FACE_SUBMIT_PER_MIN]);
    for (const [key, limit] of rules) {
      const wait = limiter.retryAfter(key, limit, 60);
      if (wait) {
        res.setHeader("Retry-After", String(wait));
        res.status(429).json({ detail: `Terlalu banyak permintaan. Coba lagi dalam ${wait} detik.` });
        return;
      }
    }
    for (const [key] of rules) limiter.hit(key, 60);
  }
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    // notifikasi baru: lonceng penerima diperbarui setelah permintaan selesai
    for (const uid of store.notifyUids) bus.publish("notifications", null, uid);
    if (store.pushes.length) void pushNotifications(store.pushes).catch((e) => log("warn", "push", `Push queue failed: ${(e as Error).message}`));
    const topic = WRITE.has(req.method) ? topicFor(path) : null;
    if (!topic || !store.actor) return;
    const { units, id } = store.actor;
    if (!units?.length) bus.publish(topic, null, null, id);
    else for (const unit of units) bus.publish(topic, unit, null, id); // Kepala Unit beberapa unit: semua unitnya diberi tahu
  });
  reqStore.run(store, next);
}

/** File unggahan (Multer, disimpan di memori). */
export type UploadFile = { fieldname: string; originalname: string; mimetype: string; size: number; buffer: Buffer };
