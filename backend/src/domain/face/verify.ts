/**
 * Verifikasi submit sesi wajah. Klien hanya membimbing; server yang memutuskan.
 * Langkah: klaim sesi -> jumlah frame -> decode -> deteksi (wajah terdekat) -> gerakan kepala -> embedding
 * -> konsistensi antar-frame -> cocok dengan template -> aturan masuk/pulang -> lokasi -> simpan.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { settings } from "../../core/config";
import { db, schema } from "../../db";
import type { Attendance, User } from "../../db/schema";
import { checkGeofence, checkPrerequisite, claimSession, lateMinutes, resolveWorkDate, shiftFor } from "../rules";
import { notifyManagers } from "../services";
import { cosine, decode, detect, embed, faceQuality, fromBlob, normalize, toBlob, yawRatio, type Detection, type Img } from "./models";

export const MAX_FRAME_BYTES = 3 * 1024 * 1024;

class Fail extends Error {
  constructor(public code: string) {
    super(code);
  }
}

type Meta = Record<string, unknown>;

type Ctx = {
  user: User;
  sessionId: string;
  frames: Buffer[];
  meta: Meta;
  now: Date;
  purpose: string;
  challenges: string[];
  images: Img[];
  detections: Detection[];
  embeddings: Map<number, Float32Array>;
  scores: Record<string, unknown> & { frames?: Record<string, unknown>[] };
  matchScore: number | null;
  distanceM: number | null;
  attendance: Attendance | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function fs_(c: Ctx, i: number) {
  c.scores.frames ??= c.frames.map(() => ({}));
  return c.scores.frames[i];
}

/** Wajah utama = bbox terlebar (paling dekat ke kamera); wajah kedua untuk cek keraguan. */
export function mainFace(dets: Detection[]): [Detection | null, Detection | null] {
  const r = [...dets].sort((a, b) => b.box[2] - a.box[2]);
  return [r[0] ?? null, r[1] ?? null];
}

export function challengeOk(challenge: string, yaw: number | null): boolean {
  const s = settings;
  const [left, right] = s.SWAP_LEFT_RIGHT ? ["turn_right", "turn_left"] : ["turn_left", "turn_right"];
  if (yaw === null) return false;
  if (challenge === "center") return yaw >= s.YAW_CENTER_MIN && yaw <= s.YAW_CENTER_MAX;
  if (challenge === left) return yaw > s.YAW_LEFT_MIN;
  if (challenge === right) return yaw < s.YAW_RIGHT_MAX;
  return false; // "blink" tidak didukung lagi
}

// ---------------------------------------------------------------- langkah

async function stepDecode(c: Ctx) {
  for (const raw of c.frames) {
    if (!raw.length || raw.length > MAX_FRAME_BYTES) throw new Fail("BAD_IMAGE");
    const img = await decode(raw);
    if (!img || img.width < 64 || img.height < 64) throw new Fail("BAD_IMAGE");
    c.images.push(img);
  }
}

async function stepDetect(c: Ctx) {
  for (let i = 0; i < c.images.length; i++) {
    const dets = await detect(c.images[i]);
    const [main, second] = mainFace(dets);
    const f = fs_(c, i);
    f.challenge = c.challenges[i];
    f.faces = dets.length;
    f.det_score = main ? Math.round(main.score * 1e4) / 1e4 : null;
    if (!main) throw new Fail("NO_FACE");
    const width = main.box[2] / c.images[i].width;
    f.face_width_pct = Math.round(1000 * width) / 10;
    // kualitas dicek di server juga: klien hanya membimbing dan bisa dimodifikasi
    const q = faceQuality(c.images[i], main);
    f.brightness = Math.round(q.brightness);
    f.sharpness = Math.round(q.sharpness);
    if (width < settings.MIN_FACE_WIDTH) throw new Fail("FACE_TOO_SMALL");
    if (q.brightness < settings.MIN_FACE_BRIGHTNESS || q.brightness > settings.MAX_FACE_BRIGHTNESS) throw new Fail("POOR_LIGHTING");
    if (settings.MIN_FACE_SHARPNESS > 0 && q.sharpness < settings.MIN_FACE_SHARPNESS) throw new Fail("BLURRY_FACE");
    if (second) {
      const ratio = second.box[2] / main.box[2];
      f.second_face_ratio = Math.round(ratio * 1000) / 1000;
      if (ratio >= settings.SECOND_FACE_MAX_RATIO) throw new Fail("MULTIPLE_FACES"); // dua wajah sama dekat
    }
    c.detections.push(main);
  }
}

function stepChallenges(c: Ctx) {
  let failed = false;
  c.detections.forEach((d, i) => {
    const yaw = yawRatio(d);
    const f = fs_(c, i);
    f.yaw = Math.round(yaw * 1e4) / 1e4;
    f.challenge_ok = challengeOk(c.challenges[i], yaw);
    failed ||= !f.challenge_ok; // lanjut agar skor semua frame tercatat
  });
  if (failed) throw new Fail("CHALLENGE_MISMATCH");
}

/** Frame center pertama & terakhir (frame toleh tidak dipakai untuk identitas). */
const centerIdx = (c: Ctx) => [...new Set([c.challenges.indexOf("center"), c.challenges.lastIndexOf("center")])].filter((i) => i >= 0);

async function stepEmbeddings(c: Ctx) {
  for (const i of centerIdx(c)) c.embeddings.set(i, await embed(c.images[i], c.detections[i]));
}

function stepConsistency(c: Ctx) {
  const keys = [...c.embeddings.keys()].sort((a, b) => a - b);
  const pairs: Record<string, number> = {};
  for (let a = 0; a < keys.length; a++)
    for (let b = a + 1; b < keys.length; b++) pairs[`${keys[a]}-${keys[b]}`] = Math.round(cosine(c.embeddings.get(keys[a])!, c.embeddings.get(keys[b])!) * 1e4) / 1e4;
  c.scores.consistency_scores = pairs;
  if (Object.values(pairs).some((v) => v < settings.CONSISTENCY_THRESHOLD)) throw new Fail("INCONSISTENT_FACE");
}

async function stepEnroll(c: Ctx) {
  const idx = centerIdx(c);
  const vecs = idx.map((i) => c.embeddings.get(i)!);
  const mean = new Float32Array(vecs[0].length);
  for (const v of vecs) v.forEach((x, k) => (mean[k] += x / vecs.length));
  c.scores.enroll_turn_frames_used = [];
  await db().update(schema.users).set({ faceEmbedding: toBlob(normalize(mean)), faceEnrolledAt: c.now }).where(eq(schema.users.id, c.user.id));
}

async function stepMatch(c: Ctx) {
  if (!c.user.faceEmbedding) throw new Fail("NOT_ENROLLED");
  // skor = frame center terbaik; frame lain sudah dipastikan orang yang sama oleh stepConsistency
  const template = fromBlob(c.user.faceEmbedding);
  const per: Record<string, number> = {};
  let best = -1;
  for (const [i, e] of c.embeddings) {
    per[i] = cosine(e, template);
    if (best < 0 || per[i] > per[best]) best = i;
  }
  c.matchScore = per[best];
  c.scores.match_score = Math.round(c.matchScore * 1e4) / 1e4;
  c.scores.match_scores_per_frame = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]));
  c.scores.match_threshold = settings.MATCH_THRESHOLD;
  if (c.matchScore < settings.MATCH_THRESHOLD) throw new Fail("FACE_MISMATCH");
  // cocok dengan yakin -> template bergeser sedikit ke wajah terbaru (rambut, kacamata, cahaya)
  if ((c.purpose === "in" || c.purpose === "out") && c.matchScore >= settings.TEMPLATE_UPDATE_MIN) {
    const w = settings.TEMPLATE_UPDATE_WEIGHT;
    const cur = c.embeddings.get(best)!;
    const t = normalize(template);
    const mixed = normalize(t.map((x, k) => (1 - w) * x + w * cur[k]));
    await db().update(schema.users).set({ faceEmbedding: toBlob(mixed) }).where(eq(schema.users.id, c.user.id));
    c.scores.template_updated = true;
  }
}

async function stepBusinessRules(c: Ctx) {
  const code = await checkPrerequisite(c.user, c.purpose, c.now);
  if (code) throw new Fail(code);
}

function stepMockLocation(c: Ctx) {
  const mocked = !!c.meta.is_mocked && c.meta.is_mocked !== "false";
  c.scores.is_mocked = mocked;
  if (mocked && settings.REJECT_MOCK_LOCATION) throw new Fail("MOCK_LOCATION");
}

async function stepGeofence(c: Ctx) {
  const [office] = c.user.officeId ? await db().select().from(schema.offices).where(eq(schema.offices.id, c.user.officeId)) : [];
  if (!office) throw new Fail("NO_OFFICE");
  const g = checkGeofence(num(c.meta.lat), num(c.meta.lng), num(c.meta.accuracy), office.lat, office.lng, office.radiusM, settings.MAX_GPS_ACCURACY_M, settings.GPS_ACCURACY_ALLOWANCE_MAX_M);
  c.distanceM = g.distance;
  c.scores.distance_m = g.distance === null ? null : Math.round(g.distance * 10) / 10;
  if (!g.ok) throw new Fail(g.reason ?? "OUT_OF_RANGE");
}

async function stepPersist(c: Ctx) {
  const workDate = await resolveWorkDate(c.user, c.purpose, c.now);
  const shift = await shiftFor(c.user.id, workDate);
  let id: number;
  try {
    [{ id }] = await db()
      .insert(schema.attendances)
      .values({
        userId: c.user.id,
        workDate,
        type: c.purpose,
        checkedAt: c.now,
        shiftTypeId: shift?.shiftTypeId ?? null,
        lateMinutes: c.purpose === "in" ? await lateMinutes(c.now, shift) : null,
        lat: num(c.meta.lat),
        lng: num(c.meta.lng),
        accuracy: num(c.meta.accuracy),
        distanceM: c.distanceM,
        matchScore: c.matchScore,
      })
      .$returningId();
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new Fail(c.purpose === "in" ? "ALREADY_CHECKED_IN" : "ALREADY_CHECKED_OUT");
    throw e;
  }
  const rel = path.posix.join("attendance", workDate, `${id}.jpg`);
  const full = path.join(settings.STORAGE_DIR, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, c.frames[c.challenges.indexOf("center")]);
  await db().update(schema.attendances).set({ photoPath: rel }).where(eq(schema.attendances.id, id));
  [c.attendance] = await db().select().from(schema.attendances).where(eq(schema.attendances.id, id));
}

type Step = (c: Ctx) => Promise<void> | void;
const COMMON: Step[] = [
  (c) => {
    c.scores.frame_count = c.frames.length;
    if (c.frames.length !== c.challenges.length) throw new Fail("FRAME_COUNT_MISMATCH");
  },
  stepDecode,
  stepDetect,
  stepChallenges,
  stepEmbeddings,
  stepConsistency,
];
const PIPELINE: Record<string, Step[]> = {
  enroll: [...COMMON, stepEnroll],
  // pindai ulang: harus cocok dengan template lama dulu (cegah pengambilalihan akun)
  reenroll: [...COMMON, stepMatch, stepEnroll],
  in: [...COMMON, stepMatch, stepBusinessRules, stepMockLocation, stepGeofence, stepPersist],
  out: [...COMMON, stepMatch, stepBusinessRules, stepMockLocation, stepGeofence, stepPersist],
};

export type VerifyResult = { success: boolean; reasonCode: string; purpose: string; matchScore: number | null; distanceM: number | null; scores: Record<string, unknown>; attendance: Attendance | null };

export async function runVerification(user: User, sessionId: string, frames: Buffer[], meta: Meta, now = new Date()): Promise<VerifyResult> {
  const c: Ctx = { user, sessionId, frames, meta, now, purpose: "", challenges: [], images: [], detections: [], embeddings: new Map(), scores: {}, matchScore: null, distanceM: null, attendance: null };
  c.scores.captured_at = meta.captured_at ?? null;
  let code = "OK";
  try {
    const [sess] = await db().select().from(schema.faceSessions).where(eq(schema.faceSessions.id, sessionId));
    if (sess && sess.userId === user.id) {
      c.purpose = sess.purpose;
      c.challenges = [...sess.challenges];
    }
    const claim = await claimSession(sessionId, user, now);
    if (claim) throw new Fail(claim);
    for (const step of PIPELINE[c.purpose] ?? []) await step(c);
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    code = e.code;
  }
  await db()
    .insert(schema.attempts)
    .values({ sessionId, userId: user.id, purpose: c.purpose || "unknown", success: code === "OK", reasonCode: code, scores: c.scores, lat: num(meta.lat), lng: num(meta.lng), accuracy: num(meta.accuracy), distanceM: c.distanceM });
  if ((code === "MOCK_LOCATION" || code === "FACE_MISMATCH") && (c.purpose === "in" || c.purpose === "out")) {
    await notifyManagers(user, "attendance", `Verifikasi gagal · ${user.name}`, code === "MOCK_LOCATION" ? "Lokasi palsu terdeteksi" : "Wajah tidak cocok", `/attendance?detail=${user.id}`);
  }
  return { success: code === "OK", reasonCode: code, purpose: c.purpose, matchScore: c.matchScore, distanceM: c.distanceM, scores: c.scores, attendance: c.attendance };
}
