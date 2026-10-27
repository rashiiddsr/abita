/** Error HTTP & validasi bergaya API lama: {"detail": "..."} dan 422 {"detail": [{loc, msg, type}]}. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
    public headers?: Record<string, string>,
  ) {
    super(typeof detail === "string" ? detail : "HTTP " + status);
  }
}

export const fail = (status: number, detail: string): never => {
  throw new HttpError(status, detail);
};

export function parse<T>(schema: ZodType<T>, data: unknown, where = "body"): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const detail = r.error.issues.map((i) => ({ loc: [where, ...i.path.map(String)], msg: i.message, type: i.code }));
  throw new HttpError(422, detail);
}

/** Konteks per permintaan (AsyncLocalStorage): notifikasi diumumkan setelah handler berhasil. */
export type ReqStore = { notifyUids: Set<number>; pushes: number[]; actor?: { id: number; role: string; units: string[] | null } };
export const reqStore = new AsyncLocalStorage<ReqStore>();

export { zDay, zTime } from "../shared";
