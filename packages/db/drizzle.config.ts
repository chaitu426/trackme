import { defineConfig } from "drizzle-kit";
import { env } from "@trackme/config";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "../../infra/migrations/postgres",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});

