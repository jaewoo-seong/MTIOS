import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";

export async function parseJson<T>(request: Request, schema: ZodSchema<T>) {
  const body = await request.json().catch(() => null);
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      error: NextResponse.json(
        { error: "validation_error", details: result.error.flatten() },
        { status: 400 }
      )
    };
  }
  return { data: result.data };
}

export const notFound = (resource: string) =>
  NextResponse.json({ error: "not_found", resource }, { status: 404 });
