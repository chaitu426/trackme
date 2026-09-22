import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@trackme/config";
import * as schema from "./schema/index.js";

// Configure postgres-js connection client with sensible pool defaults
const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;

