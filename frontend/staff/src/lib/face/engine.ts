/**
 * Kamera depan + MediaPipe Face Landmarker (di browser) untuk membimbing gerakan kepala.
 * Frame yang dianalisis & dikirim ke server adalah frame mentah (tidak di-mirror); pratinjau di-mirror lewat CSS.
 */
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { ChallengeConfig, NO_FACE, type FrameInfo } from "./challenge";

const ASSETS = `${import.meta.env.BASE_URL}mediapipe`;
let landmarker: Promise<FaceLandmarker> | null = null;

function loadLandmarker(): Promise<FaceLandmarker> {
  landmarker ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${ASSETS}/wasm`);
    const make = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${ASSETS}/face_landmarker.task`, delegate },
        runningMode: "VIDEO",
        numFaces: 2,
      });
    try {
      return await make("GPU");
    } catch {
      return make("CPU");
    }
  })().catch((e) => {
    landmarker = null;
    throw e;
  });
  return landmarker;
}

/** Indeks 478-landmark: 1 = ujung hidung, 33 & 263 = sudut luar mata. */
function analyze(res: FaceLandmarkerResult): FrameInfo {
  const all = res.faceLandmarks;
  if (!all.length) return NO_FACE;
  // wajah utama = terlebar (paling dekat); wajah di latar hanya dihitung bila hampir sama dekat
  const spans = all.map((pts) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)));
  const main = spans.indexOf(Math.max(...spans));
  const lm = all[main];
  let minX = 1,
    maxX = 0,
    minY = 1,
    maxY = 0;
  for (const p of lm) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = lm[263].x - lm[33].x;
  const ratio = Math.abs(w) < 1e-6 ? 0.5 : (lm[1].x - lm[33].x) / w;
  const deg = (Math.atan((ratio - 0.5) / 0.39) * 180) / Math.PI;
  // pitch kasar dari posisi hidung relatif mata-dagu
  const eyeY = (lm[33].y + lm[263].y) / 2;
  const pitchRatio = (lm[1].y - eyeY) / Math.max(1e-6, lm[152].y - eyeY);
  const pitch = (pitchRatio - 0.42) * 90;
  const cx = (minX + maxX) / 2 - 0.5,
    cy = (minY + maxY) / 2 - 0.5;
  return {
    faces: spans.filter((s) => s >= spans[main] * ChallengeConfig.secondFaceRatio).length,
    yawDeg: ChallengeConfig.leftIsPositive ? deg : -deg,
    pitchDeg: pitch,
    faceWidth: maxX - minX,
    centerOffset: Math.max(Math.abs(cx), Math.abs(cy)),
    box: [minX, minY, maxX - minX, maxY - minY],
  };
}

export class FaceEngine {
  video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private raf = 0;
  private lastTime = -1;
  private canvas = document.createElement("canvas");
  private probe = document.createElement("canvas");
  private frames = 0;
  private bright: number | null = null;
  onFrame: ((info: FrameInfo) => void) | null = null;

  constructor() {
    const v = document.createElement("video");
    v.setAttribute("playsinline", "");
    v.muted = true;
    v.autoplay = true;
    v.className = "h-full w-full object-cover -scale-x-100";
    this.video = v;
  }

  async start() {
    if (!window.isSecureContext) throw new Error("Kamera butuh koneksi aman (HTTPS) atau localhost.");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Perangkat ini tidak mendukung kamera di browser.");
    const lm = loadLandmarker();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
    } catch (e) {
      const name = (e as DOMException)?.name;
      throw new Error(name === "NotAllowedError" ? "Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser." : "Kamera tidak bisa dibuka. Tutup aplikasi lain yang memakai kamera lalu coba lagi.");
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => undefined);
    if (this.video.readyState < 2) await new Promise((r) => this.video.addEventListener("loadeddata", r, { once: true }));
    const model = await lm;
    const loop = () => {
      const v = this.video;
      if (v.readyState >= 2 && v.currentTime !== this.lastTime) {
        this.lastTime = v.currentTime;
        try {
          const info = analyze(model.detectForVideo(v, performance.now()));
          // kecerahan wajah dihitung tiap 6 frame (cukup untuk petunjuk, hemat CPU di HP murah)
          if (info.box) {
            if (this.bright === null || ++this.frames % 6 === 0) this.bright = this.brightness(info.box);
            info.brightness = this.bright;
          }
          this.onFrame?.(info);
        } catch {
          /* frame dilewati */
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Kecerahan rata-rata area wajah (0..255) dari potongan kecil 24x24. */
  private brightness([x, y, w, h]: [number, number, number, number]): number | null {
    const v = this.video;
    const c = this.probe;
    c.width = c.height = 24;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx || !v.videoWidth) return null;
    ctx.drawImage(v, x * v.videoWidth, y * v.videoHeight, w * v.videoWidth, h * v.videoHeight, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  }

  /** Frame mentah saat ini sebagai JPEG. */
  grab(quality = 0.85): Promise<Blob> {
    const v = this.video;
    const c = this.canvas;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal mengambil foto."))), "image/jpeg", quality));
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.onFrame = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
