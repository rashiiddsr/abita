/** Pengaturan yang diubah dari dasbor (tabel app_settings), di-cache singkat per proses. */
import { eq } from "drizzle-orm";
import { settings as env } from "./config";
import { db, schema, type DB } from "../db";

export const DEFAULTS = {
  // jendela absen terhadap jadwal shift (menit)
  checkin_open_before_min: 120 as number,
  checkin_close_after_min: 60 as number,
  checkout_open_before_min: 60 as number,
  checkout_close_after_min: 120 as number,
  escalation_hours: 48 as number,
  schedule_deadline_day: 25 as number,
  helpdesk_email: "" as string,
  helpdesk_whatsapp: "" as string,
  sdm_decides_headless: true as boolean,
  smtp_host: "" as string,
  smtp_port: 587 as number,
  smtp_encryption: "tls" as string,
  smtp_username: "" as string,
  smtp_password: "" as string,
  smtp_sender: "" as string,
};
export type SettingKey = keyof typeof DEFAULTS;
export type SettingValues = { [K in SettingKey]: (typeof DEFAULTS)[K] };

const TTL_MS = 15_000;
const g = globalThis as unknown as { __abitaSettings?: { at: number; vals: Record<string, unknown> } | null };

export function invalidateSettings() {
  g.__abitaSettings = null;
}

async function load(q: DB = db()): Promise<Record<string, unknown>> {
  const rows = await q.select().from(schema.appSettings);
  const vals: Record<string, unknown> = {};
  for (const r of rows) vals[r.key] = (r.value as { v?: unknown } | null)?.v;
  g.__abitaSettings = { at: Date.now(), vals };
  return vals;
}

async function values(): Promise<Record<string, unknown>> {
  const hit = g.__abitaSettings;
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.vals;
  return load();
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
  const v = (await values())[key];
  return (v === undefined || v === null ? DEFAULTS[key] : v) as SettingValues[K];
}

export async function allSettings(q?: DB): Promise<SettingValues> {
  const vals = await load(q);
  const out = {} as Record<string, unknown>;
  for (const [k, d] of Object.entries(DEFAULTS)) out[k] = vals[k] ?? d;
  return out as SettingValues;
}

export async function putSettings(values: Partial<Record<string, unknown>>, q: DB = db()): Promise<SettingValues> {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULTS) || v === undefined || v === null) continue;
    const [row] = await q.select({ key: schema.appSettings.key }).from(schema.appSettings).where(eq(schema.appSettings.key, k));
    if (row) await q.update(schema.appSettings).set({ value: { v }, updatedAt: new Date() }).where(eq(schema.appSettings.key, k));
    else await q.insert(schema.appSettings).values({ key: k, value: { v } });
  }
  invalidateSettings();
  return allSettings(q);
}
