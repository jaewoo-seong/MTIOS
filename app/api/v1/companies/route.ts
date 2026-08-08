import { NextResponse } from "next/server";
import { parseJson } from "@/lib/http";
import { registerCompany } from "@/lib/company-research";
import { companyInputSchema } from "@/lib/company-input";

import { guard } from "@/lib/api/guard";
export const POST = guard(async (request) => {
  const parsed = await parseJson(request, companyInputSchema);
  if (parsed.error) return parsed.error;
  const result = await registerCompany(parsed.data);
  return NextResponse.json({ data: result }, { status: result.created ? 201 : 200 });
});
