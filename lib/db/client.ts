import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

const connectionString = process.env.DATABASE_URL;

export const sql = connectionString
  ? postgres(connectionString, { max: 10, prepare: false })
  : null;

export const db = sql ? drizzle(sql, { schema }) : null;

export function requireDatabase() {
  if (!db) {
    throw new Error("DATABASE_URL is required for persistent production state.");
  }
  return db;
}
