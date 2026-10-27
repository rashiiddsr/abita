/** Email lewat SMTP yang diatur di dasbor (Pengaturan → SMTP): kredensial akun baru & atur ulang kata sandi. */
import { randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { log } from "../common/logger";
import { settings } from "../core/config";
import { getSetting } from "../core/settings";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // tanpa karakter mirip (0/O, 1/l)

export class MailError extends Error {}

/** Kata sandi acak yang mudah diketik: huruf besar, kecil, dan angka. */
export function generatePassword(length = 10): string {
  for (;;) {
    let pw = "";
    for (let i = 0; i < length; i++) pw += ALPHABET[randomInt(ALPHABET.length)];
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}

export async function smtpConfig() {
  return {
    host: String(await getSetting("smtp_host")),
    port: Number(await getSetting("smtp_port")),
    encryption: String(await getSetting("smtp_encryption")),
    username: String(await getSetting("smtp_username")),
    password: String(await getSetting("smtp_password")),
    sender: String(await getSetting("smtp_sender")),
  };
}

type Sender = (to: string, subject: string, text: string, html?: string) => Promise<void>;

/** Bisa diganti di tes (tanpa server SMTP sungguhan). */
export const mail: { send: Sender } = {
  async send(to, subject, text, html) {
    const c = await smtpConfig();
    if (!c.host || !c.sender) throw new MailError("SMTP belum diatur. Isi di Pengaturan → SMTP.");
    const port = c.port || (c.encryption === "ssl" ? 465 : 587);
    const t = nodemailer.createTransport({
      host: c.host,
      port,
      secure: c.encryption === "ssl",
      requireTLS: c.encryption === "tls",
      ignoreTLS: c.encryption === "none",
      auth: c.username ? { user: c.username, pass: c.password } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    try {
      await t.sendMail({ from: { name: settings.ORG_NAME, address: c.sender }, to, subject, text, html });
    } catch (e) {
      const err = e as { code?: string; responseCode?: number; command?: string; message?: string };
      const gmail = /gmail|google/.test(c.host);
      log("warn", "mail", `SMTP delivery failed: ${err.code ?? "ERROR"}`, { host: `${c.host}:${port}`, tls: c.encryption, response: err.responseCode, command: err.command });
      if (err.code === "EAUTH" || err.responseCode === 535)
        throw new MailError(
          "Login SMTP ditolak server." +
            (gmail
              ? " Untuk Gmail: aktifkan Verifikasi 2 Langkah, lalu buat App Password (16 huruf) di myaccount.google.com/apppasswords dan pakai sebagai Password, bukan kata sandi akun Google."
              : " Periksa username dan password SMTP."),
        );
      if (err.command === "RCPT TO") throw new MailError(`Alamat penerima ditolak server: ${to}.`);
      if (err.command === "MAIL FROM") throw new MailError("Email pengirim ditolak server. Untuk Gmail, email pengirim harus sama dengan username.");
      if (["ETIMEDOUT", "ECONNECTION", "ECONNREFUSED", "ESOCKET", "EDNS", "ENOTFOUND"].includes(err.code ?? ""))
        throw new MailError(`Tidak bisa terhubung ke ${c.host}:${port}. Cocokkan port dan enkripsi (465 = SSL, 587 = TLS).`);
      throw new MailError(`Email gagal dikirim: ${err.message ?? e}`);
    }
  },
};

export async function isConfigured() {
  const c = await smtpConfig();
  return !!(c.host && c.sender);
}

/** Kirim email; pesan galat atau null bila berhasil. */
export async function trySend(to: string | null | undefined, subject: string, text: string, html?: string): Promise<string | null> {
  if (!to) return "Akun tidak punya email.";
  try {
    await mail.send(to, subject, text, html);
    return null;
  } catch (e) {
    return e instanceof MailError ? e.message : `Email gagal dikirim: ${(e as Error).message}`;
  }
}

// ------------------------------------------------------------------ isi email

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function html(title: string, lines: string[], box: [string, string][] = [], button?: [string, string]): string {
  const rows = box
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#5B6678">${esc(k)}</td><td style="padding:6px 0;font-weight:600;font-family:monospace;font-size:15px">${esc(v)}</td></tr>`)
    .join("");
  const boxHtml = rows ? `<table style="margin:16px 0;padding:12px 16px;background:#F4F6F8;border-radius:8px;width:100%">${rows}</table>` : "";
  const btn = button
    ? `<p style="margin:20px 0"><a href="${esc(button[1])}" style="background:#007A87;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(button[0])}</a></p>`
    : "";
  const body = lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join("");
  return (
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0D1726;max-width:520px">' +
    `<p style="font-size:17px;font-weight:600;margin:0 0 14px">${esc(title)}</p>${body}${boxHtml}${btn}` +
    `<p style="margin-top:24px;color:#97A1B0;font-size:12px">${esc(settings.ORG_NAME)}</p></div>`
  );
}

export function credentialsEmail(name: string, login: string, password: string, isStaff: boolean, appUrl: string): [string, string, string] {
  const where = isStaff ? `aplikasi ABiTA: ${appUrl}/staff` : `dasbor admin: ${appUrl}/admin`;
  const subject = `Akun ABiTA ${settings.ORG_NAME}`;
  const text =
    `Halo ${name},\n\nAkun ABiTA Anda sudah dibuat. Masuk di ${where}.\n\nEmail/NIK : ${login}\nKata sandi: ${password}\n\n` +
    "Segera ganti kata sandi setelah masuk pertama kali." +
    (isStaff ? "\nSaat pertama masuk, Anda akan diminta mendaftarkan wajah." : "");
  return [
    subject,
    text,
    html(
      "Akun ABiTA Anda sudah dibuat",
      [`Halo ${name},`, `Masuk di ${where}.`],
      [
        ["Email/NIK", login],
        ["Kata sandi", password],
      ],
      [isStaff ? "Buka aplikasi" : "Buka dasbor", isStaff ? `${appUrl}/staff` : `${appUrl}/admin`],
    ),
  ];
}

/** Kata sandi baru dari permintaan "Lupa kata sandi" (bukan reset oleh admin). */
export function forgotPasswordEmail(name: string, login: string, password: string): [string, string, string] {
  return [
    "Kata sandi baru ABiTA",
    `Halo ${name},

Anda meminta kata sandi baru untuk akun ABiTA.

Email/NIK : ${login}
Kata sandi baru: ${password}

Kata sandi ini berlaku 24 jam. Setelah masuk, Anda wajib membuat kata sandi sendiri.
Bila Anda tidak memintanya, abaikan email ini: kata sandi lama Anda tetap berlaku.`,
    html(
      "Kata sandi baru",
      [`Halo ${name},`, "Anda meminta kata sandi baru untuk akun ABiTA. Kata sandi ini berlaku 24 jam; setelah masuk, Anda wajib membuat kata sandi sendiri.", "Bila Anda tidak memintanya, abaikan email ini: kata sandi lama Anda tetap berlaku."],
      [
        ["Email/NIK", login],
        ["Kata sandi baru", password],
      ],
    ),
  ];
}

export function tempPasswordEmail(name: string, login: string, password: string): [string, string, string] {
  return [
    "Kata sandi ABiTA Anda direset",
    `Halo ${name},\n\nKata sandi akun ABiTA Anda direset oleh admin.\n\nEmail/NIK : ${login}\nKata sandi baru: ${password}\n\nSegera ganti setelah masuk.`,
    html(
      "Kata sandi Anda direset",
      [`Halo ${name},`, "Kata sandi akun ABiTA Anda direset oleh admin."],
      [
        ["Email/NIK", login],
        ["Kata sandi baru", password],
      ],
    ),
  ];
}
