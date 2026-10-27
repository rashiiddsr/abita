/**
 * bcrypt di worker thread. bcryptjs murni JavaScript: satu login (cost 12) memakai ~270 ms CPU dan, bila dijalankan
 * di thread utama, membekukan seluruh API (termasuk check in) selama itu. Di sini hash/compare dikerjakan oleh
 * kumpulan worker kecil sehingga thread utama tetap melayani permintaan lain saat jam sibuk.
 * Saat dijalankan dari sumber TypeScript (tsx: seed, skrip) worker tidak tersedia -> langsung di thread ini.
 */
import os from "node:os";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import bcrypt from "bcryptjs";

type Job = { id: number; op: "hash" | "compare"; pw: string; arg: string | number };
type Reply = { id: number; ok: boolean; value?: string | boolean; error?: string };

const COST = 12;

// ------------------------------------------------------------------ sisi worker
if (!isMainThread && parentPort) {
  const port = parentPort;
  port.on("message", async (j: Job) => {
    try {
      const value = j.op === "hash" ? await bcrypt.hash(j.pw, j.arg as number) : await bcrypt.compare(j.pw, j.arg as string);
      port.postMessage({ id: j.id, ok: true, value } satisfies Reply);
    } catch (e) {
      port.postMessage({ id: j.id, ok: false, error: (e as Error).message } satisfies Reply);
    }
  });
}

// ------------------------------------------------------------------ sisi thread utama
const SIZE = Math.max(1, Math.min(4, os.availableParallelism() - 1));
const canSpawn = isMainThread && __filename.endsWith(".js");
type Slot = { w: Worker; ids: Set<number> };
let pool: Slot[] | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (v: string | boolean) => void; reject: (e: Error) => void }>();

function workers() {
  if (pool) return pool;
  pool = Array.from({ length: SIZE }, () => {
    const w = new Worker(__filename);
    w.unref(); // tidak menahan proses tetap hidup saat dimatikan
    const slot: Slot = { w, ids: new Set() };
    w.on("message", (r: Reply) => {
      slot.ids.delete(r.id);
      const p = waiting.get(r.id);
      waiting.delete(r.id);
      if (!p) return;
      if (r.ok) p.resolve(r.value!);
      else p.reject(new Error(r.error));
    });
    // worker mati: pekerjaannya gagal (bukan menggantung), kumpulan dibuat ulang pada permintaan berikutnya
    const fail = () => {
      if (pool?.includes(slot)) for (const other of pool) if (other !== slot) void other.w.terminate();
      pool = null;
      for (const id of slot.ids) {
        waiting.get(id)?.reject(new Error("password worker stopped"));
        waiting.delete(id);
      }
      slot.ids.clear();
    };
    w.on("error", fail);
    w.on("exit", fail);
    return slot;
  });
  return pool;
}

function run(op: Job["op"], pw: string, arg: string | number): Promise<string | boolean> {
  if (!canSpawn) return op === "hash" ? bcrypt.hash(pw, arg as number) : bcrypt.compare(pw, arg as string);
  const slot = workers().reduce((a, b) => (b.ids.size < a.ids.size ? b : a));
  const id = ++seq;
  slot.ids.add(id);
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    slot.w.postMessage({ id, op, pw, arg } satisfies Job);
  });
}

export const bcryptHash = (pw: string) => run("hash", pw, COST) as Promise<string>;
export const bcryptCompare = (pw: string, hash: string) => run("compare", pw, hash) as Promise<boolean>;
