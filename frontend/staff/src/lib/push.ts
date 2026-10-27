/**
 * Notifikasi push (Web Push) aplikasi karyawan: izin browser -> PushManager.subscribe (kunci VAPID dari API) -> simpan
 * langganan di server. Pesan ditampilkan service worker (public/push-sw.js). Hanya aktif di versi build / hosting
 * (service worker tidak dipasang saat `npm run dev`).
 */
import { api } from "./api";
import type { PushConfig } from "./types";

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
  if (!reg) throw new Error("Service worker aplikasi belum aktif. Buka aplikasi versi hosting lalu coba lagi.");
  return reg;
}

/** Langganan perangkat ini (null bila belum / tidak didukung). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Minta izin, berlangganan, dan daftarkan perangkat ini ke akun yang sedang masuk. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("Browser ini tidak mendukung notifikasi push.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Izin notifikasi ditolak. Aktifkan di pengaturan browser/HP." : "Izin notifikasi belum diberikan.");
  const reg = await registration();
  const { public_key } = await api<PushConfig>("/me/push");
  let sub = await reg.pushManager.getSubscription();
  // kunci server berganti: langganan lama tidak bisa dipakai lagi
  const key = sub?.options.applicationServerKey;
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== public_key) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) });
  await api("/me/push", { body: sub.toJSON() });
}

/** Berhenti menerima push di perangkat ini. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("/me/push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe();
}

/** Saat aplikasi dibuka: langganan yang sudah ada dikaitkan lagi ke akun yang sedang masuk (ganti akun, data server direset). */
export async function syncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await api("/me/push", { body: sub.toJSON() }).catch(() => undefined);
}
