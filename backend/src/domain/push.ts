/**
 * Web Push untuk aplikasi karyawan: notifikasi muncul di HP/komputer walau aplikasi ditutup.
 * Kunci VAPID dari .env (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) atau dibuat sekali dan disimpan di app_settings.
 * Pesan dienkripsi web-push (generateRequestDetails) lalu dikirim dengan fetch; langganan yang sudah tidak berlaku
 * (404/410 dari layanan push) dihapus.
 */
import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { settings } from "../core/config";
import { db, schema } from "../db";
import { log } from "../common/logger";

const { appSettings, notifications, pushSubscriptions, users } = schema;
const KEY = "push_vapid";

type Vapid = { publicKey: string; privateKey: string };
let cached: Vapid | null = null;

/** Kunci VAPID (dibuat sekali bila belum ada). */
export async function vapidKeys(): Promise<Vapid> {
  if (cached) return cached;
  if (settings.VAPID_PUBLIC_KEY && settings.VAPID_PRIVATE_KEY) return (cached = { publicKey: settings.VAPID_PUBLIC_KEY, privateKey: settings.VAPID_PRIVATE_KEY });
  const [row] = await db().select().from(appSettings).where(eq(appSettings.key, KEY));
  const saved = row?.value?.v as Vapid | undefined;
  if (saved?.publicKey && saved.privateKey) return (cached = saved);
  const keys = webpush.generateVAPIDKeys();
  await db().insert(appSettings).values({ key: KEY, value: { v: keys } }).onDuplicateKeyUpdate({ set: { key: KEY } });
  const [again] = await db().select().from(appSettings).where(eq(appSettings.key, KEY)); // proses lain mungkin lebih dulu menyimpan
  return (cached = (again?.value?.v as Vapid) ?? keys);
}

/** "mailto:" atau URL https situs (wajib bagi layanan push Apple/Google). */
function subject(): string {
  if (settings.VAPID_SUBJECT) return settings.VAPID_SUBJECT;
  return /^https:\/\//.test(settings.PUBLIC_APP_URL) ? settings.PUBLIC_APP_URL : "mailto:noreply@abita.local";
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/** Kirim ke semua perangkat milik pengguna. Mengembalikan jumlah yang terkirim. */
export async function pushToUser(userId: number, payload: PushPayload): Promise<number> {
  const subs = await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (!subs.length) return 0;
  const { publicKey, privateKey } = await vapidKeys();
  let sent = 0;
  for (const s of subs) {
    try {
      const req = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject: subject(), publicKey, privateKey },
        TTL: 24 * 3600,
        urgency: "high",
        topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
      });
      const res = await fetch(req.endpoint, { method: req.method, headers: req.headers as Record<string, string>, body: req.body ? new Uint8Array(req.body) : undefined, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404 || res.status === 410) {
        await db().delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)); // langganan kedaluwarsa / dicabut
      } else if (res.ok) {
        sent++;
        await db().update(pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
      } else {
        log("warn", "push", `Push rejected (${res.status})`, { user: userId, body: (await res.text()).slice(0, 200) });
      }
    } catch (e) {
      log("warn", "push", `Push failed: ${(e as Error).message}`, { user: userId });
    }
  }
  return sent;
}

/** Push untuk notifikasi yang baru dibuat (hanya akun karyawan). Membuka detail notifikasi di aplikasi saat diketuk. */
export async function pushNotifications(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const rows = await db()
    .select({ id: notifications.id, userId: notifications.userId, title: notifications.title, body: notifications.body, kind: notifications.kind })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(inArray(notifications.id, ids), eq(users.role, "staff")));
  for (const n of rows) await pushToUser(n.userId, { title: n.title, body: n.body ?? "", url: `/staff/notifications/${n.id}`, tag: `n${n.id}` });
}

/** Simpan / perbarui langganan perangkat (endpoint yang sama pindah ke akun yang sedang masuk). */
export async function saveSubscription(userId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | null) {
  await db()
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 255) ?? null })
    .onDuplicateKeyUpdate({ set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 255) ?? null } });
}

export async function removeSubscription(userId: number, endpoint: string) {
  await db().delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}
