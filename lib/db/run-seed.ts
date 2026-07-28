import { sql } from "@/lib/db/client";
import { seedDefaultWorkspace } from "@/lib/db/seed";

async function main() {
  await seedDefaultWorkspace();
  await sql?.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql?.end();
  process.exitCode = 1;
});
