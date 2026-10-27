#!/usr/bin/env node
/**
 * Backend (API) development start:  npm run dev   (Windows: double-click dev.cmd)
 *
 *   1. .env              created from .env.example (random JWT_SECRET) if missing
 *   2. dependencies      `npm install` if node_modules is missing or outdated
 *   3. MySQL             started from XAMPP if not running (Apache too, for phpMyAdmin)
 *   4. database          created if missing; tables pushed; default Admin SDM account if empty
 *   5. port              API_PORT (3001) checked; the program holding a busy port is named
 *   6. API               NestJS in watch mode on :3001 (the frontend folder runs separately and proxies /api here)
 *
 * Flags: --no-xampp (don't start XAMPP services), --no-seed (never seed), --check (run checks only).
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const isWin = process.platform === "win32";
const XAMPP = process.env.XAMPP_DIR || (isWin ? "C:\\xampp" : "/opt/lampp");
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (msg, note = "") => console.log(`  ${c(32, "✓")} ${msg}${note ? c(90, "  " + note) : ""}`);
const info = (msg) => console.log(`  ${c(36, "•")} ${msg}`);
const fail = (msg, hint) => {
  console.error(`  ${c(31, "✗")} ${msg}${hint ? "\n    " + c(90, hint) : ""}`);
  process.exit(1);
};
/** Run an npm command; `quiet` hides its output unless it fails. */
const run = (command, quiet = false) => {
  const r = spawnSync(command, { cwd: ROOT, shell: true, stdio: quiet ? ["inherit", "pipe", "pipe"] : "inherit", encoding: "utf8" });
  if (r.status !== 0) {
    if (quiet) process.stderr.write(`${r.stdout ?? ""}${r.stderr ?? ""}`);
    fail(`"${command}" failed (exit ${r.status})`);
  }
};
const portOpen = (port, host = "127.0.0.1") =>
  new Promise((resolve) => {
    const s = net.connect(port, host);
    s.setTimeout(800);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("timeout", () => (s.destroy(), resolve(false)));
    s.once("error", () => resolve(false));
  });
const waitPort = async (port, host, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) if (await portOpen(port, host)) return true;
  return false;
};

console.log(`\n${c(1, "ABiTA")} ${c(90, "development")}\n`);

// ------------------------------------------------------------------ 0. Node.js
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 20 || (maj === 20 && min < 19)) fail(`Node.js ${process.versions.node} is too old`, "Install Node.js 22 LTS or newer.");
ok(`Node.js ${process.versions.node}`);

// ------------------------------------------------------------------ 1. .env
const envFile = path.join(ROOT, ".env");
if (!fs.existsSync(envFile)) {
  const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  fs.writeFileSync(envFile, example.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(32).toString("hex")}`));
  ok(".env", "created from .env.example");
} else ok(".env");
const env = Object.fromEntries( // like dotenv: real environment variables win over .env
  fs
    .readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
for (const k of Object.keys(env)) if (process.env[k]) env[k] = process.env[k];
const ports = { api: Number(env.API_PORT) || 3001 };

// ------------------------------------------------------------------ 2. dependencies
const lock = path.join(ROOT, "package-lock.json");
const marker = path.join(ROOT, "node_modules", ".package-lock.json");
if (!fs.existsSync(path.join(ROOT, "node_modules", "@nestjs", "cli")) || (fs.existsSync(lock) && fs.existsSync(marker) && fs.statSync(lock).mtimeMs > fs.statSync(marker).mtimeMs + 1000)) {
  info("Installing dependencies…");
  run("npm install --no-fund --no-audit");
}
ok("Dependencies");

// ------------------------------------------------------------------ 3. MySQL (+ Apache for phpMyAdmin)
const db = new URL(env.DATABASE_URL || "mysql://root:@127.0.0.1:3306/abita");
const dbHost = db.hostname === "localhost" ? "127.0.0.1" : db.hostname;
const dbPort = Number(db.port) || 3306;
const dbName = db.pathname.slice(1);
const local = ["127.0.0.1", "::1"].includes(dbHost);

function startDetached(exe, exeArgs, cwd) {
  const p = spawn(exe, exeArgs, { cwd, detached: true, stdio: "ignore", windowsHide: true });
  p.unref();
}

if (await portOpen(dbPort, dbHost)) ok(`MySQL ${dbHost}:${dbPort}`);
else {
  const mysqld = path.join(XAMPP, "mysql", "bin", isWin ? "mysqld.exe" : "mysqld");
  if (!local || args.has("--no-xampp") || !fs.existsSync(mysqld)) fail(`MySQL is not reachable at ${dbHost}:${dbPort}`, "Start MySQL (XAMPP Control Panel → MySQL → Start), then run `npm run dev` again.");
  startDetached(mysqld, [`--defaults-file=${path.join(XAMPP, "mysql", "bin", "my.ini")}`, "--standalone"], XAMPP);
  if (!(await waitPort(dbPort, dbHost, 30_000))) fail("MySQL did not start within 30s", `Check ${path.join(XAMPP, "mysql", "data", "mysql_error.log")}`);
  ok(`MySQL ${dbHost}:${dbPort}`, "started from XAMPP");
}
if (local && !args.has("--no-xampp")) {
  const httpd = path.join(XAMPP, "apache", "bin", isWin ? "httpd.exe" : "httpd");
  if (await portOpen(80)) ok("phpMyAdmin", "http://localhost/phpmyadmin");
  else if (fs.existsSync(httpd)) {
    startDetached(httpd, [], XAMPP);
    if (await waitPort(80, "127.0.0.1", 10_000)) ok("phpMyAdmin", "http://localhost/phpmyadmin (Apache started from XAMPP)");
    else info("Apache did not start (port 80 busy?). phpMyAdmin unavailable; the app is not affected.");
  }
}

// ------------------------------------------------------------------ 4. database, tables, seed data
const require = createRequire(path.join(ROOT, "package.json"));
const mysql = require("mysql2/promise");
let conn;
try {
  conn = await mysql.createConnection({ host: dbHost, port: dbPort, user: decodeURIComponent(db.username), password: decodeURIComponent(db.password) });
} catch (e) {
  fail(`Cannot log in to MySQL: ${e.code ?? e.message}`, "Check the user/password in DATABASE_URL (.env).");
}
await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const [[{ n: tables }]] = await conn.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [dbName]);
if (!tables) {
  info(`Creating tables in ${dbName}…`);
  run("npm run db:push --silent", true);
}
const countUsers = async () => (await conn.query(`SELECT COUNT(*) n FROM \`${dbName}\`.users`).catch(() => [[{ n: 0 }]]))[0][0].n;
let users = await countUsers();
if (!users && !args.has("--no-seed")) {
  info("Database is empty; adding the default Admin SDM account…");
  run("npm run db:seed --silent");
  users = await countUsers();
}
const [[{ n: tableCount }]] = await conn.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [dbName]);
await conn.end();
ok(`Database ${dbName}`, `${tableCount} tables, ${users} users`);

// face models
const models = ["face_detection_yunet_2023mar.onnx", "face_recognition_sface_2021dec.onnx"].filter((f) => !fs.existsSync(path.join(ROOT, "models", f)));
if (models.length) info(`Face models missing in models/: ${models.join(", ")} (check-in will fail)`);
else ok("Face models");

// ------------------------------------------------------------------ 5. ports
function holder(port) {
  try {
    if (isWin) {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
      const line = out.split(/\r?\n/).find((l) => new RegExp(`:${port}\\s+\\S+\\s+LISTENING`).test(l));
      if (!line) return null;
      const pid = Number(line.trim().split(/\s+/).pop());
      const cmd = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`], { encoding: "utf8" }).trim();
      return { pid, cmd };
    }
    const pid = Number(execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0]);
    return pid ? { pid, cmd: execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim() } : null;
  } catch {
    return null;
  }
}
const busy = [];
for (const [name, port] of Object.entries(ports)) {
  if (!(await portOpen(port))) continue;
  const h = holder(port);
  const ours = h && h.cmd.toLowerCase().includes(ROOT.toLowerCase());
  busy.push(`    ${String(port).padEnd(5)} ${name.padEnd(6)} ${h ? `pid ${h.pid}  ${ours ? "(ABiTA API already running)" : h.cmd.slice(0, 70)}` : ""}`);
}
if (busy.length) {
  const kill = isWin ? "taskkill /PID <pid> /T /F" : "kill <pid>";
  fail(`Port already in use:\n${busy.join("\n")}`, `Stop it (Ctrl+C in its terminal, or ${kill}), or change the port in .env.`);
}
ok(`Ports ${Object.values(ports).join(", ")} available`);

if (args.has("--check")) process.exit(0);

// ------------------------------------------------------------------ 6. start API
const api = `http://localhost:${ports.api}`;
console.log(`
  ${c(1, "API")}       ${c(36, `${api}/api/v1`)}
  ${c(1, "API docs")}  ${c(36, `${api}/api/docs`)}
  ${c(90, "Frontend: npm run dev di folder frontend (http://localhost:3000). Ctrl+C to stop")}
`);
const child = spawn("npm run dev:watch --silent", { cwd: ROOT, stdio: "inherit", shell: true });
// Ctrl+C reaches the child directly (same console); stay alive until it has stopped
process.on("SIGINT", () => {});
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
