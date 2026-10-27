/**
 * Tipe "di kabel": nilai yang boleh dikembalikan handler API untuk tipe respons T.
 * Date dari database diserialisasi menjadi string ISO oleh JSON, jadi field string boleh berupa Date.
 * Pemeta di API memakai `: Wire<User>` agar field yang hilang/salah nama/berlebih gagal saat compile.
 */
export type Wire<T> = T extends string
  ? string extends T
    ? string | Date
    : T
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
