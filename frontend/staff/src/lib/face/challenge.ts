/**
 * Mesin langkah liveness di klien (hadap · toleh kiri · toleh kanan · hadap). Klien hanya MEMBIMBING;
 * server memeriksa ulang setiap frame dengan model wajah yang sama untuk semua perangkat.
 * Padanan mobile/lib/face/challenge.dart.
 */
import type { Challenge } from "../types";

export const ChallengeConfig = {
  /** yaw positif = orang menoleh ke KIRI-nya (frame mentah, belum di-mirror). */
  leftIsPositive: true,
  turnMinDeg: 20,
  centerMaxDeg: 12,
  centerMaxPitchDeg: 18,
  /** wajah lain hanya dihitung bila hampir sama dekat (lebar >= 80% wajah utama) */
  secondFaceRatio: 0.8,
  minFaceWidth: 0.25,
  /** kecerahan wajah (server menolak < 40 atau > 235; di sini sedikit lebih ketat agar diarahkan lebih dulu) */
  minBrightness: 50,
  maxBrightness: 225,
  turnWidthFactor: 0.8,
  centerZone: 0.18,
  centerStableMs: 400,
  turnHoldFrames: 2,
  stepTimeoutMs: 10_000,
};

export type FrameInfo = {
  faces: number; // wajah yang hampir sama dekat dengan wajah utama
  yawDeg: number | null;
  pitchDeg: number | null;
  faceWidth: number | null; // 0..1 terhadap lebar frame
  centerOffset: number | null; // jarak pusat wajah dari tengah frame
  brightness?: number | null; // kecerahan rata-rata area wajah 0..255 (diambil berkala)
  box?: [number, number, number, number]; // area wajah 0..1: x, y, lebar, tinggi
};
export const NO_FACE: FrameInfo = { faces: 0, yawDeg: null, pitchDeg: null, faceWidth: null, centerOffset: null };

export type StepUpdate = { kind: "progress" | "done" | "timeout"; hint?: string; progress?: number; capture?: boolean };

const isLeft = (yaw: number) => (ChallengeConfig.leftIsPositive ? yaw >= ChallengeConfig.turnMinDeg : yaw <= -ChallengeConfig.turnMinDeg);
const isRight = (yaw: number) => (ChallengeConfig.leftIsPositive ? yaw <= -ChallengeConfig.turnMinDeg : yaw >= ChallengeConfig.turnMinDeg);

export function generalHint(f: FrameInfo, challenge?: Challenge): string | null {
  if (f.faces === 0) return "Wajah tidak terlihat";
  if (f.faces > 1) return "Pastikan hanya Anda yang paling dekat ke kamera";
  const turning = challenge === "turn_left" || challenge === "turn_right";
  const minW = ChallengeConfig.minFaceWidth * (turning ? ChallengeConfig.turnWidthFactor : 1);
  if ((f.faceWidth ?? 0) < minW) return "Dekatkan wajah ke kamera";
  if (f.brightness != null && f.brightness < ChallengeConfig.minBrightness) return "Cari tempat yang lebih terang";
  if (f.brightness != null && f.brightness > ChallengeConfig.maxBrightness) return "Cahaya terlalu silau, hindari lampu langsung";
  return null;
}

export class StepRunner {
  private stableSince: number | null = null;
  private turnHits = 0;
  constructor(
    public challenge: Challenge,
    public startedAt: number,
  ) {}

  timedOut(now: number) {
    return now - this.startedAt > ChallengeConfig.stepTimeoutMs;
  }

  update(f: FrameInfo, now: number): StepUpdate {
    if (this.timedOut(now)) return { kind: "timeout" };
    const hint = generalHint(f, this.challenge);
    if (hint) {
      this.stableSince = null;
      this.turnHits = 0;
      return { kind: "progress", hint };
    }
    const yaw = f.yawDeg ?? 0;
    if (this.challenge === "center") {
      if (Math.abs(yaw) > ChallengeConfig.centerMaxDeg || Math.abs(f.pitchDeg ?? 0) > ChallengeConfig.centerMaxPitchDeg) {
        this.stableSince = null;
        return { kind: "progress", hint: "Luruskan wajah ke kamera" };
      }
      if ((f.centerOffset ?? 1) > ChallengeConfig.centerZone) {
        this.stableSince = null;
        return { kind: "progress", hint: "Posisikan wajah di tengah bingkai" };
      }
      this.stableSince ??= now;
      const held = now - this.stableSince;
      if (held >= ChallengeConfig.centerStableMs) return { kind: "done", capture: true };
      return { kind: "progress", hint: "Tahan…", progress: held / ChallengeConfig.centerStableMs };
    }
    const ok = this.challenge === "turn_left" ? isLeft(yaw) : isRight(yaw);
    this.turnHits = ok ? this.turnHits + 1 : 0;
    if (this.turnHits >= ChallengeConfig.turnHoldFrames) return { kind: "done", capture: true };
    return { kind: "progress", progress: this.turnHits / ChallengeConfig.turnHoldFrames };
  }
}

export const CHALLENGE_TEXT: Record<Challenge, string> = {
  center: "Hadap ke kamera",
  turn_left: "Toleh ke kiri",
  turn_right: "Toleh ke kanan",
};
