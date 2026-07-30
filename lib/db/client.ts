import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

const connectionString = process.env.DATABASE_URL;

/**
 * Database construction must stay safe during `next build`.
 *
 * Next imports route modules while collecting page data, so throwing here
 * makes compilation depend on production secrets and a reachable database.
 * Production startup validation lives in `instrumentation.ts`, while
 * `requireDatabase()` keeps request-time paths fail-closed if startup hooks are
 * bypassed. The in-memory branches remain available only to local development
 * and tests.
 */

export const sql = connectionString
  ? postgres(connectionString, {
      /**
       * Sized against the work this app actually does concurrently: a dossier
       * fan-out runs ten workers, each of which calls back into the app, and
       * those callbacks compete with ordinary web traffic for connections. Ten
       * total was tight enough that a campaign could starve the UI.
       *
       * Raise `DATABASE_POOL_MAX` rather than editing this if a deployment has
       * a larger Postgres plan; the ceiling that matters is the server's
       * `max_connections` shared across every instance and the Trigger.dev
       * workers, not this number alone.
       */
      max: Number(process.env.DATABASE_POOL_MAX ?? 20),
      /**
       * Postgres-js prepares statements per connection. Left on, a pooled
       * connection through a proxy that rotates backends can be handed a
       * prepared-statement name the new backend has never seen. Off is the
       * safe default for a pooled/proxied setup and costs a little planning
       * time per query.
       */
      prepare: false,
      /** Bounds a hung connection attempt instead of holding a request open. */
      connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT_SECONDS ?? 10),
      /** Recycles idle connections so a restarted database is not held against a stale socket. */
      idle_timeout: Number(process.env.DATABASE_IDLE_TIMEOUT_SECONDS ?? 300)
    })
  : null;

export const db = sql ? drizzle(sql, { schema }) : null;

export function requireDatabase() {
  if (!db) {
    throw new Error("DATABASE_URL is required for persistent production state.");
  }
  return db;
}
