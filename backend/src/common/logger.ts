/**
 * Structured application logging.
 *
 *   2026-10-15 14:17:26.104  INFO  [app]  Listening on port 3001 (env=development)
 *   2026-10-15 14:17:31.552  WARN  [http] POST /api/v1/auth/web-login 401 Unauthorized 4ms ip=127.0.0.1
 *
 * Env:
 *   LOG_LEVEL    error | warn | info (default) | debug
 *   LOG_REQUESTS errors (default: 4xx/5xx and slow requests) | all | off
 *   LOG_FORMAT   text (default) | json (one JSON object per line, for log shippers / PM2 files)
 */
import { STATUS_CODES } from "node:http";
import type { LoggerService } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type Level = keyof typeof LEVELS;

const env = (k: string, d: string) => (process.env[k] ?? d).trim().toLowerCase();
const cfg = () => ({
  level: (env("LOG_LEVEL", "info") in LEVELS ? env("LOG_LEVEL", "info") : "info") as Level,
  requests: env("LOG_REQUESTS", "errors"),
  json: env("LOG_FORMAT", "text") === "json",
});
const SLOW_MS = 1500;

const color = (code: number, s: string) => (!cfg().json && process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const LABEL: Record<Level, [string, number]> = { error: ["ERROR", 31], warn: ["WARN ", 33], info: ["INFO ", 36], debug: ["DEBUG", 90] };

function stamp(d = new Date()) {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Write one log record. `context` is a short component name: app, db, http, face, mail, auth… */
export function log(level: Level, context: string, message: string, meta: Record<string, unknown> = {}) {
  const c = cfg();
  if (LEVELS[level] > LEVELS[c.level]) return;
  const out = level === "error" ? process.stderr : process.stdout;
  const { stack, ...fields } = meta;
  if (c.json) {
    out.write(JSON.stringify({ time: new Date().toISOString(), level, context, msg: message, ...fields, ...(stack ? { stack } : {}) }) + "\n");
    return;
  }
  const kv = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : v}`)
    .join(" ");
  const [label, code] = LABEL[level];
  out.write(`${color(90, stamp())}  ${color(code, label)} ${color(90, `[${context}]`.padEnd(7))} ${message}${kv ? " " + color(90, kv) : ""}${stack ? "\n" + color(90, String(stack)) : ""}\n`);
}

// Nest framework contexts that only produce start-up noise (route mapping, module wiring).
const QUIET = new Set(["NestFactory", "InstanceLoader", "RoutesResolver", "RouterExplorer", "NestApplication"]);

/** Nest LoggerService adapter: same format, framework start-up noise moved to debug. */
export class AppLogger implements LoggerService {
  private split(params: unknown[]): [string, string | undefined] {
    const last = params[params.length - 1];
    const ctx = typeof last === "string" && !last.includes("\n") ? last : "app";
    const stack = params.find((p) => typeof p === "string" && p.includes("\n    at ")) as string | undefined;
    return [ctx.toLowerCase(), stack];
  }
  private text = (m: unknown) => (m instanceof Error ? m.message : typeof m === "string" ? m : JSON.stringify(m));
  log(message: unknown, ...params: unknown[]) {
    const [ctx] = this.split(params);
    const raw = params[params.length - 1];
    log(typeof raw === "string" && QUIET.has(raw) ? "debug" : "info", ctx, this.text(message));
  }
  error(message: unknown, ...params: unknown[]) {
    const [ctx, stack] = this.split(params);
    log("error", ctx, this.text(message), { stack: stack ?? (message instanceof Error ? message.stack : undefined) });
  }
  warn(message: unknown, ...params: unknown[]) {
    log("warn", this.split(params)[0], this.text(message));
  }
  debug(message: unknown, ...params: unknown[]) {
    log("debug", this.split(params)[0], this.text(message));
  }
  verbose(message: unknown, ...params: unknown[]) {
    log("debug", this.split(params)[0], this.text(message));
  }
}

/** Machine-readable fields for a 4xx (validation fields, reason code). User-facing copy is never logged. */
function reason(status: number, body: unknown): Record<string, string> {
  const d = (body as { detail?: unknown })?.detail;
  if (status === 422 && Array.isArray(d)) {
    return { error: "validation_failed", fields: d.map((x: { loc?: string[] }) => (x.loc ?? []).slice(1).join(".") || "body").join(",") };
  }
  if (d && typeof d === "object" && "reason_code" in d) return { reason: String((d as { reason_code: unknown }).reason_code) };
  return {};
}

/** One line per request: method, path, status, duration, client and user. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const mode = cfg().requests;
  if (mode === "off" || req.path === "/api/v1/events") return next();
  const t0 = process.hrtime.bigint();
  const send = res.json.bind(res);
  let why: Record<string, string> = {};
  res.json = (body: unknown) => {
    if (res.statusCode >= 400) why = reason(res.statusCode, body);
    return send(body);
  };
  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
    const s = res.statusCode;
    const slow = ms > SLOW_MS;
    if (s >= 500) return; // logged by ApiExceptionFilter with the stack trace
    if (mode !== "all" && s < 400 && !slow) return;
    if (mode !== "all" && s === 401 && req.method === "GET") return; // anonymous session probe from the login screen
    const user = (res.locals as { userId?: number }).userId;
    const status = `${s} ${STATUS_CODES[s] ?? ""}`.trim();
    log(s >= 400 || slow ? "warn" : "info", "http", `${req.method} ${req.originalUrl.split("?")[0]} ${status} ${ms}ms${slow ? " (slow)" : ""}`, {
      ip: req.ip,
      user,
      ...why,
    });
  });
  next();
}
