// Bentuk data /api/v1: satu sumber di packages/shared (skema zod yang sama dipakai API untuk validasi & Swagger).
// Ganti nama field di sana -> typecheck gagal di setiap pemakainya di sini.
export type * from "../../../shared";
