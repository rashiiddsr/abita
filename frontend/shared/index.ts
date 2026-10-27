/**
 * Kontrak API ABiTA (tipe respons & body) untuk admin/ dan staff/. Hanya tipe yang dipakai (export type),
 * jadi zod tidak ikut ke bundel. Salinan dari backend/src/shared; ubah keduanya bersamaan bila kontrak berubah.
 */
export * from "./common";
export * from "./requests";
export * from "./responses";
export type { Wire } from "./wire";
