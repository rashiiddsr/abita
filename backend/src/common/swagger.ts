/**
 * Dokumentasi OpenAPI (Swagger) dari skema zod di src/shared.
 * Body/query: cukup `@Body({ schema: X })` (Nest membaca skemanya); respons: `@Returns(X)`.
 */
import { applyDecorators, type INestApplication } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiResponse, DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ApiErrorBody } from "../shared";
import { z, type ZodType } from "zod";
import { COOKIE_NAME } from "../core/auth";
import { settings } from "../core/config";

export const DOCS_PATH = "api/docs";

/** Respons sukses endpoint. `list` = array dari skema; `status` default 200 (201 untuk POST tanpa @HttpCode(200)). */
export const Returns = (schema: ZodType, opts: { list?: boolean; status?: number; description?: string } = {}) =>
  applyDecorators(ApiResponse({ status: opts.status ?? 200, description: opts.description ?? "Berhasil", standardSchema: opts.list ? z.array(schema) : schema }));

/** Unggahan multipart/form-data: nama field -> "file" | "files" | deskripsi field teks. */
export const Upload = (fields: Record<string, "file" | "files" | string>, required: string[] = []) =>
  applyDecorators(
    ApiConsumes("multipart/form-data"),
    ApiBody({
      schema: {
        type: "object",
        required,
        properties: Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [
            k,
            v === "file" ? { type: "string", format: "binary" } : v === "files" ? { type: "array", items: { type: "string", format: "binary" } } : { type: "string", description: v },
          ]),
        ),
      },
    }),
  );

const ERRORS: Record<number, string> = {
  401: "Belum login / sesi kedaluwarsa",
  403: "Peran tidak diizinkan, atau kata sandi dari admin/email belum diganti",
  422: 'Validasi gagal: {"detail": [{loc, msg, type}]}',
  429: "Terlalu banyak permintaan (lihat header Retry-After)",
};

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("ABiTA API")
    .setDescription(
      [
        `API presensi wajah ${settings.ORG_NAME}. Semua endpoint di bawah \`/api/v1\`.`,
        "",
        "**Autentikasi**: dasbor & aplikasi karyawan memakai cookie httpOnly `" + COOKIE_NAME + "` (dari `POST /auth/web-login` atau `/auth/app-login`). Masuk dulu di aplikasi, lalu \"Try it out\" di halaman ini memakai cookie yang sama.",
        "",
        '**Error**: selalu `{"detail": "pesan"}`; validasi (422) berisi daftar `{loc, msg, type}`.',
        "",
        "**Daftar berhalaman**: `limit` & `offset`, total di header `X-Total-Count`.",
        "",
        "**Real-time**: `GET /events` (Server-Sent Events).",
      ].join("\n"),
    )
    .setVersion("1.0")
    .addServer("/", "Server ini")
    .addCookieAuth(COOKIE_NAME, { type: "apiKey", in: "cookie", name: COOKIE_NAME }, "cookie")
    .addSecurityRequirements("cookie")
    .build();
  const document = SwaggerModule.createDocument(app, config, { operationIdFactory: (controller, method) => `${controller.replace(/Controller$/, "")}_${method}` });
  // galat umum yang berlaku untuk semua endpoint
  const err = z.toJSONSchema(ApiErrorBody, { target: "openapi-3.0" }) as Record<string, unknown>;
  delete err.$schema;
  document.components = { ...document.components, schemas: { ...document.components?.schemas, ApiError: err } };
  for (const item of Object.values(document.paths))
    for (const op of Object.values(item) as { responses?: Record<string, unknown>; security?: unknown[] }[]) {
      if (!op?.responses) continue;
      for (const [code, description] of Object.entries(ERRORS)) {
        if (code !== "422" && code !== "429" && Array.isArray(op.security) && op.security.length === 0) continue; // endpoint publik
        op.responses[code] ??= { description, content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } };
      }
    }
  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
    yamlDocumentUrl: `${DOCS_PATH}/openapi.yaml`,
    customSiteTitle: "ABiTA API · Dokumentasi",
    swaggerOptions: { persistAuthorization: true, docExpansion: "none", filter: true, tagsSorter: "alpha", displayRequestDuration: true, validatorUrl: null }, // tanpa lencana validator online
  });
  return document;
}
