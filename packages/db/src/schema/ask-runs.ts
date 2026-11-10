import { pgTable, text, timestamp, uuid, integer, jsonb, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";
import { sites } from "./sites.js";
import { users } from "./users.js";

/**
 * One Ask run: the question, the scope it ran under, and the grounded answer the worker produced.
 * Run state lives here (not in Redis) so a web restart, a reconnect or a replica switch can always
 * read the outcome back. `answer` is the full `Answer` JSON; `stream` events are a live convenience only.
 */
export const askRuns = pgTable(
  "ask_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    scope: jsonb("scope").default({}).notNull(),
    /** queued | running | done | failed */
    status: text("status").default("queued").notNull(),
    answer: jsonb("answer"),
    error: text("error"),
    model: text("model"),
    tokens: integer("tokens"),
    /** The worker bumps this while it holds the run; the sweeper re-queues runs whose heartbeat is stale. */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_ask_runs_workspace_created").on(table.workspaceId, table.createdAt),
    index("idx_ask_runs_status").on(table.status),
  ]
);

export type AskRun = typeof askRuns.$inferSelect;
export type NewAskRun = typeof askRuns.$inferInsert;
