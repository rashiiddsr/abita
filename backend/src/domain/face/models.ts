/**
 * Deteksi (YuNet) + embedding (SFace) memakai model ONNX yang sama dengan OpenCV di backend lama.
 * Pra/pasca-proses meniru cv::FaceDetectorYN dan cv::FaceRecognizerSF (face_detect.cpp / face_recognize.cpp)
 * agar template wajah lama (dibuat OpenCV) tetap cocok. Model dimuat sekali per proses.
 */
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { settings } from "../../core/config";

export type Img = { data: Uint8Array; width: number; height: number }; // RGB, 3 kanal

export type Detection = {
  box: [number, number, number, number]; // x, y, w, h
  landmarks: [number, number][]; // mata kanan, mata kiri, hidung, mulut kanan, mulut kiri (sudut pandang orang di foto)
  score: number;
};

const DET_SIZE = 640; // model YuNet 2023mar berinput tetap 1x3x640x640
const NMS_IOU = 0.3;
const STRIDES = [8, 16, 32];
// titik acuan wajah 112x112 untuk SFace (OpenCV face_recognize.cpp)
const SFACE_DST: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

type Sessions = { det: ort.InferenceSession; rec: ort.InferenceSession };
type ModelState = "loading" | "ok" | "error";
const g = globalThis as unknown as { __abitaFace?: Promise<Sessions>; __abitaFaceState?: ModelState };

/** Status model untuk /health: belum/sedang dimuat, siap, atau gagal dimuat. */
export const modelState = (): ModelState => g.__abitaFaceState ?? "loading";

export function loadModels(): Promise<Sessions> {
  g.__abitaFace ??= (async () => {
    ort.env.logLevel = "error"; // sembunyikan peringatan bawaan model YuNet/SFace
    const opts: ort.InferenceSession.SessionOptions = { logSeverityLevel: 3, intraOpNumThreads: 2 };
    const det = await ort.InferenceSession.create(path.join(settings.MODELS_DIR, "face_detection_yunet_2023mar.onnx"), opts);
    const rec = await ort.InferenceSession.create(path.join(settings.MODELS_DIR, "face_recognition_sface_2021dec.onnx"), opts);
    g.__abitaFaceState = "ok";
    return { det, rec };
  })().catch((e) => {
    g.__abitaFace = undefined;
    g.__abitaFaceState = "error";
    throw e;
  });
  return g.__abitaFace;
}

// antre: satu inferensi pada satu waktu per sesi (onnxruntime aman multi-thread, tapi CPU dibatasi agar request lain tetap jalan)
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

/** JPEG/PNG -> RGB mentah (orientasi EXIF diterapkan seperti cv2.imread). null bila bukan gambar. */
export async function decode(buf: Buffer): Promise<Img | null> {
  try {
    const { data, info } = await sharp(buf).rotate().removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) return null;
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/**
 * Kualitas area wajah: kecerahan rata-rata (0–255) dan ketajaman (varian Laplacian) pada potongan wajah
 * yang diperkecil ke 64x64 abu-abu. Murah (4.096 piksel) dan cukup untuk menolak foto gelap/silau/buram.
 */
export function faceQuality(img: Img, det: Detection): { brightness: number; sharpness: number } {
  const N = 64;
  const [bx, by, bw, bh] = det.box;
  const x0 = Math.max(0, Math.floor(bx)),
    y0 = Math.max(0, Math.floor(by));
  const x1 = Math.min(img.width - 1, Math.ceil(bx + bw)),
    y1 = Math.min(img.height - 1, Math.ceil(by + bh));
  const gray = new Float32Array(N * N);
  let sum = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = Math.min(x1, x0 + Math.floor(((i + 0.5) * (x1 - x0)) / N));
      const y = Math.min(y1, y0 + Math.floor(((j + 0.5) * (y1 - y0)) / N));
      const k = (y * img.width + x) * 3;
      const v = 0.299 * img.data[k] + 0.587 * img.data[k + 1] + 0.114 * img.data[k + 2];
      gray[j * N + i] = v;
      sum += v;
    }
  let lsum = 0,
    lsq = 0;
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      const l = gray[c - 1] + gray[c + 1] + gray[c - N] + gray[c + N] - 4 * gray[c];
      lsum += l;
      lsq += l * l;
    }
  const n = (N - 2) * (N - 2);
  return { brightness: sum / (N * N), sharpness: lsq / n - (lsum / n) ** 2 };
}

// ------------------------------------------------------------------ YuNet

export async function detect(img: Img, minScore = settings.MIN_DETECTION_SCORE): Promise<Detection[]> {
  const { det } = await loadModels();
  // gambar diperkecil (bila perlu) agar muat 640x640, lalu diberi bantalan hitam di kanan/bawah seperti OpenCV
  const scale = Math.min(1, DET_SIZE / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const src = scale === 1 ? img.data : new Uint8Array(await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 3 } }).resize(w, h, { kernel: "linear" }).raw().toBuffer());
  const plane = DET_SIZE * DET_SIZE;
  const input = new Float32Array(3 * plane); // BGR, 0..255 (blobFromImage tanpa swapRB)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const o = y * DET_SIZE + x;
      input[o] = src[i + 2];
      input[plane + o] = src[i + 1];
      input[2 * plane + o] = src[i];
    }
  }
  const out = await serial(() => det.run({ input: new ort.Tensor("float32", input, [1, 3, DET_SIZE, DET_SIZE]) }));
  const faces: Detection[] = [];
  for (const s of STRIDES) {
    const cls = out[`cls_${s}`].data as Float32Array;
    const obj = out[`obj_${s}`].data as Float32Array;
    const bbox = out[`bbox_${s}`].data as Float32Array;
    const kps = out[`kps_${s}`].data as Float32Array;
    const cols = DET_SIZE / s;
    const rows = DET_SIZE / s;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const score = Math.sqrt(Math.min(1, Math.max(0, cls[idx])) * Math.min(1, Math.max(0, obj[idx])));
        if (score < minScore) continue;
        const cx = (c + bbox[idx * 4]) * s;
        const cy = (r + bbox[idx * 4 + 1]) * s;
        const bw = Math.exp(bbox[idx * 4 + 2]) * s;
        const bh = Math.exp(bbox[idx * 4 + 3]) * s;
        const lm: [number, number][] = [];
        for (let n = 0; n < 5; n++) lm.push([((kps[idx * 10 + 2 * n] + c) * s) / scale, ((kps[idx * 10 + 2 * n + 1] + r) * s) / scale]);
        faces.push({ box: [(cx - bw / 2) / scale, (cy - bh / 2) / scale, bw / scale, bh / scale], landmarks: lm, score });
      }
    }
  }
  return nms(faces).sort((a, b) => b.score - a.score);
}

function iou(a: Detection["box"], b: Detection["box"]) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

function nms(faces: Detection[]): Detection[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const f of sorted) if (keep.every((k) => iou(k.box, f.box) <= NMS_IOU)) keep.push(f);
  return keep;
}

// ------------------------------------------------------------------ SFace

/** Matriks similarity 2x3 (Umeyama) dari 5 titik wajah ke titik acuan 112x112 — sama dengan OpenCV. */
export function similarityTransform(src: [number, number][], dst: [number, number][] = SFACE_DST): number[] {
  const n = src.length;
  const ms = [0, 0];
  const md = [0, 0];
  for (let i = 0; i < n; i++) {
    ms[0] += src[i][0] / n;
    ms[1] += src[i][1] / n;
    md[0] += dst[i][0] / n;
    md[1] += dst[i][1] / n;
  }
  // A = dst_demean^T * src_demean / n
  let a00 = 0, a01 = 0, a10 = 0, a11 = 0, varSrc = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - ms[0], sy = src[i][1] - ms[1];
    const dx = dst[i][0] - md[0], dy = dst[i][1] - md[1];
    a00 += (dx * sx) / n;
    a01 += (dx * sy) / n;
    a10 += (dy * sx) / n;
    a11 += (dy * sy) / n;
    varSrc += (sx * sx + sy * sy) / n;
  }
  const det = a00 * a11 - a01 * a10;
  const d = [1, det < 0 ? -1 : 1];
  const { U, S, V } = svd2(a00, a01, a10, a11);
  // R = U * diag(d) * V^T
  const r00 = U[0] * d[0] * V[0] + U[1] * d[1] * V[1];
  const r01 = U[0] * d[0] * V[2] + U[1] * d[1] * V[3];
  const r10 = U[2] * d[0] * V[0] + U[3] * d[1] * V[1];
  const r11 = U[2] * d[0] * V[2] + U[3] * d[1] * V[3];
  const scale = varSrc > 0 ? (S[0] * d[0] + S[1] * d[1]) / varSrc : 1;
  const tx = md[0] - scale * (r00 * ms[0] + r01 * ms[1]);
  const ty = md[1] - scale * (r10 * ms[0] + r11 * ms[1]);
  return [scale * r00, scale * r01, tx, scale * r10, scale * r11, ty];
}

/** SVD 2x2: A = U diag(S) V^T. U dan V baris-mayor [m00, m01, m10, m11]. */
function svd2(a: number, b: number, c: number, d: number) {
  const e = (a + d) / 2, f = (a - d) / 2, gg = (c + b) / 2, h = (c - b) / 2;
  const q = Math.hypot(e, h), r = Math.hypot(f, gg);
  const sx = q + r, sy = q - r;
  const a1 = Math.atan2(gg, f), a2 = Math.atan2(h, e);
  const theta = (a2 - a1) / 2, phi = (a2 + a1) / 2;
  // A = R(phi) * diag(sx, sy) * R(theta)  ->  U = R(phi), V^T = R(theta)
  const U = [Math.cos(phi), -Math.sin(phi), Math.sin(phi), Math.cos(phi)];
  const Vt = [Math.cos(theta), -Math.sin(theta), Math.sin(theta), Math.cos(theta)];
  let S = [sx, sy];
  // tanda: nilai singular non-negatif
  if (sy < 0) {
    S = [sx, -sy];
    Vt[2] = -Vt[2];
    Vt[3] = -Vt[3];
  }
  const V = [Vt[0], Vt[2], Vt[1], Vt[3]]; // transpose
  return { U, S, V };
}

/** warpAffine bilinear ke 112x112 (piksel di luar gambar = hitam). */
function warp(img: Img, m: number[], size = 112): Uint8Array {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  // invers transform: dst -> src
  const ia = e / det, ib = -b / det, id = -d / det, ie = a / det;
  const ic = -(ia * c + ib * f), iff = -(id * c + ie * f);
  const out = new Uint8Array(size * size * 3);
  const { width: W, height: H, data } = img;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = ia * x + ib * y + ic;
      const sy = id * x + ie * y + iff;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const px = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : data[(yy * W + xx) * 3 + ch]);
        const v = (1 - fx) * (1 - fy) * px(x0, y0) + fx * (1 - fy) * px(x0 + 1, y0) + (1 - fx) * fy * px(x0, y0 + 1) + fx * fy * px(x0 + 1, y0 + 1);
        out[(y * size + x) * 3 + ch] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  return out;
}

/** Embedding 128-d ternormalisasi dari wajah terdeteksi. */
export async function embed(img: Img, det: Detection): Promise<Float32Array> {
  const { rec } = await loadModels();
  const aligned = warp(img, similarityTransform(det.landmarks));
  const plane = 112 * 112;
  const input = new Float32Array(3 * plane); // RGB, 0..255 (blobFromImage swapRB=true dari BGR)
  for (let i = 0; i < plane; i++) {
    input[i] = aligned[i * 3];
    input[plane + i] = aligned[i * 3 + 1];
    input[2 * plane + i] = aligned[i * 3 + 2];
  }
  const out = await serial(() => rec.run({ data: new ort.Tensor("float32", input, [1, 3, 112, 112]) }));
  return normalize(Float32Array.from(out.fc1.data as Float32Array));
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n > 0 ? v.map((x) => x / n) : v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const na = normalize(a), nb = normalize(b);
  let s = 0;
  for (let i = 0; i < na.length; i++) s += na[i] * nb[i];
  return s;
}

export const toBlob = (v: Float32Array) => Buffer.from(normalize(v).buffer.slice(0));
export const fromBlob = (b: Buffer) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));

/** Rasio posisi hidung di antara kedua mata (0.5 = lurus). Frame mentah kamera depan: menoleh ke KIRI orang itu -> naik. */
export function yawRatio(det: Detection): number {
  const [eyeA, eyeB, nose] = det.landmarks;
  const width = eyeB[0] - eyeA[0];
  return Math.abs(width) < 1e-6 ? 0.5 : (nose[0] - eyeA[0]) / width;
}
