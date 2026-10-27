/** Alur verifikasi wajah live: kamera → sesi server → gerakan acak → kirim frame → hasil (server yang memutuskan). */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import type { Challenge, FaceSession, SubmitResult } from "../types";
import { ChallengeConfig, generalHint, NO_FACE, StepRunner, type FrameInfo } from "./challenge";
import { FaceEngine } from "./engine";

export type Purpose = "enroll" | "reenroll" | "in" | "out";
export type Stage = "starting" | "idle" | "preparing" | "running" | "submitting" | "success" | "failed";

// alasan yang tidak bisa diulang dengan mencoba lagi
const FINAL = new Set(["ALREADY_CHECKED_IN", "ALREADY_CHECKED_OUT", "ALREADY_ENROLLED", "NOT_CHECKED_IN", "NOT_ENROLLED", "ACCOUNT_INACTIVE"]);

export function useVerifier(purpose: Purpose, meta: () => Record<string, unknown>) {
  const engine = useRef<FaceEngine | null>(null);
  const [stage, setStage] = useState<Stage>("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [frame, setFrame] = useState<FrameInfo>(NO_FACE);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [step, setStep] = useState(0);
  const [total, setTotal] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [remaining, setRemaining] = useState(ChallengeConfig.stepTimeoutMs);
  const [fail, setFail] = useState<{ message: string; code?: string; canRetry: boolean } | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const run = useRef<{ session: FaceSession; idx: number; runner: StepRunner; grabbed: (Promise<Blob> | null)[]; at: (string | null)[]; finishing: boolean } | null>(null);
  const stageRef = useRef<Stage>("starting");
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const set = (s: Stage) => {
    stageRef.current = s;
    setStage(s);
  };

  const failWith = useCallback((message: string, code?: string, canRetry = true) => {
    run.current = null;
    set("failed");
    setFail({ message, code, canRetry });
  }, []);

  const submit = useCallback(async () => {
    const r = run.current!;
    set("submitting");
    try {
      const frames = await Promise.all(r.grabbed.map((g) => g!));
      const form = new FormData();
      frames.forEach((b, i) => form.append("frames", b, `frame-${i}.jpg`));
      form.append("meta", JSON.stringify({ captured_at: r.at, user_agent: "abita-web", ...metaRef.current() }));
      const res = await api<SubmitResult>(`/sessions/${r.session.session_id}/submit`, { body: form });
      setResult(res);
      if (res.success) set("success");
      else failWith(res.message, res.reason_code, !FINAL.has(res.reason_code));
    } catch (e) {
      failWith(e instanceof Error ? e.message : String(e));
    }
  }, [failWith]);

  const onFrame = useCallback(
    (info: FrameInfo) => {
      const r = run.current;
      if (stageRef.current !== "running" || !r || r.finishing) {
        if (stageRef.current === "idle" || stageRef.current === "failed") setFrame(info);
        return;
      }
      const now = performance.now();
      const u = r.runner.update(info, now);
      setFrame(info);
      if (u.kind === "timeout") return failWith("Waktu habis. Ikuti instruksi di layar lalu coba lagi.", "TIMEOUT");
      if (u.kind === "done" && u.capture) {
        r.grabbed[r.idx] = engine.current!.grab(); // frame mentah yang sama dengan yang baru dianalisis
        r.at[r.idx] = new Date().toISOString();
      }
      if (u.kind === "done") {
        r.idx++;
        if (r.idx >= r.session.challenges.length) {
          r.finishing = true;
          void submit();
          return;
        }
        r.runner = new StepRunner(r.session.challenges[r.idx], now);
        setChallenge(r.session.challenges[r.idx]);
        setStep(r.idx);
        setHint(null);
        setProgress(0);
      } else {
        setHint(u.hint ?? null);
        setProgress(u.progress ?? 0);
      }
    },
    [failWith, submit],
  );

  const openCamera = useCallback(async () => {
    if (engine.current) return true;
    set("starting");
    setCameraError(null);
    const e = new FaceEngine();
    e.onFrame = onFrame;
    try {
      await e.start();
      engine.current = e;
      set("idle");
      return true;
    } catch (err) {
      e.stop();
      const message = err instanceof Error ? err.message : String(err);
      setCameraError(message);
      failWith(message);
      return false;
    }
  }, [onFrame, failWith]);

  /** Satu percobaan = satu sesi baru dari server (gerakan acak baru). */
  const start = useCallback(async () => {
    if (!engine.current && !(await openCamera())) return;
    set("preparing");
    setFail(null);
    setResult(null);
    setHint(null);
    setProgress(0);
    try {
      const session = await api<FaceSession>("/sessions", { body: { purpose } });
      const now = performance.now();
      run.current = { session, idx: 0, runner: new StepRunner(session.challenges[0], now), grabbed: session.challenges.map(() => null), at: session.challenges.map(() => null), finishing: false };
      setTotal(session.challenges.length);
      setStep(0);
      setChallenge(session.challenges[0]);
      setRemaining(ChallengeConfig.stepTimeoutMs);
      set("running");
    } catch (e) {
      if (e instanceof ApiError) failWith(e.message, e.reasonCode, e.status !== 409);
      else failWith(String(e));
    }
  }, [openCamera, purpose, failWith]);

  // hitung mundur langkah berjalan
  useEffect(() => {
    if (stage !== "running") return;
    const t = window.setInterval(() => {
      const r = run.current;
      if (!r) return;
      const left = ChallengeConfig.stepTimeoutMs - (performance.now() - r.runner.startedAt);
      setRemaining(Math.max(0, left));
      if (left <= 0) failWith("Waktu habis. Ikuti instruksi di layar lalu coba lagi.", "TIMEOUT");
    }, 200);
    return () => window.clearInterval(t);
  }, [stage, failWith]);

  useEffect(() => {
    void openCamera();
    return () => {
      engine.current?.stop();
      engine.current = null;
    };
  }, [openCamera]);

  return {
    video: engine.current?.video ?? null,
    stage,
    cameraError,
    frame,
    faceOk: generalHint(frame) === null,
    challenge,
    step,
    total,
    hint,
    progress,
    remaining,
    fail,
    result,
    start,
  };
}
