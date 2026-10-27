import { defineConfig } from "drizzle-kit";
import { settings } from "./src/core/config";

// npm run db:push -> menyamakan struktur tabel MySQL dengan src/db/schema.ts
export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: settings.DATABASE_URL },
  strict: false,
  verbose: true,
});
