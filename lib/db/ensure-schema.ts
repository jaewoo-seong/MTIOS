import { readFile } from "node:fs/promises";
import { sql } from "@/lib/db/client";

async function main() {
  if (!sql) throw new Error("DATABASE_URL is required.");
  const [result] = await sql<{ table_name: string | null }[]>`
    select to_regclass('public.organizations')::text as table_name
  `;
  if (result?.table_name) {
    await sql.end();
    return;
  }

  const migration = await readFile(
    new URL("../../drizzle/0000_salty_vision.sql", import.meta.url),
    "utf8"
  );
  await sql.unsafe(migration.replaceAll("--> statement-breakpoint", ""));
  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql?.end();
  process.exitCode = 1;
});
