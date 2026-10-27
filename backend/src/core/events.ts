/**
 * Sinkronisasi real-time lewat Server-Sent Events (GET /api/v1/events).
 * Setiap perubahan data yang berhasil diumumkan sebagai event kecil {topic, unit}; dasbor & aplikasi karyawan
 * lalu memuat ulang data terkait. Event tidak membawa data sensitif.
 */
import { invalidateSettings } from "./settings";

export type Evt = { id: string; topic: string; unit: string | null; user_id: number | null; by: number | null };
type Sub = { userId: number; role: string; units: string[] | null; push: (e: Evt) => void };

const REPLAY = 300;

// path API (tanpa /api/v1) -> topik. Yang tidak cocok tidak diumumkan.
const TOPICS: [RegExp, string][] = [
  [/^\/sessions\/[^/]+\/submit$/, "attendance"],
  [/^\/admin\/(shifts|schedule|patterns)\b/, "schedule"],
  [/^\/admin\/(settings|shift-types|office|holidays)\b/, "settings"],
  [/^\/(admin|me)\/leaves\b/, "leaves"],
  [/^\/(admin|me)\/swaps\b/, "swaps"],
  [/^\/admin\/(folders|files|file-categories)\b|^\/admin\/staff\/\d+\/files$/, "files"],
  [/^\/admin\/(users|staff)\b|^\/me\/(profile|avatar)$/, "staff"],
  [/^\/admin\/units\b/, "units"],
];

export const topicFor = (path: string) => TOPICS.find(([rx]) => rx.test(path))?.[1] ?? null;

export function visible(sub: { userId: number; role: string; units: string[] | null }, e: Pick<Evt, "unit" | "user_id">): boolean {
  if (e.user_id != null) return sub.userId === e.user_id;
  if (e.unit == null) return true;
  return sub.role === "admin" || !!sub.units?.includes(e.unit);
}

class Bus {
  subs = new Set<Sub>();
  recent: Evt[] = [];
  seq = 0;
  /** Event setelah id ini masih tersimpan untuk dikirim ulang (naik saat proses dimulai dan saat buffer penuh). */
  floor = this.nextId();

  private nextId(): string {
    this.seq = (this.seq + 1) % 1000;
    return `${Date.now().toString().padStart(15, "0")}${String(this.seq).padStart(3, "0")}`;
  }

  /** Posisi terbaru; dikirim ke klien sebagai id awal aliran. */
  cursor(): string {
    return this.recent.at(-1)?.id ?? this.floor;
  }

  /** true bila semua event setelah lastId masih bisa dikirim ulang (proses tidak dimulai ulang, buffer belum terlewati). */
  covers(lastId: string): boolean {
    return lastId >= this.floor;
  }

  subscribe(s: Sub) {
    this.subs.add(s);
    return () => this.subs.delete(s);
  }

  since(s: Sub, lastId: string | null): Evt[] {
    if (!lastId) return [];
    return this.recent.filter((e) => e.id > lastId && visible(s, e));
  }

  publish(topic: string, unit: string | null = null, userId: number | null = null, by: number | null = null) {
    const e: Evt = { id: this.nextId(), topic, unit, user_id: userId, by };
    if (topic === "settings") invalidateSettings();
    this.recent.push(e);
    if (this.recent.length > REPLAY) this.floor = this.recent.shift()!.id;
    for (const s of this.subs) if (visible(s, e)) s.push(e);
  }
}

const g = globalThis as unknown as { __abitaBus?: Bus };
export const bus = (g.__abitaBus ??= new Bus());
