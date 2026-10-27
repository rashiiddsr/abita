import "reflect-metadata";
import { settings } from "./core/config"; // must load first: reads .env before other modules touch process.env
import { NestFactory, Reflector } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { AppLogger, log, requestLogger } from "./common/logger";
import helmet from "helmet";
import { ApiExceptionFilter, API_PREFIX, AuthGuard, requestContext, SchemaValidationPipe } from "./common/nest";
import { DOCS_PATH, setupSwagger } from "./common/swagger";
import { pool } from "./db";
import { ensureSchema } from "./db/ensure";
import { AppModule } from "./app.module";
import { loadModels } from "./domain/face/models";
import { allowedOrigin, WEB_ORIGINS } from "./core/web";
import { startInstanceLock } from "./core/instance";

const DB_HINTS: Record<string, string> = {
  ECONNREFUSED: "MySQL is not running. Start it from the XAMPP Control Panel (or run `npm run dev`, which starts it).",
  ER_BAD_DB_ERROR: "Database does not exist. Create it in phpMyAdmin or run `npm run dev`.",
  ER_NO_SUCH_TABLE: "Tables are missing. Run `npm run db:push`.",
  ER_ACCESS_DENIED_ERROR: "MySQL credentials in DATABASE_URL (.env) were rejected.",
};

/** Fail fast with an actionable message when MySQL is unreachable or not initialised. */
async function checkDatabase(): Promise<string> {
  const url = new URL(settings.DATABASE_URL);
  const target = `${url.hostname}:${url.port || 3306}/${url.pathname.slice(1)}`;
  try {
    await pool().query("SELECT 1 FROM users LIMIT 1");
    await ensureSchema(pool());
    return target;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    log("error", "db", `Cannot use MySQL at ${target}: ${err.code ?? err.message}`, { hint: DB_HINTS[err.code ?? ""] });
    process.exit(1);
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const sameHost = (origin: string, req: Request) => {
  try {
    return new URL(origin).host === String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  } catch {
    return false;
  }
};

async function bootstrap() {
  const t0 = Date.now();
  const db = await checkDatabase();
  log("info", "db", `Connected to MySQL ${db}`);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: new AppLogger() });
  app.set("trust proxy", "loopback"); // client IP from the frontend server proxy (X-Forwarded-For) is trusted only from localhost
  app.disable("x-powered-by");
  // Frontend dapat berada di origin lain: izinkan pemuatan gambar lintas origin dan penyematan PDF lampiran.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: settings.COOKIE_SAMESITE === "none" ? "cross-origin" : "same-site" },
      frameguard: false,
      contentSecurityPolicy: { directives: { frameAncestors: ["'self'", ...WEB_ORIGINS] } },
    }),
  );
  app.enableCors({ origin: (o, cb) => cb(null, !o || allowedOrigin(o)), credentials: true, maxAge: 86_400 });
  // Proteksi CSRF: permintaan yang mengubah data hanya diterima dari origin API sendiri atau frontend terdaftar.
  app.use((req: Request, res: Response, next: () => void) => {
    const origin = req.headers.origin;
    if (!origin || SAFE_METHODS.has(req.method) || allowedOrigin(origin) || sameHost(origin, req)) return next();
    res.status(403).json({ detail: "Origin tidak diizinkan." });
  });
  app.useBodyParser("json", { limit: "5mb" });
  // hosting (cPanel "Setup Node.js App" dengan Application URL /api) bisa meneruskan alamat tanpa awalan /api
  app.use((req: { url: string }, _res: unknown, next: () => void) => {
    if (/^\/(v1|docs)(\/|\?|$)/.test(req.url)) req.url = `/api${req.url}`;
    next();
  });
  app.use(requestLogger);
  app.use(requestContext);
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalGuards(new AuthGuard(app.get(Reflector)));
  app.useGlobalPipes(new SchemaValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  if (settings.DEBUG || settings.API_DOCS) setupSwagger(app); // production: dokumentasi API hanya bila API_DOCS=true
  try {
    await app.listen(settings.API_PORT, "0.0.0.0");
  } catch (e) {
    if ((e as { code?: string }).code === "EADDRINUSE") {
      log("error", "app", `Port ${settings.API_PORT} is already in use`, { hint: "Stop the other API instance or change API_PORT in .env." });
      process.exit(1);
    }
    throw e;
  }
  log("info", "app", `Listening on port ${settings.API_PORT}`, { env: process.env.NODE_ENV ?? "development", startup_ms: Date.now() - t0 });
  if (!settings.DEBUG && settings.JWT_SECRET.length < 32) log("warn", "app", "JWT_SECRET is shorter than 32 characters", { hint: "Use a long random value (e.g. 64 hex chars); changing it signs everyone out once." });
  log("info", "app", "Web origins allowed", { origins: WEB_ORIGINS.join(", "), cookie_samesite: settings.COOKIE_SAMESITE });
  if (settings.DEBUG || settings.API_DOCS) log("info", "app", `API docs at /${DOCS_PATH}`);
  startInstanceLock(); // tugas terjadwal hanya dijalankan oleh satu proses per database
  // face models are loaded once at start-up, not on the first check-in
  const tf = Date.now();
  loadModels()
    .then(() => log("info", "face", "Recognition models loaded (YuNet, SFace)", { ms: Date.now() - tf }))
    .catch((e) => log("error", "face", `Recognition models failed to load: ${e.message}`, { dir: settings.MODELS_DIR }));
}

process.on("unhandledRejection", (e) => log("error", "app", `Unhandled promise rejection: ${(e as Error)?.message ?? e}`, { stack: (e as Error)?.stack }));
void bootstrap();
